#!/usr/bin/env python3
"""
Generic ETL script: fetch data from a third-party REST API, transform it,
and store it locally. Handles retries, rate limits, and common HTTP errors.
"""

import argparse
import json
import logging
import os
import sqlite3
import sys
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

DEFAULT_API_URL = "https://jsonplaceholder.typicode.com/posts"
DEFAULT_OUTPUT = "output/posts.jsonl"
DEFAULT_DB_PATH = "output/posts.db"
DEFAULT_RATE_LIMIT_RPS = 5.0
DEFAULT_TIMEOUT = 30
DEFAULT_MAX_RETRIES = 5
DEFAULT_BACKOFF = 1.0  # seconds


def env(key: str, default: Any = None) -> Any:
    return os.getenv(key, default)


# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------

def setup_logging(level: int = logging.INFO) -> None:
    logging.basicConfig(
        level=level,
        format="%(asctime)s | %(levelname)-8s | %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S %Z",
    )


# ---------------------------------------------------------------------------
# HTTP client with retries and rate-limit awareness
# ---------------------------------------------------------------------------

class RateLimitSession(requests.Session):
    """
    A requests.Session that:
      - retries transient errors with exponential backoff,
      - respects HTTP 429 / Retry-After headers,
      - enforces a simple per-request rate ceiling.
    """

    def __init__(
        self,
        max_retries: int = DEFAULT_MAX_RETRIES,
        backoff_factor: float = DEFAULT_BACKOFF,
        rate_limit_rps: float = DEFAULT_RATE_LIMIT_RPS,
        timeout: int = DEFAULT_TIMEOUT,
    ):
        super().__init__()
        self.timeout = timeout
        self._min_interval = 1.0 / rate_limit_rps if rate_limit_rps > 0 else 0.0
        self._last_request_time: float = 0.0

        retry_strategy = Retry(
            total=max_retries,
            backoff_factor=backoff_factor,
            status_forcelist=[429, 500, 502, 503, 504],
            allowed_methods=["HEAD", "GET", "OPTIONS"],
            respect_retry_after_header=True,
        )
        adapter = HTTPAdapter(max_retries=retry_strategy)
        self.mount("https://", adapter)
        self.mount("http://", adapter)

    def request(self, method: str, url: str, **kwargs: Any) -> requests.Response:
        # Simple client-side rate cap
        if self._min_interval > 0:
            elapsed = time.monotonic() - self._last_request_time
            if elapsed < self._min_interval:
                sleep_for = self._min_interval - elapsed
                logging.debug("Rate-limit sleep: %.3fs", sleep_for)
                time.sleep(sleep_for)

        kwargs.setdefault("timeout", self.timeout)
        response = super().request(method, url, **kwargs)
        self._last_request_time = time.monotonic()
        return response


# ---------------------------------------------------------------------------
# Data model
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class Post:
    id: int
    user_id: int
    title: str
    body: str
    fetched_at: str


# ---------------------------------------------------------------------------
# Fetch
# ---------------------------------------------------------------------------

def fetch_posts(
    session: RateLimitSession,
    url: str,
    params: dict[str, Any] | None = None,
) -> list[dict[str, Any]]:
    """Fetch raw records from the API. Raises on unrecoverable errors."""
    logging.info("Fetching data from %s", url)
    response = session.get(url, params=params)
    response.raise_for_status()
    data = response.json()
    if not isinstance(data, list):
        raise ValueError(f"Expected a JSON array from {url!r}, got {type(data).__name__}")
    logging.info("Fetched %d raw records", len(data))
    return data


# ---------------------------------------------------------------------------
# Transform
# ---------------------------------------------------------------------------

def transform_post(raw: dict[str, Any], fetched_at: str) -> Post:
    """Normalize and validate a single raw record."""
    try:
        return Post(
            id=int(raw["id"]),
            user_id=int(raw["userId"]),
            title=str(raw["title"]).strip(),
            body=str(raw["body"]).strip(),
            fetched_at=fetched_at,
        )
    except (KeyError, ValueError, TypeError) as exc:
        raise ValueError(f"Invalid record: {raw!r}") from exc


def transform_posts(raw_records: list[dict[str, Any]]) -> list[Post]:
    fetched_at = datetime.now(timezone.utc).isoformat()
    transformed: list[Post] = []
    errors: list[str] = []

    for idx, raw in enumerate(raw_records):
        try:
            transformed.append(transform_post(raw, fetched_at))
        except ValueError as exc:
            errors.append(f"Record {idx}: {exc}")

    if errors:
        # Log but don't fail the whole batch; adjust to your SLA.
        logging.warning("Transformation errors (%d kept, %d dropped)", len(transformed), len(errors))
        for err in errors[:10]:
            logging.warning("  %s", err)
        if len(errors) > 10:
            logging.warning("  ... and %d more", len(errors) - 10)

    return transformed


# ---------------------------------------------------------------------------
# Store
# ---------------------------------------------------------------------------

def store_jsonl(posts: list[Post], path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as f:
        for post in posts:
            f.write(json.dumps(post.__dict__, ensure_ascii=False) + "\n")
    logging.info("Wrote %d records to %s", len(posts), path)


def store_sqlite(posts: list[Post], db_path: Path) -> None:
    db_path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(db_path)
    try:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS posts (
                id INTEGER PRIMARY KEY,
                user_id INTEGER NOT NULL,
                title TEXT NOT NULL,
                body TEXT NOT NULL,
                fetched_at TEXT NOT NULL
            )
            """
        )
        conn.execute("DELETE FROM posts")
        conn.executemany(
            "INSERT INTO posts (id, user_id, title, body, fetched_at) VALUES (?, ?, ?, ?, ?)",
            [(p.id, p.user_id, p.title, p.body, p.fetched_at) for p in posts],
        )
        conn.commit()
        logging.info("Wrote %d records to SQLite %s", len(posts), db_path)
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="ETL from third-party API")
    parser.add_argument("--api-url", default=env("API_URL", DEFAULT_API_URL), help="API endpoint URL")
    parser.add_argument("--output", default=env("OUTPUT_PATH", DEFAULT_OUTPUT), help="JSONL output path")
    parser.add_argument("--db", default=env("DB_PATH", DEFAULT_DB_PATH), help="SQLite output path")
    parser.add_argument("--format", choices=["jsonl", "sqlite", "both"], default=env("OUTPUT_FORMAT", "jsonl"))
    parser.add_argument("--rate-limit-rps", type=float, default=float(env("RATE_LIMIT_RPS", DEFAULT_RATE_LIMIT_RPS)))
    parser.add_argument("--max-retries", type=int, default=int(env("MAX_RETRIES", DEFAULT_MAX_RETRIES)))
    parser.add_argument("--timeout", type=int, default=int(env("TIMEOUT", DEFAULT_TIMEOUT)))
    parser.add_argument("--backoff", type=float, default=float(env("BACKOFF_FACTOR", DEFAULT_BACKOFF)))
    parser.add_argument("--limit", type=int, default=None, help="Limit number of records fetched (for testing)")
    parser.add_argument("--verbose", action="store_true", help="Enable debug logging")
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)

    setup_logging(logging.DEBUG if args.verbose else logging.INFO)

    params = {"_limit": args.limit} if args.limit else None

    try:
        with RateLimitSession(
            max_retries=args.max_retries,
            backoff_factor=args.backoff,
            rate_limit_rps=args.rate_limit_rps,
            timeout=args.timeout,
        ) as session:
            raw_records = fetch_posts(session, args.api_url, params=params)
    except requests.exceptions.HTTPError as exc:
        logging.error("HTTP error: %s - %s", exc.response.status_code, exc.response.text[:200])
        return 1
    except requests.exceptions.RequestException as exc:
        logging.error("Network error after retries: %s", exc)
        return 1
    except ValueError as exc:
        logging.error("Unexpected API response: %s", exc)
        return 1

    posts = transform_posts(raw_records)
    if not posts:
        logging.warning("No valid records to store")
        return 0

    try:
        if args.format in ("jsonl", "both"):
            store_jsonl(posts, Path(args.output))
        if args.format in ("sqlite", "both"):
            store_sqlite(posts, Path(args.db))
    except OSError as exc:
        logging.error("Storage failed: %s", exc)
        return 1

    logging.info("ETL completed successfully")
    return 0


if __name__ == "__main__":
    sys.exit(main())

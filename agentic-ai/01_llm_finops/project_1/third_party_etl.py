#!/usr/bin/env python3
"""Pull JSON data from a third-party API, transform it, and store it as JSONL."""

from __future__ import annotations

import argparse
import json
import logging
import os
import re
import sys
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from pathlib import Path
from typing import Any, Callable
from urllib.error import HTTPError, URLError
from urllib.parse import urljoin
from urllib.request import Request, urlopen


JsonValue = dict[str, Any] | list[Any] | str | int | float | bool | None
Opener = Callable[..., Any]
Sleeper = Callable[[float], None]


class ApiRequestError(RuntimeError):
    """Raised when the API cannot be read after retry handling."""


class ConfigError(ValueError):
    """Raised when required runtime configuration is missing."""


@dataclass(frozen=True)
class RetryConfig:
    max_attempts: int = 4
    base_delay: float = 1.0
    max_delay: float = 30.0


def build_headers(api_token: str | None = None) -> dict[str, str]:
    headers = {
        "Accept": "application/json",
        "User-Agent": "third-party-etl/1.0",
    }
    if api_token:
        headers["Authorization"] = f"Bearer {api_token}"
    return headers


def request_json(
    url: str,
    *,
    headers: dict[str, str],
    retry_config: RetryConfig,
    timeout: float = 30.0,
    opener: Opener = urlopen,
    sleeper: Sleeper = time.sleep,
) -> JsonValue:
    last_error: Exception | None = None

    for attempt in range(1, retry_config.max_attempts + 1):
        request = Request(url, headers=headers, method="GET")
        try:
            with opener(request, timeout=timeout) as response:
                body = response.read().decode("utf-8")
                return json.loads(body)
        except HTTPError as error:
            last_error = error
            if not _should_retry_status(error.code) or attempt == retry_config.max_attempts:
                raise ApiRequestError(f"API request failed with HTTP {error.code}: {url}") from error

            delay = _retry_delay(error, attempt, retry_config)
            logging.warning(
                "API returned HTTP %s for %s; retrying in %.1fs",
                error.code,
                url,
                delay,
            )
            sleeper(delay)
        except (TimeoutError, URLError, OSError) as error:
            last_error = error
            if attempt == retry_config.max_attempts:
                raise ApiRequestError(f"API request failed after {attempt} attempts: {url}") from error

            delay = _backoff_delay(attempt, retry_config)
            logging.warning("API request error for %s; retrying in %.1fs: %s", url, delay, error)
            sleeper(delay)
        except json.JSONDecodeError as error:
            raise ApiRequestError(f"API returned invalid JSON: {url}") from error

    raise ApiRequestError(f"API request failed: {url}") from last_error


def fetch_records(
    api_url: str,
    *,
    headers: dict[str, str],
    retry_config: RetryConfig,
    data_key: str = "items",
    next_key: str = "next",
    max_pages: int = 100,
    timeout: float = 30.0,
    opener: Opener = urlopen,
    sleeper: Sleeper = time.sleep,
) -> list[dict[str, Any]]:
    records: list[dict[str, Any]] = []
    next_url: str | None = api_url

    for _ in range(max_pages):
        if not next_url:
            return records

        payload = request_json(
            next_url,
            headers=headers,
            retry_config=retry_config,
            timeout=timeout,
            opener=opener,
            sleeper=sleeper,
        )
        page_records, page_next = _extract_page(payload, data_key=data_key, next_key=next_key)
        records.extend(page_records)
        next_url = urljoin(next_url, page_next) if page_next else None

    raise ApiRequestError(f"Stopped after {max_pages} pages without reaching the end of pagination")


def transform_record(record: dict[str, Any]) -> dict[str, Any]:
    return {_to_snake_case(key): value for key, value in record.items()}


def write_jsonl(records: list[dict[str, Any]], output_path: str | Path) -> int:
    path = Path(output_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temp_path = path.with_name(f".{path.name}.tmp")

    with temp_path.open("w", encoding="utf-8") as output_file:
        for record in records:
            output_file.write(json.dumps(record, ensure_ascii=False))
            output_file.write("\n")

    temp_path.replace(path)
    return len(records)


def run(args: argparse.Namespace) -> int:
    if not args.api_url:
        raise ConfigError("API URL is required. Pass --api-url or set API_URL.")

    logging.basicConfig(
        level=logging.INFO if not args.verbose else logging.DEBUG,
        format="%(levelname)s %(message)s",
    )

    retry_config = RetryConfig(
        max_attempts=args.max_attempts,
        base_delay=args.base_delay,
        max_delay=args.max_delay,
    )
    headers = build_headers(args.api_token)

    logging.info("Fetching records from %s", args.api_url)
    records = fetch_records(
        args.api_url,
        headers=headers,
        retry_config=retry_config,
        data_key=args.data_key,
        next_key=args.next_key,
        max_pages=args.max_pages,
        timeout=args.timeout,
    )
    transformed = [transform_record(record) for record in records]
    count = write_jsonl(transformed, args.output)
    logging.info("Stored %s records in %s", count, args.output)
    return count


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--api-url", default=os.getenv("API_URL"), help="JSON API endpoint to read")
    parser.add_argument("--api-token", default=os.getenv("API_TOKEN"), help="Bearer token, if required")
    parser.add_argument(
        "--output",
        default=os.getenv("OUTPUT_PATH", "data.jsonl"),
        help="Path to write transformed JSONL records",
    )
    parser.add_argument("--data-key", default=os.getenv("DATA_KEY", "items"))
    parser.add_argument("--next-key", default=os.getenv("NEXT_KEY", "next"))
    parser.add_argument("--max-pages", type=int, default=int(os.getenv("MAX_PAGES", "100")))
    parser.add_argument("--timeout", type=float, default=float(os.getenv("API_TIMEOUT", "30")))
    parser.add_argument("--max-attempts", type=int, default=int(os.getenv("MAX_ATTEMPTS", "4")))
    parser.add_argument("--base-delay", type=float, default=float(os.getenv("BASE_DELAY", "1")))
    parser.add_argument("--max-delay", type=float, default=float(os.getenv("MAX_DELAY", "30")))
    parser.add_argument("--verbose", action="store_true")
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    try:
        run(parse_args(argv or sys.argv[1:]))
        return 0
    except (ApiRequestError, ConfigError) as error:
        logging.error("%s", error)
        return 1


def _extract_page(
    payload: JsonValue,
    *,
    data_key: str,
    next_key: str,
) -> tuple[list[dict[str, Any]], str | None]:
    if isinstance(payload, list):
        return [_ensure_record(item) for item in payload], None

    if isinstance(payload, dict):
        if data_key in payload:
            raw_records = payload[data_key]
            if not isinstance(raw_records, list):
                raise ApiRequestError(f"Expected '{data_key}' to contain a list")
            next_url = payload.get(next_key)
            if next_url is not None and not isinstance(next_url, str):
                raise ApiRequestError(f"Expected '{next_key}' to be a URL string or null")
            return [_ensure_record(item) for item in raw_records], next_url
        return [_ensure_record(payload)], None

    raise ApiRequestError("Expected API response to be a JSON object or array")


def _ensure_record(item: Any) -> dict[str, Any]:
    if not isinstance(item, dict):
        raise ApiRequestError("Expected each API record to be a JSON object")
    return item


def _should_retry_status(status: int) -> bool:
    return status == 429 or 500 <= status <= 599


def _retry_delay(error: HTTPError, attempt: int, retry_config: RetryConfig) -> float:
    retry_after = error.headers.get("Retry-After") if error.headers else None
    if retry_after:
        parsed_retry_after = _parse_retry_after(retry_after)
        if parsed_retry_after is not None:
            return min(parsed_retry_after, retry_config.max_delay)
    return _backoff_delay(attempt, retry_config)


def _parse_retry_after(value: str) -> float | None:
    try:
        return max(0.0, float(value))
    except ValueError:
        pass

    try:
        retry_at = parsedate_to_datetime(value)
    except (TypeError, ValueError):
        return None

    if retry_at.tzinfo is None:
        retry_at = retry_at.replace(tzinfo=timezone.utc)
    return max(0.0, (retry_at - datetime.now(timezone.utc)).total_seconds())


def _backoff_delay(attempt: int, retry_config: RetryConfig) -> float:
    delay = retry_config.base_delay * (2 ** (attempt - 1))
    return min(delay, retry_config.max_delay)


def _to_snake_case(value: str) -> str:
    value = re.sub(r"([a-z0-9])([A-Z])", r"\1_\2", value)
    value = re.sub(r"[^0-9A-Za-z]+", "_", value)
    return value.strip("_").lower()


if __name__ == "__main__":
    sys.exit(main())

# API ETL Script

A small, production-ready Python ETL script that pulls data from a third-party REST API,
transforms it, stores it locally, and handles retries, rate limits, and errors.

## Setup

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

## Run

```bash
python api_etl.py
```

### Options

| Flag | Environment variable | Default | Description |
|------|------------------------|---------|-------------|
| `--api-url` | `API_URL` | `https://jsonplaceholder.typicode.com/posts` | API endpoint |
| `--output` | `OUTPUT_PATH` | `output/posts.jsonl` | JSONL output path |
| `--db` | `DB_PATH` | `output/posts.db` | SQLite output path |
| `--format` | `OUTPUT_FORMAT` | `jsonl` | `jsonl`, `sqlite`, or `both` |
| `--rate-limit-rps` | `RATE_LIMIT_RPS` | `5` | Max requests per second |
| `--max-retries` | `MAX_RETRIES` | `5` | Retries for transient HTTP errors |
| `--timeout` | `TIMEOUT` | `30` | Request timeout in seconds |
| `--backoff` | `BACKOFF_FACTOR` | `1` | Exponential backoff factor |
| `--limit` | - | - | Limit records fetched (testing) |
| `--verbose` | - | - | Debug logging |

## Example

```bash
python api_etl.py --format both --rate-limit-rps 2 --limit 10 --verbose
```

## Design notes

- Uses `requests` + `urllib3.util.retry.Retry` for automatic retries with exponential backoff.
- `RateLimitSession` enforces a client-side request cap and respects `Retry-After` headers on 429 responses.
- Transformation failures are logged per-record so one bad record does not kill the whole batch.
- Storage is atomic for SQLite (`DELETE` then `INSERT` inside one connection).

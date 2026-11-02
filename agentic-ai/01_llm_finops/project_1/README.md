# Third-Party ETL Script

`third_party_etl.py` pulls JSON records from an API, follows simple `next` pagination, normalizes record keys to `snake_case`, and stores the result as JSON Lines.

## Usage

```bash
python3 third_party_etl.py \
  --api-url "https://api.example.com/v1/items" \
  --api-token "$API_TOKEN" \
  --output data/items.jsonl
```

You can also configure it with environment variables:

```bash
API_URL="https://api.example.com/v1/items" \
API_TOKEN="..." \
OUTPUT_PATH="data/items.jsonl" \
python3 third_party_etl.py
```

The script retries `429` and `5xx` responses, honors `Retry-After` when present, and exits non-zero for non-retryable errors or invalid API responses.

Run tests with:

```bash
python3 -m unittest test_third_party_etl.py
```

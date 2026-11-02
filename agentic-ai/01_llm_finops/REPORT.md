# LLM: A Prediction Engine, Not a Search Engine

## 1. The deliberately vague technical request

```text
Write a script that pulls data from a third-party API, transforms it, and stores it, handling rate limits and errors.
```

What the prompt intentionally leaves out:

- Which API (URL, endpoints, response format, authentication)
- Language and runtime
- What "transforms" means
- Where and how data is stored
- What "handling rate limits" means (retry count, backoff, `Retry-After` header)
- Which errors to handle and how (retry, skip, abort, log)
- How the script is run (one-off, cron, loop)

Both models received the exact same prompt, in a fresh conversation, with no project rules and no additional context.

## 2. Models tested

| Role             | Model         | Interface          | Output    |
| ---------------- | ------------- | ------------------ | --------- |
| General-purpose  | GPT 5.2       | Cursor, Agent mode | Project 1 |
| Code-specialized | Kimi Code 2.7 | Cursor, Agent mode | Project 2 |

GPT is trained for broad use. Kimi Code is tuned specifically for programming and agentic coding.

Methodology note: Cursor adds its own system prompt, which cannot be disabled. It was identical for both runs, so the differences below come from the models.

## 3. Observed choices

| Decision                    | General-purpose (GPT 5.2)                                                                                               | Code-specialized (Kimi Code 2.7)                                                                                                        |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Asked clarifying questions? | No. Made every choice itself and wrote files directly                                                                   | Yes, several before writing any code. All were deliberately skipped so the model had to make its own choices                            |
| Language                    | Python 3                                                                                                                | Python 3                                                                                                                                |
| API chosen / invented       | None. Generic: URL is required via `--api-url` / `API_URL`. Invented a response convention (`items` list + `next` link) | Picked a concrete public demo API: `https://jsonplaceholder.typicode.com/posts`                                                         |
| HTTP library                | Standard library only (`urllib`)                                                                                        | `requests` + `urllib3` `Retry`                                                                                                          |
| Sync or async               | Sync                                                                                                                    | Sync                                                                                                                                    |
| "Transform" interpretation  | Generic: rename every key to `snake_case`                                                                               | API-specific: map to a hardcoded `Post` schema (`id`, `userId`, `title`, `body`), strip strings, add `fetched_at`, drop invalid records |
| Storage                     | JSON Lines file, written atomically (temp file + rename)                                                                | JSON Lines and/or SQLite (`--format jsonl / sqlite / both`)                                                                             |
| Pagination                  | Yes, follows `next` links up to 100 pages                                                                               | No, single request                                                                                                                      |
| Rate-limit strategy         | Reactive: retry 429 and 5xx, honor `Retry-After` (capped at 30 s), exponential backoff 1 s, 2 s, 4 s, no jitter         | Proactive client-side throttle (5 requests/s) plus `urllib3` retry on 429/500/502/503/504 with `Retry-After`, no jitter                 |
| Error handling              | Custom exceptions, fail fast on 4xx and invalid JSON, exit code 1                                                       | Catches HTTP, network and response-shape errors; bad records are logged and skipped                                                     |
| Secrets / API key handling  | Optional Bearer token from `API_TOKEN` env var or `--api-token` flag                                                    | No authentication support at all                                                                                                        |
| Timeouts set?               | Yes, 30 s                                                                                                               | Yes, 30 s                                                                                                                               |
| Logging                     | `logging`, level + message                                                                                              | `logging` with timestamps                                                                                                               |
| Extras not requested        | Unit test suite (5 tests, passing), dependency injection for testability, README                                        | README, `requirements.txt`, `.env.example`, CLI with 10 options                                                                          |
| Output size                 | 3 files, ~445 lines (280 script + 136 tests + 29 README)                                                                | 4 files, ~334 lines (277 script + 46 README + config files)                                                                             |

## 4. Summary of observed differences

Both models filled every gap in the prompt with their own choices, and they filled them in opposite directions. GPT did so silently, without asking a single question; Kimi Code asked several clarifying questions first, and once they were deliberately skipped it made its own choices. GPT treated "a third-party API" as an unknown and built a generic, dependency-free tool. To do that it still had to invent a response format (`items` + `next`) and a meaning for "transform" (key renaming), and it added unrequested pagination and a test suite. Kimi Code went the other way and chose a concrete API for the user, JSONPlaceholder `/posts`, so the "transform" step and the database schema only fit that one demo API. It also added a SQLite backend and a client-side throttle. Against expectations, the general-purpose model produced the more defensive, tested code, while the code-specialized model produced a more polished-looking but narrower script. Neither answer is "the" correct one: each is a plausible completion of a common pattern from the model's training data, which is exactly how a prediction engine behaves. A search engine would have returned existing documents; these models generated two different systems from the same sentence.

## 5. Problems and arbitrary choices identified

1. **Invented API and schema (Kimi Code)** - The prompt never named an API, but the script defaults to JSONPlaceholder, hardcodes its fields (`userId`, `title`, `body`) in a `Post` dataclass, and uses `_limit`, a query parameter specific to json-server-style demo APIs. It also assumes the response is a bare JSON array. Pointed at a real API that returns an object (the common `{"data": [...]}` shape), it aborts. If the API returns an array with different fields, every record fails validation and is dropped, the script logs "No valid records to store" and **exits with code 0**: a silent failure that a scheduler would report as success.
2. **No authentication, and a config file that is never read (Kimi Code)** - Most third-party APIs require a key, yet the script has no way to send one. It ships a `.env.example` ("Copy to .env and fill in as needed"), but nothing loads `.env` (no `python-dotenv`, no parsing), so the file does nothing unless the user exports the variables manually.
3. **Rate limiting that cannot matter (Kimi Code)** - It implements a 5 requests/s throttle, but the script makes exactly one request (no pagination). The README also calls the script "production-ready", which is an unverified claim.
4. **Credential leak through pagination (GPT)** - `fetch_records` follows the API's `next` link with `urljoin` and resends the `Authorization: Bearer` header on every page. An absolute `next` URL pointing to another host (`https://evil.example/...`) receives the token, and a `file://` URL makes `urlopen` read local files (both verified). The script never checks that `next` stays on the same host and uses HTTPS.
5. `Retry-After` **is overridden (GPT)** - The server's `Retry-After` value is capped at `max_delay` (30 s). If the API asks for 120 s, the script retries early, gets rate-limited again and burns its 4 attempts. Neither model adds jitter to its backoff.
6. **Token on the command line (GPT)** - `--api-token` and the README example `--api-token "$API_TOKEN"` expose the secret in shell history and the process list; the environment variable alone would be safer.
7. **Unrequested scope (both)** - GPT added pagination, a test suite and dependency injection; Kimi Code added SQLite, an output-format switch and a throttle. Both overwrite all previous data on each run (`DELETE FROM posts` / file replace) instead of upserting, an arbitrary choice for an ETL job.

## 6. Self-assessment

The clearest hallucination is Kimi Code inventing the data source itself: it chose JSONPlaceholder and hardcoded its schema and its `_limit` parameter, so the script "works" only on a demo API and, on a real API with a different schema, can store nothing while still exiting with code 0. It also has no authentication and ships a `.env.example` that nothing reads. GPT avoided naming an API but made its own arbitrary assumptions: an invented `items`/`next` response format, and a pagination loop that sends the Bearer token to whatever host or `file://` path the API returns, which is a real security flaw. GPT also overrides the server's `Retry-After` instructions. A vague prompt is dangerous in production because the model does not look up the right answer for your system; it predicts the most likely one and fills every gap with silent assumptions about APIs, schemas, libraries and security. The result looks confident, often runs, and may even pass tests, so these assumptions can reach production unreviewed and cause outages, silent data loss or leaked credentials. Precise prompts (named API, auth method, schema, storage, retry policy) and a human review of every assumption are required before such code is trusted.

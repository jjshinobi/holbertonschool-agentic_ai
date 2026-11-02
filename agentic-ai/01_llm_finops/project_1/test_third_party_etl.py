import email.message
import json
import tempfile
import unittest
from pathlib import Path
from urllib.error import HTTPError

import third_party_etl as etl


class FakeResponse:
    def __init__(self, payload, status=200):
        self.payload = payload
        self.status = status

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, traceback):
        return False

    def read(self):
        return json.dumps(self.payload).encode("utf-8")


class FakeOpener:
    def __init__(self, outcomes):
        self.outcomes = list(outcomes)
        self.urls = []

    def __call__(self, request, timeout):
        self.urls.append(request.full_url)
        outcome = self.outcomes.pop(0)
        if isinstance(outcome, Exception):
            raise outcome
        return outcome


def http_error(status, retry_after=None):
    headers = email.message.Message()
    if retry_after is not None:
        headers["Retry-After"] = str(retry_after)
    return HTTPError("https://api.example.test/items", status, "error", headers, None)


class ThirdPartyEtlTests(unittest.TestCase):
    def test_transform_record_normalizes_keys(self):
        transformed = etl.transform_record(
            {
                "User ID": 123,
                "updatedAt": "2026-11-02T10:00:00Z",
                "profile-url": "https://example.test/u/123",
            }
        )

        self.assertEqual(
            transformed,
            {
                "user_id": 123,
                "updated_at": "2026-11-02T10:00:00Z",
                "profile_url": "https://example.test/u/123",
            },
        )

    def test_fetch_records_follows_next_page(self):
        opener = FakeOpener(
            [
                FakeResponse({"items": [{"id": 1}], "next": "/items?page=2"}),
                FakeResponse({"items": [{"id": 2}], "next": None}),
            ]
        )

        records = etl.fetch_records(
            "https://api.example.test/items",
            headers={},
            retry_config=etl.RetryConfig(max_attempts=1),
            opener=opener,
            sleeper=lambda delay: None,
        )

        self.assertEqual(records, [{"id": 1}, {"id": 2}])
        self.assertEqual(
            opener.urls,
            [
                "https://api.example.test/items",
                "https://api.example.test/items?page=2",
            ],
        )

    def test_request_json_retries_rate_limit_using_retry_after(self):
        sleeps = []
        opener = FakeOpener(
            [
                http_error(429, retry_after=2),
                FakeResponse({"items": [{"id": 1}]}),
            ]
        )

        payload = etl.request_json(
            "https://api.example.test/items",
            headers={},
            retry_config=etl.RetryConfig(max_attempts=2),
            opener=opener,
            sleeper=sleeps.append,
        )

        self.assertEqual(payload, {"items": [{"id": 1}]})
        self.assertEqual(sleeps, [2.0])

    def test_request_json_does_not_retry_client_errors(self):
        opener = FakeOpener([http_error(400)])

        with self.assertRaises(etl.ApiRequestError):
            etl.request_json(
                "https://api.example.test/items",
                headers={},
                retry_config=etl.RetryConfig(max_attempts=3),
                opener=opener,
                sleeper=lambda delay: self.fail("should not sleep"),
            )

    def test_write_jsonl_writes_records_atomically(self):
        with tempfile.TemporaryDirectory() as directory:
            output_path = Path(directory) / "records.jsonl"

            count = etl.write_jsonl([{"id": 1}, {"id": 2}], output_path)

            self.assertEqual(count, 2)
            self.assertEqual(
                output_path.read_text(encoding="utf-8").splitlines(),
                ['{"id": 1}', '{"id": 2}'],
            )


if __name__ == "__main__":
    unittest.main()

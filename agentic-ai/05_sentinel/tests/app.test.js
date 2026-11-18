import { jest } from "@jest/globals";
import "../app.js";

const {
  ACTIVITY_LIMIT,
  OPEN_ISSUE_LIMIT,
  SAMPLE_SIZE,
  TOP_LABEL_LIMIT,
  GitHubApiError,
  createCache,
  fetchDashboardData,
  formatPercent,
  formatRelativeTime,
  normalizeIssue,
  parseRepository,
  requestJson,
  summarize,
} = globalThis.SentinelDashboard;

const NOW = Date.parse("2026-11-18T12:00:00Z");
const HOUR_MS = 60 * 60 * 1000;

function isoHoursAgo(hours) {
  return new Date(NOW - hours * HOUR_MS).toISOString();
}

function makeIssue(number, overrides = {}) {
  return {
    number,
    title: `Issue ${number}`,
    state: "open",
    user: { login: `user${number}` },
    labels: [{ name: "bug" }],
    comments: number,
    created_at: "2026-11-17T00:00:00Z",
    updated_at: "2026-11-18T00:00:00Z",
    closed_at: null,
    html_url: `https://github.com/o/r/issues/${number}`,
    ...overrides,
  };
}

function makeResponse({ ok = true, status = 200, statusText = "OK", body = [], headers = {}, invalidJson = false } = {}) {
  return {
    ok,
    status,
    statusText,
    headers: { get: (name) => headers[name.toLowerCase()] ?? null },
    json: async () => {
      if (invalidJson) {
        throw new SyntaxError("Unexpected token");
      }
      return body;
    },
  };
}

function mockFetch(options = {}) {
  return jest.fn().mockResolvedValue(makeResponse(options));
}

function mockGithub({ list = {}, open = { body: { total_count: 0 } }, closed = { body: { total_count: 0 } } } = {}) {
  return jest.fn(async (url) => {
    const parsed = new URL(url);
    if (parsed.pathname === "/search/issues") {
      return makeResponse(parsed.searchParams.get("q").includes("is:open") ? open : closed);
    }
    return makeResponse(list);
  });
}

function makeData(issues, overrides = {}) {
  return {
    repository: "o/r",
    fetchedAt: new Date(NOW).toISOString(),
    sampleSize: issues.length,
    issues,
    totals: { open: 3, closed: 1 },
    totalsError: null,
    rateLimit: null,
    ...overrides,
  };
}

function makeNormalized(number, overrides = {}) {
  return normalizeIssue(makeIssue(number, overrides));
}

function makeStorage(initial = {}) {
  const store = new Map(Object.entries(initial));
  return {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, String(value)),
  };
}

describe("parseRepository", () => {
  test("should_return_owner_and_repo_when_input_is_owner_slash_repo", () => {
    // Arrange
    const input = "  microsoft/vscode ";

    // Act
    const result = parseRepository(input);

    // Assert
    expect(result).toEqual({ owner: "microsoft", repo: "vscode" });
  });

  test("should_extract_owner_and_repo_when_input_is_a_github_url", () => {
    // Arrange
    const input = "https://github.com/microsoft/vscode/issues?q=is%3Aopen";

    // Act
    const result = parseRepository(input);

    // Assert
    expect(result).toEqual({ owner: "microsoft", repo: "vscode" });
  });

  test.each([
    { name: "should_return_null_when_input_is_empty", input: "" },
    { name: "should_return_null_when_input_has_no_slash", input: "microsoft" },
    { name: "should_return_null_when_input_has_extra_segments", input: "a/b/c" },
    { name: "should_return_null_when_owner_has_invalid_characters", input: "micro soft/vscode" },
    { name: "should_return_null_when_repo_is_a_dot_segment", input: "microsoft/.." },
    { name: "should_return_null_when_input_is_not_a_string", input: null },
  ])("$name", ({ input }) => {
    // Arrange
    const value = input;

    // Act
    const result = parseRepository(value);

    // Assert
    expect(result).toBeNull();
  });
});

describe("requestJson", () => {
  test("should_return_data_and_rate_limit_when_response_is_ok", async () => {
    // Arrange
    const fetchImpl = mockFetch({
      body: [{ id: 1 }],
      headers: { "x-ratelimit-remaining": "42", "x-ratelimit-limit": "60", "x-ratelimit-reset": "1795000000" },
    });

    // Act
    const result = await requestJson("https://api.github.com/x", { fetchImpl });

    // Assert
    expect(result.data).toEqual([{ id: 1 }]);
    expect(result.rateLimit).toEqual({ remaining: 42, limit: 60, resetAt: new Date(1795000000 * 1000).toISOString() });
  });

  test("should_send_no_authorization_header_when_requesting_from_the_browser", async () => {
    // Arrange
    const fetchImpl = mockFetch();

    // Act
    await requestJson("https://api.github.com/x", { fetchImpl });

    // Assert
    expect(fetchImpl.mock.calls[0][1].headers).not.toHaveProperty("Authorization");
  });

  test.each([
    { name: "should_report_authentication_error_when_status_is_401", status: 401, headers: {}, message: "Bad credentials", type: "authentication" },
    { name: "should_report_rate_limit_when_status_is_403_and_no_requests_remain", status: 403, headers: { "x-ratelimit-remaining": "0" }, message: "API rate limit exceeded", type: "rate_limit" },
    { name: "should_report_rate_limit_when_status_is_403_with_secondary_limit_message", status: 403, headers: {}, message: "You have exceeded a secondary rate limit", type: "rate_limit" },
    { name: "should_report_rate_limit_when_status_is_429", status: 429, headers: {}, message: "Too many requests", type: "rate_limit" },
    { name: "should_report_forbidden_when_status_is_403_with_requests_remaining", status: 403, headers: { "x-ratelimit-remaining": "10" }, message: "Resource not accessible", type: "forbidden" },
    { name: "should_report_not_found_when_status_is_404", status: 404, headers: {}, message: "Not Found", type: "not_found" },
    { name: "should_report_issues_disabled_when_status_is_410", status: 410, headers: {}, message: "Issues are disabled for this repo", type: "issues_disabled" },
    { name: "should_report_server_error_when_status_is_503", status: 503, headers: {}, message: "Service Unavailable", type: "server_error" },
    { name: "should_report_generic_http_error_when_status_is_unexpected", status: 418, headers: {}, message: "teapot", type: "http_error" },
  ])("$name", async ({ status, headers, message, type }) => {
    // Arrange
    const fetchImpl = mockFetch({ ok: false, status, headers, body: { message } });

    // Act
    const result = requestJson("https://api.github.com/x", { fetchImpl });

    // Assert
    await expect(result).rejects.toMatchObject({ name: "GitHubApiError", type, status, message: `GitHub API error ${status}: ${message}` });
  });

  test("should_include_reset_time_when_rate_limit_is_exceeded", async () => {
    // Arrange
    const fetchImpl = mockFetch({
      ok: false,
      status: 403,
      headers: { "x-ratelimit-remaining": "0", "x-ratelimit-reset": "1795000000" },
      body: { message: "API rate limit exceeded" },
    });

    // Act
    const result = requestJson("https://api.github.com/x", { fetchImpl });

    // Assert
    await expect(result).rejects.toMatchObject({
      type: "rate_limit",
      resetAt: new Date(1795000000 * 1000).toISOString(),
      hint: expect.stringContaining("resets at"),
    });
  });

  test("should_fall_back_to_status_only_message_when_error_body_is_not_json", async () => {
    // Arrange
    const fetchImpl = mockFetch({ ok: false, status: 502, invalidJson: true });

    // Act
    const result = requestJson("https://api.github.com/x", { fetchImpl });

    // Assert
    await expect(result).rejects.toMatchObject({ type: "server_error", message: "GitHub API error 502" });
  });

  test("should_report_network_error_when_fetch_rejects", async () => {
    // Arrange
    const fetchImpl = jest.fn().mockRejectedValue(new TypeError("Failed to fetch"));

    // Act
    const result = requestJson("https://api.github.com/x", { fetchImpl });

    // Assert
    await expect(result).rejects.toMatchObject({ type: "network", message: "Could not reach GitHub." });
  });

  test("should_report_timeout_when_github_does_not_respond_in_time", async () => {
    // Arrange
    const fetchImpl = jest.fn(
      (url, { signal }) =>
        new Promise((resolve, reject) => {
          signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
        }),
    );

    // Act
    const result = requestJson("https://api.github.com/x", { fetchImpl, timeoutMs: 5 });

    // Assert
    await expect(result).rejects.toMatchObject({ type: "timeout" });
  });

  test("should_report_invalid_response_when_success_body_is_not_json", async () => {
    // Arrange
    const fetchImpl = mockFetch({ invalidJson: true });

    // Act
    const result = requestJson("https://api.github.com/x", { fetchImpl });

    // Assert
    await expect(result).rejects.toBeInstanceOf(GitHubApiError);
  });
});

describe("normalizeIssue", () => {
  test("should_map_github_fields_when_issue_is_complete", () => {
    // Arrange
    const issue = makeIssue(7, { labels: [{ name: "bug" }, "help wanted"] });

    // Act
    const result = normalizeIssue(issue);

    // Assert
    expect(result).toEqual({
      number: 7,
      title: "Issue 7",
      state: "open",
      author: "user7",
      labels: ["bug", "help wanted"],
      comments: 7,
      createdAt: "2026-11-17T00:00:00Z",
      updatedAt: "2026-11-18T00:00:00Z",
      closedAt: null,
      url: "https://github.com/o/r/issues/7",
    });
  });

  test("should_use_safe_defaults_when_fields_are_missing", () => {
    // Arrange
    const issue = { number: 3 };

    // Act
    const result = normalizeIssue(issue);

    // Assert
    expect(result).toMatchObject({ title: "(untitled)", state: "open", author: null, labels: [], comments: 0, createdAt: null, updatedAt: null, url: null });
  });

  test("should_drop_link_when_url_is_not_a_github_https_url", () => {
    // Arrange
    const issue = makeIssue(4, { html_url: "javascript:alert(1)" });

    // Act
    const result = normalizeIssue(issue);

    // Assert
    expect(result.url).toBeNull();
  });

  test("should_return_null_when_issue_has_no_number", () => {
    // Arrange
    const issue = makeIssue(undefined);

    // Act
    const result = normalizeIssue(issue);

    // Assert
    expect(result).toBeNull();
  });
});

describe("fetchDashboardData", () => {
  test("should_return_issues_and_totals_when_all_requests_succeed", async () => {
    // Arrange
    const fetchImpl = mockGithub({
      list: { body: [makeIssue(1), makeIssue(2, { state: "closed" })], headers: { "x-ratelimit-remaining": "58" } },
      open: { body: { total_count: 120 } },
      closed: { body: { total_count: 880 } },
    });

    // Act
    const data = await fetchDashboardData("o", "r", { fetchImpl, now: NOW });

    // Assert
    expect(data).toMatchObject({
      repository: "o/r",
      fetchedAt: new Date(NOW).toISOString(),
      sampleSize: 2,
      totals: { open: 120, closed: 880 },
      totalsError: null,
      rateLimit: { remaining: 58 },
    });
    expect(data.issues.map((issue) => issue.number)).toEqual([1, 2]);
  });

  test("should_request_recent_issues_and_search_counts_when_loading", async () => {
    // Arrange
    const fetchImpl = mockGithub();

    // Act
    await fetchDashboardData("octo", "repo", { fetchImpl, now: NOW });

    // Assert
    const urls = fetchImpl.mock.calls.map(([url]) => new URL(url));
    const list = urls.find((url) => url.pathname === "/repos/octo/repo/issues");
    const queries = urls.filter((url) => url.pathname === "/search/issues").map((url) => url.searchParams.get("q"));
    expect(list.searchParams.get("sort")).toBe("updated");
    expect(list.searchParams.get("state")).toBe("all");
    expect(list.searchParams.get("per_page")).toBe(String(SAMPLE_SIZE));
    expect(queries.sort()).toEqual(["repo:octo/repo is:issue is:closed", "repo:octo/repo is:issue is:open"]);
  });

  test("should_exclude_pull_requests_when_api_returns_mixed_items", async () => {
    // Arrange
    const fetchImpl = mockGithub({ list: { body: [makeIssue(1), makeIssue(2, { pull_request: {} })] } });

    // Act
    const data = await fetchDashboardData("o", "r", { fetchImpl, now: NOW });

    // Assert
    expect(data.issues.map((issue) => issue.number)).toEqual([1]);
  });

  test("should_return_empty_list_when_repo_has_no_issues", async () => {
    // Arrange
    const fetchImpl = mockGithub({ list: { body: [] } });

    // Act
    const data = await fetchDashboardData("o", "r", { fetchImpl, now: NOW });

    // Assert
    expect(data.issues).toEqual([]);
    expect(data.totals).toEqual({ open: 0, closed: 0 });
  });

  test("should_keep_issue_list_and_report_totals_error_when_search_is_rate_limited", async () => {
    // Arrange
    const fetchImpl = mockGithub({
      list: { body: [makeIssue(1)] },
      open: { ok: false, status: 403, headers: { "x-ratelimit-remaining": "0" }, body: { message: "API rate limit exceeded" } },
    });

    // Act
    const data = await fetchDashboardData("o", "r", { fetchImpl, now: NOW });

    // Assert
    expect(data.issues).toHaveLength(1);
    expect(data.totals).toBeNull();
    expect(data.totalsError).toBe("GitHub API error 403: API rate limit exceeded");
  });

  test("should_throw_list_error_when_issue_list_request_fails", async () => {
    // Arrange
    const fetchImpl = mockGithub({ list: { ok: false, status: 404, body: { message: "Not Found" } } });

    // Act
    const result = fetchDashboardData("o", "missing", { fetchImpl, now: NOW });

    // Assert
    await expect(result).rejects.toMatchObject({ type: "not_found", status: 404 });
  });

  test("should_throw_network_error_when_github_is_unreachable", async () => {
    // Arrange
    const fetchImpl = jest.fn().mockRejectedValue(new TypeError("Failed to fetch"));

    // Act
    const result = fetchDashboardData("o", "r", { fetchImpl, now: NOW });

    // Assert
    await expect(result).rejects.toMatchObject({ type: "network" });
  });

  test("should_throw_invalid_response_when_issue_list_is_not_an_array", async () => {
    // Arrange
    const fetchImpl = mockGithub({ list: { body: { message: "unexpected" } } });

    // Act
    const result = fetchDashboardData("o", "r", { fetchImpl, now: NOW });

    // Assert
    await expect(result).rejects.toMatchObject({ type: "invalid_response" });
  });

  test("should_throw_network_error_when_fetch_is_unavailable", async () => {
    // Arrange
    const fetchImpl = null;

    // Act
    const result = fetchDashboardData("o", "r", { fetchImpl, now: NOW });

    // Assert
    await expect(result).rejects.toMatchObject({ type: "network" });
  });
});

describe("summarize", () => {
  test("should_list_newest_open_issues_first_when_sample_has_mixed_states", () => {
    // Arrange
    const issues = [
      makeNormalized(1, { created_at: isoHoursAgo(30) }),
      makeNormalized(2, { created_at: isoHoursAgo(2) }),
      makeNormalized(3, { state: "closed", created_at: isoHoursAgo(1) }),
    ];

    // Act
    const summary = summarize(makeData(issues), NOW);

    // Assert
    expect(summary.openIssues.map((issue) => issue.number)).toEqual([2, 1]);
    expect(summary.openInSample).toBe(2);
  });

  test("should_limit_lists_when_sample_is_larger_than_display_limits", () => {
    // Arrange
    const issues = Array.from({ length: 40 }, (_, i) => makeNormalized(i + 1, { labels: [{ name: `label-${i}` }] }));

    // Act
    const summary = summarize(makeData(issues), NOW);

    // Assert
    expect(summary.openIssues).toHaveLength(OPEN_ISSUE_LIMIT);
    expect(summary.activity).toHaveLength(ACTIVITY_LIMIT);
    expect(summary.topLabels).toHaveLength(TOP_LABEL_LIMIT);
  });

  test("should_compute_open_share_when_totals_are_available", () => {
    // Arrange
    const data = makeData([makeNormalized(1)], { totals: { open: 25, closed: 75 } });

    // Act
    const summary = summarize(data, NOW);

    // Assert
    expect(summary.openShare).toBe(0.25);
  });

  test.each([
    { name: "should_leave_open_share_empty_when_totals_are_missing", totals: null },
    { name: "should_leave_open_share_empty_when_totals_are_zero", totals: { open: 0, closed: 0 } },
  ])("$name", ({ totals }) => {
    // Arrange
    const data = makeData([makeNormalized(1)], { totals });

    // Act
    const summary = summarize(data, NOW);

    // Assert
    expect(summary.openShare).toBeNull();
  });

  test("should_count_issues_updated_in_last_24_hours_when_sample_is_partial", () => {
    // Arrange
    const issues = [
      makeNormalized(1, { updated_at: isoHoursAgo(1) }),
      makeNormalized(2, { updated_at: isoHoursAgo(23) }),
      makeNormalized(3, { updated_at: isoHoursAgo(25) }),
    ];

    // Act
    const summary = summarize(makeData(issues), NOW);

    // Assert
    expect(summary.active24h).toEqual({ count: 2, saturated: false });
  });

  test("should_flag_saturation_when_full_sample_falls_inside_24_hours", () => {
    // Arrange
    const issues = Array.from({ length: SAMPLE_SIZE }, (_, i) => makeNormalized(i + 1, { updated_at: isoHoursAgo(1) }));

    // Act
    const summary = summarize(makeData(issues, { sampleSize: SAMPLE_SIZE }), NOW);

    // Assert
    expect(summary.active24h).toEqual({ count: SAMPLE_SIZE, saturated: true });
  });

  test("should_rank_labels_by_open_issue_count_when_labels_repeat", () => {
    // Arrange
    const issues = [
      makeNormalized(1, { labels: [{ name: "bug" }, { name: "ui" }] }),
      makeNormalized(2, { labels: [{ name: "bug" }] }),
      makeNormalized(3, { state: "closed", labels: [{ name: "ui" }, { name: "ui" }] }),
    ];

    // Act
    const summary = summarize(makeData(issues), NOW);

    // Assert
    expect(summary.topLabels).toEqual([
      { name: "bug", count: 2 },
      { name: "ui", count: 1 },
    ]);
  });

  test("should_classify_activity_when_issues_were_opened_closed_or_updated", () => {
    // Arrange
    const issues = [
      makeNormalized(1, { created_at: isoHoursAgo(1), updated_at: isoHoursAgo(1) }),
      makeNormalized(2, { state: "closed", created_at: isoHoursAgo(50), closed_at: isoHoursAgo(2), updated_at: isoHoursAgo(2) }),
      makeNormalized(3, { created_at: isoHoursAgo(50), updated_at: isoHoursAgo(3) }),
    ];

    // Act
    const summary = summarize(makeData(issues), NOW);

    // Assert
    expect(summary.activity.map(({ issue, kind }) => [issue.number, kind])).toEqual([
      [1, "opened"],
      [2, "closed"],
      [3, "updated"],
    ]);
  });

  test("should_mark_empty_when_repo_has_no_issues", () => {
    // Arrange
    const data = makeData([], { totals: { open: 0, closed: 0 } });

    // Act
    const summary = summarize(data, NOW);

    // Assert
    expect(summary.isEmpty).toBe(true);
  });
});

describe("formatting", () => {
  test.each([
    { name: "should_say_just_now_when_less_than_45_seconds_passed", iso: new Date(NOW - 10_000).toISOString(), expected: "just now" },
    { name: "should_show_minutes_when_less_than_an_hour_passed", iso: new Date(NOW - 5 * 60_000).toISOString(), expected: "5 min ago" },
    { name: "should_show_hours_when_less_than_a_day_passed", iso: isoHoursAgo(3), expected: "3 h ago" },
    { name: "should_show_days_when_less_than_a_month_passed", iso: isoHoursAgo(72), expected: "3 d ago" },
    { name: "should_show_date_when_more_than_a_month_passed", iso: "2026-01-02T00:00:00Z", expected: "2026-01-02" },
    { name: "should_say_unknown_when_date_is_invalid", iso: "not a date", expected: "unknown" },
  ])("$name", ({ iso, expected }) => {
    // Arrange
    const now = NOW;

    // Act
    const result = formatRelativeTime(iso, now);

    // Assert
    expect(result).toBe(expected);
  });

  test.each([
    { name: "should_round_percent_when_ratio_is_regular", ratio: 0.256, expected: "26%" },
    { name: "should_show_below_one_percent_when_ratio_is_tiny", ratio: 0.001, expected: "<1%" },
    { name: "should_show_dash_when_ratio_is_missing", ratio: null, expected: "–" },
  ])("$name", ({ ratio, expected }) => {
    // Arrange
    const value = ratio;

    // Act
    const result = formatPercent(value);

    // Assert
    expect(result).toBe(expected);
  });
});

describe("createCache", () => {
  test("should_return_saved_data_when_written_then_read", () => {
    // Arrange
    const cache = createCache(makeStorage());
    const data = makeData([makeNormalized(1)]);
    cache.write("O/R", data);

    // Act
    const result = cache.read("o/r");

    // Assert
    expect(result).toEqual(data);
  });

  test("should_return_null_when_cached_value_is_corrupted", () => {
    // Arrange
    const cache = createCache(makeStorage({ "sentinel:dashboard:o/r": "{not json" }));

    // Act
    const result = cache.read("o/r");

    // Assert
    expect(result).toBeNull();
  });

  test("should_return_null_when_storage_access_throws", () => {
    // Arrange
    const cache = createCache({
      getItem: () => {
        throw new Error("SecurityError");
      },
    });

    // Act
    const result = cache.read("o/r");

    // Assert
    expect(result).toBeNull();
  });

  test("should_return_false_when_storage_is_full", () => {
    // Arrange
    const cache = createCache({
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
    });

    // Act
    const result = cache.write("o/r", makeData([]));

    // Assert
    expect(result).toBe(false);
  });
});

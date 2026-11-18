import { jest } from "@jest/globals";
import { fetchGithubIssues, formatToolError, GitHubApiError } from "../mcp_server.js";

function makeIssue(number, overrides = {}) {
  return {
    number,
    title: `Issue ${number}`,
    state: "open",
    user: { login: `user${number}` },
    labels: [{ name: "bug" }],
    comments: number,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-02T00:00:00Z",
    html_url: `https://github.com/o/r/issues/${number}`,
    ...overrides,
  };
}

function mockFetch({ ok = true, status = 200, statusText = "OK", body = [], headers = {} } = {}) {
  return jest.fn().mockResolvedValue({
    ok,
    status,
    statusText,
    headers: { get: (name) => headers[name.toLowerCase()] ?? null },
    json: async () => body,
  });
}

describe("fetchGithubIssues", () => {
  test("should_request_newest_issues_first_when_called_with_owner_and_repo", async () => {
    // Arrange
    const fetchImpl = mockFetch();

    // Act
    await fetchGithubIssues("octo", "repo", { fetchImpl, token: "" });

    // Assert
    const [url] = fetchImpl.mock.calls[0];
    expect(url.pathname).toBe("/repos/octo/repo/issues");
    expect(url.searchParams.get("sort")).toBe("created");
    expect(url.searchParams.get("direction")).toBe("desc");
    expect(url.searchParams.get("state")).toBe("all");
  });

  test("should_url_encode_path_segments_when_owner_and_repo_contain_special_characters", async () => {
    // Arrange
    const fetchImpl = mockFetch();

    // Act
    await fetchGithubIssues("a/b", "c?d", { fetchImpl, token: "" });

    // Assert
    expect(fetchImpl.mock.calls[0][0].pathname).toBe("/repos/a%2Fb/c%3Fd/issues");
  });

  test("should_send_bearer_authorization_header_when_token_is_set", async () => {
    // Arrange
    const fetchImpl = mockFetch();

    // Act
    await fetchGithubIssues("o", "r", { fetchImpl, token: "secret" });

    // Assert
    expect(fetchImpl.mock.calls[0][1].headers.Authorization).toBe("Bearer secret");
  });

  test("should_omit_authorization_header_when_token_is_missing", async () => {
    // Arrange
    const fetchImpl = mockFetch();

    // Act
    await fetchGithubIssues("o", "r", { fetchImpl, token: undefined });

    // Assert
    expect(fetchImpl.mock.calls[0][1].headers).not.toHaveProperty("Authorization");
  });

  test("should_return_only_five_issues_when_api_returns_more", async () => {
    // Arrange
    const body = Array.from({ length: 10 }, (_, i) => makeIssue(i + 1));
    const fetchImpl = mockFetch({ body });

    // Act
    const issues = await fetchGithubIssues("o", "r", { fetchImpl, token: "" });

    // Assert
    expect(issues.map((issue) => issue.number)).toEqual([1, 2, 3, 4, 5]);
  });

  test("should_exclude_pull_requests_when_api_returns_mixed_items", async () => {
    // Arrange
    const body = [makeIssue(1), makeIssue(2, { pull_request: { url: "x" } }), makeIssue(3)];
    const fetchImpl = mockFetch({ body });

    // Act
    const issues = await fetchGithubIssues("o", "r", { fetchImpl, token: "" });

    // Assert
    expect(issues.map((issue) => issue.number)).toEqual([1, 3]);
  });

  test("should_return_compact_issue_shape_when_api_returns_full_issue", async () => {
    // Arrange
    const body = [makeIssue(7, { labels: ["plain", { name: "obj" }] })];
    const fetchImpl = mockFetch({ body });

    // Act
    const [issue] = await fetchGithubIssues("o", "r", { fetchImpl, token: "" });

    // Assert
    expect(issue).toEqual({
      number: 7,
      title: "Issue 7",
      state: "open",
      author: "user7",
      labels: ["plain", "obj"],
      comments: 7,
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-02T00:00:00Z",
      url: "https://github.com/o/r/issues/7",
    });
  });

  test("should_default_author_and_labels_when_user_and_labels_are_missing", async () => {
    // Arrange
    const body = [makeIssue(1, { user: null, labels: undefined })];
    const fetchImpl = mockFetch({ body });

    // Act
    const [issue] = await fetchGithubIssues("o", "r", { fetchImpl, token: "" });

    // Assert
    expect(issue.author).toBeNull();
    expect(issue.labels).toEqual([]);
  });

  test("should_return_empty_list_when_repo_has_no_issues", async () => {
    // Arrange
    const fetchImpl = mockFetch({ body: [] });

    // Act
    const issues = await fetchGithubIssues("o", "r", { fetchImpl, token: "" });

    // Assert
    expect(issues).toEqual([]);
  });

  test.each([
    { name: "should_throw_authentication_error_when_status_is_401", status: 401, headers: {}, type: "authentication" },
    { name: "should_throw_not_found_error_when_status_is_404", status: 404, headers: {}, type: "not_found" },
    { name: "should_throw_forbidden_error_when_status_is_403_with_quota_left", status: 403, headers: { "x-ratelimit-remaining": "10" }, type: "forbidden" },
    { name: "should_throw_rate_limit_error_when_status_is_403_with_no_quota_left", status: 403, headers: { "x-ratelimit-remaining": "0" }, type: "rate_limit" },
    { name: "should_throw_rate_limit_error_when_status_is_429", status: 429, headers: {}, type: "rate_limit" },
    { name: "should_throw_server_error_when_status_is_500", status: 500, headers: {}, type: "server_error" },
    { name: "should_throw_http_error_when_status_is_422", status: 422, headers: {}, type: "http_error" },
  ])("$name", async ({ status, headers, type }) => {
    // Arrange
    const fetchImpl = mockFetch({ ok: false, status, statusText: "", headers, body: {} });

    // Act
    const result = fetchGithubIssues("o", "r", { fetchImpl, token: "" });

    // Assert
    await expect(result).rejects.toMatchObject({ name: "GitHubApiError", type, status });
  });

  test("should_include_github_message_when_error_body_has_message", async () => {
    // Arrange
    const fetchImpl = mockFetch({ ok: false, status: 401, statusText: "", body: { message: "Bad credentials" } });

    // Act
    const result = fetchGithubIssues("o", "r", { fetchImpl, token: "invalid" });

    // Assert
    await expect(result).rejects.toThrow(/^GitHub API error 401: Bad credentials$/);
  });

  test("should_fall_back_to_status_text_when_error_body_is_not_json", async () => {
    // Arrange
    const fetchImpl = jest.fn().mockResolvedValue({
      ok: false,
      status: 502,
      statusText: "Bad Gateway",
      headers: { get: () => null },
      json: async () => {
        throw new SyntaxError("Unexpected token <");
      },
    });

    // Act
    const result = fetchGithubIssues("o", "r", { fetchImpl, token: "" });

    // Assert
    await expect(result).rejects.toThrow(/^GitHub API error 502: Bad Gateway$/);
  });

  test("should_include_reset_time_in_hint_when_rate_limit_reset_header_is_set", async () => {
    // Arrange
    const headers = { "x-ratelimit-remaining": "0", "x-ratelimit-reset": "1767225600" };
    const fetchImpl = mockFetch({ ok: false, status: 403, statusText: "", headers, body: {} });

    // Act
    const result = fetchGithubIssues("o", "r", { fetchImpl, token: "" });

    // Assert
    await expect(result).rejects.toMatchObject({ hint: expect.stringContaining("2026-01-01T00:00:00.000Z") });
  });

  test("should_throw_network_error_when_fetch_rejects", async () => {
    // Arrange
    const fetchImpl = jest.fn().mockRejectedValue(new TypeError("fetch failed"));

    // Act
    const result = fetchGithubIssues("o", "r", { fetchImpl, token: "" });

    // Assert
    await expect(result).rejects.toMatchObject({ type: "network", message: "Could not reach GitHub: fetch failed" });
  });

  test("should_throw_invalid_response_error_when_body_is_not_a_list", async () => {
    // Arrange
    const fetchImpl = mockFetch({ body: { message: "unexpected" } });

    // Act
    const result = fetchGithubIssues("o", "r", { fetchImpl, token: "" });

    // Assert
    await expect(result).rejects.toMatchObject({ type: "invalid_response" });
  });

  test("should_throw_invalid_response_error_when_success_body_is_not_json", async () => {
    // Arrange
    const fetchImpl = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      headers: { get: () => null },
      json: async () => {
        throw new SyntaxError("Unexpected end of JSON input");
      },
    });

    // Act
    const result = fetchGithubIssues("o", "r", { fetchImpl, token: "" });

    // Assert
    await expect(result).rejects.toMatchObject({ type: "invalid_response" });
  });
});

describe("formatToolError", () => {
  test("should_return_structured_error_result_when_error_is_github_api_error", () => {
    // Arrange
    const error = new GitHubApiError("authentication", "GitHub API error 401: Bad credentials", { status: 401, hint: "Fix the token." });

    // Act
    const result = formatToolError(error, "octo", "repo");

    // Assert
    expect(result.isError).toBe(true);
    expect(JSON.parse(result.content[0].text)).toEqual({
      error: {
        type: "authentication",
        status: 401,
        message: "GitHub API error 401: Bad credentials",
        hint: "Fix the token.",
        repository: "octo/repo",
      },
    });
  });

  test("should_return_internal_error_result_when_error_is_unexpected", () => {
    // Arrange
    const error = new TypeError("boom");

    // Act
    const result = formatToolError(error, "octo", "repo");

    // Assert
    expect(JSON.parse(result.content[0].text).error).toMatchObject({ type: "internal", status: null, message: "boom" });
  });
});

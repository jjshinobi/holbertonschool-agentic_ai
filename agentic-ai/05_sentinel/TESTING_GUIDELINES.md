# Testing guidelines

Apply these rules to every test you create or edit in `tests/`.

## Setup

- Use Jest. Put tests in `tests/`, named `<module>.test.js`.
- Write tests as ES modules: `import { jest } from "@jest/globals";`, then import the code under test with a relative path.
- Run tests with `npm test`. It must pass before a change is done.

## Naming

Name each `test()` or `it()` block in English, using `should_[EXPECTED_BEHAVIOR]_when_[CONDITION]`.

Example: `should_return_empty_list_when_repo_has_no_issues`

For `test.each`, give every case a `name` field holding its full test name and use `"$name"` as the title. Jest reads `$a_when` as a single variable called `a_when`, so building names from several `$variables` breaks them.

## Arrange-Act-Assert

Split each test body into three blocks, separated by blank lines and labelled with these comments:

- `// Arrange`: build the inputs, mocks, and fixtures.
- `// Act`: make one call to the code under test.
- `// Assert`: check the result with `expect()`.

```js
test("should_exclude_pull_requests_when_api_returns_mixed_items", async () => {
  // Arrange
  const fetchImpl = mockFetch({ body: [makeIssue(1), makeIssue(2, { pull_request: {} })] });

  // Act
  const issues = await fetchGithubIssues("o", "r", { fetchImpl, token: "" });

  // Assert
  expect(issues.map((issue) => issue.number)).toEqual([1]);
});
```

To test async errors, keep the promise in `// Act` and await it in `// Assert`:

```js
// Act
const result = fetchGithubIssues("o", "r", { fetchImpl, token: "" });

// Assert
await expect(result).rejects.toThrow("rate limit exceeded");
```

## Isolation

- Never call the real GitHub API or use a real token. Pass a mocked `fetch` (`fetchImpl`) and an explicit `token`.
- Reuse small builders such as `makeIssue()` and `mockFetch()` for fixtures, rather than repeating large objects.
- Each test sets up its own state. Do not rely on the order tests run in.

## Coverage

For each function that handles GitHub data, cover:

- the success path and the shape of the returned data;
- edge cases: empty results, missing fields, and limits;
- HTTP errors (401, 403/429 rate limit, 404, 5xx) and network failures.

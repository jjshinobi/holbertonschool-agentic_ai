import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { pathToFileURL } from "node:url";
import { z } from "zod";

const GITHUB_API_URL = "https://api.github.com";
const ISSUE_LIMIT = 5;

const server = new McpServer({ name: "sentinel-server", version: "1.0.0" });

export class GitHubApiError extends Error {
  constructor(type, message, { status = null, hint = null } = {}) {
    super(message);
    this.name = "GitHubApiError";
    this.type = type;
    this.status = status;
    this.hint = hint;
  }
}

async function readGithubMessage(response) {
  try {
    const body = await response.json();
    return typeof body?.message === "string" ? body.message : null;
  } catch {
    return null;
  }
}

function classifyHttpError(response) {
  const { status } = response;
  const remaining = response.headers.get("x-ratelimit-remaining");
  const reset = Number(response.headers.get("x-ratelimit-reset"));
  const resetAt = reset ? ` Resets at ${new Date(reset * 1000).toISOString()}.` : "";

  if (status === 401) {
    return { type: "authentication", hint: "GITHUB_TOKEN is missing, invalid, or expired. Update it in .env and restart the server." };
  }
  if (status === 429 || (status === 403 && remaining === "0")) {
    return { type: "rate_limit", hint: `GitHub rate limit exceeded.${resetAt} Wait before retrying, or set GITHUB_TOKEN for a higher limit.` };
  }
  if (status === 403) {
    return { type: "forbidden", hint: "The token does not have permission to read issues in this repository." };
  }
  if (status === 404) {
    return { type: "not_found", hint: "Check the owner and repo names. Private repositories need a token with access to them." };
  }
  if (status >= 500) {
    return { type: "server_error", hint: "GitHub is having problems. Retry later." };
  }
  return { type: "http_error", hint: null };
}

export async function fetchGithubIssues(owner, repo, { fetchImpl = fetch, token = process.env.GITHUB_TOKEN, timeoutMs = 10_000 } = {}) {
  const url = new URL(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues`, GITHUB_API_URL);

  url.searchParams.set("state", "all");
  url.searchParams.set("sort", "created");
  url.searchParams.set("direction", "desc");
  url.searchParams.set("per_page", "30");

  const headers = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "sentinel-server",
  };

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  let response;
  try {
    response = await fetchImpl(url, { headers, signal: AbortSignal.timeout(timeoutMs) });
  } catch (error) {
    throw new GitHubApiError("network", `Could not reach GitHub: ${error.message}`, {
      hint: "Check the network connection and retry.",
    });
  }

  if (!response.ok) {
    const { type, hint } = classifyHttpError(response);
    const detail = (await readGithubMessage(response)) ?? response.statusText ?? "";
    const message = `GitHub API error ${response.status}${detail ? `: ${detail}` : ""}`;
    throw new GitHubApiError(type, message, { status: response.status, hint });
  }

  let data;
  try {
    data = await response.json();
  } catch {
    throw new GitHubApiError("invalid_response", "GitHub returned a response that is not valid JSON.", { status: response.status });
  }
  if (!Array.isArray(data)) {
    throw new GitHubApiError("invalid_response", "GitHub returned an unexpected response: expected a list of issues.", { status: response.status });
  }

  return data
    .filter((item) => !item.pull_request)
    .slice(0, ISSUE_LIMIT)
    .map((issue) => ({
      number: issue.number,
      title: issue.title,
      state: issue.state,
      author: issue.user?.login ?? null,
      labels: (issue.labels ?? []).map((label) => (typeof label === "string" ? label : label.name)),
      comments: issue.comments,
      created_at: issue.created_at,
      updated_at: issue.updated_at,
      url: issue.html_url,
    }));
}

export function formatToolError(error, owner, repo) {
  const known = error instanceof GitHubApiError;
  const payload = {
    error: {
      type: known ? error.type : "internal",
      status: known ? error.status : null,
      message: error?.message ?? String(error),
      hint: known ? error.hint : null,
      repository: `${owner}/${repo}`,
    },
  };
  return {
    isError: true,
    content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
  };
}

server.registerTool(
  "fetch_github_issues",
  {
    title: "Fetch GitHub issues",
    description:
      "Return the 5 most recent issues (excluding pull requests) of a GitHub repository. " +
      "On failure, returns an error object with type, status, message, and hint.",
    inputSchema: {
      owner: z.string().min(1).describe("Repository owner (user or organization)"),
      repo: z.string().min(1).describe("Repository name"),
    },
  },
  async ({ owner, repo }) => {
    try {
      const issues = await fetchGithubIssues(owner, repo);
      return {
        content: [{ type: "text", text: JSON.stringify(issues, null, 2) }],
      };
    } catch (error) {
      console.error(`fetch_github_issues failed for ${owner}/${repo}:`, error.message);
      return formatToolError(error, owner, repo);
    }
  },
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("MCP Server started and listening on stdio");
}

// Only start the stdio server when run directly, so tests can import fetchGithubIssues.
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error("Fatal error:", error);
    process.exit(1);
  });
}

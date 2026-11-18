import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { pathToFileURL } from "node:url";
import { z } from "zod";

const GITHUB_API_URL = "https://api.github.com";
const ISSUE_LIMIT = 5;

const server = new McpServer({ name: "sentinel-server", version: "1.0.0" });

/**
 * Fetch the most recent issues (pull requests excluded) of a GitHub repository.
 * The token is read from the GITHUB_TOKEN environment variable, never from source.
 */
export async function fetchGithubIssues(owner, repo, { fetchImpl = fetch, token = process.env.GITHUB_TOKEN } = {}) {
  const url = new URL(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues`, GITHUB_API_URL);
  url.searchParams.set("state", "all");
  url.searchParams.set("sort", "created");
  url.searchParams.set("direction", "desc");
  // The issues endpoint also returns pull requests, so ask for more than we need and filter.
  url.searchParams.set("per_page", "30");

  const headers = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "sentinel-server",
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetchImpl(url, { headers });
  if (!response.ok) {
    const remaining = response.headers.get("x-ratelimit-remaining");
    const hint =
      response.status === 401
        ? " (check GITHUB_TOKEN)"
        : response.status === 404
          ? " (repository not found or not accessible)"
          : (response.status === 403 || response.status === 429) && remaining === "0"
            ? " (rate limit exceeded)"
            : "";
    throw new Error(`GitHub API error ${response.status} ${response.statusText}${hint}`);
  }

  const data = await response.json();
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

server.registerTool(
  "fetch_github_issues",
  {
    title: "Fetch GitHub issues",
    description: "Return the 5 most recent issues (excluding pull requests) of a GitHub repository.",
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
      return {
        isError: true,
        content: [{ type: "text", text: `Failed to fetch issues for ${owner}/${repo}: ${error.message}` }],
      };
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

# Sentinel: GitHub Monitoring Dashboard Agent

Sentinel is an AI coding agent that turns live GitHub issue data into a static monitoring dashboard for a development team, and keeps it usable when GitHub requests fail.

## Requirements

### GitHub integration

- Query the GitHub REST API for issues of a configured or user-selected repository.
- Handle rate limits, missing data, authentication errors, and network failures; never crash when GitHub is unreachable.

### Dashboard

- Show issue totals and status, open issues, and recent activity, readable at a glance.
- Provide loading, empty, error, and recovery states.
- Open directly from `index.html` on disk, with no build step.

### Agent workflow

- Read open GitHub issues through the `sentinel-server` MCP tools before changing dashboard code. If issues cannot be read, stop and report the blocker instead of inventing requirements or data.
- Follow [AGENTS.md](./AGENTS.md), [CODING_STANDARDS.md](./CODING_STANDARDS.md), and [TESTING_GUIDELINES.md](./TESTING_GUIDELINES.md).

## Project Structure

```text
05_sentinel/
├── AGENTS.md
├── CODING_STANDARDS.md
├── TESTING_GUIDELINES.md
├── README.md
├── index.html
├── styles.css
├── app.js
├── mcp_server.js
├── package.json
├── package-lock.json
└── tests/
```

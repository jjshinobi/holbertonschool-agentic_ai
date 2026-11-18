/*
 * Sentinel dashboard.
 *
 * Loaded as a classic script (<script src="app.js" defer>) so index.html works from disk.
 * Data logic is exposed on globalThis.SentinelDashboard so Jest can test it without a DOM;
 * the UI only starts when a document is present.
 */
(function sentinelDashboard(root) {
  "use strict";

  const GITHUB_API_URL = "https://api.github.com";
  const DEFAULT_REPOSITORY = "microsoft/vscode";
  const SAMPLE_SIZE = 100;
  const OPEN_ISSUE_LIMIT = 15;
  const ACTIVITY_LIMIT = 12;
  const TOP_LABEL_LIMIT = 6;
  const REQUEST_TIMEOUT_MS = 10_000;
  const AUTO_REFRESH_MS = 5 * 60 * 1000;
  const SAME_EVENT_WINDOW_MS = 60_000;
  const DAY_MS = 24 * 60 * 60 * 1000;
  const CACHE_PREFIX = "sentinel:dashboard:";
  const LAST_REPOSITORY_KEY = "sentinel:last-repository";

  const OWNER_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
  const REPO_PATTERN = /^[A-Za-z0-9._-]{1,100}$/;
  const GITHUB_URL_PATTERN = /^(?:https?:\/\/)?(?:www\.)?github\.com\/(.+)$/i;

  class GitHubApiError extends Error {
    constructor(type, message, { status = null, hint = null, resetAt = null } = {}) {
      super(message);
      this.name = "GitHubApiError";
      this.type = type;
      this.status = status;
      this.hint = hint;
      this.resetAt = resetAt;
    }
  }

  // ---------------------------------------------------------------------------
  // Data logic (pure, tested in tests/app.test.js)
  // ---------------------------------------------------------------------------

  function parseRepository(input) {
    if (typeof input !== "string") {
      return null;
    }

    let value = input.trim();
    const urlMatch = value.match(GITHUB_URL_PATTERN);
    let parts;

    if (urlMatch) {
      parts = urlMatch[1].split(/[/?#]/).slice(0, 2);
    } else {
      parts = value.replace(/\/+$/, "").split("/");
    }

    if (parts.length !== 2) {
      return null;
    }

    const owner = parts[0];
    const repo = parts[1].replace(/\.git$/, "");

    if (!OWNER_PATTERN.test(owner) || !REPO_PATTERN.test(repo) || repo === "." || repo === "..") {
      return null;
    }

    return { owner, repo };
  }

  function buildIssuesUrl(owner, repo) {
    const url = new URL(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues`, GITHUB_API_URL);

    url.searchParams.set("state", "all");
    url.searchParams.set("sort", "updated");
    url.searchParams.set("direction", "desc");
    url.searchParams.set("per_page", String(SAMPLE_SIZE));

    return url;
  }

  function buildCountUrl(owner, repo, state) {
    const url = new URL("/search/issues", GITHUB_API_URL);

    url.searchParams.set("q", `repo:${owner}/${repo} is:issue is:${state}`);
    url.searchParams.set("per_page", "1");

    return url;
  }

  function readRateLimit(headers) {
    const get = (name) => (headers && typeof headers.get === "function" ? headers.get(name) : null);
    const remaining = Number.parseInt(get("x-ratelimit-remaining"), 10);
    const limit = Number.parseInt(get("x-ratelimit-limit"), 10);
    const reset = Number.parseInt(get("x-ratelimit-reset"), 10);

    if (!Number.isFinite(remaining)) {
      return null;
    }

    return {
      remaining,
      limit: Number.isFinite(limit) ? limit : null,
      resetAt: Number.isFinite(reset) ? new Date(reset * 1000).toISOString() : null,
    };
  }

  function formatClock(iso) {
    const time = Date.parse(iso);
    if (Number.isNaN(time)) {
      return "";
    }
    return new Date(time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }

  function classifyHttpError(status, rateLimit, message) {
    const resetAt = rateLimit?.resetAt ?? null;
    const resetText = resetAt ? ` It resets at ${formatClock(resetAt)}.` : "";
    const mentionsRateLimit = typeof message === "string" && /rate limit/i.test(message);

    if (status === 401) {
      return {
        type: "authentication",
        hint: "GitHub refused the request as unauthenticated. This dashboard sends no token, so the resource likely requires sign-in.",
      };
    }
    if (status === 429 || (status === 403 && (rateLimit?.remaining === 0 || mentionsRateLimit))) {
      return {
        type: "rate_limit",
        hint: `GitHub's rate limit for unauthenticated requests from this network is used up.${resetText} Retry after that.`,
        resetAt,
      };
    }
    if (status === 403) {
      return { type: "forbidden", hint: "GitHub refused access to this repository's issues." };
    }
    if (status === 404) {
      return {
        type: "not_found",
        hint: "Check the owner and repository names. Private repositories cannot be read without a token.",
      };
    }
    if (status === 410) {
      return { type: "issues_disabled", hint: "This repository has issues turned off." };
    }
    if (status >= 500) {
      return { type: "server_error", hint: "GitHub is having problems. Retry in a few minutes." };
    }
    return { type: "http_error", hint: null };
  }

  async function readGithubMessage(response) {
    try {
      const body = await response.json();
      return typeof body?.message === "string" ? body.message : null;
    } catch {
      return null;
    }
  }

  async function requestJson(url, { fetchImpl, timeoutMs = REQUEST_TIMEOUT_MS } = {}) {
    const controller = typeof AbortController === "function" ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
    let response;

    try {
      response = await fetchImpl(String(url), {
        headers: { Accept: "application/vnd.github+json" },
        signal: controller ? controller.signal : undefined,
      });
    } catch (error) {
      if (error?.name === "AbortError") {
        throw new GitHubApiError("timeout", `GitHub did not respond within ${Math.ceil(timeoutMs / 1000)} s.`, {
          hint: "GitHub or the network is slow. Retry in a moment.",
        });
      }
      throw new GitHubApiError("network", "Could not reach GitHub.", {
        hint: "Check your connection. The dashboard retries automatically when the browser is back online.",
      });
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
    }

    const rateLimit = readRateLimit(response.headers);

    if (!response.ok) {
      const detail = await readGithubMessage(response);
      const { type, hint, resetAt } = classifyHttpError(response.status, rateLimit, detail);
      const message = `GitHub API error ${response.status}${detail ? `: ${detail}` : ""}`;
      throw new GitHubApiError(type, message, { status: response.status, hint, resetAt });
    }

    let data;
    try {
      data = await response.json();
    } catch {
      throw new GitHubApiError("invalid_response", "GitHub returned a response that is not valid JSON.", {
        status: response.status,
        hint: "Retry in a moment.",
      });
    }

    return { data, rateLimit };
  }

  function validDate(value) {
    return typeof value === "string" && !Number.isNaN(Date.parse(value)) ? value : null;
  }

  function safeIssueUrl(value) {
    if (typeof value !== "string") {
      return null;
    }
    try {
      const url = new URL(value);
      return url.protocol === "https:" && url.hostname === "github.com" ? url.href : null;
    } catch {
      return null;
    }
  }

  function normalizeIssue(item) {
    if (!item || typeof item !== "object" || !Number.isInteger(item.number)) {
      return null;
    }

    const labels = Array.isArray(item.labels)
      ? item.labels
          .map((label) => (typeof label === "string" ? label : label?.name))
          .filter((name) => typeof name === "string" && name !== "")
      : [];
    const title = typeof item.title === "string" ? item.title.trim() : "";

    return {
      number: item.number,
      title: title || "(untitled)",
      state: item.state === "closed" ? "closed" : "open",
      author: typeof item.user?.login === "string" ? item.user.login : null,
      labels,
      comments: Number.isFinite(item.comments) ? item.comments : 0,
      createdAt: validDate(item.created_at),
      updatedAt: validDate(item.updated_at) ?? validDate(item.created_at),
      closedAt: validDate(item.closed_at),
      url: safeIssueUrl(item.html_url),
    };
  }

  function readTotalCount(result) {
    if (result.status !== "fulfilled") {
      return null;
    }
    const count = result.value.data?.total_count;
    return Number.isInteger(count) && count >= 0 ? count : null;
  }

  function defaultFetch() {
    return typeof root.fetch === "function" ? root.fetch.bind(root) : null;
  }

  async function fetchDashboardData(owner, repo, { fetchImpl = defaultFetch(), timeoutMs = REQUEST_TIMEOUT_MS, now = Date.now() } = {}) {
    if (typeof fetchImpl !== "function") {
      throw new GitHubApiError("network", "This browser cannot make network requests.", {
        hint: "Open the dashboard in a current version of Chrome, Edge, Firefox, or Safari.",
      });
    }

    const options = { fetchImpl, timeoutMs };
    const [list, openCount, closedCount] = await Promise.allSettled([
      requestJson(buildIssuesUrl(owner, repo), options),
      requestJson(buildCountUrl(owner, repo, "open"), options),
      requestJson(buildCountUrl(owner, repo, "closed"), options),
    ]);

    if (list.status === "rejected") {
      throw list.reason;
    }

    const items = list.value.data;
    if (!Array.isArray(items)) {
      throw new GitHubApiError("invalid_response", "GitHub returned an unexpected response: expected a list of issues.", {
        hint: "Retry in a moment.",
      });
    }

    const issues = items
      .filter((item) => item && !item.pull_request)
      .map(normalizeIssue)
      .filter(Boolean);

    const openTotal = readTotalCount(openCount);
    const closedTotal = readTotalCount(closedCount);
    const totals = openTotal !== null && closedTotal !== null ? { open: openTotal, closed: closedTotal } : null;
    const failedCount = [openCount, closedCount].find((result) => result.status === "rejected");
    const totalsError = totals ? null : failedCount?.reason?.message ?? "GitHub returned no issue totals.";

    return {
      repository: `${owner}/${repo}`,
      fetchedAt: new Date(now).toISOString(),
      sampleSize: items.length,
      issues,
      totals,
      totalsError,
      rateLimit: list.value.rateLimit,
    };
  }

  function timeOf(iso) {
    const time = Date.parse(iso);
    return Number.isNaN(time) ? 0 : time;
  }

  function describeActivity(issue) {
    const updated = Date.parse(issue.updatedAt);
    const closed = Date.parse(issue.closedAt);
    const created = Date.parse(issue.createdAt);

    if (issue.state === "closed" && !Number.isNaN(closed) && Math.abs(updated - closed) <= SAME_EVENT_WINDOW_MS) {
      return "closed";
    }
    if (!Number.isNaN(created) && Math.abs(updated - created) <= SAME_EVENT_WINDOW_MS) {
      return "opened";
    }
    return "updated";
  }

  function summarize(data, now = Date.now()) {
    const issues = Array.isArray(data?.issues) ? data.issues : [];
    const totals = data?.totals ?? null;
    const totalCount = totals ? totals.open + totals.closed : 0;
    const open = issues.filter((issue) => issue.state === "open");

    const openIssues = [...open].sort((a, b) => timeOf(b.createdAt) - timeOf(a.createdAt)).slice(0, OPEN_ISSUE_LIMIT);
    const activity = [...issues]
      .sort((a, b) => timeOf(b.updatedAt) - timeOf(a.updatedAt))
      .slice(0, ACTIVITY_LIMIT)
      .map((issue) => ({ issue, kind: describeActivity(issue) }));

    const recentCount = issues.filter((issue) => {
      const updated = Date.parse(issue.updatedAt);
      return !Number.isNaN(updated) && now - updated <= DAY_MS;
    }).length;
    const sampleSize = Number.isInteger(data?.sampleSize) ? data.sampleSize : issues.length;
    const saturated = sampleSize >= SAMPLE_SIZE && issues.length > 0 && recentCount === issues.length;

    const labelCounts = new Map();
    for (const issue of open) {
      for (const label of new Set(issue.labels)) {
        labelCounts.set(label, (labelCounts.get(label) ?? 0) + 1);
      }
    }
    const topLabels = [...labelCounts.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
      .slice(0, TOP_LABEL_LIMIT);

    return {
      totals,
      openShare: totals && totalCount > 0 ? totals.open / totalCount : null,
      openIssues,
      openInSample: open.length,
      sampleSize,
      activity,
      active24h: { count: recentCount, saturated },
      topLabels,
      isEmpty: issues.length === 0 && totalCount === 0,
    };
  }

  function formatRelativeTime(iso, now = Date.now()) {
    const time = Date.parse(iso);
    if (Number.isNaN(time)) {
      return "unknown";
    }

    const diff = Math.max(0, now - time);
    if (diff < 45_000) {
      return "just now";
    }
    const minutes = Math.round(diff / 60_000);
    if (minutes < 60) {
      return `${minutes} min ago`;
    }
    const hours = Math.round(diff / 3_600_000);
    if (hours < 24) {
      return `${hours} h ago`;
    }
    const days = Math.round(diff / DAY_MS);
    if (days < 30) {
      return `${days} d ago`;
    }
    return new Date(time).toISOString().slice(0, 10);
  }

  function formatNumber(value) {
    return Number.isFinite(value) ? new Intl.NumberFormat("en-US").format(value) : "–";
  }

  function formatPercent(ratio) {
    if (!Number.isFinite(ratio)) {
      return "–";
    }
    const percent = ratio * 100;
    return `${percent > 0 && percent < 1 ? "<1" : Math.round(percent)}%`;
  }

  function isDashboardData(value) {
    return (
      Boolean(value) &&
      typeof value === "object" &&
      typeof value.repository === "string" &&
      typeof value.fetchedAt === "string" &&
      Array.isArray(value.issues)
    );
  }

  function createCache(storage) {
    const keyFor = (repository) => CACHE_PREFIX + repository.toLowerCase();

    return {
      read(repository) {
        try {
          const raw = storage ? storage.getItem(keyFor(repository)) : null;
          if (!raw) {
            return null;
          }
          const data = JSON.parse(raw);
          return isDashboardData(data) ? data : null;
        } catch {
          return null;
        }
      },
      write(repository, data) {
        try {
          if (!storage) {
            return false;
          }
          storage.setItem(keyFor(repository), JSON.stringify(data));
          return true;
        } catch {
          return false;
        }
      },
    };
  }

  // ---------------------------------------------------------------------------
  // UI
  // ---------------------------------------------------------------------------

  function getStorage(win) {
    try {
      return win.localStorage ?? null;
    } catch {
      return null;
    }
  }

  function startDashboard(doc, win) {
    const byId = (id) => doc.getElementById(id);
    const refs = {
      main: byId("main"),
      form: byId("repo-form"),
      input: byId("repo-input"),
      inputError: byId("repo-error"),
      loadButton: byId("load-button"),
      refreshButton: byId("refresh-button"),
      status: byId("status"),
      empty: byId("empty-state"),
      emptyMessage: byId("empty-message"),
      dashboard: byId("dashboard"),
      repoLink: byId("repo-link"),
      tileOpen: byId("tile-open"),
      tileOpenNote: byId("tile-open-note"),
      tileClosed: byId("tile-closed"),
      tileClosedNote: byId("tile-closed-note"),
      tileShare: byId("tile-share"),
      tileShareNote: byId("tile-share-note"),
      tileActive: byId("tile-active"),
      tileActiveNote: byId("tile-active-note"),
      split: byId("split"),
      splitBar: byId("split-bar"),
      legendOpen: byId("legend-open"),
      legendClosed: byId("legend-closed"),
      openNote: byId("open-note"),
      openBody: byId("open-body"),
      activityList: byId("activity-list"),
      labelList: byId("label-list"),
      updatedAt: byId("updated-at"),
      rateLimit: byId("rate-limit"),
    };

    const storage = getStorage(win);
    const cache = createCache(storage);
    const state = { repository: null, requestId: 0, loading: false, lastFailed: false, blockedUntil: 0, shown: null };

    function el(tag, { className, text, attrs } = {}, children = []) {
      const node = doc.createElement(tag);
      if (className) {
        node.className = className;
      }
      if (text !== undefined && text !== null) {
        node.textContent = String(text);
      }
      if (attrs) {
        for (const [name, value] of Object.entries(attrs)) {
          if (value !== undefined && value !== null) {
            node.setAttribute(name, String(value));
          }
        }
      }
      for (const child of children) {
        if (child) {
          node.append(child);
        }
      }
      return node;
    }

    function timeElement(iso, now) {
      const valid = validDate(iso);
      return el("time", {
        text: formatRelativeTime(iso, now),
        attrs: valid ? { datetime: valid, title: new Date(valid).toLocaleString() } : {},
      });
    }

    function issueLink(issue, className) {
      const url = safeIssueUrl(issue.url);
      const children = [el("span", { className: "issue-number", text: `#${issue.number} ` }), doc.createTextNode(issue.title)];
      if (!url) {
        return el("span", { className }, children);
      }
      return el("a", { className, attrs: { href: url, target: "_blank", rel: "noopener noreferrer" } }, children);
    }

    // --- Status banner -------------------------------------------------------

    function hideStatus() {
      refs.status.hidden = true;
      refs.status.replaceChildren();
    }

    function showStatus(kind, { title, message, hint, retry = false }) {
      const icons = { loading: "", info: "i", warning: "!", error: "×" };
      const body = el("div", { className: "status-body" }, [
        el("p", { className: "status-title", text: title }),
        message ? el("p", { className: "status-message", text: message }) : null,
        hint ? el("p", { className: "status-hint", text: hint }) : null,
      ]);
      const children = [el("span", { className: "status-icon", text: icons[kind] ?? "i", attrs: { "aria-hidden": "true" } }), body];

      if (retry) {
        const button = el("button", { text: "Retry", attrs: { type: "button" } });
        button.addEventListener("click", () => load(state.repository));
        children.push(button);
      }

      refs.status.className = `status status-${kind}`;
      refs.status.setAttribute("aria-live", kind === "error" ? "assertive" : "polite");
      refs.status.replaceChildren(...children);
      refs.status.hidden = false;
    }

    function setLoading(loading) {
      state.loading = loading;
      refs.main.setAttribute("aria-busy", String(loading));
      refs.loadButton.disabled = loading;
      refs.refreshButton.disabled = loading;
    }

    // --- Rendering -----------------------------------------------------------

    function renderTiles(summary, data) {
      const { totals } = summary;
      const totalsNote = totals ? "all time, excluding pull requests" : "totals unavailable";

      refs.tileOpen.textContent = totals ? formatNumber(totals.open) : "–";
      refs.tileOpenNote.textContent = totals ? totalsNote : `${formatNumber(summary.openInSample)} open in the latest ${formatNumber(summary.sampleSize)}`;
      refs.tileClosed.textContent = totals ? formatNumber(totals.closed) : "–";
      refs.tileClosedNote.textContent = totalsNote;
      refs.tileShare.textContent = formatPercent(summary.openShare);
      refs.tileShareNote.textContent = totals ? `of ${formatNumber(totals.open + totals.closed)} issues` : "totals unavailable";

      const { count, saturated } = summary.active24h;
      refs.tileActive.textContent = `${formatNumber(count)}${saturated ? "+" : ""}`;
      refs.tileActiveNote.textContent = saturated
        ? `issues updated; the latest ${formatNumber(data.sampleSize)} all fall in this window`
        : "issues opened, closed, or updated";

      if (totals && totals.open + totals.closed > 0) {
        const total = totals.open + totals.closed;
        const openText = `Open ${formatNumber(totals.open)} (${formatPercent(totals.open / total)})`;
        const closedText = `Closed ${formatNumber(totals.closed)} (${formatPercent(totals.closed / total)})`;
        refs.splitBar.max = total;
        refs.splitBar.value = totals.open;
        refs.splitBar.title = `${openText} · ${closedText}`;
        refs.splitBar.setAttribute("aria-label", `${openText}, ${closedText}`);
        refs.legendOpen.textContent = openText;
        refs.legendClosed.textContent = closedText;
        refs.split.hidden = false;
      } else {
        refs.split.hidden = true;
      }
    }

    function renderOpenIssues(summary, now) {
      refs.openNote.textContent = `Newest first, from the ${formatNumber(summary.sampleSize)} most recently updated issues`;

      if (summary.openIssues.length === 0) {
        const cell = el("td", {
          className: "table-empty",
          text: "No open issues among the most recently updated issues.",
          attrs: { colspan: "4" },
        });
        refs.openBody.replaceChildren(el("tr", {}, [cell]));
        return;
      }

      const rows = summary.openIssues.map((issue) => {
        const labelChips = issue.labels.length
          ? el(
              "ul",
              { className: "chips", attrs: { "aria-label": "Labels" } },
              issue.labels.slice(0, 3).map((label) => el("li", { className: "chip", text: label }))
                .concat(issue.labels.length > 3 ? [el("li", { className: "chip", text: `+${issue.labels.length - 3}` })] : []),
            )
          : null;

        return el("tr", {}, [
          el("td", {}, [issueLink(issue, "issue-title"), labelChips]),
          el("td", { className: "nowrap", text: issue.author ?? "unknown" }),
          el("td", { className: "numeric", text: formatNumber(issue.comments) }),
          el("td", { className: "nowrap" }, [timeElement(issue.createdAt, now)]),
        ]);
      });

      refs.openBody.replaceChildren(...rows);
    }

    function renderActivity(summary, now) {
      if (summary.activity.length === 0) {
        refs.activityList.replaceChildren(el("li", { className: "list-empty", text: "No recent activity." }));
        return;
      }

      const labels = { opened: "Opened", closed: "Closed", updated: "Updated" };
      const items = summary.activity.map(({ issue, kind }) =>
        el("li", { className: "activity-item" }, [
          el("span", { className: `badge badge-${kind}`, text: labels[kind] }),
          issueLink(issue, "activity-link"),
          el("span", { className: "activity-meta" }, [
            doc.createTextNode(`${issue.author ? `by ${issue.author} · ` : ""}${issue.state === "open" ? "open" : "closed"} · `),
            timeElement(issue.updatedAt, now),
          ]),
        ]),
      );

      refs.activityList.replaceChildren(...items);
    }

    function renderLabels(summary) {
      if (summary.topLabels.length === 0) {
        refs.labelList.replaceChildren(el("li", { className: "list-empty", text: "No labels on open issues in this sample." }));
        return;
      }

      const max = summary.topLabels[0].count;
      const items = summary.topLabels.map(({ name, count }) => {
        const bar = el("progress", {
          className: "label-bar",
          attrs: { max, value: count, "aria-label": `${name}: ${count} open issues`, title: `${name}: ${count}` },
        });
        return el("li", { className: "label-item" }, [
          el("span", { className: "label-name", text: name, attrs: { title: name } }),
          el("span", { className: "label-count", text: formatNumber(count) }),
          bar,
        ]);
      });

      refs.labelList.replaceChildren(...items);
    }

    function renderFooter(data, now) {
      const fetched = validDate(data.fetchedAt);
      refs.updatedAt.replaceChildren(
        doc.createTextNode(`${data.repository} · data from `),
        timeElement(fetched, now),
        doc.createTextNode(fetched ? ` (${new Date(fetched).toLocaleString()})` : ""),
      );

      const rate = data.rateLimit;
      refs.rateLimit.textContent = rate
        ? `GitHub API: ${formatNumber(rate.remaining)}${rate.limit ? ` of ${formatNumber(rate.limit)}` : ""} requests left${rate.resetAt ? `, resets at ${formatClock(rate.resetAt)}` : ""}`
        : "";
    }

    function render(data) {
      const now = Date.now();
      const summary = summarize(data, now);
      const parsed = parseRepository(data.repository);

      state.shown = data;
      refs.repoLink.textContent = data.repository;
      if (parsed) {
        refs.repoLink.href = `https://github.com/${parsed.owner}/${parsed.repo}/issues`;
      } else {
        refs.repoLink.removeAttribute("href");
      }
      renderFooter(data, now);

      if (summary.isEmpty) {
        refs.dashboard.hidden = true;
        refs.emptyMessage.textContent = `${data.repository} has no issues yet. New issues will show up here on the next refresh.`;
        refs.empty.hidden = false;
        return;
      }

      refs.empty.hidden = true;
      renderTiles(summary, data);
      renderOpenIssues(summary, now);
      renderActivity(summary, now);
      renderLabels(summary);
      refs.dashboard.hidden = false;
    }

    function clearContent() {
      state.shown = null;
      refs.dashboard.hidden = true;
      refs.empty.hidden = true;
      refs.updatedAt.textContent = "Not loaded yet.";
      refs.rateLimit.textContent = "";
    }

    // --- Loading -------------------------------------------------------------

    function setInputError(message) {
      refs.inputError.textContent = message ?? "";
      refs.inputError.hidden = !message;
      if (message) {
        refs.input.setAttribute("aria-invalid", "true");
      } else {
        refs.input.removeAttribute("aria-invalid");
      }
    }

    function remember(repository) {
      try {
        if (storage) {
          storage.setItem(LAST_REPOSITORY_KEY, repository);
        }
      } catch {
        // Storage can be full or blocked; the dashboard still works without it.
      }
      try {
        const url = new URL(win.location.href);
        url.searchParams.set("repo", repository);
        win.history.replaceState(null, "", url.href);
      } catch {
        // file:// pages may refuse history updates; the URL is a convenience only.
      }
    }

    async function load(target) {
      const parsed = parseRepository(target);
      if (!parsed) {
        setInputError("Enter a repository as owner/repo, for example microsoft/vscode.");
        refs.input.focus();
        return;
      }
      setInputError(null);

      const repository = `${parsed.owner}/${parsed.repo}`;
      const requestId = ++state.requestId;
      const cached = cache.read(repository);

      state.repository = repository;
      refs.input.value = repository;
      remember(repository);
      setLoading(true);

      if (cached) {
        render(cached);
        showStatus("loading", {
          title: `Refreshing ${repository}…`,
          message: `Showing data from ${formatRelativeTime(cached.fetchedAt)} until the update arrives.`,
        });
      } else {
        clearContent();
        showStatus("loading", { title: `Loading issues for ${repository}…` });
      }

      try {
        const data = await fetchDashboardData(parsed.owner, parsed.repo);
        if (requestId !== state.requestId) {
          return;
        }

        cache.write(repository, data);
        state.lastFailed = false;
        state.blockedUntil = 0;
        render(data);

        if (data.totalsError) {
          showStatus("warning", {
            title: "Issue totals are unavailable",
            message: `Open and closed totals could not be loaded (${data.totalsError}). Lists below are current.`,
            hint: "GitHub's search API allows only a few unauthenticated requests per minute. Retry shortly.",
            retry: true,
          });
        } else {
          hideStatus();
        }
      } catch (error) {
        if (requestId !== state.requestId) {
          return;
        }

        state.lastFailed = true;
        state.blockedUntil = error?.resetAt ? Date.parse(error.resetAt) || 0 : 0;
        const message = error?.message ?? String(error);
        const hint = error?.hint ?? null;

        if (cached) {
          render(cached);
          showStatus("error", {
            title: `Couldn't refresh ${repository}`,
            message: `${message}. Showing cached data from ${formatRelativeTime(cached.fetchedAt)}.`,
            hint,
            retry: true,
          });
        } else {
          clearContent();
          showStatus("error", { title: `Couldn't load issues for ${repository}`, message, hint, retry: true });
        }
      } finally {
        if (requestId === state.requestId) {
          setLoading(false);
        }
      }
    }

    // --- Events --------------------------------------------------------------

    refs.form.addEventListener("submit", (event) => {
      event.preventDefault();
      load(refs.input.value);
    });

    refs.input.addEventListener("input", () => setInputError(null));

    refs.refreshButton.addEventListener("click", () => load(state.repository ?? refs.input.value));

    win.addEventListener("online", () => {
      if (state.lastFailed && state.repository) {
        load(state.repository);
      }
    });

    win.addEventListener("offline", () => {
      showStatus("warning", {
        title: "You're offline",
        message: state.shown ? "Showing the last loaded data." : "Issues will load when the connection returns.",
        hint: "The dashboard reloads automatically when the browser is back online.",
      });
    });

    win.setInterval(() => {
      const visible = doc.visibilityState !== "hidden";
      if (visible && !state.loading && state.repository && Date.now() >= state.blockedUntil) {
        load(state.repository);
      }
    }, AUTO_REFRESH_MS);

    // --- Start ---------------------------------------------------------------

    let initial = null;
    try {
      initial = new URL(win.location.href).searchParams.get("repo");
    } catch {
      initial = null;
    }
    if (!parseRepository(initial)) {
      try {
        initial = storage ? storage.getItem(LAST_REPOSITORY_KEY) : null;
      } catch {
        initial = null;
      }
    }
    if (!parseRepository(initial)) {
      initial = DEFAULT_REPOSITORY;
    }

    load(initial);
  }

  root.SentinelDashboard = {
    DEFAULT_REPOSITORY,
    SAMPLE_SIZE,
    OPEN_ISSUE_LIMIT,
    ACTIVITY_LIMIT,
    TOP_LABEL_LIMIT,
    GitHubApiError,
    parseRepository,
    buildIssuesUrl,
    buildCountUrl,
    readRateLimit,
    classifyHttpError,
    requestJson,
    normalizeIssue,
    fetchDashboardData,
    describeActivity,
    summarize,
    formatRelativeTime,
    formatNumber,
    formatPercent,
    createCache,
  };

  if (typeof root.document !== "undefined" && typeof root.addEventListener === "function") {
    if (root.document.readyState === "loading") {
      root.document.addEventListener("DOMContentLoaded", () => startDashboard(root.document, root));
    } else {
      startDashboard(root.document, root);
    }
  }
})(globalThis);

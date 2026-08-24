# Browser session

A browser session (`pipeline/weles.js`) is the pipeline's only path to a web
page. The pipeline never launches its own browser and never touches a local
browser profile — no Chrome cookie DBs, no user-data-dir scraping. All page
automation goes through the Weles MCP stdio server (`weles-mcp`).

## Shape

Two layers:

- **`McpStdioClient`** — a minimal JSON-RPC 2.0 client over a spawned MCP
  stdio server (also reused by the [Blender session](blender-session.md)).
  Per-request timeout: 120 s (`weles MCP request timed out: <method>`). The
  child process gets a scrubbed environment (PATH/HOME only).
- **`WelesBrowserSession`** — owns one browser slot end-to-end:
  `start({ headless, browser })` → `weles_browser_start`;
  `newPage()` → `weles_page_new`; `close()` → `weles_browser_close` plus
  process shutdown.

The Weles tool surface the pipeline drives (captured from a live
`glina weles-tools` run):

```
weles_browser_start — Launch a Weles browser context via AsyncNewBrowser and return a browserId.
weles_browser_close — Close a Weles browser context and all tracked pages for it.
weles_page_new — Create a new page in a Weles browser context and return a pageId.
weles_page_goto — Navigate a tracked Weles page to a URL.
weles_page_text — Read visible text from a Weles page or selector.
weles_page_click — Click a CSS selector on a Weles page.
weles_page_fill — Fill a CSS selector on a Weles page.
weles_page_screenshot — Capture a Weles page screenshot. Saves to path when provided, otherwise returns base64 PNG.
weles_page_evaluate — Evaluate a JavaScript expression in a Weles page and return the JSON-serializable result.
```

`WelesPage` wraps the page tools: `goto`, `text`, `click(selector)`,
`fill(selector, value)`, `screenshot(path)`, `evaluate(expression)`.

## Lifecycle

Only the [studio job](studio-job.md) opens browser sessions. The session is
closed in a `finally` — a failed job never leaks a browser slot.

## Refusals

- `weles MCP process failed to start: <reason>` — `weles-mcp` is not on
  PATH or died at spawn.
- `weles MCP process exited (code N)` — the server died mid-session; every
  pending request fails with this.
- `weles tool <name> failed: <text>` — the tool answered `isError`.
- `weles MCP request timed out: <method>` — no answer within 120 s.
- `could not parse id from weles MCP reply: <text>` — the server's reply
  named no browser/page id.
- `MCP client not started` — a request was issued before `start()`.

## Environment

The Weles child receives only `PATH` and `HOME` by default. `WELES_BIN` and
`WELES_MCP_ARGS` appear in the config module's non-secret allowlist but this
version does not read or apply them; place `weles-mcp` on PATH. Credential
environment variables are not a supported configuration path — see
[configuration](../configuration.md).

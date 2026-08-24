# Operations runbook

Start with the smallest probe that does not mutate operator state. `glina check-config` touches only the config and Skarbiec. `glina verify <file> --config <absent>` parses locally when render smoke is off. `glina setup --check` only locates binaries. `glina blender-health`, animated preview, sculpting, animation, showcase, and render smoke all reach the live Blender bridge.

## Config and vault

### `pipeline config is not valid JSON: <path>`

The selected file could be read but not parsed. Validate JSON syntax and that `--config` names the intended file.

### `config key '…' holds an inline value; secrets must be skarbiec://<item>/<field> references`

Move the value into Skarbiec and replace it with a reference. Do not move it to an environment variable. Run `glina check-config` again; output should show `<resolved: ok>` for secret-shaped fields.

### `malformed skarbiec reference: "…"`

Use exactly `skarbiec://<item>/<field>` and allowed identifier characters. There must be one item and one field.

### `skarbiec CLI failed: …`

Confirm `skarbiec` (or `SKARBIEC_BIN`) is executable and the local vault can satisfy policy. The nested CLI stderr is retained after the prefix.

### `skarbiec item '<item>' has no non-empty field '<field>'`

Inspect the item schema and fix the field name/value. The refusal also appends `(at config path …)` during deep resolution.

## Model backend

### `no model backend configured — set models.brama.url+key+bearer or models.openrouter.key …`

Supply a complete Brama tuple or an OpenRouter key, using Skarbiec refs. Include Brama `agent_id` as well; it is used to sign every request.

### `backend=brama requested but models.brama.url/key/bearer are not configured`

This occurs in the selection edge where OpenRouter is requested but not ready and Brama is also incomplete. Complete the intended backend rather than relying on fallback.

### `direct provider APIs are not supported …`

Remove `models.anthropic`, `models.openai`, or `models.direct`. Use Brama or the explicitly configured OpenRouter backend.

### `brama HTTP N: …` / `openrouter HTTP N: …`

Authentication/routing 4xx errors are final (OpenRouter 429 is retried). Fix identity, model, or policy from the named response. Brama 502/503 and OpenRouter 429/5xx are retried automatically.

### `brama unreachable after N attempts: …` / `openrouter unreachable after N attempts: …`

All transport attempts failed or timed out. Check router reachability and configured URL, then retry after the external service recovers. Do not increase attempts before addressing the cause.

### `model reply not usable in round N: …`

The model did not provide parseable step JSON. The nested cause distinguishes malformed fenced JSON from no JSON object. The job stops; revise model route/prompt policy rather than executing the text manually.

### `model did not finish within N rounds`

The sculpt loop exhausted its cap. Inspect stderr round thoughts, then raise `llm.maxRounds` only if the asset is making progress; otherwise simplify the prompt or repair repeated execution errors.

## Blender and animation

### `blender MCP server failed to start (…) … Run 'node pipeline/setup.js' …`

Run `glina setup --check` first. If Blender and uvx are present, inspect the nested Weles/MCP process error. A started stdio server is not proof that Blender's add-on bridge is alive.

### Health returns `healthy:false`

The server listed tools but `execute_blender_code` did not round-trip. Start/repair the Blender GUI add-on bridge on `127.0.0.1:9876`, then use `glina blender-health` only when it is safe to probe the operator session. `scripts/ensure-blender.sh` waits up to 60 seconds and otherwise says `ensure-blender: bridge did not come up`.

### `Blender bridge is down after 3 consecutive failures: …`

The sculpt loop intentionally stopped instead of spending more model rounds. Repair the bridge and start a new job; the failed session is closed.

### `export produced no file at <path>: …`

Check output directory existence/permissions and the preceding `GAC-EXEC-ERROR` text. The export call ran but no non-empty file landed.

### `no animation clips in this GLB`

`preview-anim` found no Blender Actions. Generate/repair animations first or verify without animation requirements.

### `clip '<name>' not found; have […]`

Choose an exact action name/base name from the list or omit `--clip` to select the longest action.

### `GIF assembly failed (ffmpeg and uv+Pillow): …`

Install a working `ffmpeg`, or uv with access to Pillow, and confirm the output directory is writable. Rendered temporary frames are removed in all outcomes.

### `unknown animation preset: …` / `unknown showcase asset: …`

Only `dragon` is implemented for each deterministic command.

## Weles and studio jobs

### `weles MCP process failed to start: …` / `weles MCP process exited (code N)`

Ensure `weles-mcp` is on PATH and starts under a PATH/HOME-only environment. A mid-session exit fails every pending request.

### `weles MCP request timed out: <method>`

The request had no response in 120 seconds. Inspect the named Weles method and browser worker; the Glina session will still be closed.

### `weles tool <name> failed: …`

The named Weles tool returned `isError`. Preserve its text and investigate the browser-side refusal.

### `text2game step '<step>' failed: <reason>`

Use the step name to localize failure: login selectors, generation selectors, artifact polling, download, Blender postprocess, or verify. Selector and URL changes belong in config.

### `artifact not ready within Nms`

The configured poll expression never returned an HTTP URL before `studio.artifact.timeoutMs`. Check the page expression and remote job state before raising the timeout.

### `download failed: HTTP N`

The artifact URL or `artifact.downloadHeaders` was rejected. Glina does not silently retain a bad response as a GLB.

## Verification

A normal gate rejection is not a parser crash. Read every entry in `errors`. Common exact reasons include `no meshes`, `no triangles`, `no materials`, `no animation clips`, `too few animation clips: N < M [names]`, `animation clips contain no changing channels: N channel(s), all static`, `over triangle budget: N > MAX (target T)`, and byte limits.

Parser failures are exceptions: `file too small to be a GLB`, `not a GLB (bad magic)`, `truncated before first chunk`, `first GLB chunk is not JSON`, or `GLB JSON chunk does not parse: …`. Recover the source artifact; do not loosen thresholds for malformed data.

A render-only problem appears as `render smoke failed: <reason>` alongside structural errors. Fix the Blender/import/render path; structural acceptance alone does not override a requested render smoke.

## Loopback backend

- Invalid port: `error: serve requires --port <n> (0 = ephemeral)`.
- HTTP 400: fix `request body is not valid JSON`, `request body too large`, or the endpoint's missing field.
- HTTP 404: fix the exact method/path named by `unknown endpoint: …`.
- HTTP 200 NDJSON with terminal status 1: this is a job failure, not server success. Preserve preceding stderr log events.
- Stream closes before a result: backend exchange is incomplete; restart the owned backend process and retry only if the operation is safe to repeat.

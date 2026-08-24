# Loopback HTTP reference

`glina serve` is the local backend used by Glina Desktop. It binds only `127.0.0.1`, defaults to port 8080, and accepts port 0 for an ephemeral port. Once bound it prints exactly one stdout line:

```json
{"ready":true,"port":62357}
```

The actual port varies. All endpoints are under `/v1`.

## Response protocols

Ordinary endpoints return `application/json`. Pre-stream errors use a non-2xx status and:

```json
{ "error": "one product refusal sentence" }
```

Long jobs return HTTP 200 with `application/x-ndjson` once preparation succeeds. Zero or more log events are followed by exactly one result event:

```json
{"type":"log","stream":"stdout","chunk":"...\n"}
{"type":"log","stream":"stderr","chunk":"error: ...\n"}
{"type":"result","status":0,"json":{"ok":true}}
```

`status` mirrors the corresponding CLI exit status. A runtime failure after streaming starts emits a stderr log and then `{"type":"result","status":1,"json":{"error":"..."}}`. Do not infer job success from HTTP 200; read the terminal result.

Request bodies are JSON objects, at most 1 MiB. Invalid JSON: HTTP 400 `request body is not valid JSON`. Oversize body: HTTP 400 `request body too large`. Unknown route: HTTP 404 `unknown endpoint: <METHOD> <path>`.

Streamed jobs are queued and run one at a time because the backend redirects process-global console methods into the active response.

## Endpoints

### `GET /v1/health`

Returns HTTP 200 `{ "status": "ok" }`. It does not probe Blender, Weles, the vault, or configuration.

### `GET /v1/config`

Loads the launch-time config, resolves its vault references, redacts secret-shaped fields, and returns the object. Failure is HTTP 500. Unlike optional-config workflow endpoints, this endpoint does not fall back to `{}`.

### `GET /v1/blender-health`

Starts the configured/default Blender MCP session and performs the real execute probe. It always returns HTTP 200:

- success: `{ "ok": true, "detail": "Blender MCP handshake and execute probe succeeded; tools: …" }`
- failure: `{ "ok": false, "error": "…" }`

This endpoint reaches the live Blender bridge.

### `GET /v1/weles-tools`

Starts Weles MCP and returns `{ "tools": [{"name":"…","description":"…"}] }`. Failure is HTTP 500.

### `POST /v1/sculpt`

Body:

| Field | Type | Required | Meaning |
|---|---|---:|---|
| `prompt` | string | yes | Trimmed asset prompt. Missing/blank: HTTP 400 `sculpt requires a prompt`. |
| `outDir` | string or null | no | Output directory; null/absent uses default. |
| `rounds` | number/string or null | no | Converted with `Number`; null/absent uses config/default. |

Config must load before the stream starts. The NDJSON result JSON is `{outPath, verification, rounds}`.

### `POST /v1/verify`

Body: `{ "path": "/path/to/file.glb" }`. Missing/non-string/empty path is HTTP 400 `verify requires a .glb path`. Config is best-effort; load failure falls back to verification defaults. The terminal result contains the full report and status 0/1 according to `report.ok`.

### `POST /v1/preview-anim`

Body: `{ "path": "/path/to/file.glb", "clip": "idle" }`; `clip` is optional. Missing path is HTTP 400 `preview-anim requires a .glb path`. Config is best-effort. The terminal result is `{outPath, clip, frames, tool}`.

## Executed evidence

[The HTTP example](examples/serve-verify.sh) was executed with an ephemeral port. `GET /v1/health` returned `{"status":"ok"}` and `POST /v1/verify` emitted one status-0 result for the 748-triangle reference dragon. The full exchange is in [the serve walkthrough](walkthrough-serve.md).

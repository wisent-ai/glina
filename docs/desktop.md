# macOS desktop companion

Glina Desktop is a separate SwiftUI client in the `glina-desktop` repository. It does not reimplement pipeline jobs. It lazily starts the installed `glina` binary as `glina serve --port 0`, reads the ready line, then uses the [loopback HTTP API](http.md).

## Backend lifecycle

`GlinaBackendProcess` searches PATH first, then:

1. `~/.stado/bin/glina`
2. `~/.local/bin/glina`
3. `/opt/homebrew/bin/glina`
4. `/usr/local/bin/glina`

It starts one process for the app lifetime, expects `{ready:true,port:N}` within 20 seconds, binds the client to `http://127.0.0.1:N`, respawns after a death, and terminates the process when the app exits. Start failure retains the backend's stderr tail.

## Client mappings

| Desktop operation | Backend exchange |
|---|---|
| Config | `GET /v1/config` |
| Weles tools | `GET /v1/weles-tools` |
| Blender health | `GET /v1/blender-health`; `{ok:false}` is converted to a failed outcome even though HTTP status is 200. |
| Sculpt | `POST /v1/sculpt` with `prompt`, `rounds`, and null `outDir`; NDJSON stream. |
| Verify | `POST /v1/verify` with `path`; NDJSON stream. |
| Animation preview | `POST /v1/preview-anim` with `path` and `clip`; NDJSON stream. |

For streams, every log chunk is delivered to the live log in arrival order. Stderr chunks are also accumulated. The single result event supplies status and display JSON. A stream ending without a result becomes `The Glina backend closed the stream before reporting a result.`

The client extracts artifact paths only from top-level `outPath`, `file`, or `path` result keys. It uses the backend's own stderr sentence as the refusal when status is nonzero; it does not invent a second product error vocabulary.

## Operator guidance

- Install `glina` in one of the discovered locations before launching the app.
- Treat the HTTP process health and Blender health as separate states.
- A Blender health action executes a real probe in the current Blender session.
- Keep the backend local. It has no authentication and is intentionally bound to loopback only.
- If startup fails, resolve the executable or ready-line error before retrying a job; the app terminates a process that misses the handshake.

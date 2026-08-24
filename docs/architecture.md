# Architecture and ownership

Glina has two deliberately separate halves. `src/` builds procedural runtime art in a JavaScript process. `pipeline/` authors and verifies GLBs by coordinating systems that remain outside Glina.

## Components

```text
Game / JavaScript importer
        |
        +--> src/index.js --> THREE.js geometry or SVG strings

Operator / agent / Glina Desktop
        |
        +--> glina CLI --------+
        +--> glina-mcp --------+--> shared pipeline functions
        +--> glina serve ------+
                                  |
             +--------------------+--------------------+
             |                    |                    |
       Skarbiec CLI          Weles MCP            Blender MCP
       secret reads          browser work         bpy execution
             |                                         |
             +--> Brama or sanctioned OpenRouter <-----+
                  model completion
                                  |
                           verify.js quality gate
                                  |
                             accepted GLB
```

The CLI, MCP server, and loopback HTTP backend are adapters around the same functions. They do not maintain separate implementations of sculpting or verification.

## Runtime-art half

`src/index.js` exports `makeBody`, `buildBlobBody`, `sculptHumanoid`, mesh-building helpers, `cardArtSvg`, and the procedural-only loader compatibility functions. Geometry calls return THREE.js objects or mutate caller-owned vertex/index arrays; card art returns an SVG string. This path does not read config, open a network connection, resolve secrets, or start Blender.

See [runtime art](concepts/runtime-art.md) and the [JavaScript API](runtime-api.md).

## Authoring-pipeline half

- `config.js` reads one JSON document, rejects inline secret-shaped values in `credentials` and `models`, and resolves `skarbiec://` references.
- `text2game.js` drives a configured hosted studio through Weles, downloads the GLB, optionally post-processes it, then verifies it.
- `llm_blender.js` asks a configured model backend for small `bpy` steps, executes them through one Blender MCP session, exports, then verifies.
- `verify.js` parses GLB structure locally. Its optional render smoke is the only verification mode that needs Blender.
- `serve.js` exposes the desktop protocol on `127.0.0.1`; streamed jobs are serialized because console capture is process-global.

## External ownership boundaries

| Capability | Owner | What Glina does |
|---|---|---|
| Secret storage, policy, audit | Skarbiec | Resolves `skarbiec://<item>/<field>` with `skarbiec get`; retains values only in memory, except the explicit owner-only `export-config` handoff file. |
| Browser lifecycle and page automation | Weles | Starts one Weles MCP child and calls its browser/page tools. It never reads profiles or cookies itself. |
| Blender process/add-on bridge | Blender plus `blender-mcp` | Spawns the MCP stdio server and uses `get_scene_info` / `execute_blender_code`. Blender's add-on listens on loopback port 9876. |
| Serving-time model routing | Brama | Sends OpenAI-compatible chat completions with Brama's bearer plus HMAC agent identity. |
| Operator-sanctioned alternate model route | OpenRouter | Uses it only when configured; its key still comes from Skarbiec. |
| Desktop UI | `glina-desktop` companion repository | Lazily starts `glina serve --port 0` and consumes HTTP/NDJSON. |

Glina owns none of the vault, browser, model router, or Blender bridge. It owns the workflow, its integration discipline, the produced artifact, and the acceptance gate.

## Trust and failure boundaries

1. **Config load:** handwritten inline secrets are refused before a job begins.
2. **Child-process environment:** MCP clients use PATH and HOME by default rather than inheriting the parent environment.
3. **Model code:** each response must be JSON; each `bpy` body is wrapped so Python exceptions become `GAC-EXEC-ERROR` output instead of escaping through the add-on.
4. **Artifact boundary:** a downloaded or exported file does not count as success until the gate passes.
5. **Protocol boundary:** HTTP failures are JSON error envelopes before streaming, or a terminal status-1 NDJSON result after a stream begins. MCP tool failures set `isError: true`.

## Data and lifecycle

Glina has no database or daemon-owned state. Durable output is the downloaded/exported GLB, optional preview GIF/render PNG, and an explicitly requested resolved config file. Browser, Blender MCP, and Weles MCP sessions are scoped to a job and closed in `finally` blocks. `glina serve` is the only long-lived process; the desktop companion terminates it when the app exits.

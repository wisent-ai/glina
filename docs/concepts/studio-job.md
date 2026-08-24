# Studio job

A studio job (`pipeline/text2game.js`, `runTextToGameJob`) generates an asset
through a hosted text-to-3D studio's web UI, driven end-to-end through
Skarbiec (credentials) and Weles (browser). Nothing platform-specific is
hardcoded: endpoints and selectors come from the pipeline config, so swapping
studios is a config change, not a code change.

Entry points: `glina create <prompt> [--race r]`, MCP tool
`glina_create_asset`. (`--race` prefixes the prompt; the MCP schema limits it
to `humans | dwarves | elves | skeletons`.)

## Steps

Every step is named, and a failure carries its name:
`text2game step '<name>' failed: <reason>`.

1. `open-session` — start a [browser session](browser-session.md)
   (`browser.headless`, `browser.engine` from config) and open a page.
2. `login:goto` / `login:user` / `login:pass` / `login:submit` — navigate to
   `studio.loginUrl`, fill `studio.selectors.loginUser` /
   `loginPassword` with the resolved `credentials.username` / `password`,
   click `loginSubmit`.
3. `studio:goto` / `studio:prompt` / `studio:submit` — open
   `studio.generateUrl`, fill `promptInput`, click `generateSubmit`.
4. `studio:wait-artifact` — poll `studio.artifact.pollExpression` (a page
   JavaScript expression) every `intervalMs` (default 5 s) until it yields an
   `http…` string, up to `timeoutMs` (default 300 s); on timeout:
   `artifact not ready within Nms`.
5. `artifact:download` — fetch the artifact URL (optional
   `artifact.downloadHeaders`); non-2xx: `download failed: HTTP N`. The file
   lands at `<outDir>/<slug>.glb` (default `assets/models`).
6. `blender:postprocess` (only when `blender.enabled`) — import → run
   `blender.processCode` (which sees `INPUT_PATH` and `OUTPUT_PATH` as
   injected globals) → export `<name>.processed.glb`. See
   [Blender session](blender-session.md).
7. `verify` (unless `verify.enabled: false`) — the
   [verification gate](verification-gate.md) with `throwOnFail`, run against
   the processed file when one exists, else the download.

Result: `{ outPath, processedPath, artifactUrl, prompt, verification }`.

## Invariants

- The browser session closes in a `finally`; a failed job never leaks a
  browser slot.
- Credentials exist only in process memory, resolved from
  `skarbiec://` references at config load — never logged, never written.
- The example config (`pipeline.config.example.json`) targets Hunyuan3D's
  studio and stores its login as vault item `TEXT2GAME_ACCOUNT` with fields
  `login_email` / `login_password`.

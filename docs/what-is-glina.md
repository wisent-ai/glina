# What is Glina

Glina turns a text prompt into a verified, game-ready GLB. An LLM (routed
through Brama, the org model router) writes Blender Python, executes it round
by round through a live Blender MCP session, and every produced asset must
pass a structural quality gate before it counts as done. The same package also
ships the procedural THREE.js runtime art that the browser RTS
[Potyczka](https://github.com/lbartoszcze/potyczka) renders in-game — Glina
was extracted from that game's `web/art/` with full history.

## The three-part mental model

1. **Two halves, one package.**
   - *Runtime art* (`src/`) is procedural generation a game imports directly:
     `makeBody`, `sculptHumanoid`, `cardArtSvg`. No credentials, no network,
     no Blender — geometry and SVG built in memory.
   - *Authoring pipeline* (`pipeline/`) is the AI text→3D toolchain: the
     `glina` CLI, the `glina-mcp` stdio server for agent hosts, and the
     loopback HTTP backend (`glina serve`) the macOS desktop app drives.

2. **Every capability is delegated through a hard integration boundary.**
   The pipeline holds no secrets, no browser, no Blender socket, and no
   provider API of its own:
   - secrets resolve only from **Skarbiec** (`skarbiec://<item>/<field>` refs
     in the config; inline secrets are refused at load time),
   - browser automation goes only through the **Weles** MCP stdio server,
   - Blender work goes only through a **Blender MCP** server
     (`uvx blender-mcp` by default),
   - model access goes through **Brama** by default; the operator may
     sanction **OpenRouter** in the config as the only alternative. Direct
     provider APIs (Anthropic, OpenAI, …) do not exist in this package —
     those code paths were deleted at the owner's demand, not gated.

3. **The verification gate is the definition of done.** Every produced `.glb`
   passes `pipeline/verify.js`: valid glTF container, mesh/primitive sanity,
   triangle budget (default 6000 ±100%), materials, animation clips whose
   channels actually move, file-size bounds, and an optional Blender render
   smoke. A failed gate fails the job — it never warns.

## What Glina is not

- Not a model router — Brama owns which model answers ([model
  backend](concepts/model-backend.md)).
- Not a vault — Skarbiec owns secrets; Glina only carries references.
- Not a browser — Weles owns page automation.
- Not a Blender wrapper library — the only Blender surface used is
  `get_scene_info` and `execute_blender_code`; everything else is Blender
  Python sent through that one tool.

## Where to go next

- [Quick start](quick-start.md) — install, configure, run the gate.
- [Concepts](concepts/sculpt-job.md) — sculpt job, studio job, verification
  gate, Blender session, browser session, model backend, runtime art.
- [CLI reference](cli.md), [HTTP reference](http.md),
  [MCP reference](mcp.md), [runtime API](runtime-api.md).
- [Architecture](architecture.md) — what Glina owns and does not own.
- [Runbook](runbook.md) — symptom-first failure catalogue.

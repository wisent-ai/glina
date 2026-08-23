---
name: glina
description: Glina — generate, post-process, and verify game assets. Procedural runtime art (anatomy/sculpt/card art), AI text-to-3D pipeline, Blender MCP post-processing, and a GLB quality gate. Credentials come only from Skarbiec (skarbiec:// refs); browser work only via the Weles MCP server; Blender work only via the Blender MCP server; model access ONLY via Brama. Use when creating, processing, or verifying 3D models or card art.
---

# Glina

Asset pipeline born inside the RTS game simple-rts-unity (races: humans /
dwarves / elves / skeletons); two halves:

- **Runtime art** (`src/`) — procedural THREE.js generation imported by the
  game: `makeBody` / `sculptHumanoid` / `cardArtSvg`. No credentials, no
  network.
- **Authoring pipeline** (`pipeline/`) — AI text→3D generation with strict
  integration rules (below).

## Hard rules (never bypass)

1. **Secrets**: only via Skarbiec. Config holds `skarbiec://<item>/<field>`
   refs; the loader rejects inline secrets and credential-shaped env vars.
2. **Browser**: only via the Weles MCP stdio server (`weles-mcp`), never a
   local Chromium/profile.
3. **Blender**: only via a Blender MCP server (`uvx blender-mcp` default),
   never hand-rolled sockets.
4. **Model access**: ONLY via Brama (the org model router). There is NO
   direct provider API code in this package — the user explicitly rejected
   direct calls (Anthropic etc.); the code paths were deleted, not gated.

## Setup (once per machine)

```bash
skarbiec set TEXT2GAME_ACCOUNT --type login \
  --field login_email=you@example.com --field login_password=...
cp pipeline.config.example.json pipeline.config.json   # edit URLs/selectors
node pipeline/cli.js setup                              # installs Blender + uv + blender-mcp
node pipeline/cli.js blender-health
```

## CLI

```bash
node pipeline/cli.js check-config          # validate config + vault refs
node pipeline/cli.js create "dwarven axe warrior, low-poly" --race dwarves
node pipeline/cli.js sculpt "gothic dwarven tower, low-poly"   # LLM drives Blender
node pipeline/cli.js verify assets/models/warrior.glb
node pipeline/cli.js weles-tools
node pipeline/cli.js setup [--check|--dry-run]
```

## LLM sculpt mode

`sculpt` lets a model iteratively write bpy code into the Blender MCP session
— block out, refine, colors — then exports GLB and runs the verification
gate. Model access goes ONLY through Brama (`models.brama.{url,key,model}`);
direct provider APIs do not exist in this package. Cap: `llm.maxRounds`
(default 12). MCP tool: `glina_sculpt`.

`create` flow: login → prompt → poll → download `.glb` → optional Blender
postprocess (`blender.enabled`, `blender.processCode` sees
`INPUT_PATH`/`OUTPUT_PATH`) → **verification gate** (fails the job on
broken/off-budget assets). Outputs `<name>.glb` (+ `<name>.processed.glb`).

## MCP server (for agents)

```bash
node pipeline/mcp.js        # stdio JSON-RPC MCP, package bin: glina-mcp
```

Tools: `glina_create_asset` (prompt/race/out_dir/filename/config),
`glina_sculpt` (prompt/out_dir/filename/max_rounds/config), `glina_verify_asset`
(path/config), `glina_check_config`, `glina_blender_health`, `glina_weles_tools`.

## Verification gate (`verify` in config)

- Structural GLB checks: valid glTF container, meshes/primitives,
  **triangle budget** (`triTarget` 6000, `triTolerancePct` 100),
  materials/skins/animation clips, file size bounds.
- Optional render smoke through Blender MCP (`verify.render: true`).
- `verify.enabled: false` opts out (not recommended).

## Layout

- `src/` — runtime procedural art (ESM, `three` via import map)
- `assets/cards/` — card glyph SVGs; `assets/models/` — reference GLBs
- `pipeline/` — skarbiec.js, config.js, weles.js, blender.js, setup.js,
  text2game.js, verify.js, cli.js, mcp.js
- `tests/` — node:test (fake vault, fake MCP servers, synthetic GLBs)

Run tests: `npm test` (15+ tests, no real vault/browser/Blender needed).

## Tests & evals live in Probierz

End-to-end journeys and visual evaluation for this package run in
**Probierz** (`wisent-tester`), registered as app `game-asset-creator`:

- TUI journeys (CLI, verify gate): `packages/tui/specs/game-asset-creator-cli.spec.mjs`
- Visual eval (Blender-render → Brama-vision rubric):
  `apps/game-asset-creator/evals/visual-eval.mjs`
- App config: `apps/game-asset-creator/probierz.yaml`, fixtures in
  `apps/game-asset-creator/fixtures.mjs` (synthetic GLBs + fake vault)

Package-local unit tests (`npm test` here) stay for fast iteration;
anything touching a browser, Blender, a model, or a vault belongs in
Probierz.

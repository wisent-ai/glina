# Glina

**Your AI sculpts your game assets.** Glina turns a text prompt into a verified,
game-ready GLB: a Brama-routed model writes Blender Python, executes it through
a live Blender MCP session, round by round, and every result passes a structural
quality gate before it counts as done.

Born as the asset pipeline of the browser RTS [Potyczka](https://github.com/lbartoszcze/potyczka)
(`web/art/`, extracted with full history), now a standalone Wisent product.

## Two halves

- **Runtime art** (`src/`) — procedural THREE.js generation imported by a game:
  `makeBody` / `sculptHumanoid` / `cardArtSvg`. No credentials, no network.
- **Authoring pipeline** (`pipeline/`) — AI text→3D generation with strict
  integration rules (below).

## Hard rules (never bypass)

1. **Secrets**: only via [Skarbiec](https://github.com/wisent-ai/skarbiec).
   Config holds `skarbiec://<item>/<field>` refs; the loader rejects inline
   secrets and credential-shaped env vars.
2. **Browser**: only via the Weles MCP stdio server (`weles-mcp`), never a
   local Chromium/profile.
3. **Blender**: only via a Blender MCP server (`uvx blender-mcp` default),
   never hand-rolled sockets.
4. **Model access**: [Brama](https://github.com/wisent-ai/brama), the org
   model router, is the default and the only fleet path. When the operator
   sanctions it in the config (`models.openrouter` + `models.backend`), the
   [OpenRouter](https://openrouter.ai) API is an approved alternative — the
   key still comes from Skarbiec. No other direct provider APIs exist here;
   direct paths were deleted at the owner's demand, not gated.

## Install

```sh
npm install -g @wisent-ai/glina     # or: npm install @wisent-ai/glina
```

Bins: `glina` (CLI) and `glina-mcp` (MCP stdio server for agents).

## Use

```sh
glina check-config                                   # validate config + vault refs
glina sculpt "gothic dwarven tower, low-poly"        # LLM drives Blender
glina create "dwarven axe warrior" --race dwarves    # studio flow via Weles browser
glina verify assets/models/tower.glb                 # GLB quality gate
glina preview-anim assets/models/dragon.glb          # animated GIF of one clip
glina animate assets/models/dragon.glb --preset dragon --out dragon-animated.glb
glina showcase dragon --out assets/models/smok.glb   # cohesive animated reference
glina blender-health                                 # probe the Blender session
glina weles-tools                                    # list browser-layer tools
```

MCP tools for agent hosts (`glina-mcp`): `glina_create_asset`,
`glina_sculpt`, `glina_verify_asset`, `glina_check_config`,
`glina_blender_health`, `glina_weles_tools`.

## Animations

Sculpt jobs whose config sets `verify.requireAnimations` / `verify.minAnimationClips`
produce rigged assets: the model builds an armature, parents the mesh with
automatic weights, and keyframes named Actions ("idle" plus one characteristic
motion). `animate` supplies deterministic, visibly moving presets when an
LLM-authored clip is structurally present but visually static. `preview-anim`
renders one clip through Blender into a looping GIF.

`showcase dragon` builds a deterministic cohesive reference asset — rigid
mesh parts bone-parented to a compact armature — for animation regression and
visual review. It replaces the disconnected LLM prototype.

## Verification gate

Every produced `.glb` passes `pipeline/verify.js`: valid glTF container,
mesh/primitive sanity, triangle budget (default 6000 ±100%), materials/skins/
animation clips and changing animation channels, file-size bounds, optional
Blender render smoke. The gate fails the job; it never warns.

## Proven results

Generated end-to-end and gate-verified on live runs:

- `kamien.glb` — granite boulder with moss patches (12 bpy rounds, Brama →
  Blender MCP, 2026-07-27)
- `krasnolud-wojownik.glb` — dwarven warrior (local Brama, 2026-07-28)

## Surfaces

| Surface | Repository |
|---|---|
| CLI + pipeline | `wisent-ai/glina` (this repo) |
| macOS app | `wisent-ai/glina-desktop` |
| Website | `wisent-ai/glina-landing` |

Quality journeys and visual evaluation are registered in **Probierz**
(`apps/game-asset-creator`); package-local unit tests (`npm test`) stay for
fast iteration only.

## License

MIT

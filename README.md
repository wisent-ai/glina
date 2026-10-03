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

1. **Secrets**: [Skarbiec](https://github.com/wisent-ai/skarbiec), or on a
   machine without it the owner-only JSON file `GLINA_CREDENTIALS_FILE` names
   (item → field → value, mode 600; a file others can read is refused). Config
   holds `skarbiec://<item>/<field>` refs either way; the loader rejects inline
   secrets and credential-shaped env vars. `glina check-config` prints every
   value that came from a reference as `<resolved: ok>`.
2. **Browser**: only via the Weles MCP stdio server (`weles-mcp`), never a
   local Chromium/profile.
3. **Blender**: only via a Blender MCP server (`uvx blender-mcp` default),
   never hand-rolled sockets.
4. **Model access**: one backend under `models`. `models.brama` is
   [Brama](https://github.com/wisent-ai/brama), the org model router, with
   `url`, `key`, `bearer` and `agent_id`; requests are signed. Without Brama,
   `models.openai_compatible` names any OpenAI-compatible provider with `url`,
   `bearer` and `model`; requests go unsigned. Any other key, or both at
   once, is refused by name.

## Install

```sh
npm install -g @wisent-ai/glina     # or: npm install @wisent-ai/glina
```

Bins: `glina` (CLI) and `glina-mcp` (MCP stdio server for agents).

## Use

```sh
glina onboarding [--reset] [--asset existing.glb]   # first-run import or replay
glina import existing.glb [--name asset-id] [--variant-of base-id]
glina workspace [list | select <id> | remove <id>]  # inspect, activate, or remove
glina check-config                                   # validate config + vault refs
glina sculpt "gothic dwarven tower, low-poly"        # LLM drives Blender
glina create "dwarven axe warrior" --race dwarves    # studio flow via Weles browser
glina verify [assets/models/tower.glb]               # explicit or active GLB gate
glina preview-anim [assets/models/dragon.glb]        # one clip as an animated GIF
glina preview-scene [assets/models/dragon.glb]       # neutral-ground PNG via Blender
glina animate [rigged.glb] --preset motion --out build/moving.glb
glina showcase biped --out build/biped.glb
glina showcases [list | add <name> <file.json> | remove <name>]
glina presets [list | add <name> <file.json> | remove <name>]
glina doctor                                         # config, Blender bridge, browser layer; exit 1 on any failure
```

MCP tools for agent hosts (`glina-mcp`): `glina_create_asset`,
`glina_sculpt`, `glina_verify_asset`, `glina_check_config`, `glina_doctor`.

`glina import` accepts existing GLB data without invoking a model. It stages the
exact bytes, runs the canonical structural and configured Blender gate, then
commits only accepted content under `$XDG_DATA_HOME/glina` or
`~/.local/share/glina`. `--variant-of` links a distinct accepted asset to an
existing base; removing that base is refused until its variants are removed.
Repeated SHA-256 content is `unchanged`; the same name with different content
is `conflicting`; invalid data is `rejected` without a partial manifest update.
The active destination is the default for `verify`, `animate`, `preview-anim`,
and `preview-scene` when their path is omitted.

## Animations

Sculpt jobs whose config sets `verify.requireAnimations` / `verify.minAnimationClips`
produce rigged assets: the model builds an armature, parents the mesh with
automatic weights, and keyframes named Actions ("idle" plus one characteristic
motion). `animate` supplies deterministic, visibly moving presets when an
LLM-authored clip is structurally present but visually static. `preview-anim`
renders one clip through Blender into a looping GIF. `preview-scene` renders
the selected model on neutral ground as a PNG, with a bounds-framed camera;
both require a live Blender MCP session and report the failed operation.

`showcase <asset>` builds a deterministic cohesive reference asset — rigid
mesh parts bone-parented to a compact armature — for animation regression and
visual review. It replaces the disconnected LLM prototype.

Showcase assets and animation presets are declarations interpreted by
`pipeline/rigs/interpreter.js`, not separate generators. Glina ships `dragon`
and `biped` showcases and `dragon` and `motion` presets. The latter has idle,
travel and attack clips without required bone names, for any rigged GLB.
Built-in JSON files live under `assets/showcases/` and `assets/presets/`.
`glina showcases add <name> <file.json>` (or `presets add`) validates the
declaration and stores it under the user workspace; `remove` withdraws only
custom declarations. Built-ins cannot be removed, and an unknown or malformed
declaration is refused with exit status 2. See the [declaration and animation
contracts](https://glina.wisent.com/docs/cli/animate).

## Verification gate

Every produced `.glb` passes `pipeline/verify.js`: valid glTF container,
mesh/primitive sanity, triangle budget (default 6000 ±100%), materials/skins/
animation clips and changing animation channels, file-size bounds, optional
Blender render smoke. The gate fails the job; it never warns.

## Example outputs

Examples of generated assets:

- `kamien.glb` — granite boulder with moss patches
- `krasnolud-wojownik.glb` — dwarven warrior

## Surfaces

| Surface | Repository |
|---|---|
| CLI + pipeline | `wisent-ai/glina` (this repo) |
| macOS app | `wisent-ai/glina-desktop` |
| Website | `wisent-ai/glina-landing` |

The real CLI lifecycle tests live under `tests/workspace/` and `tests/animation/`.
Run `node --test tests/workspace/*.test.mjs tests/animation/declarations.test.mjs`
for workspace and declaration flows. `tests/preview/scene.test.mjs` and
`tests/animation/catalogue.test.mjs` exercise live Blender and cannot pass
with a disconnected add-on.

## License

MIT

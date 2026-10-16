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

1. **Secrets**: by role. Config holds `role://<role>/<field>` references — the
   role the vault item plays (its tag `stado:role:<role>`) and the field — and
   never an item name. Each is read with `stado credentials get --role ROLE
   --field FIELD` (`STADO_BIN` names another executable), or on a machine
   without Stado from the owner-only JSON file `GLINA_CREDENTIALS_FILE` names
   (role → field → value, mode 600; a file others can read is refused). The
   loader refuses inline credential fields. `glina config check` validates the
   selected model backend and prints references as `<resolved: ok>`; it
   refuses resolved handoff files because they contain plaintext secrets.
2. **Browser**: one layer under `browser`, never a local Chromium profile.
   `browser.weles` drives Weles through
   its MCP stdio server (`command`, default `weles-mcp`; `args`; `headless`;
   `engine`). Without Weles, `browser.playwright_mcp` names the program that
   starts the Playwright MCP server and its arguments (`command` and `args`,
   both required); the studio selectors are passed to it as Playwright
   targets and the artifact link is read from its `Result` reply. No
   `browser` section, an empty one, any other key, or both at once is refused
   by name.
3. **Blender**: only via the MCP for Blender server (`uvx mcp-for-blender`
   default), never hand-rolled sockets.
4. **Model access**: one backend under `models`. `models.brama` is
   [Brama](https://github.com/wisent-ai/brama), the org model router, with
   `key`, `bearer`, `agent_id` and the alias in `model`; requests are signed.
   Its address is `url` when given, otherwise the one Stado's service
   directory wrote for this machine in `~/.stado/forwards/brama.local`; with
   neither the run is refused naming both. Without Brama,
   `models.openai_compatible` names any OpenAI-compatible provider with `url`,
   `bearer` and `model`; requests go unsigned. Any other key, or both at
   once, is refused by name.

## Install

```sh
npm install -g @wisent-ai/glina     # or: npm install @wisent-ai/glina
```

Bins: `glina` (CLI) and `glina-mcp` (MCP stdio server for agents).

Releases go through Stado: `.wisent-release.json` packs the package with
`stado product npm pack`, runs the test suite (`node --test`) on the release
worker's checkout, and publishes the verified `npm-package.tgz` unchanged with
`stado product deliver npm`. `stado product install glina --surface cli`
installs that release. The example configuration ships as
`docs/examples/pipeline.config.example.json`.

## Use

```sh
glina onboarding [--reset] [--asset existing.glb]   # first-run import or replay
glina import existing.glb [--name asset-id] [--variant-of base-id]
glina workspace [list | select <id> | remove <id>]  # inspect, activate, or remove
glina config check                                   # validate config, vault refs and model backend
glina sculpt "gothic dwarven tower, low-poly"        # LLM drives Blender
glina create "dwarven axe warrior" --race dwarves    # studio flow via the declared browser layer
glina verify [assets/models/tower.glb]               # explicit or active GLB gate
glina preview anim [assets/models/dragon.glb]        # one clip as an animated GIF
glina preview scene [assets/models/dragon.glb]       # neutral-ground PNG via Blender
glina animate [rigged.glb] --preset motion --out build/moving.glb
glina showcase biped --out build/biped.glb
glina showcases [list | add <name> <file.json> | remove <name>]
glina presets [list | add <name> <file.json> | remove <name>]
glina setup [--check] [--dry-run]                     # provision Blender, uv and the matching addon
glina doctor                                         # config, Blender bridge, browser layer; exit 1 on any failure
```

`setup --check` inspects installed tools, not Blender's live addon. Run `doctor`
to check the code round trip; an addon installed on disk can still be inactive
in the running Blender process.

`doctor` reads the browser layer from the config: it starts the declared MCP
server, lists its tools and reports `bridge` (`weles` or `playwright_mcp`),
`command` and `tools`. A config that cannot be loaded fails the Blender and
browser checks with that cause instead of probing a default server.

`create` writes `<out>/<name>.glb` (`--out`, default `assets/models`); the
name is the prompt's letters and digits joined by hyphens, and a prompt with
none is refused. The MCP tool `glina_create_asset` also takes `filename`.

MCP tools for agent hosts (`glina-mcp`): `glina_create_asset`,
`glina_sculpt`, `glina_verify_asset`, `glina_check_config`, `glina_doctor`.
`glina_verify_asset` loads its config as `glina verify` does: only an absent
default `pipeline.config.json` leaves the built-in thresholds; an explicit
`config` that cannot be read, or a default that does not parse, is a tool error
naming the file.

`glina import` accepts existing GLB data without invoking a model. It stages the
exact bytes, runs the canonical structural and configured Blender gate, then
commits only accepted content under `$XDG_DATA_HOME/glina` or
`~/.local/share/glina`. `--variant-of` links a distinct accepted asset to an
existing base; removing that base is refused until its variants are removed.
Repeated SHA-256 content is `unchanged`; the same name with different content
is `conflicting`; invalid data is `rejected` without a partial manifest update.
The report's `accepted` is true for `imported` and `unchanged`, the outcomes
that leave the asset in the workspace as the active input. Onboarding records
its first success only on an accepted import; a progress file under
`$XDG_STATE_HOME/glina/onboarding.json` that cannot be read or is not JSON is
refused with the file and the cause rather than restarted.
The active destination is the default for `verify`, `animate`, `preview anim`,
and `preview scene` when their path is omitted.

## Animations

Sculpt jobs whose config sets `verify.requireAnimations` / `verify.minAnimationClips`
produce rigged assets: the model builds an armature, parents the mesh with
automatic weights, and keyframes named Actions ("idle" plus characteristic
motions, as many as `verify.minAnimationClips` states). A sculpt needs
`llm.maxRounds` (or `--rounds`) and `llm.maxTokens` in the pipeline config and
refuses to start without them; its prompt names the triangle budget only when
`verify.triTarget` states one. `animate` supplies deterministic, visibly moving presets when an
LLM-authored clip is structurally present but visually static. `preview anim`
renders one clip through Blender into a looping GIF. `preview scene` renders
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
mesh/primitive sanity, the triangle budget when the config states
`verify.triTarget` (with its `verify.triTolerancePct`; a target without a
tolerance is refused), materials/skins/animation clips and changing animation
channels, optional Blender render smoke at the scene's own render size. The
gate fails the job; it never warns.

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

The real CLI and MCP journeys live under `tests/cli/`, `tests/config/`,
`tests/workspace/`, `tests/animation/`, `tests/mcp/`, `tests/onboarding/` and
`tests/doctor/`:

```sh
node --test tests/cli/*.test.mjs tests/config/*.test.mjs tests/workspace/*.test.mjs tests/animation/declarations.test.mjs tests/mcp/*.test.mjs tests/onboarding/*.test.mjs tests/doctor/*.test.mjs
```

These cover the installed shape (`glina` run through a symlink, `--help`,
JSON and `--text` output, the `config` and `preview` groups and the refusal of
the retired hyphenated verbs), `config check` resolving role references from
`GLINA_CREDENTIALS_FILE` and refusing item references and inline secrets, the
workspace and its variants, declarations, the MCP verify config refusals, the
onboarding progress refusals and `glina doctor`
against a Blender that is not running (it starts the real
`uvx mcp-for-blender` server, so it needs uv). Each journey keeps its data
and state in its own directory under `build/tests/`. With `GLINA_TEST_DEFECT`
and `GLINA_TEST_CRITERION` set on committed source, a passing journey writes a
criterion report under `build/criterion/`: the revision, the commands with
their exits and the refusals it observed.
`tests/preview/scene.test.mjs` and `tests/animation/catalogue.test.mjs`
exercise live Blender and cannot pass with a disconnected add-on.
`tests/browser/bridge.test.mjs` checks the browser refusals through
`glina doctor`, then starts the real Playwright MCP server through `npx` (so
it needs npm and a Playwright browser) and runs `glina create` against a
studio page the test serves, comparing the written GLB with the linked one.

## License

MIT

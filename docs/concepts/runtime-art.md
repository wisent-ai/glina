# Runtime art

The runtime-art half (`src/`) is what a game imports: procedural THREE.js
geometry and SVG card art, built entirely in memory. No credentials, no
network calls at generation time, no Blender — this half never touches the
authoring pipeline's integration boundaries.

It is the extracted asset layer of the browser RTS Potyczka (races: humans /
dwarves / elves / skeletons), and its APIs keep that game's vocabulary.

## Modules

| Module | Subpath | What it builds |
|---|---|---|
| `anatomy.js` | `./anatomy` | `makeBody(team, raceKey, armorTier, weaponTier, klass, magicType, weaponStyle)` — lathe-profile humanoid bodies with race visuals (skin/helmet colors, proportions, beard/ears/skull accessories); `buildBlobBody` — marching-cubes blob bodies with generated skin textures |
| `sculpt.js` | `./sculpt` | `sculptHumanoid(opts)` — a single-geometry vertex-colored warrior (torso/head/limb rings, face features, axe, armor details, cape, horns); palette via `opts.skin/armor/helmet/pants/boot/belt/collar/gauntlet`, plus `beard`, `eyeGlow`, `noHorns` |
| `sculpt-gear.js` | `./sculpt-gear` | low-level mesh helpers: `addBox`, `buildAxe`, `buildArmorDetails`, `buildBodyDetails`, `buildExtraDetails`, `buildCape` |
| `card-art.js` | `./card-art` | `cardArtSvg(card, race)` — a complete `<svg>` string; dependency-free |
| `loader.js` | `./loader` | procedural-only stubs of a former GLB loader API (see below) |

`three` (>= 0.160.0) is a peer dependency of the geometry modules.
`anatomy.js` additionally imports `MarchingCubes` from the three examples CDN
and `../../lib/weapons.js` — a game-side file, so `./anatomy` resolves as an
import only inside a host that provides that layout; `sculpt.js`,
`sculpt-gear.js`, `card-art.js`, and `loader.js` are self-contained.

## Card art

`cardArtSvg(card, race)` is pure string assembly (no DOM, runs in Node):

- `race` picks a palette and background scene (`castle`, `peaks`, `forest`,
  `ruins`); unknown races fall back to `humans`.
- `card.tier` picks the glow (`common`, `combo`, `rare`; anything else gets
  a neutral grey).
- The glyph is chosen from `card.id` / `card.klass` / `card.kind` by
  `pickGlyph` (e.g. `d_forge → anvil`, `klass: archer → bow`,
  `kind: building → tower`; final fallback `sword`) and referenced as an
  `<image href="<ART_BASE>/<glyph>.svg">` from `assets/cards/` — overridable
  in a browser via `window.CARD_ART_BASE`.

Executed evidence: `node docs/examples/card-art.mjs` writes a 5.6 kB SVG.

## Loader stubs

`loader.js` keeps the old GLB-loading API alive as explicit no-ops, because
all character geometry is procedural now: `loadHumanoid()` resolves `null`,
`isHumanoidReady()`/`isRaceReady()` return `false`, `loadRaceModel()` rejects
with `procedural-only`, `buildRaceUnit`/`buildHumanoidUnit`/`playClip` return
`null`, `crossFadeTo` returns the current action unchanged.

Full export list: [runtime API reference](../runtime-api.md).

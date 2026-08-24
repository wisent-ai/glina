# JavaScript runtime API

Package: `@wisent-ai/glina` (ES modules). `three >= 0.160.0` is a peer dependency. The root export re-exports every function below; subpaths are `./anatomy`, `./sculpt`, `./sculpt-gear`, `./card-art`, and `./loader`.

`./anatomy` imports a host-side `../../lib/weapons.js` and uses `document.createElement('canvas')` for blob textures. It is intended for the original game layout/browser runtime. The other listed subpaths are self-contained apart from their THREE.js peer where noted.

## High-level geometry

### `makeBody(team, raceKey, armorTier = 0, weaponTier = 0, klass = 'infantry', magicType = null, weaponStyle = null)`

From `./anatomy`. Returns a `THREE.Group` containing the full procedural unit body. `team` must provide `livery` and `accent` THREE-compatible colors. Known `raceKey` values are `humans`, `dwarves`, `elves`, and `skeletons`; unknown values use human visual constants. `klass` affects scale and weapon construction. The returned group exposes `userData.weaponArm`, `userData.shieldArm`, and `userData.twoHand`, uses `YXZ` rotation order, and is scaled for race/class proportions.

### `buildBlobBody(skinHex, accentHex, resolution = 96, isolation = 80)`

From `./anatomy`. Builds and returns a THREE `MarchingCubes` object, with a generated canvas skin texture, fixed body field, cast shadows, and scalar size 2.32. Requires browser DOM canvas support.

### `sculptHumanoid(opts = {})`

From `./sculpt`. Returns one `THREE.Mesh` with indexed `BufferGeometry`, vertex colors, computed normals/bounds, cast/receive shadow enabled, and the fixed stylized warrior geometry. Color options accept THREE-compatible numeric hex values:

- palette: `skin` (`0xd9b48a`), `armor` (`0xc9a44a`), `helmet` (`0x9a9aa6`), `pants` (`0x4a3a2a`), `boot` (`0x2a1f15`), `belt` (`0x33231a`), `collar` (`0xb8843e`), `gauntlet` (`0x8a8a98`)
- details: `cape` (`0x8a1a1a`), `tabard` (falls back to cape), `emblem` (`0xfff5b8`), `shield` (`0x8a1a1a`), `eyeGlow` (`0xffaa30`), `beardColor` (`0x6e3f1f`), `furColor` (`0xe8e0d0`)
- toggles: `beard` (off by default), `noHorns` (false), `noSpikes` (false), `fur` (enabled unless exactly false)

## Card art

### `cardArtSvg(card, race)`

From `./card-art`; no THREE.js or DOM dependency. Returns a complete 100×100 SVG string with invocation-unique definition IDs. `race` chooses `humans`, `dwarves`, `elves`, or `skeletons`; unknown values fall back to humans. `card.tier` recognizes `common`, `combo`, and `rare`, otherwise neutral gray. Glyph selection examines `card.id`, then `card.klass`, then `card.kind`, then falls back to sword. Glyph images use `glina/assets/cards` unless browser global `window.CARD_ART_BASE` is set before module evaluation.

See [the executable card example](examples/card-art.mjs).

## Low-level sculpt-gear builders

These functions mutate caller-owned flat arrays and return `undefined`. `verts` and `colors` are packed XYZ/RGB number arrays; `idx` is a triangle-index array. Colors/palette members are `THREE.Color` instances.

- `addBox(verts, colors, idx, color, cx, cy, cz, hx, hy, hz)` appends an axis-aligned box centered at `(cx,cy,cz)` with half-extents `(hx,hy,hz)`.
- `buildAxe(verts, colors, idx, haftCol, bladeCol)` appends the fixed warrior axe.
- `buildArmorDetails(verts, colors, idx, palette, opts)` appends emblem, greaves, pauldrons, trim, rivets, and armor plates; reads `opts.armor` and `opts.emblem`.
- `buildBodyDetails(verts, colors, idx, palette, opts)` appends helmet/visor, boots, belt, tabard, scabbard, gauntlets, and chest details; reads `opts.tabard` and `opts.cape`.
- `buildExtraDetails(verts, colors, idx, palette, opts)` appends optional spikes/fur plus cape stripes and weapon/body accents; reads `noSpikes`, `fur`, `furColor`, and `cape`.
- `buildCape(verts, colors, idx, opts)` appends two-sided cape triangles; reads `opts.cape`.

## Procedural-only loader compatibility API

`./loader` preserves former call sites but does not load GLBs:

| Function | Result |
|---|---|
| `loadHumanoid()` | `Promise.resolve(null)` |
| `isHumanoidReady()` | `false` |
| `isRaceReady()` | `false` |
| `loadAllRaces()` | `Promise.resolve([])` |
| `loadRaceModel()` | rejected Promise with `Error('procedural-only')` |
| `buildRaceUnit()` | `null` |
| `buildHumanoidUnit()` | `null` |
| `playClip()` | `null` |
| `crossFadeTo(unitGltf, currentAction)` | returns `currentAction` unchanged |

These are compatibility stubs, not an asynchronous loading subsystem.

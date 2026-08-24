# Verification gate

The gate (`pipeline/verify.js`) is the pipeline's definition of done: every
produced `.glb` must pass it, and a failed gate fails the job. It never warns.

## Definition

Two layers:

1. **Structural** (always): parse the GLB container and check it against
   thresholds from the pipeline config.
2. **Render smoke** (optional, `verify.render: true`): import the file into
   an empty Blender scene through the [Blender session](blender-session.md)
   and render one 512×512 frame — proves Blender can actually open the
   artifact.

## Report shape

`verifyAsset(path, config)` returns one report and the CLI prints it:

```json
{
  "ok": true,
  "errors": [],
  "stats": {
    "meshes": 38, "primitives": 38, "triangles": 748,
    "materials": 5, "animations": 2, "animationNames": ["flap", "idle"],
    "textures": 0, "nodes": 48,
    "animationChannels": 54, "movingAnimationChannels": 8,
    "staticAnimationChannels": 46
  },
  "thresholds": { "triTarget": 6000, "triTolerancePct": 100, "...": "..." },
  "path": "assets/models/smok.glb"
}
```

`triangles` counts TRIANGLES-mode primitives via their index accessor (or
POSITION count when unindexed). `movingAnimationChannels` counts channels
whose float output samples actually differ by more than `0.00001` from the
first sample — a clip that exists but never moves is detected.

## Thresholds and defaults

| Threshold | Default | Failure sentence |
|---|---|---|
| `triTarget` | `6000` | `over triangle budget: N > MAX (target T)` — MAX = target × (100 + tolerance)/100 |
| `triTolerancePct` | `100` | (folds into the budget above) |
| `requireMaterials` | `true` | `no materials` |
| `requireAnimations` | `false` | `no animation clips`, and `animation clips contain no changing channels: N channel(s), all static` |
| `minAnimationClips` | `0` | `too few animation clips: N < M [names]` |
| `minBytes` | `100` | `file too small: NB < MB` |
| `maxBytes` | `64 MiB` | `file too large: NB > MB` |
| always | — | `no meshes`, `no triangles`, `length mismatch: header says N, file is M` |

## Lifecycle

- `glina verify <file>` runs the gate standalone; exit 0 on pass, 1 on fail.
  Config is optional — defaults apply when the file is absent or unreadable.
- Inside a [sculpt job](sculpt-job.md) or [studio job](studio-job.md) the
  gate runs with `throwOnFail`, so a failing report becomes
  `asset failed verification: <reasons joined with '; '>` and fails the job.
- `verify.enabled: false` opts a job out of the gate (not recommended);
  standalone `glina verify` always runs.

## Invariants and refusals

- A gate *failure* is a report (`ok: false` plus reasons), never a throw.
  Only an unparseable file throws, with one of these exact sentences:
  - `file too small to be a GLB`
  - `not a GLB (bad magic)`
  - `truncated before first chunk`
  - `first GLB chunk is not JSON`
  - `GLB JSON chunk does not parse: <reason>`
- Render smoke failures append `render smoke failed: <reason>` to the report
  and set `ok: false`; the structural verdict is never masked by them.

# Walkthrough: verify a GLB and inspect a refusal

This walkthrough uses only Glina's local GLB parser. It does not load config secrets, start Weles, or contact the live Blender bridge. The exact script is [`examples/verify-asset.sh`](examples/verify-asset.sh); it was executed against this checkout with Node v22 on macOS.

## 1. Run with built-in defaults

The script points `--config` at an absent temporary file. `verify` treats config as optional and uses its built-in thresholds:

```console
$ node pipeline/cli.js verify assets/models/smok.glb --config /tmp/absent.json
{
  "ok": true,
  "errors": [],
  "stats": {
    "meshes": 38,
    "primitives": 38,
    "triangles": 748,
    "materials": 5,
    "animations": 2,
    "animationNames": ["flap", "idle"],
    "textures": 0,
    "nodes": 48,
    "animationChannels": 54,
    "movingAnimationChannels": 8,
    "staticAnimationChannels": 46
  },
  "thresholds": {
    "triTarget": 6000,
    "triTolerancePct": 100,
    "requireMaterials": true,
    "requireAnimations": false,
    "minAnimationClips": 0,
    "minBytes": 100,
    "maxBytes": 67108864
  },
  "path": "assets/models/smok.glb"
}
```

The captured process exited 0. The important animation distinction is visible: 54 channels exist, but only 8 change. If animation were required and all 54 were static, the gate would refuse the model.

## 2. Deliberately tighten the contract

The script writes:

```json
{
  "verify": {
    "triTarget": 300,
    "triTolerancePct": 50,
    "requireAnimations": true,
    "minAnimationClips": 3
  }
}
```

That allows at most 450 triangles and requires three clips. The same asset produced:

```console
{
  "ok": false,
  "errors": [
    "over triangle budget: 748 > 450 (target 300)",
    "too few animation clips: 2 < 3 [flap, idle]"
  ],
  "stats": {
    "meshes": 38,
    "triangles": 748,
    "materials": 5,
    "animations": 2,
    "animationNames": ["flap", "idle"],
    "animationChannels": 54,
    "movingAnimationChannels": 8,
    "staticAnimationChannels": 46
  },
  "thresholds": {
    "triTarget": 300,
    "triTolerancePct": 50,
    "requireMaterials": true,
    "requireAnimations": true,
    "minAnimationClips": 3,
    "minBytes": 100,
    "maxBytes": 67108864
  },
  "path": "assets/models/smok.glb"
}
strict gate refused as expected
```

The inner `glina verify` exited 1. The example catches that expected status so the walkthrough script itself completes successfully.

## 3. Use the verdict correctly

- Treat `ok`, not the presence of a JSON report, as acceptance.
- Display every `errors` entry; failures are cumulative.
- Preserve the threshold block with evidence so a later reader knows which contract ran.
- In a generation job, Glina sets `throwOnFail:true`, turning the same reasons into `asset failed verification: …` and failing the whole job.

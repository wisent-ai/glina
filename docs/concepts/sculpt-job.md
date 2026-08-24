# Sculpt job

A sculpt job (`pipeline/llm_blender.js`, `sculptWithLlm`) is the LLM-driven
build loop: prompt → the model writes `bpy` code → execute through the
[Blender session](blender-session.md) → iterate → export GLB → run the
[verification gate](verification-gate.md). The model is the brain; every
execution still goes through the Blender MCP layer, and the model key comes
from Skarbiec like every other secret.

Entry points: `glina sculpt <prompt>`, MCP tool `glina_sculpt`, HTTP
`POST /v1/sculpt`.

## Definition and shape

Job inputs: `prompt`, `outDir` (default `assets/models`), `filename`
(default: slugified prompt + `.glb`), `maxRounds` (default
`llm.maxRounds`, 12). Result: `{ outPath, verification, rounds }` — the CLI
strips the transcript from what it prints.

Each model reply must be one JSON object:

```json
{ "thought": "one short sentence", "code": "python bpy code", "done": false }
```

The reply parser tolerates fences and surrounding prose (first balanced JSON
object wins) but a round with no usable JSON fails the job:
`model reply not usable in round N: <reason>`.

## The system prompt's execution contract

The model is told, verbatim in spirit (see `SYSTEM_PROMPT`):

- each block executes in a **fresh namespace** containing only `bpy` —
  nothing persists between calls except Blender data itself,
- never use `bpy.context` for object access; work through `bpy.data`,
- never call `bpy.ops.wm.read_factory_settings` — it kills the bridge,
- flat shading, material colors only, ~6000-triangle budget
  (Thronefall-style chunky low-poly),
- when animations are required: one armature, automatic weights, at least
  two named actions (`idle` plus one characteristic motion) keyframed over
  24–64 frames,
- reply `done: true` with empty code when finished.

Animations become **required** in the job when `verify.requireAnimations` is
true or `verify.minAnimationClips` > 0 — the requirement is injected into the
first user message, since the gate will refuse static meshes anyway.

## Round loop

1. Ask the model (`llm.maxTokens`, default 8192).
2. Execute `step.code` if non-empty. Execution errors are fed back to the
   model as `ERROR: <message>` — the model gets a chance to repair its own
   bug.
3. **Bridge-down rule**: three *consecutive* transport failures end the run —
   `Blender bridge is down after 3 consecutive failures: <reason>` — because
   the model cannot heal a dead bridge; probing through the LLM only burns
   rounds.
4. If the Blender MCP server exposes `get_viewport_screenshot`, a screenshot
   is attached to the next round (best-effort; the loop works text-only).
5. `done: true` breaks the loop. Running out of rounds fails the job:
   `model did not finish within N rounds`.

## Export and gate

The scene is exported with `exportGlb` and then, unless
`verify.enabled: false`, gated with `throwOnFail` — a failing asset raises
`asset failed verification: <reasons>` and the job fails. The Blender session
is closed in a `finally` either way.

## Proven runs

Generated end-to-end and gate-verified on live runs (per the README):
`kamien.glb` (granite boulder, 12 bpy rounds, Brama → Blender MCP,
2026-07-27) and `krasnolud-wojownik.glb` (dwarven warrior, local Brama,
2026-07-28). Both files live in `assets/models/`.

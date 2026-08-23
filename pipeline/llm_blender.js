// llm_blender.js — "Opus wyklepuje w Blenderze": an LLM-driven sculpt loop.
//
// The loop: prompt → model writes bpy code → execute through the Blender
// MCP session → (optionally) attach a viewport screenshot → iterate →
// export GLB → run the standard verification gate. The model is the
// brain; every execution still goes through the Blender MCP layer, and
// the model key comes from Skarbiec like every other secret.

import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { BlenderSession } from './blender.js';
import { buildCompleter, parseJsonFrom, LlmError } from './llm.js';
import { verifyAsset } from './verify.js';

export class SculptError extends Error {
  constructor(message, { round, cause } = {}) {
    super(message);
    this.name = 'SculptError';
    this.round = round;
    this.cause = cause;
  }
}

const SYSTEM_PROMPT = `You are a senior 3D technical artist driving Blender through bpy code.
You are building ONE game-ready character/prop model for a low-poly RTS game
(visual style: Thronefall — chunky heroic proportions, flat-shaded, ~6000 triangle budget).

IMPORTANT — execution environment constraints (violating these crashes the run):
- Each code block executes in a FRESH namespace containing only "bpy".
  Nothing persists between calls: every block must be fully self-contained
  (re-import modules, re-fetch object references, repeat setup you need).
- NEVER use bpy.context for object access — there is no .object, no
  .active_object, no usable context at all in this environment. Work through
  bpy.data (bpy.data.objects/materials/collections) and object references
  you created yourself in the SAME block. For ops that insist on an active
  object use "with bpy.context.temp_override(active_object=obj):" around the
  op; prefer data-API (bpy.data, bmesh) over bpy.ops whenever possible.
- This is Blender 5.x — do not rely on 4.x-era context patterns.
- Keep each block small and exception-free; an unhandled exception kills
  the session.

Each reply MUST be a single JSON object (no prose around it):
{
  "thought": "one short sentence — what this step does",
  "code": "python bpy code to execute now (may be empty when done)",
  "done": false
}

Rules:
- Build with primitives + vertex-level detail; flat shading; assign material
  COLORS (no texture files). Keep the final triangle count near 6000.
- NEVER call bpy.ops.wm.read_factory_settings — it wipes the bridge's scene
  properties and kills the session. To start from an empty scene, remove
  data directly in your first step:
    for obj in list(bpy.data.objects): bpy.data.objects.remove(obj, do_unlink=True)
    for mat in list(bpy.data.materials): bpy.data.materials.remove(mat)
- Iterate in small steps: block out → refine → details → materials/colors.
- ANIMATION — when the user message says animations are REQUIRED:
  build ONE Armature (single bone chain or simple skeleton), parent the
  mesh to it with automatic weights, and create at least TWO named Actions
  in bpy.data.actions: "idle" plus one characteristic motion ("roar",
  "flap", "walk", "hover"...). Keyframe bone poses across a short range
  (24–64 frames). bpy.data.actions persists between blocks, so you can
  build the rig in one step and keyframe in later steps. The armature does
  not count toward the triangle budget.
- When the model is complete, reply with done:true and empty code.
- Never touch the filesystem except the provided INPUT/OUTPUT paths; never
  import external assets; no network access.`;

/** Build the loop's user messages transcript entry for one round. */
function roundMessage(round, maxRounds, execResult, screenshot) {
  const text = [
    `Round ${round}/${maxRounds}.`,
    execResult ? `Execution result: ${execResult}` : 'Start from an empty scene.',
    'Reply with the next JSON step.',
  ].join(' ');
  const content = [{ type: 'text', text }];
  if (screenshot?.base64 && screenshot?.mediaType) {
    content.push({
      type: 'image',
      source: {
        type: 'base64',
        media_type: screenshot.mediaType,
        data: screenshot.base64,
      },
    });
  }
  return { role: 'user', content };
}

async function tryViewportScreenshot(session, tools) {
  if (!tools.some((t) => t.name === 'get_viewport_screenshot')) return null;
  try {
    const result = await session.client.callTool('get_viewport_screenshot', {});
    const image = result?.content?.find((c) => c.type === 'image');
    if (image?.data) {
      return { base64: image.data, mediaType: image.mimeType ?? 'image/png' };
    }
  } catch {
    // screenshot is best-effort; the loop works text-only too
  }
  return null;
}

/**
 * Sculpt one asset with the LLM loop.
 *
 * @param {object} job      { prompt, outDir, filename, maxRounds? }
 * @param {object} config   resolved pipeline config (models + blender + verify)
 * @param {object} [deps]   test seams: { complete, sessionFactory, verify, onRound }
 * @returns {Promise<{outPath, verification, rounds, transcript: string[]}>}
 */
export async function sculptWithLlm(job, config, deps = {}) {
  const complete = deps.complete ?? buildCompleter(config.models ?? {});
  const sessionFactory = deps.sessionFactory ?? ((opts) => BlenderSession.start(opts));
  const verify = deps.verify ?? verifyAsset;
  const maxRounds = job.maxRounds ?? config.llm?.maxRounds ?? 12;

  const session = await sessionFactory(config.blender?.mcp ?? {});
  const transcript = [];
  const requireAnimations =
    config.verify?.requireAnimations === true || Number(config.verify?.minAnimationClips ?? 0) > 0;
  const messages = [
    {
      role: 'user',
      content:
        `Build this asset: ${job.prompt}` +
        (requireAnimations
          ? '\n\nHARD REQUIREMENT: the quality gate refuses static meshes. The final GLB must contain a rigged mesh (skin) and at least two named animation clips (bpy Actions), e.g. "idle" plus one characteristic motion.'
          : ''),
    },
  ];

  try {
    const tools = await session.listTools().catch(() => []);
    let exported = false;
    let rounds = 0;

    for (let round = 1; round <= maxRounds; round += 1) {
      const reply = await complete({ system: SYSTEM_PROMPT, messages, maxTokens: job.maxTokens ?? config.llm?.maxTokens ?? 8192 });
      transcript.push(reply.text);
      let step;
      try {
        step = parseJsonFrom(reply.text);
      } catch (error) {
        throw new SculptError(`model reply not usable in round ${round}: ${error.message}`, {
          round,
          cause: error,
        });
      }

      let execResult = null;
      if (typeof step.code === 'string' && step.code.trim()) {
        try {
          execResult = String(await session.execute(step.code));
        } catch (error) {
          execResult = `ERROR: ${error.message}`;
        }
      }

      if (step.done === true) {
        exported = true;
        break;
      }

      const screenshot = await tryViewportScreenshot(session, tools);
      messages.push({ role: 'assistant', content: reply.text });
      messages.push(roundMessage(round + 1, maxRounds, execResult, screenshot));
      deps.onRound?.({ round, step, execResult, screenshot: Boolean(screenshot) });
    }

    if (!exported) {
      throw new SculptError(`model did not finish within ${maxRounds} rounds`, {
        round: maxRounds,
      });
    }

    // ---- export + verify ----
    const outDir = job.outDir ?? 'assets/models';
    await mkdir(outDir, { recursive: true });
    const filename = job.filename ?? `${slugify(job.prompt)}.glb`;
    const outPath = join(outDir, filename);
    await session.exportGlb(outPath);

    const verification =
      config.verify?.enabled !== false
        ? await verify(outPath, {
            verify: { ...(config.verify ?? {}), throwOnFail: true },
            blender: config.blender,
          })
        : null;

    return { outPath, verification, rounds, transcript };
  } finally {
    await session.close().catch(() => {});
  }
}

function slugify(text) {
  return (
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || 'sculpt'
  );
}

export { LlmError };

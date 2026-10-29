// llm_blender.js — "Opus wyklepuje w Blenderze": an LLM-driven sculpt loop.
//
// The loop: prompt → model writes bpy code → execute through the Blender
// MCP session → (when the bridge offers it) attach a viewport screenshot →
// iterate → export GLB → run the standard verification gate. The model is
// the brain; every execution still goes through the Blender MCP layer, and
// the model key comes from Skarbiec like every other secret. Each step is
// the model's answer under STEP_ANSWER, never JSON searched for in prose.

import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { BlenderSession, releaseSession } from '../gate/blender.js';
import { buildCompleter, LlmError } from './llm.js';
import { verifyAsset } from '../gate/verify.js';
import { DEFAULT_OUT_DIR, slugify } from '../show/text2game.js';

export class SculptError extends Error {
  /** `details` is { round, cause } when the failure has them. */
  constructor(message, details) {
    super(message);
    this.name = 'SculptError';
    this.round = details?.round;
    this.cause = details?.cause;
  }
}

/** One step of the loop: what it does, the bpy code to run now, and whether the model is done. */
const STEP_PROPERTIES = {
  thought: { type: 'string', description: 'one short sentence — what this step does' },
  code: { type: 'string', description: 'python bpy code to execute now (empty when done)' },
  done: { type: 'boolean', description: 'true when the model is complete' },
};
const STEP_ANSWER = {
  name: 'sculpt_step',
  schema: { type: 'object', additionalProperties: false, required: Object.keys(STEP_PROPERTIES), properties: STEP_PROPERTIES },
};

// The prompt names the gate's own triangle budget and clip count when the
// pipeline config's `verify` section states them, so the model aims at what
// the gate will check rather than at a number written into the prompt.
function systemPrompt(verify) {
  const budget = Number.isFinite(verify.triTarget) ? `, ~${verify.triTarget} triangle budget` : '';
  const clips = Number.isInteger(verify.minAnimationClips) ? `at least ${verify.minAnimationClips} ` : '';
  return `You are a senior 3D technical artist driving Blender through bpy code.
You are building ONE game-ready character/prop model for a low-poly RTS game
(visual style: Thronefall — chunky heroic proportions, flat-shaded${budget}).

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

Each reply is one step: a short thought, the bpy code to execute now, and
whether the model is done.

Rules:
- Build with primitives + vertex-level detail; flat shading; assign material
  COLORS (no texture files).${budget ? ` Keep the final triangle count near ${verify.triTarget}.` : ''}
- NEVER call bpy.ops.wm.read_factory_settings — it wipes the bridge's scene
  properties and kills the session. To start from an empty scene, remove
  data directly in your first step:
    for obj in list(bpy.data.objects): bpy.data.objects.remove(obj, do_unlink=True)
    for mat in list(bpy.data.materials): bpy.data.materials.remove(mat)
- Iterate in small steps: block out → refine → details → materials/colors.
- ANIMATION — when the user message says animations are REQUIRED:
  build ONE Armature (single bone chain or simple skeleton), parent the
  mesh to it with automatic weights, and create ${clips}named
  Actions in bpy.data.actions: "idle" plus characteristic motions ("roar",
  "flap", "walk", "hover"...). Keyframe bone poses across a short range of
  frames. bpy.data.actions persists between blocks, so you can
  build the rig in one step and keyframe in later steps. The armature does
  not count toward the triangle budget.
- When the model is complete, answer done true with empty code.
- Never touch the filesystem except the provided INPUT/OUTPUT paths; never
  import external assets; no network access.`;
}

/** The user message after `done` of `maxRounds` rounds have run. */
function roundMessage(done, maxRounds, execResult, screenshot) {
  const text = [
    `${done} of ${maxRounds} rounds are done.`,
    execResult === undefined ? 'The last step ran no code.' : `Execution result: ${execResult}`,
    'Answer with the next step.',
  ].join(' ');
  const content = [{ type: 'text', text }];
  if (screenshot) {
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

/** The viewport as { base64, mediaType }; a bridge that cannot give one is the error. */
async function viewportScreenshot(session, round) {
  let result;
  try {
    result = await session.client.callTool('get_viewport_screenshot', {});
  } catch (error) {
    throw new SculptError(`the Blender bridge offers get_viewport_screenshot and refused it after round ${round}: ${error.message}`, {
      round,
      cause: error,
    });
  }
  const image = result?.content?.find((c) => c.type === 'image');
  if (!image?.data || !image.mimeType) {
    throw new SculptError(
      `the Blender bridge answered get_viewport_screenshot after round ${round} without an image and its media type: ${JSON.stringify(result)}`,
      { round },
    );
  }
  return { base64: image.data, mediaType: image.mimeType };
}

/**
 * Sculpt one asset with the LLM loop.
 *
 * @param {object} job      { prompt, outDir?, filename?, maxRounds?, maxTokens? }
 * @param {object} config   resolved pipeline config (models + blender + verify)
 * @param {object} [deps]   { complete, sessionFactory, verify, onRound } when the caller supplies them
 * @returns {Promise<{outPath, verification, rounds, transcript: string[]}>}
 */
export async function sculptWithLlm(job, config, deps) {
  const complete = deps?.complete ?? buildCompleter(config.models);
  const sessionFactory = deps?.sessionFactory ?? ((opts) => BlenderSession.start(opts));
  const verify = deps?.verify ?? verifyAsset;
  // How many rounds a sculpt may take is the operator's decision: the
  // request's --rounds, or llm.maxRounds in the pipeline config.
  const maxRounds = job.maxRounds ?? config.llm?.maxRounds;
  if (!Number.isInteger(maxRounds) || maxRounds <= 0) {
    throw new SculptError('sculpt needs a round cap: pass --rounds <n> or set llm.maxRounds in the pipeline config');
  }
  // The reply length a round may take is the config's too.
  const maxTokens = job.maxTokens ?? config.llm?.maxTokens;
  if (!Number.isInteger(maxTokens) || maxTokens <= 0) {
    throw new SculptError('sculpt needs a reply length: set llm.maxTokens in the pipeline config');
  }
  const verifyConfig = config.verify;
  if (!verifyConfig) {
    throw new SculptError('sculpt needs the pipeline config\'s verify section: the gate every sculpt ends in');
  }
  const SYSTEM_PROMPT = systemPrompt(verifyConfig);
  const outDir = job.outDir === undefined ? DEFAULT_OUT_DIR : job.outDir;
  const filename = job.filename === undefined ? `${slugify(job.prompt)}.glb` : job.filename;

  const session = await sessionFactory(config.blender?.mcp);
  const transcript = [];
  const requireAnimations = verifyConfig.requireAnimations === true || Boolean(verifyConfig.minAnimationClips);
  const messages = [
    {
      role: 'user',
      content:
        `Build this asset: ${job.prompt}` +
        (requireAnimations
          ? `\n\nHARD REQUIREMENT: the quality gate refuses static meshes. The final GLB must contain a rigged mesh (skin) and ${Number.isInteger(verifyConfig.minAnimationClips) ? `at least ${verifyConfig.minAnimationClips} ` : ''}named animation clips (bpy Actions), e.g. "idle" plus characteristic motions.`
          : ''),
    },
  ];

  try {
    let tools;
    try {
      tools = await session.listTools();
    } catch (error) {
      throw new SculptError(`the Blender bridge could not list its tools before the first round: ${error.message}`, { cause: error });
    }
    // A bridge without the screenshot tool gives text-only rounds by design.
    const screenshots = tools.some((t) => t.name === 'get_viewport_screenshot');
    let finished = false;

    while (!finished && transcript.length < maxRounds) {
      let reply;
      try {
        reply = await complete({ system: SYSTEM_PROMPT, messages, maxTokens, answer: STEP_ANSWER });
      } catch (error) {
        throw new SculptError(`model reply not usable after ${transcript.length} of ${maxRounds} rounds: ${error.message}`, {
          round: transcript.length,
          cause: error,
        });
      }
      transcript.push(reply.text);
      const round = transcript.length;
      const step = reply.object;
      // A provider that does not decode under the schema can still answer
      // another object; such a step is refused with what it said.
      if (typeof step.code !== 'string' || typeof step.done !== 'boolean') {
        throw new SculptError(`round ${round} answered a step without its code text and done flag: ${reply.text}`, { round });
      }

      let execResult;
      if (step.code.trim()) {
        try {
          execResult = String(await session.execute(step.code));
        } catch (error) {
          execResult = `ERROR: ${error.message}`;
          // A failed block is the model's to repair only while the bridge
          // still answers: ask the bridge itself, and end the run with the
          // cause named when it does not, instead of counting failures.
          try {
            await session.listTools();
          } catch (probe) {
            throw new SculptError(`Blender bridge is down: ${error.message}; the bridge then refused listTools too: ${probe.message}`, {
              round,
              cause: error,
            });
          }
        }
      }

      finished = step.done;
      if (!finished) {
        const screenshot = screenshots ? await viewportScreenshot(session, round) : undefined;
        messages.push({ role: 'assistant', content: reply.text });
        messages.push(roundMessage(round, maxRounds, execResult, screenshot));
        deps?.onRound?.({ round, step, execResult, screenshot: Boolean(screenshot) });
      }
    }

    if (!finished) {
      throw new SculptError(`model did not finish within ${maxRounds} rounds`, { round: maxRounds });
    }

    // ---- export + verify ----
    await mkdir(outDir, { recursive: true });
    const outPath = join(outDir, filename);
    await session.exportGlb(outPath);

    const verification =
      verifyConfig.enabled !== false
        ? await verify(outPath, {
            verify: { ...verifyConfig, throwOnFail: true },
            blender: config.blender,
          })
        : null;

    return { outPath, verification, rounds: transcript.length, transcript };
  } finally {
    await releaseSession(session);
  }
}

export { LlmError };

// animate.js — deterministic animation presets through Blender MCP.
//
// LLM-authored actions can be structurally present yet visually static. A
// preset is the boring, reproducible repair path: import the GLB, keyframe
// the explicit poses a declared preset (assets/presets/<name>.json) names,
// export, then let the normal gate inspect the result.

import { BlenderSession } from '../gate/blender.js';
import { verifyAsset } from '../gate/verify.js';
import { load } from '../rigs/declared.js';
import { presetProgram } from '../rigs/interpreter.js';

export class AnimateError extends Error {}

export async function animatePreset({ inputPath, outputPath, preset, sessionOptions } = {}) {
  if (!inputPath) throw new AnimateError('inputPath is required');
  if (!outputPath) throw new AnimateError('outputPath is required');
  const spec = await load('preset', preset);
  const session = await BlenderSession.start(sessionOptions ?? {});
  try {
    await session.importModel(inputPath);
    await session.execute(presetProgram(spec));
    await session.exportGlb(outputPath);
  } finally {
    await session.close().catch(() => {});
  }
  const verification = await verifyAsset(outputPath, {
    verify: {
      requireMaterials: true,
      requireAnimations: true,
      minAnimationClips: spec.actions.length,
      throwOnFail: true,
    },
  });
  return { outputPath, preset, verification };
}

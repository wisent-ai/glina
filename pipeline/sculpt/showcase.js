// showcase.js — deterministic reference assets for animation regression.
//
// The first LLM-sculpted dragon proved the pipeline but not the art quality:
// disconnected geometry and weak skinning made it a bad showcase. A showcase
// is a declared asset (assets/showcases/<name>.json): materials, rigid parts
// bone-parented to a compact armature, and its keyed actions, built by the one
// interpreter in ../rigs/interpreter.js.

import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { BlenderSession } from '../gate/blender.js';
import { verifyAsset } from '../gate/verify.js';
import { load } from '../rigs/declared.js';
import { workspaceRoot } from '../workspace/store.js';
import { showcaseProgram } from '../rigs/interpreter.js';

export class ShowcaseError extends Error {}

export async function buildShowcase({ outputPath, asset, sessionOptions } = {}) {
  const spec = await load('showcase', asset);
  if (!outputPath) {
    const directory = join(workspaceRoot(), 'outputs');
    await mkdir(directory, { recursive: true });
    outputPath = join(directory, `${asset}-showcase.glb`);
  }
  const session = await BlenderSession.start(sessionOptions ?? {});
  try {
    await session.execute(showcaseProgram(spec));
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
  return { outputPath, asset, verification };
}

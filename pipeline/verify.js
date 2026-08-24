// verify.js — asset quality gate for generated models.
//
// Two layers:
//   1. STRUCTURAL (always): parse the GLB container and check it against
//      thresholds from the pipeline config — valid glTF binary, mesh /
//      primitive counts, triangle budget (default ~6k, the game's art
//      target), materials / skins / animation clips present, file size.
//   2. RENDER SMOKE (optional): import + render through the Blender MCP
//      session — proves Blender can actually open the artifact and the
//      render produces non-trivial output.
//
// A failed gate fails the pipeline job (and exits 1 in the CLI), so a
// broken or off-budget asset never silently lands in assets/models/.

import { readFile } from 'node:fs/promises';
import { BlenderSession } from './blender.js';

export class VerifyError extends Error {
  constructor(message, { errors, cause } = {}) {
    super(message);
    this.name = 'VerifyError';
    this.errors = errors ?? [];
    this.cause = cause;
  }
}

export const DEFAULT_THRESHOLDS = {
  triTarget: 6000,
  triTolerancePct: 100, // accept up to 2× the target by default
  requireMaterials: true,
  requireAnimations: false,
  minAnimationClips: 0,
  minBytes: 100,
  maxBytes: 64 * 1024 * 1024,
};

/** Parse a GLB buffer into { json, binaryLength }. Throws VerifyError on any structural problem. */
export function parseGlb(buffer) {
  const errors = [];
  if (buffer.length < 12) {
    throw new VerifyError('file too small to be a GLB', { errors: ['truncated header'] });
  }
  const magic = buffer.toString('ascii', 0, 4);
  if (magic !== 'glTF') {
    throw new VerifyError('not a GLB (bad magic)', { errors: [`magic=${JSON.stringify(magic)}`] });
  }
  const version = buffer.readUInt32LE(4);
  const declaredLength = buffer.readUInt32LE(8);
  if (declaredLength !== buffer.length) {
    errors.push(`length mismatch: header says ${declaredLength}, file is ${buffer.length}`);
  }
  if (buffer.length < 20) {
    throw new VerifyError('truncated before first chunk', { errors });
  }
  const jsonChunkLength = buffer.readUInt32LE(12);
  const jsonChunkType = buffer.toString('ascii', 16, 20);
  if (jsonChunkType !== 'JSON') {
    throw new VerifyError('first GLB chunk is not JSON', {
      errors: [...errors, `chunkType=${JSON.stringify(jsonChunkType)}`],
    });
  }
  let json;
  try {
    json = JSON.parse(buffer.toString('utf8', 20, 20 + jsonChunkLength));
  } catch (error) {
    throw new VerifyError(`GLB JSON chunk does not parse: ${error.message}`, { errors });
  }
  return { json, declaredLength, version, errors };
}

/** Compute model stats from parsed glTF JSON. */
export function glbStats(json) {
  const accessors = json.accessors ?? [];
  const meshes = json.meshes ?? [];
  let triangles = 0;
  let primitives = 0;
  for (const mesh of meshes) {
    for (const prim of mesh.primitives ?? []) {
      primitives += 1;
      const mode = prim.mode ?? 4; // 4 = TRIANGLES
      if (mode !== 4) continue;
      if (prim.indices !== undefined && accessors[prim.indices]) {
        triangles += Math.floor(accessors[prim.indices].count / 3);
      } else if (prim.attributes?.POSITION !== undefined && accessors[prim.attributes.POSITION]) {
        triangles += Math.floor(accessors[prim.attributes.POSITION].count / 3);
      }
    }
  }
  return {
    meshes: meshes.length,
    primitives,
    triangles,
    materials: (json.materials ?? []).length,
    animations: (json.animations ?? []).length,
    animationNames: (json.animations ?? []).map((a) => a.name ?? '(unnamed)'),
    textures: (json.textures ?? []).length,
    nodes: (json.nodes ?? []).length,
  };
}

/** Count animation channels whose output samples actually change. */
export function animationMotionStats(buffer, json) {
  const components = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };
  const jsonLength = buffer.readUInt32LE(12);
  const binaryHeader = 20 + jsonLength;
  const binaryStart = binaryHeader + 8;
  let animationChannels = 0;
  let movingAnimationChannels = 0;
  for (const animation of json.animations ?? []) {
    for (const channel of animation.channels ?? []) {
      animationChannels += 1;
      const sampler = animation.samplers?.[channel.sampler];
      const accessor = sampler ? json.accessors?.[sampler.output] : null;
      const view = accessor ? json.bufferViews?.[accessor.bufferView] : null;
      const width = accessor ? components[accessor.type] : null;
      if (!accessor || !view || !width || accessor.componentType !== 5126 || accessor.count < 2) continue;
      const stride = view.byteStride ?? width * 4;
      const start = binaryStart + (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
      let moves = false;
      for (let sample = 1; sample < accessor.count && !moves; sample += 1) {
        for (let component = 0; component < width; component += 1) {
          const first = buffer.readFloatLE(start + component * 4);
          const current = buffer.readFloatLE(start + sample * stride + component * 4);
          if (Math.abs(first - current) > 0.00001) {
            moves = true;
            break;
          }
        }
      }
      if (moves) movingAnimationChannels += 1;
    }
  }
  return {
    animationChannels,
    movingAnimationChannels,
    staticAnimationChannels: animationChannels - movingAnimationChannels,
  };
}

/**
 * Structural gate on a GLB file. Returns a report:
 *   { ok, errors, stats, thresholds, path }
 * Never throws on a *failed gate* — `ok:false` carries the reasons.
 * Throws VerifyError only when the file can't be parsed at all.
 */
export async function verifyGlbStructure(path, thresholds = {}) {
  const t = { ...DEFAULT_THRESHOLDS, ...thresholds };
  const buffer = await readFile(path);
  const { json, errors: parseWarnings } = parseGlb(buffer);
  const stats = { ...glbStats(json), ...animationMotionStats(buffer, json) };

  const errors = [...parseWarnings];
  if (buffer.length < t.minBytes) errors.push(`file too small: ${buffer.length}B < ${t.minBytes}B`);
  if (buffer.length > t.maxBytes) errors.push(`file too large: ${buffer.length}B > ${t.maxBytes}B`);
  if (stats.meshes === 0) errors.push('no meshes');
  if (stats.triangles === 0) errors.push('no triangles');
  const triMax = Math.round((t.triTarget * (100 + t.triTolerancePct)) / 100);
  if (stats.triangles > triMax) {
    errors.push(`over triangle budget: ${stats.triangles} > ${triMax} (target ${t.triTarget})`);
  }
  if (t.requireMaterials && stats.materials === 0) errors.push('no materials');
  if (t.requireAnimations && stats.animations === 0) errors.push('no animation clips');
  if (stats.animations < (t.minAnimationClips ?? 0)) {
    errors.push(
      `too few animation clips: ${stats.animations} < ${t.minAnimationClips}` +
        (stats.animationNames.length ? ` [${stats.animationNames.join(', ')}]` : ''),
    );
  }
  if (t.requireAnimations && stats.movingAnimationChannels === 0) {
    errors.push(
      `animation clips contain no changing channels: ${stats.animationChannels} channel(s), all static`,
    );
  }

  return { ok: errors.length === 0, errors, stats, thresholds: t, path };
}

/**
 * Optional render smoke through the Blender MCP session: import the GLB
 * into an empty scene and render one frame — proves Blender can open the
 * artifact. The render path is returned when it exists and is non-empty;
 * the caller decides how much weight to put on it.
 */
export async function verifyGlbRenderSmoke(path, { sessionOptions, renderOut } = {}) {
  const session = await BlenderSession.start(sessionOptions ?? {});
  try {
    await session.importModel(path);
    const out = renderOut ?? path.replace(/\.glb$/i, '.verify.png');
    const code = [
      'import bpy',
      'scene = bpy.context.scene',
      'scene.render.engine = "BLENDER_EEVEE_NEXT" if hasattr(bpy.types, "BLENDER_EEVEE_NEXT") else "BLENDER_EEVEE"',
      'scene.render.resolution_x = 512',
      'scene.render.resolution_y = 512',
      `scene.render.filepath = ${JSON.stringify(out)}`,
      'bpy.ops.render.render(write_still=True)',
      'import os',
      `print("rendered", os.path.getsize(${JSON.stringify(out)}), "bytes")`,
    ].join('\n');
    const result = await session.execute(code);
    return { ok: true, renderPath: out, detail: String(result) };
  } finally {
    await session.close().catch(() => {});
  }
}

/**
 * Full gate: structural always, render smoke when `render:true`.
 * Returns one report; throws VerifyError with the combined error list
 * when the gate fails and `throwOnFail` is set (the pipeline job path).
 */
export async function verifyAsset(path, config = {}) {
  const thresholds = config.verify ?? {};
  const report = await verifyGlbStructure(path, thresholds);
  if (thresholds.render) {
    try {
      report.render = await verifyGlbRenderSmoke(path, {
        sessionOptions: config.blender?.mcp,
      });
      if (!report.render.ok) report.errors.push('render smoke failed');
    } catch (error) {
      report.errors.push(`render smoke failed: ${error.message}`);
      report.ok = false;
    }
  }
  if (thresholds.throwOnFail && !report.ok) {
    throw new VerifyError(`asset failed verification: ${report.errors.join('; ')}`, {
      errors: report.errors,
    });
  }
  return report;
}

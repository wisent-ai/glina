// preview.js — animated preview of a GLB's clips, rendered by Blender.
//
// Import the model, play one Action across its frame range, render N frames
// (EEVEE, small square), and assemble a looping GIF. Blender access goes
// through the same MCP session discipline as everywhere else in the
// pipeline; GIF assembly prefers ffmpeg and falls back to uv+Pillow so no
// image library is ever vendored here.

import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { BlenderSession } from './blender.js';

export class PreviewError extends Error {}

function runBin(bin, args) {
  return new Promise((resolve) => {
    const child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (out += d));
    child.on('error', () => resolve({ ok: false }));
    child.on('close', (code) => resolve({ ok: code === 0, out }));
  });
}

/** Build a looping GIF from frame_###.png files in framesDir. */
export async function assembleGif(framesDir, outPath, fps = 10) {
  const palette = join(framesDir, 'palette.png');
  let attempt = await runBin('ffmpeg', [
    '-y', '-framerate', String(fps), '-i', join(framesDir, 'frame_%03d.png'),
    '-i', palette, '-lavfi', 'palettegen=stats_mode=diff [p]; [0:v][p] paletteuse=dither=bayer',
    '-loop', '0', outPath,
  ]);
  // Two-pass palette needs the palette to exist first; generate then reuse.
  if (!attempt.ok || !(await readdirSafeSize(outPath))) {
    await runBin('ffmpeg', ['-y', '-i', join(framesDir, 'frame_%03d.png'), '-vf', 'palettegen=stats_mode=diff', palette]);
    attempt = await runBin('ffmpeg', [
      '-y', '-framerate', String(fps), '-i', join(framesDir, 'frame_%03d.png'),
      '-i', palette, '-lavfi', '[0:v][1:v] paletteuse=dither=bayer', '-loop', '0', outPath,
    ]);
  }
  if (attempt.ok && (await readdirSafeSize(outPath))) return { tool: 'ffmpeg' };

  const py = [
    'import glob, os, sys',
    'from PIL import Image',
    `frames = sorted(glob.glob(os.path.join(${JSON.stringify(framesDir)}, "frame_*.png")))`,
    'assert frames, "no frames rendered"',
    'imgs = [Image.open(f).convert("P", palette=Image.ADAPTIVE, colors=128) for f in frames]',
    `d, ms = ${JSON.stringify(outPath)}, ${Math.round(1000 / fps)}`,
    'imgs[0].save(d, save_all=True, append_images=imgs[1:], duration=ms, loop=0)',
    'print("gif-bytes", os.path.getsize(d))',
  ].join('\n');
  const viaUv = await runBin('uv', ['run', '--with', 'pillow', 'python', '-c', py]);
  if (!viaUv.ok || !(await readdirSafeSize(outPath))) {
    throw new PreviewError(`GIF assembly failed (ffmpeg and uv+Pillow): ${viaUv.out ?? ''}`.trim());
  }
  return { tool: 'uv+pillow' };
}

async function readdirSafeSize(p) {
  try {
    const { stat } = await import('node:fs/promises');
    return (await stat(p)).size > 0;
  } catch {
    return false;
  }
}

/**
 * Render an animated GIF preview of one clip of a GLB.
 * @param {object} opts { glbPath, outPath?, clip?, frames?, fps?, sessionOptions? }
 * @returns {Promise<{outPath, clip, frames, tool}>}
 */
export async function renderAnimationPreview({
  glbPath,
  outPath,
  clip,
  frames = 24,
  fps = 10,
  sessionOptions,
} = {}) {
  if (!glbPath) throw new PreviewError('glbPath is required');
  const session = await BlenderSession.start(sessionOptions ?? {});
  const dir = await mkdtemp(join(tmpdir(), 'glina-preview-'));
  const framesDir = join(dir, 'frames');
  try {
    const { mkdir } = await import('node:fs/promises');
    await mkdir(framesDir, { recursive: true });
    await session.importModel(glbPath);
    const code = [
      'import bpy, os, math',
      `FRAMES_DIR = ${JSON.stringify(framesDir)}`,
      `WANT_CLIP = ${JSON.stringify(clip ?? '')}`,
      'TARGET_FRAMES = ' + Number(frames),
      '',
      '# --- pick the action (named, else longest) ---',
      'actions = list(bpy.data.actions)',
      'if not actions: raise RuntimeError("no animation clips in this GLB")',
      'def base(a): return a.name.split(".")[0]',
      'act = None',
      'if WANT_CLIP:',
      '    act = next((a for a in actions if base(a) == WANT_CLIP or a.name == WANT_CLIP), None)',
      '    if act is None: raise RuntimeError("clip %r not found; have %s" % (WANT_CLIP, [base(a) for a in actions]))',
      'else:',
      '    act = max(actions, key=lambda a: a.frame_range[1] - a.frame_range[0])',
      'for ob in bpy.data.objects:',
      '    if ob.animation_data is not None:',
      '        ob.animation_data.action = act',
      '',
      '# --- scene range over the action ---',
      'start, end = int(act.frame_range[0]), int(act.frame_range[1])',
      'if end <= start: end = start + 1',
      'step = max(1, (end - start + 1) // TARGET_FRAMES)',
      'scene = bpy.context.scene',
      "scene.render.engine = 'BLENDER_EEVEE_NEXT' if hasattr(bpy.types, 'BLENDER_EEVEE_NEXT') else 'BLENDER_EEVEE'",
      'scene.render.resolution_x = scene.render.resolution_y = 512',
      'scene.render.image_settings.file_format = "PNG"',
      'scene.frame_start, scene.frame_end = start, end',
      '',
      '# --- camera framing the whole model ---',
      'mesh_obs = [o for o in bpy.data.objects if o.type == "MESH"]',
      'if mesh_obs:',
      '    from mathutils import Vector',
      '    pts = []',
      '    for o in mesh_obs:',
      '        for c in o.bound_box:',
      '            pts.append(o.matrix_world @ Vector(c))',
      '    lo = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))',
      '    hi = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))',
      '    center = (lo + hi) / 2',
      '    radius = max((hi - lo).length / 2, 0.5)',
      '    cam_data = bpy.data.cameras.new("preview-cam")',
      '    cam = bpy.data.objects.new("preview-cam", cam_data)',
      '    bpy.context.scene.collection.objects.link(cam)',
      '    direction = Vector((1.0, -1.4, 0.7)).normalized()',
      '    cam.location = center + direction * (radius * 2.6)',
      '    look = center - cam.location',
      '    cam.rotation_euler = look.to_track_quat("-Z", "Y").to_euler()',
      '    scene.camera = cam',
      '    sun_data = bpy.data.lights.new("preview-sun", type="SUN")',
      '    sun_data.energy = 3.0',
      '    sun = bpy.data.objects.new("preview-sun", sun_data)',
      '    bpy.context.scene.collection.objects.link(sun)',
      '    sun.rotation_euler = (math.radians(50), math.radians(-20), math.radians(30))',
      '',
      'n = 0',
      'f = start',
      'while f <= end and n < TARGET_FRAMES:',
      '    scene.frame_set(f)',
      "    scene.render.filepath = os.path.join(FRAMES_DIR, 'frame_%03d.png' % n)",
      '    bpy.ops.render.render(write_still=True)',
      '    n += 1',
      '    f += step',
      'print("rendered-frames", n, "clip", base(act))',
    ].join('\n');
    const result = String(await session.execute(code));
    const rendered = await readdir(framesDir);
    if (!rendered.some((f) => f.startsWith('frame_'))) {
      throw new PreviewError(`Blender rendered no frames: ${result.slice(-400)}`);
    }
    const finalOut =
      outPath ?? glbPath.replace(/\.glb$/i, '') + `-anim${clip ? `-${clip}` : ''}.gif`;
    const { tool } = await assembleGif(framesDir, finalOut, fps);
    return { outPath: finalOut, clip, frames: rendered.length, tool };
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
    await session.close().catch(() => {});
  }
}

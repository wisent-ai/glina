// preview.js — animated preview of a GLB's clips, rendered by Blender.
//
// Import the model, play one Action across its frame range, render N frames
// (EEVEE, small square), and assemble a looping GIF. Blender access goes
// through the same MCP session discipline as everywhere else in the
// pipeline; GIF assembly prefers ffmpeg and falls back to uv+Pillow so no
// image library is ever vendored here.

import { mkdir, mkdtemp, readdir, rename, rm, stat } from 'node:fs/promises';
import { join, dirname, basename, extname } from 'node:path';
import { spawn } from 'node:child_process';
import { BlenderSession } from '../gate/blender.js';
import { workspaceRoot } from '../workspace/store.js';

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

/** Build a looping GIF from frame_###.png files in framesDir, played at `fps`. */
export async function assembleGif(framesDir, outPath, fps) {
  if (!(Number(fps) > 0)) throw new PreviewError(`GIF playback rate must be above zero, got ${fps}`);
  const palette = join(framesDir, 'palette.png');
  // ImageIO exposes GIF delta rectangles as individual CGImages. Glina's
  // frame-driven player therefore needs every encoded frame to cover the full
  // canvas; otherwise a moving wing's small delta rectangle is centered and
  // the whole dragon appears to jump.
  const gifFlags = '-offsetting-transdiff';
  let attempt = await runBin('ffmpeg', [
    '-y', '-framerate', String(fps), '-i', join(framesDir, 'frame_%03d.png'),
    '-i', palette, '-lavfi', 'palettegen=stats_mode=diff [p]; [0:v][p] paletteuse=dither=bayer',
    '-loop', '0', '-gifflags', gifFlags, outPath,
  ]);
  // Two-pass palette needs the palette to exist first; generate then reuse.
  if (!attempt.ok || !(await readdirSafeSize(outPath))) {
    await runBin('ffmpeg', ['-y', '-i', join(framesDir, 'frame_%03d.png'), '-vf', 'palettegen=stats_mode=diff', palette]);
    attempt = await runBin('ffmpeg', [
      '-y', '-framerate', String(fps), '-i', join(framesDir, 'frame_%03d.png'),
      '-i', palette, '-lavfi', '[0:v][1:v] paletteuse=dither=bayer',
      '-loop', '0', '-gifflags', gifFlags, outPath,
    ]);
  }
  if (attempt.ok && (await readdirSafeSize(outPath))) return { tool: 'ffmpeg' };

  const py = [
    'import glob, os, sys',
    'from PIL import Image',
    `frames = sorted(glob.glob(os.path.join(${JSON.stringify(framesDir)}, "frame_*.png")))`,
    'assert frames, "no frames rendered"',
    // 256 is the GIF format's palette size, the same ceiling ffmpeg's palettegen uses.
    'imgs = [Image.open(f).convert("P", palette=Image.ADAPTIVE, colors=256) for f in frames]',
    `d, ms = ${JSON.stringify(outPath)}, ${Math.round(1000 / fps)}`,
    'imgs[0].save(d, save_all=True, append_images=imgs[1:], duration=ms, loop=0, optimize=False, disposal=2)',
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
 *
 * Without `frames` every frame of the clip is rendered; without `fps` the GIF
 * plays at the clip's own speed (the scene rate Blender imported it at,
 * divided by the sampling step), so the preview moves as the asset does.
 * @param {object} opts { glbPath, outPath?, clip?, frames?, fps?, sessionOptions? }
 * @returns {Promise<{outPath, clip, frames, fps, tool}>}
 */
export async function renderAnimationPreview({
  glbPath,
  outPath,
  clip,
  frames,
  fps,
  sessionOptions,
} = {}) {
  if (!glbPath) throw new PreviewError('glbPath is required');
  const session = await BlenderSession.start(sessionOptions ?? {});
  const dir = await mkdtemp(join(dirname(outPath ?? glbPath), '.glina-preview-'));
  const framesDir = join(dir, 'frames');
  try {
    const { mkdir } = await import('node:fs/promises');
    await mkdir(framesDir, { recursive: true });
    await session.importModel(glbPath);
    const code = [
      'import bpy, os, math',
      `FRAMES_DIR = ${JSON.stringify(framesDir)}`,
      `WANT_CLIP = ${JSON.stringify(clip ?? '')}`,
      'TARGET_FRAMES = ' + (frames === undefined ? 0 : Number(frames)),
      '',
      '# --- pick the action (named, else longest) ---',
      'actions = list(bpy.data.actions)',
      'if not actions: raise RuntimeError("no animation clips in this GLB")',
      'def base(a): return a.name.split(".")[0]',
      'act = None',
      'if WANT_CLIP:',
      '    matches = [a for a in actions if base(a) == WANT_CLIP or a.name == WANT_CLIP]',
      '    act = matches[-1] if matches else None',
      '    if act is None: raise RuntimeError("clip %r not found; have %s" % (WANT_CLIP, [base(a) for a in actions]))',
      'else:',
      '    act = max(actions, key=lambda a: a.frame_range[1] - a.frame_range[0])',
      'for ob in bpy.data.objects:',
      '    if ob.animation_data is not None:',
      '        for track in ob.animation_data.nla_tracks: track.mute = True',
      '        ob.animation_data.action = act',
      '        if hasattr(ob.animation_data, "action_slot") and len(act.slots):',
      '            suitable = next((slot for slot in act.slots if slot.target_id_type == ob.id_type), act.slots[0])',
      '            ob.animation_data.action_slot = suitable',
      '',
      '# --- scene range over the action ---',
      'start, end = int(act.frame_range[0]), int(act.frame_range[1])',
      'if end <= start: end = start + 1',
      'step = max(1, (end - start + 1) // TARGET_FRAMES) if TARGET_FRAMES else 1',
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
      '    direction = Vector((1.1, -1.6, 1.25)).normalized()',
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
      'while f <= end and (not TARGET_FRAMES or n < TARGET_FRAMES):',
      '    scene.frame_set(f)',
      "    scene.render.filepath = os.path.join(FRAMES_DIR, 'frame_%03d.png' % n)",
      '    bpy.ops.render.render(write_still=True)',
      '    n += 1',
      '    f += step',
      'print("rendered-frames", n, "clip", base(act))',
      'print("clip-timing", scene.render.fps / scene.render.fps_base, step)',
    ].join('\n');
    const result = String(await session.execute(code));
    const rendered = await readdir(framesDir);
    if (!rendered.some((f) => f.startsWith('frame_'))) {
      throw new PreviewError(`Blender rendered no frames: ${result.slice(-400)}`);
    }
    let playback = fps;
    if (playback === undefined) {
      const timing = /clip-timing ([0-9.]+) (\d+)/.exec(result);
      if (!timing) throw new PreviewError(`Blender did not report the clip's timing: ${result.slice(-400)}`);
      playback = Number(timing[1]) / Number(timing[2]);
    }
    const finalOut =
      outPath ?? glbPath.replace(/\.glb$/i, '') + `-anim${clip ? `-${clip}` : ''}.gif`;
    const { tool } = await assembleGif(framesDir, finalOut, playback);
    return { outPath: finalOut, clip, frames: rendered.length, fps: playback, tool };
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
    await session.close().catch(() => {});
  }
}

/**
 * Render an accepted GLB on a neutral ground with a framed camera and light.
 * `size` is the square image edge in pixels the caller asked for; without it
 * the image keeps the resolution of the Blender scene it is rendered in.
 */
export async function renderScenePreview({ glbPath, outPath, size, sessionOptions } = {}) {
  if (size !== undefined && !(Number.isInteger(size) && size > 0)) {
    throw new PreviewError(`--size must be a whole number of pixels above zero, got ${size}`);
  }
  if (!glbPath) throw new PreviewError('glbPath is required');
  let finalOut = outPath;
  if (!finalOut) {
    const directory = join(workspaceRoot(), 'previews');
    await mkdir(directory, { recursive: true });
    finalOut = join(directory, `${basename(glbPath, extname(glbPath))}-scene.png`);
  }
  const temporaryDirectory = await mkdtemp(join(dirname(finalOut), '.glina-scene-'));
  const temporary = join(temporaryDirectory, basename(finalOut));
  let session;
  try {
    session = await BlenderSession.start(sessionOptions ?? {});
    try {
      await session.importModel(glbPath);
    } catch (error) {
      throw new PreviewError(`Blender could not import ${glbPath}: ${error.message}`, { cause: error });
    }
    const code = [
      'import bpy, math, os',
      'from mathutils import Vector',
      'scene = bpy.context.scene',
      'meshes = [obj for obj in bpy.data.objects if obj.type == "MESH"]',
      'if not meshes: raise RuntimeError("the GLB contains no mesh to preview")',
      'points = [obj.matrix_world @ Vector(corner) for obj in meshes for corner in obj.bound_box]',
      'lo = Vector((min(p.x for p in points), min(p.y for p in points), min(p.z for p in points)))',
      'hi = Vector((max(p.x for p in points), max(p.y for p in points), max(p.z for p in points)))',
      'center = (lo + hi) / 2',
      'radius = max((hi - lo).length / 2, 0.5)',
      'floor_z = lo.z - max(radius * 0.03, 0.01)',
      'bpy.ops.mesh.primitive_plane_add(size=2, location=(center.x, center.y, floor_z))',
      'floor = bpy.context.object',
      'floor.name = "Glina preview ground"',
      'floor.scale = (radius * 2.5, radius * 2.5, 1)',
      'mat = bpy.data.materials.new("Glina preview ground")',
      'mat.diffuse_color = (0.28, 0.34, 0.30, 1)',
      'floor.data.materials.append(mat)',
      'camera_data = bpy.data.cameras.new("Glina preview camera")',
      'camera = bpy.data.objects.new("Glina preview camera", camera_data)',
      'scene.collection.objects.link(camera)',
      'camera.location = center + Vector((1.1, -1.6, 1.25)).normalized() * radius * 3.5',
      'camera.rotation_euler = (center - camera.location).to_track_quat("-Z", "Y").to_euler()',
      'camera_data.type = "ORTHO"',
      'camera_data.ortho_scale = radius * 4.8',
      'scene.camera = camera',
      'light_data = bpy.data.lights.new("Glina preview light", type="AREA")',
      'light = bpy.data.objects.new("Glina preview light", light_data)',
      'scene.collection.objects.link(light)',
      'light.location = center + Vector((-1, -1, 2)) * radius * 2',
      'light_data.energy = 800',
      'light_data.shape = "DISK"',
      'light_data.size = radius * 3',
      'if scene.world is None: scene.world = bpy.data.worlds.new("Glina preview world")',
      'scene.world.color = (0.35, 0.35, 0.35)',
      'scene.render.engine = "BLENDER_EEVEE_NEXT" if hasattr(bpy.types, "BLENDER_EEVEE_NEXT") else "BLENDER_EEVEE"',
      ...(size === undefined
        ? []
        : [
            `scene.render.resolution_x = scene.render.resolution_y = ${size}`,
            'scene.render.resolution_percentage = 100',
          ]),
      'scene.render.image_settings.file_format = "PNG"',
      `scene.render.filepath = ${JSON.stringify(temporary)}`,
      'bpy.ops.render.render(write_still=True)',
      'print("rendered-scene", os.path.getsize(scene.render.filepath))',
      'print("scene-size", scene.render.resolution_x * scene.render.resolution_percentage // 100, scene.render.resolution_y * scene.render.resolution_percentage // 100)',
    ].join('\n');
    const result = String(await session.execute(code));
    let rendered;
    try {
      rendered = await stat(temporary);
    } catch {
      throw new PreviewError(`Blender produced no scene image at ${temporary}: ${result.slice(-400)}`);
    }
    if (!result.includes('rendered-scene') || result.includes('GAC-EXEC-ERROR') || rendered.size === 0) {
      throw new PreviewError(`Blender scene render failed: ${result.slice(-400)}`);
    }
    await rename(temporary, finalOut);
    const dimensions = /scene-size (\d+) (\d+)/.exec(result);
    return {
      outPath: finalOut,
      source: glbPath,
      bytes: rendered.size,
      width: dimensions ? Number(dimensions[1]) : null,
      height: dimensions ? Number(dimensions[2]) : null,
      scene: 'neutral-ground',
    };
  } finally {
    await session?.close().catch(() => {});
    await rm(temporaryDirectory, { recursive: true, force: true }).catch(() => {});
  }
}

// animate.js — deterministic animation presets through Blender MCP.
//
// LLM-authored actions can be structurally present yet visually static. A
// preset is the boring, reproducible repair path: import the GLB, keyframe
// explicit pose deltas, export, then let the normal gate inspect the result.

import { BlenderSession } from './blender.js';
import { verifyAsset } from './verify.js';

export class AnimateError extends Error {}

const DRAGON_PRESET = `
import bpy

arm = next((obj for obj in bpy.data.objects if obj.type == 'ARMATURE'), None)
if arm is None:
    raise RuntimeError('dragon preset requires one Armature')
required = ['body', 'tail1', 'tail2', 'tail3', 'wing.L', 'wing2.L', 'wing.R', 'wing2.R']
missing = [name for name in required if arm.pose.bones.get(name) is None]
if missing:
    raise RuntimeError('missing dragon bones: ' + ', '.join(missing))
if arm.animation_data is None:
    arm.animation_data_create()
for action in list(bpy.data.actions):
    if action.name.split('.')[0] in {'idle', 'flap'}:
        bpy.data.actions.remove(action)

def clear_pose():
    for bone in arm.pose.bones:
        bone.rotation_mode = 'XYZ'
        bone.rotation_euler = (0.0, 0.0, 0.0)
        bone.location = (0.0, 0.0, 0.0)
        bone.scale = (1.0, 1.0, 1.0)
    arm.rotation_mode = 'XYZ'
    arm.rotation_euler = (0.0, 0.0, 0.0)
    arm.location = (0.0, 0.0, 0.0)

def key_rotation(bone_name, frame, xyz):
    bone = arm.pose.bones[bone_name]
    bone.rotation_mode = 'XYZ'
    bone.rotation_euler = xyz
    bone.keyframe_insert(data_path='rotation_euler', frame=frame, group=bone_name)

def key_location(bone_name, frame, xyz):
    bone = arm.pose.bones[bone_name]
    bone.location = xyz
    bone.keyframe_insert(data_path='location', frame=frame, group=bone_name)

# Flap: two full wing beats plus an obvious root lift/tilt over 24 frames.
clear_pose()
flap = bpy.data.actions.new('flap')
flap.use_fake_user = True
arm.animation_data.action = flap
for frame, amount in [(1, -1.0), (7, 1.0), (13, -1.0), (19, 1.0), (25, -1.0)]:
    arm.location = (0.0, 0.0, 1.20 * amount)
    arm.rotation_euler = (0.35 * amount, 0.0, 0.25 * amount)
    arm.keyframe_insert(data_path='location', frame=frame)
    arm.keyframe_insert(data_path='rotation_euler', frame=frame)
    key_rotation('wing.L', frame, (0.30 * amount, 1.25 * amount, 0.50 * amount))
    key_rotation('wing.R', frame, (-0.30 * amount, -1.25 * amount, -0.50 * amount))
    key_rotation('wing2.L', frame, (0.18 * amount, 0.90 * amount, 0.35 * amount))
    key_rotation('wing2.R', frame, (-0.18 * amount, -0.90 * amount, -0.35 * amount))
# Idle: visible breathing and a travelling tail sway over 48 frames.
clear_pose()
idle = bpy.data.actions.new('idle')
idle.use_fake_user = True
arm.animation_data.action = idle
for frame, amount in [(1, -1.0), (13, 1.0), (25, -1.0), (37, 1.0), (49, -1.0)]:
    arm.location = (0.0, 0.0, 0.12 * amount)
    arm.keyframe_insert(data_path='location', frame=frame)
    key_location('body', frame, (0.0, 0.0, 0.12 * amount))
    key_rotation('tail1', frame, (0.0, 0.0, 0.18 * amount))
    key_rotation('tail2', frame, (0.0, 0.0, -0.28 * amount))
    key_rotation('tail3', frame, (0.0, 0.0, 0.38 * amount))

arm.animation_data.action = flap
bpy.context.scene.frame_start = 1
bpy.context.scene.frame_end = 25
bpy.context.scene.frame_set(1)
print('dragon-actions', [(action.name, tuple(action.frame_range)) for action in bpy.data.actions if action.name in {'idle', 'flap'}])
`;

export async function animatePreset({ inputPath, outputPath, preset = 'dragon', sessionOptions } = {}) {
  if (!inputPath) throw new AnimateError('inputPath is required');
  if (!outputPath) throw new AnimateError('outputPath is required');
  if (preset !== 'dragon') throw new AnimateError(`unknown animation preset: ${preset}`);
  const session = await BlenderSession.start(sessionOptions ?? {});
  try {
    await session.importModel(inputPath);
    await session.execute(DRAGON_PRESET);
    await session.exportGlb(outputPath);
  } finally {
    await session.close().catch(() => {});
  }
  const verification = await verifyAsset(outputPath, {
    verify: {
      requireMaterials: true,
      requireAnimations: true,
      minAnimationClips: 2,
      throwOnFail: true,
    },
  });
  return { outputPath, preset, verification };
}

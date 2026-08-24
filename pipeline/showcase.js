// showcase.js — deterministic reference assets for animation regression.
//
// The first LLM-sculpted dragon proved the pipeline but not the art quality:
// disconnected geometry and weak skinning made it a bad showcase. This builder
// creates one cohesive stylized dragon with rigid parts bone-parented to a
// compact armature, then writes visible idle/flap actions.

import { BlenderSession } from './blender.js';
import { verifyAsset } from './verify.js';

export class ShowcaseError extends Error {}

const DRAGON_SHOWCASE = `
import bpy, math
from mathutils import Vector

# Clean every scene datablock that could collide with exported names.
for obj in list(bpy.data.objects): bpy.data.objects.remove(obj, do_unlink=True)
for data in list(bpy.data.meshes): bpy.data.meshes.remove(data)
for data in list(bpy.data.armatures): bpy.data.armatures.remove(data)
for data in list(bpy.data.materials): bpy.data.materials.remove(data)
for action in list(bpy.data.actions): bpy.data.actions.remove(action)

scene = bpy.context.scene
scene.render.engine = 'BLENDER_EEVEE_NEXT' if hasattr(bpy.types, 'BLENDER_EEVEE_NEXT') else 'BLENDER_EEVEE'

def material(name, color, metallic=0.0, roughness=0.75):
    mat = bpy.data.materials.new(name)
    mat.diffuse_color = color
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get('Principled BSDF')
    bsdf.inputs['Base Color'].default_value = color
    bsdf.inputs['Roughness'].default_value = roughness
    bsdf.inputs['Metallic'].default_value = metallic
    return mat
wing_mat = material('Wing membrane', (0.08, 0.48, 0.24, 1.0))
scale_mat = material('Emerald scales', (0.03, 0.34, 0.12, 1.0))
belly_mat = material('Belly plates', (0.62, 0.55, 0.25, 1.0), metallic=0.12)
horn_mat = material('Ivory horn', (0.72, 0.66, 0.48, 1.0))
eye_mat = material('Amber eye', (1.0, 0.24, 0.01, 1.0), metallic=0.25, roughness=0.25)

def flat(obj):
    if obj.type == 'MESH':
        for poly in obj.data.polygons: poly.use_smooth = False

def ico(name, location, scale, mat, subdivision=1):
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=subdivision, radius=1.0, location=location)
    obj = bpy.context.object
    obj.name = name
    obj.scale = scale
    obj.data.materials.append(mat)
    flat(obj)
    return obj

def cone_between(name, start, end, r1, r2, mat, vertices=6):
    a, b = Vector(start), Vector(end)
    direction = b - a
    bpy.ops.mesh.primitive_cone_add(vertices=vertices, radius1=r1, radius2=r2, depth=direction.length, location=(a+b)/2)
    obj = bpy.context.object
    obj.name = name
    obj.rotation_euler = direction.to_track_quat('Z', 'Y').to_euler()
    obj.data.materials.append(mat)
    flat(obj)
    return obj

def wing(name, side):
    sx = float(side)
    root = (0.55*sx, 0.35, 1.25)
    elbow = (1.55*sx, 0.45, 1.35)
    tip = (2.65*sx, 0.20, 1.10)
    trailing_tip = (2.25*sx, -0.55, 0.55)
    trailing_elbow = (1.25*sx, -0.20, 0.78)
    trailing_root = (0.70*sx, -0.25, 0.95)

    def membrane(suffix, verts):
        mesh = bpy.data.meshes.new(name + suffix + 'Mesh')
        mesh.from_pydata(verts, [], [tuple(range(len(verts)))])
        mesh.materials.append(wing_mat)
        obj = bpy.data.objects.new(name + suffix, mesh)
        scene.collection.objects.link(obj)
        flat(obj)
        return obj

    inner = membrane('.inner', [root, elbow, trailing_elbow, trailing_root])
    outer = membrane('.outer', [elbow, tip, trailing_tip, trailing_elbow])
    # The outer spars follow the wrist, letting the membrane fold on recovery.
    top_finger = cone_between(name + '.finger.top', elbow, tip, 0.07, 0.04, scale_mat)
    low_finger = cone_between(name + '.finger.low', elbow, trailing_tip, 0.06, 0.03, scale_mat)
    return inner, outer, top_finger, low_finger

# Cohesive readable silhouette, oriented along +Y.
body = ico('Body', (0, 0, 1.05), (0.95, 1.55, 0.82), scale_mat, 2)
chest = ico('Chest', (0, 0.85, 1.30), (0.82, 0.75, 0.88), scale_mat, 1)
neck = cone_between('Neck', (0, 1.15, 1.35), (0, 2.00, 1.62), 0.48, 0.34, scale_mat, 7)
head = ico('Head', (0, 2.25, 1.68), (0.55, 0.68, 0.48), scale_mat, 1)
snout = ico('Snout', (0, 2.75, 1.52), (0.42, 0.58, 0.28), belly_mat, 1)

# Belly armor plates.
for index, y in enumerate([-0.7, -0.15, 0.40, 0.95]):
    ico('Belly.%02d' % index, (0, y, 0.57), (0.52, 0.34, 0.10), belly_mat, 1)

# Legs and claws.
leg_roots = [(-0.58, 0.70, 0.75), (0.58, 0.70, 0.75), (-0.62, -0.70, 0.72), (0.62, -0.70, 0.72)]
legs = []
for index, root in enumerate(leg_roots):
    side = -1 if root[0] < 0 else 1
    knee = (root[0] + 0.20*side, root[1], 0.10)
    foot = (root[0] + 0.38*side, root[1] + 0.18, -0.08)
    legs.append(cone_between('Leg.%02d' % index, root, knee, 0.22, 0.15, scale_mat, 6))
    legs.append(cone_between('Foot.%02d' % index, knee, foot, 0.16, 0.09, belly_mat, 6))

# Segmented tapered tail.
tail_points = [(0,-1.25,0.95), (0,-2.10,0.78), (0,-2.90,0.55), (0,-3.65,0.38), (0,-4.25,0.28)]
tails = []
for index in range(len(tail_points)-1):
    tails.append(cone_between('Tail.%02d' % index, tail_points[index], tail_points[index+1], 0.38-index*0.07, 0.30-index*0.06, scale_mat, 7))

left_wing = wing('Wing.L', 1)
right_wing = wing('Wing.R', -1)

# Horns and eyes.
for side in [-1, 1]:
    cone_between('Horn.%s' % side, (0.25*side,2.30,1.96), (0.48*side,2.00,2.35), 0.12, 0.01, horn_mat, 6)
    ico('Eye.%s' % side, (0.34*side,2.64,1.72), (0.08,0.05,0.08), eye_mat, 1)

# Back spikes.
for index, y in enumerate([-0.9,-0.35,0.20,0.75,1.25]):
    cone_between('Spike.%02d' % index, (0,y,1.72), (0,y,2.10), 0.13, 0.01, horn_mat, 5)

# Compact armature. Rigid bone parenting avoids fragile auto weights.
arm_data = bpy.data.armatures.new('DragonRigData')
arm = bpy.data.objects.new('DragonRig', arm_data)
scene.collection.objects.link(arm)
bpy.context.view_layer.objects.active = arm
arm.select_set(True)
bpy.ops.object.mode_set(mode='EDIT')
def bone(name, head, tail, parent=None):
    item = arm_data.edit_bones.new(name)
    item.head, item.tail = head, tail
    if parent is not None: item.parent = arm_data.edit_bones.get(parent)
    return item
bone('body', (0,0,0.4), (0,0,1.55))
bone('head', (0,1.30,1.35), (0,2.55,1.70), 'body')
bone('wing.L.shoulder', (0.55,0.35,1.25), (1.55,0.45,1.35), 'body')
bone('wing.L.wrist', (1.55,0.45,1.35), (2.65,0.20,1.10), 'wing.L.shoulder')
bone('wing.R.shoulder', (-0.55,0.35,1.25), (-1.55,0.45,1.35), 'body')
bone('wing.R.wrist', (-1.55,0.45,1.35), (-2.65,0.20,1.10), 'wing.R.shoulder')
bone('tail1', (0,-1.10,0.95), (0,-2.10,0.78), 'body')
bone('tail2', (0,-2.10,0.78), (0,-3.05,0.52), 'tail1')
bone('tail3', (0,-3.05,0.52), (0,-4.25,0.28), 'tail2')
bpy.ops.object.mode_set(mode='POSE')

def bone_parent(obj, bone_name):
    world = obj.matrix_world.copy()
    obj.parent = arm
    obj.parent_type = 'BONE'
    obj.parent_bone = bone_name
    obj.matrix_world = world

for obj in [body, chest, neck] + legs:
    bone_parent(obj, 'body')
for obj in [head, snout] + [o for o in bpy.data.objects if o.name.startswith(('Horn.','Eye.'))]:
    bone_parent(obj, 'head')
bone_parent(left_wing[0], 'wing.L.shoulder')
bone_parent(left_wing[1], 'wing.L.wrist')
bone_parent(left_wing[2], 'wing.L.wrist')
bone_parent(left_wing[3], 'wing.L.wrist')
bone_parent(right_wing[0], 'wing.R.shoulder')
bone_parent(right_wing[1], 'wing.R.wrist')
bone_parent(right_wing[2], 'wing.R.wrist')
bone_parent(right_wing[3], 'wing.R.wrist')
for index, obj in enumerate(tails):
    bone_parent(obj, ['tail1','tail2','tail3','tail3'][index])
for obj in bpy.data.objects:
    if obj.name.startswith(('Belly.','Spike.')): bone_parent(obj, 'body')

if arm.animation_data is None: arm.animation_data_create()
def reset_pose():
    for item in arm.pose.bones:
        item.rotation_mode = 'XYZ'
        item.rotation_euler = (0,0,0)
        item.location = (0,0,0)

def key(name, frame, rotation):
    item = arm.pose.bones[name]
    item.rotation_mode = 'XYZ'
    item.rotation_euler = rotation
    item.keyframe_insert(data_path='rotation_euler', frame=frame, group=name)

# Flap: a fast, open downstroke and slower folded recovery. Shoulder and
# wrist peak at different times, so the membrane bends instead of rotating as
# one rigid board. The first and last poses match for a clean loop.
reset_pose()
flap = bpy.data.actions.new('flap')
flap.use_fake_user = True
arm.animation_data.action = flap
for frame, shoulder, wrist in [
    (1, 0.58, -0.28),
    (4, 0.20, -0.05),
    (8, -0.62, 0.34),
    (12, -0.28, 0.12),
    (17, 0.18, -0.38),
    (21, 0.50, -0.32),
    (25, 0.58, -0.28),
]:
    key('wing.L.shoulder', frame, (0.0, 0.0, shoulder))
    key('wing.R.shoulder', frame, (0.0, 0.0, -shoulder))
    key('wing.L.wrist', frame, (0.0, 0.0, wrist))
    key('wing.R.wrist', frame, (0.0, 0.0, -wrist))

# Idle: head nod and travelling tail sway. The armature root is never keyed:
# neither exported clip is allowed to translate the whole model.
reset_pose()
arm.location = (0,0,0)
idle = bpy.data.actions.new('idle')
idle.use_fake_user = True
arm.animation_data.action = idle
for frame, amount in [(1,-1.0),(13,1.0),(25,-1.0),(37,1.0),(49,-1.0)]:
    key('head', frame, (0.08*amount,0,0))
    key('tail1', frame, (0,0,0.14*amount))
    key('tail2', frame, (0,0,-0.22*amount))
    key('tail3', frame, (0,0,0.32*amount))

arm.animation_data.action = flap
scene.frame_start, scene.frame_end = 1, 25
scene.frame_set(1)
print('showcase-dragon', len([o for o in bpy.data.objects if o.type == 'MESH']), 'mesh objects')
`;

export async function buildShowcase({ outputPath, asset = 'dragon', sessionOptions } = {}) {
  if (!outputPath) throw new ShowcaseError('outputPath is required');
  if (asset !== 'dragon') throw new ShowcaseError(`unknown showcase asset: ${asset}`);
  const session = await BlenderSession.start(sessionOptions ?? {});
  try {
    await session.execute(DRAGON_SHOWCASE);
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
  return { outputPath, asset, verification };
}

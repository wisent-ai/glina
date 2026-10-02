// interpreter.js — one Blender program that reads a declared rig or preset.
//
// A showcase asset and an animation preset are data (assets/showcases/*.json,
// assets/presets/*.json): materials, parts, bones and keyed actions. This file
// holds the only Blender code; it interprets whichever declaration it is given,
// so a new asset or preset is a new JSON file, not new code.

const COMMON = `
import bpy, json
from mathutils import Vector

scene = bpy.context.scene

def reset_pose(arm):
    for item in arm.pose.bones:
        item.rotation_mode = 'XYZ'
        item.rotation_euler = (0.0, 0.0, 0.0)
        item.location = (0.0, 0.0, 0.0)
        item.scale = (1.0, 1.0, 1.0)
    arm.rotation_mode = 'XYZ'
    arm.rotation_euler = (0.0, 0.0, 0.0)
    arm.location = (0.0, 0.0, 0.0)

def key_actions(arm, spec):
    if arm.animation_data is None:
        arm.animation_data_create()
    names = {action['name'] for action in spec['actions']}
    for existing in list(bpy.data.actions):
        if existing.name.split('.')[0] in names:
            bpy.data.actions.remove(existing)
    made = {}
    for action in spec['actions']:
        reset_pose(arm)
        made[action['name']] = bpy.data.actions.new(action['name'])
        made[action['name']].use_fake_user = True
        arm.animation_data.action = made[action['name']]
        for keyframe in action['keyframes']:
            frame = keyframe['frame']
            root = keyframe.get('root', {})
            if 'location' in root:
                arm.location = root['location']
                arm.keyframe_insert(data_path='location', frame=frame)
            if 'rotation' in root:
                arm.rotation_euler = root['rotation']
                arm.keyframe_insert(data_path='rotation_euler', frame=frame)
            for bone_name, pose in keyframe.get('bones', {}).items():
                bone = arm.pose.bones[bone_name]
                bone.rotation_mode = 'XYZ'
                if 'rotation' in pose:
                    bone.rotation_euler = pose['rotation']
                    bone.keyframe_insert(data_path='rotation_euler', frame=frame, group=bone_name)
                if 'location' in pose:
                    bone.location = pose['location']
                    bone.keyframe_insert(data_path='location', frame=frame, group=bone_name)
    arm.animation_data.action = made[spec['active']]
    scene.frame_start, scene.frame_end = spec['frames'][0], spec['frames'][1]
    scene.frame_set(spec['frames'][0])
    print('actions', [(name, tuple(action.frame_range)) for name, action in made.items()])
`;

const BUILD = `
for obj in list(bpy.data.objects): bpy.data.objects.remove(obj, do_unlink=True)
for data in list(bpy.data.meshes): bpy.data.meshes.remove(data)
for data in list(bpy.data.armatures): bpy.data.armatures.remove(data)
for data in list(bpy.data.materials): bpy.data.materials.remove(data)
for action in list(bpy.data.actions): bpy.data.actions.remove(action)
scene.render.engine = 'BLENDER_EEVEE_NEXT' if hasattr(bpy.types, 'BLENDER_EEVEE_NEXT') else 'BLENDER_EEVEE'

materials = {}
for declared in spec['materials']:
    mat = bpy.data.materials.new(declared['name'])
    mat.diffuse_color = declared['color']
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get('Principled BSDF')
    bsdf.inputs['Base Color'].default_value = declared['color']
    bsdf.inputs['Roughness'].default_value = declared['roughness']
    bsdf.inputs['Metallic'].default_value = declared['metallic']
    materials[declared['name']] = mat

def finish(obj, part):
    if obj.type == 'MESH':
        if not obj.data.materials:
            obj.data.materials.append(materials[part['material']])
        for poly in obj.data.polygons: poly.use_smooth = False
    return obj

def make(part):
    if part['shape'] == 'ico':
        bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=part['subdivisions'], radius=1.0, location=part['location'])
        obj = bpy.context.object
        obj.scale = part['scale']
    elif part['shape'] == 'cone':
        a, b = Vector(part['start']), Vector(part['end'])
        direction = b - a
        bpy.ops.mesh.primitive_cone_add(vertices=part['vertices'], radius1=part['radius_start'], radius2=part['radius_end'], depth=direction.length, location=(a+b)/2)
        obj = bpy.context.object
        obj.rotation_euler = direction.to_track_quat('Z', 'Y').to_euler()
    elif part['shape'] == 'polygon':
        mesh = bpy.data.meshes.new(part['name'] + 'Mesh')
        mesh.from_pydata(part['points'], [], [tuple(range(len(part['points'])))])
        mesh.materials.append(materials[part['material']])
        obj = bpy.data.objects.new(part['name'], mesh)
        scene.collection.objects.link(obj)
    else:
        raise RuntimeError('unknown part shape ' + part['shape'] + ' for ' + part['name'])
    obj.name = part['name']
    return finish(obj, part)

made_parts = [(make(part), part) for part in spec['parts']]

arm_data = bpy.data.armatures.new(spec['rig'] + 'Data')
arm = bpy.data.objects.new(spec['rig'], arm_data)
scene.collection.objects.link(arm)
bpy.context.view_layer.objects.active = arm
arm.select_set(True)
bpy.ops.object.mode_set(mode='EDIT')
for declared in spec['bones']:
    item = arm_data.edit_bones.new(declared['name'])
    item.head, item.tail = declared['head'], declared['tail']
    if declared.get('parent'): item.parent = arm_data.edit_bones.get(declared['parent'])
bpy.ops.object.mode_set(mode='POSE')

for obj, part in made_parts:
    world = obj.matrix_world.copy()
    obj.parent = arm
    obj.parent_type = 'BONE'
    obj.parent_bone = part['bone']
    obj.matrix_world = world

key_actions(arm, spec)
print('showcase', spec['rig'], len([o for o in bpy.data.objects if o.type == 'MESH']), 'mesh objects')
`;

const APPLY = `
arm = next((obj for obj in bpy.data.objects if obj.type == 'ARMATURE'), None)
if arm is None:
    raise RuntimeError('preset requires one Armature')
missing = [name for name in spec['required_bones'] if arm.pose.bones.get(name) is None]
if missing:
    raise RuntimeError('missing bones: ' + ', '.join(missing))
key_actions(arm, spec)
`;

// The declaration is passed as a JSON string literal, which Python reads as
// its own string literal, so no value in it is ever spliced into code.
function withSpec(spec, body) {
  return `${COMMON}\nspec = json.loads(${JSON.stringify(JSON.stringify(spec))})\n${body}`;
}

export function showcaseProgram(spec) {
  return withSpec(spec, BUILD);
}

export function presetProgram(spec) {
  return withSpec(spec, APPLY);
}

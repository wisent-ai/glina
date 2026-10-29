import * as THREE from 'three';
import { addBox, buildAxe, buildArmorDetails, buildCape, buildBodyDetails, buildExtraDetails } from './sculpt-gear.js';

// A ring encloses an area only with three vertices or more.
const FEWEST_RING_VERTICES = 3;

const TORSO_RINGS = [
  { y: 0.92, rx: 0.40, rz: 0.26, c: 'pants' },
  { y: 0.98, rx: 0.46, rz: 0.30, c: 'belt' },
  { y: 1.04, rx: 0.36, rz: 0.24, c: 'belt' },
  { y: 1.14, rx: 0.40, rz: 0.26, c: 'armor' },
  { y: 1.30, rx: 0.50, rz: 0.32, c: 'armor' },
  { y: 1.46, rx: 0.58, rz: 0.36, c: 'armor' },
  { y: 1.58, rx: 0.62, rz: 0.38, c: 'armor' },
  { y: 1.66, rx: 0.62, rz: 0.38, c: 'armor' },
  { y: 1.72, rx: 0.46, rz: 0.30, c: 'collar' },
  { y: 1.78, rx: 0.20, rz: 0.16, c: 'skin' },
];

const HEAD_RINGS = [
  { y: 1.86, r: 0.20, c: 'helmet' },
  { y: 1.92, r: 0.24, c: 'helmet' },
  { y: 2.00, r: 0.26, c: 'helmet' },
  { y: 2.10, r: 0.27, c: 'helmet' },
  { y: 2.20, r: 0.26, c: 'helmet' },
  { y: 2.28, r: 0.22, c: 'helmet' },
  { y: 2.36, r: 0.16, c: 'helmet' },
];

const ARM_PATH_LEFT = [
  { r: 0.22, c: 'armor',    p: [-0.58, 1.66, 0.00] },
  { r: 0.20, c: 'armor',    p: [-0.60, 1.48, 0.04] },
  { r: 0.18, c: 'skin',     p: [-0.58, 1.30, 0.08] },
  { r: 0.16, c: 'skin',     p: [-0.78, 1.12, 0.16] },
  { r: 0.15, c: 'skin',     p: [-0.52, 0.96, 0.24] },
  { r: 0.20, c: 'gauntlet', p: [-0.50, 0.82, 0.30] },
  { r: 0.18, c: 'skin',     p: [-0.48, 0.74, 0.34] },
];

const ARM_PATH_RIGHT = [
  { r: 0.22, c: 'armor',    p: [ 0.58, 1.66, 0.00] },
  { r: 0.20, c: 'armor',    p: [ 0.60, 1.55, 0.10] },
  { r: 0.18, c: 'skin',     p: [ 0.60, 1.40, 0.22] },
  { r: 0.16, c: 'skin',     p: [ 0.62, 1.26, 0.36] },
  { r: 0.15, c: 'skin',     p: [ 0.64, 1.16, 0.50] },
  { r: 0.20, c: 'gauntlet', p: [ 0.66, 1.06, 0.62] },
  { r: 0.18, c: 'skin',     p: [ 0.68, 0.98, 0.70] },
];

const LEG_PATH_LEFT = [
  { r: 0.28, c: 'pants', p: [-0.22, 0.92, 0.00] },
  { r: 0.30, c: 'pants', p: [-0.23, 0.78, 0.10] },
  { r: 0.24, c: 'pants', p: [-0.24, 0.60, 0.20] },
  { r: 0.20, c: 'pants', p: [-0.25, 0.44, 0.30] },
  { r: 0.22, c: 'pants', p: [-0.25, 0.30, 0.36] },
  { r: 0.22, c: 'boot',  p: [-0.25, 0.18, 0.40] },
  { r: 0.26, c: 'boot',  p: [-0.25, 0.08, 0.42] },
  { r: 0.30, c: 'boot',  p: [-0.25, 0.02, 0.48] },
];

const LEG_PATH_RIGHT = [
  { r: 0.28, c: 'pants', p: [ 0.20, 0.92,  0.00] },
  { r: 0.30, c: 'pants', p: [ 0.20, 0.78, -0.04] },
  { r: 0.24, c: 'pants', p: [ 0.20, 0.60, -0.08] },
  { r: 0.20, c: 'pants', p: [ 0.20, 0.44, -0.12] },
  { r: 0.22, c: 'pants', p: [ 0.20, 0.30, -0.14] },
  { r: 0.22, c: 'boot',  p: [ 0.20, 0.18, -0.16] },
  { r: 0.26, c: 'boot',  p: [ 0.20, 0.08, -0.16] },
  { r: 0.30, c: 'boot',  p: [ 0.20, 0.02, -0.10] },
];

function colorOf(palette, name) {
  return palette[name] || palette.skin;
}

function pushRing(verts, colors, palette, cName, cx, cy, cz, rx, rz, segments) {
  const startIdx = verts.length / 3;
  const col = colorOf(palette, cName);
  for (let i = 0; i < segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    verts.push(cx + Math.cos(a) * rx, cy, cz + Math.sin(a) * rz);
    colors.push(col.r, col.g, col.b);
  }
  return startIdx;
}

function stitchRings(idx, ringA, ringB, segments) {
  for (let i = 0; i < segments; i++) {
    const j = (i + 1) % segments;
    idx.push(ringA + i, ringA + j, ringB + i);
    idx.push(ringB + i, ringA + j, ringB + j);
  }
}

function capRing(idx, ringStart, centerIdx, segments) {
  for (let i = 0; i < segments; i++) {
    const j = (i + 1) % segments;
    idx.push(ringStart + j, centerIdx, ringStart + i);
  }
}

function buildTorso(verts, colors, idx, palette, segments) {
  const starts = TORSO_RINGS.map((r) => pushRing(verts, colors, palette, r.c, 0, r.y, 0, r.rx, r.rz, segments));
  for (let i = 0; i < starts.length - 1; i++) stitchRings(idx, starts[i], starts[i + 1], segments);
  return starts;
}

function buildHead(verts, colors, idx, palette, segments) {
  const starts = HEAD_RINGS.map((r) => pushRing(verts, colors, palette, r.c, 0, r.y, 0.02, r.r, r.r * 0.92, segments));
  for (let i = 0; i < starts.length - 1; i++) stitchRings(idx, starts[i], starts[i + 1], segments);
  const topIdx = verts.length / 3;
  verts.push(0, 2.36, 0.02);
  const helmCol = colorOf(palette, 'helmet');
  colors.push(helmCol.r, helmCol.g, helmCol.b);
  capRing(idx, starts[starts.length - 1], topIdx, segments);
  return starts;
}

function pathRing(verts, colors, palette, node, mirrorX, segments) {
  const [x, y, z] = node.p;
  const px = mirrorX ? -x : x;
  return pushRing(verts, colors, palette, node.c, px, y, z, node.r, node.r, segments);
}

function buildLimb(verts, colors, idx, palette, path, mirrorX, capColorName, segments) {
  const starts = path.map((n) => pathRing(verts, colors, palette, n, mirrorX, segments));
  for (let i = 0; i < starts.length - 1; i++) stitchRings(idx, starts[i], starts[i + 1], segments);
  const tipIdx = verts.length / 3;
  const tip = path[path.length - 1];
  const px = mirrorX ? -tip.p[0] : tip.p[0];
  verts.push(px, tip.p[1] - 0.04, tip.p[2] + 0.04);
  const cc = colorOf(palette, capColorName || tip.c);
  colors.push(cc.r, cc.g, cc.b);
  capRing(idx, starts[starts.length - 1], tipIdx, segments);
  return starts;
}

function addFaceFeatures(verts, colors, idx, palette, opts = {}) {
  // Glowing eye dots inside the visor slot
  const eye = new THREE.Color(opts.eyeGlow != null ? opts.eyeGlow : 0xffaa30);
  addBox(verts, colors, idx, eye, -0.05, 2.06, 0.272, 0.018, 0.014, 0.006);
  addBox(verts, colors, idx, eye,  0.05, 2.06, 0.272, 0.018, 0.014, 0.006);
  if (opts.beard) {
    const beard = new THREE.Color(opts.beardColor != null ? opts.beardColor : 0x6e3f1f);
    // Beard hangs below helmet skirt
    addBox(verts, colors, idx, beard, 0.00, 1.78, 0.22, 0.18, 0.06, 0.05);
    addBox(verts, colors, idx, beard, 0.00, 1.72, 0.22, 0.16, 0.06, 0.05);
    addBox(verts, colors, idx, beard, 0.00, 1.66, 0.20, 0.12, 0.05, 0.04);
  }
}

function addBrow(verts, colors, idx, palette) {
  const skinCol = colorOf(palette, 'skin');
  const baseY = 2.04, baseZ = 0.22;
  const start = verts.length / 3;
  const pts = [];
  for (let i = 0; i < 16; i++) {
    const a = (i / 15) * Math.PI - Math.PI / 2;
    pts.push([Math.sin(a) * 0.12, baseY + Math.cos(a) * 0.02, baseZ]);
  }
  for (const [x, y, z] of pts) { verts.push(x, y, z); colors.push(skinCol.r, skinCol.g, skinCol.b); }
  for (const [x, y, z] of pts) { verts.push(x, y - 0.04, z + 0.005); colors.push(skinCol.r * 0.6, skinCol.g * 0.6, skinCol.b * 0.6); }
  for (let i = 0; i < pts.length - 1; i++) {
    idx.push(start + i, start + i + 1, start + pts.length + i);
    idx.push(start + pts.length + i, start + i + 1, start + pts.length + i + 1);
  }
}

function paletteFor(opts) {
  const skin = new THREE.Color(opts.skin != null ? opts.skin : 0xd9b48a);
  const armor = new THREE.Color(opts.armor != null ? opts.armor : 0xc9a44a);
  const helmet = new THREE.Color(opts.helmet != null ? opts.helmet : 0x9a9aa6);
  const pants = new THREE.Color(opts.pants != null ? opts.pants : 0x4a3a2a);
  const boot = new THREE.Color(opts.boot != null ? opts.boot : 0x2a1f15);
  const belt = new THREE.Color(opts.belt != null ? opts.belt : 0x33231a);
  const collar = new THREE.Color(opts.collar != null ? opts.collar : 0xb8843e);
  const gauntlet = new THREE.Color(opts.gauntlet != null ? opts.gauntlet : 0x8a8a98);
  return { skin, armor, helmet, pants, boot, belt, collar, gauntlet };
}

/**
 * The humanoid mesh. `opts.ringSegments` is how many vertices go around every
 * ring of the body, the axe haft and the shield: the caller's tessellation,
 * refused by name when it is missing or encloses no area.
 */
export function sculptHumanoid(opts = {}) {
  const segments = opts.ringSegments;
  if (!Number.isInteger(segments) || segments < FEWEST_RING_VERTICES) {
    throw new Error(`sculptHumanoid needs opts.ringSegments, the whole number of vertices around each ring (at least ${FEWEST_RING_VERTICES}); got ${JSON.stringify(segments)}`);
  }
  const palette = paletteFor(opts);
  const verts = []; const colors = []; const idx = [];
  buildTorso(verts, colors, idx, palette, segments);
  buildHead(verts, colors, idx, palette, segments);
  buildLimb(verts, colors, idx, palette, ARM_PATH_LEFT, false, 'gauntlet', segments);
  buildLimb(verts, colors, idx, palette, ARM_PATH_RIGHT, false, 'gauntlet', segments);
  buildLimb(verts, colors, idx, palette, LEG_PATH_LEFT, false, 'boot', segments);
  buildLimb(verts, colors, idx, palette, LEG_PATH_RIGHT, false, 'boot', segments);
  addFaceFeatures(verts, colors, idx, palette, { beard: opts.beard, beardColor: opts.beardColor, eyeGlow: opts.eyeGlow });
  buildAxe(verts, colors, idx, colorOf(palette, 'belt'), colorOf(palette, 'gauntlet'), segments);
  buildArmorDetails(verts, colors, idx, palette, opts);
  buildCape(verts, colors, idx, opts);
  buildBodyDetails(verts, colors, idx, palette, opts);
  // Helmet horns — angled spikes on each side (stylized warrior look)
  if (!opts.noHorns) {
    const horn = new THREE.Color(0x2a2a2a);
    addBox(verts, colors, idx, horn, -0.30, 2.18, -0.04, 0.025, 0.18, 0.03);
    addBox(verts, colors, idx, horn,  0.30, 2.18, -0.04, 0.025, 0.18, 0.03);
  }
  // Bigger toe caps on boots (chunky stylized look)
  const toeCol = new THREE.Color(0x161616);
  addBox(verts, colors, idx, toeCol, -0.25, 0.06, 0.62, 0.14, 0.08, 0.10);
  addBox(verts, colors, idx, toeCol,  0.20, 0.06, -0.24, 0.14, 0.08, 0.10);
  // Knee armor highlight (gold trim circle)
  const kneeRim = new THREE.Color(0xfff5b8);
  addBox(verts, colors, idx, kneeRim, -0.24, 0.42, 0.36, 0.12, 0.014, 0.04);
  addBox(verts, colors, idx, kneeRim,  0.20, 0.42, -0.16, 0.12, 0.014, 0.04);
  // Spaulder studs — three rivets along the front edge of each pauldron
  const stud = new THREE.Color(0x8a6a1a);
  for (let i = 0; i < 3; i++) {
    addBox(verts, colors, idx, stud, -0.62 + i * 0.05, 1.70, 0.18, 0.018, 0.018, 0.018);
    addBox(verts, colors, idx, stud,  0.62 - i * 0.05, 1.70, 0.28, 0.018, 0.018, 0.018);
  }
  // Chest plate side panels — vertical strips on each flank
  const sideArmor = new THREE.Color(colorOf(palette, 'armor').r * 0.85, colorOf(palette, 'armor').g * 0.85, colorOf(palette, 'armor').b * 0.85);
  addBox(verts, colors, idx, sideArmor, -0.55, 1.40, 0.05, 0.04, 0.20, 0.18);
  addBox(verts, colors, idx, sideArmor,  0.55, 1.40, 0.05, 0.04, 0.20, 0.18);
  // Boot leather straps (horizontal cross-tie)
  const strapCol = new THREE.Color(0x3a2a1a);
  addBox(verts, colors, idx, strapCol, -0.25, 0.10, 0.42, 0.32, 0.018, 0.32);
  addBox(verts, colors, idx, strapCol,  0.20, 0.10, -0.13, 0.32, 0.018, 0.32);
  // Strap buckles (small gold squares)
  addBox(verts, colors, idx, new THREE.Color(0xc9a44a), -0.25, 0.10, 0.58, 0.018, 0.025, 0.025);
  addBox(verts, colors, idx, new THREE.Color(0xc9a44a),  0.20, 0.10, 0.03, 0.018, 0.025, 0.025);
  // Spine / back ridge (vertical raised line down the back of the chest plate)
  addBox(verts, colors, idx, sideArmor, 0.0, 1.40, -0.30, 0.025, 0.30, 0.04);
  // Helmet rivets (4 small studs around the dome)
  const helmRivet = new THREE.Color(0x3a3a3a);
  for (let i = 0; i < 4; i++) {
    const a = i * Math.PI / 2 + Math.PI / 4;
    addBox(verts, colors, idx, helmRivet, Math.cos(a) * 0.20, 2.16, Math.sin(a) * 0.20 + 0.04, 0.018, 0.018, 0.018);
  }
  // Belt large center buckle (replace small one with bigger gold square)
  addBox(verts, colors, idx, new THREE.Color(0xfff5b8), 0.0, 1.04, 0.36, 0.07, 0.05, 0.012);
  addBox(verts, colors, idx, new THREE.Color(0xc9a44a), 0.0, 1.04, 0.355, 0.06, 0.04, 0.022);
  buildExtraDetails(verts, colors, idx, palette, opts);
  // Helmet side medallions on cheek guards
  const medallion = new THREE.Color(0xfff5b8);
  addBox(verts, colors, idx, medallion, -0.246, 1.96, 0.18, 0.014, 0.030, 0.030);
  addBox(verts, colors, idx, medallion,  0.246, 1.96, 0.18, 0.014, 0.030, 0.030);
  // Greave vertical seam (line down the front of each shin plate)
  const greaveSeam = new THREE.Color(0x707378);
  addBox(verts, colors, idx, greaveSeam, -0.23, 0.20, 0.475, 0.012, 0.16, 0.012);
  addBox(verts, colors, idx, greaveSeam,  0.18, 0.20, -0.155, 0.012, 0.16, 0.012);
  // Axe blade highlight — thin lighter strip on the cutting edge
  addBox(verts, colors, idx, new THREE.Color(0xfff5b8), 0.96, 1.51, 0.94, 0.025, 0.04, 0.005);
  // Cape fold — vertical raised line down the middle of the cape
  addBox(verts, colors, idx, new THREE.Color(0x4a0a0a), 0.0, 1.32, -0.36, 0.015, 0.50, 0.015);
  // Round shield on left arm — disc with a central boss
  const shieldFace = new THREE.Color(opts.shield != null ? opts.shield : 0x8a1a1a);
  const shieldRim = new THREE.Color(0xc9a44a);
  // Shield disc as a flattened ring stack
  const shieldRings = [];
  for (let i = 0; i < 4; i++) {
    const r = 0.14 + i * 0.05;
    const cy = 1.04;
    const cz = 0.40 - (i === 0 ? 0.04 : 0);
    const start = verts.length / 3;
    for (let j = 0; j < segments; j++) {
      const a = (j / segments) * Math.PI * 2;
      verts.push(-0.78 + Math.cos(a) * r * 0.05, cy + Math.sin(a) * r, cz + Math.cos(a) * r);
      const c = i === 3 ? shieldRim : shieldFace;
      colors.push(c.r, c.g, c.b);
    }
    shieldRings.push(start);
  }
  for (let i = 0; i < shieldRings.length - 1; i++) stitchRings(idx, shieldRings[i], shieldRings[i + 1], segments);
  // Shield boss — central protrusion
  addBox(verts, colors, idx, shieldRim, -0.78, 1.04, 0.42, 0.025, 0.06, 0.06);
  // Shield emblem — gold cross on the face
  addBox(verts, colors, idx, new THREE.Color(0xfff5b8), -0.76, 1.04, 0.42, 0.012, 0.14, 0.025);
  addBox(verts, colors, idx, new THREE.Color(0xfff5b8), -0.76, 1.04, 0.42, 0.012, 0.025, 0.14);
  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  geom.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geom.setIndex(idx);
  geom.computeVertexNormals();
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
  const mesh = new THREE.Mesh(geom, mat);
  mesh.castShadow = true; mesh.receiveShadow = true;
  return mesh;
}

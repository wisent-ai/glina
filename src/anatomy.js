import * as THREE from 'three';
import { MarchingCubes } from 'https://unpkg.com/three@0.160.0/examples/jsm/objects/MarchingCubes.js';
import { buildWeaponArm, buildArmorTier } from '../../lib/weapons.js';

const lambert = (color, flat = false) => new THREE.MeshLambertMaterial({ color, flatShading: flat });
const basic = (color) => new THREE.MeshBasicMaterial({ color });

const RACE_VISUALS = {
  humans:    { skin: 0xe6c39a, helmet: 0xc4a14a, scaleY: 1.00, width: 1.00, accessory: null,    capH: 0.45, hair: 0x4a2a14 },
  dwarves:   { skin: 0xd9a06d, helmet: 0x707378, scaleY: 0.78, width: 1.16, accessory: 'beard', capH: 0.32, hair: 0x6e3f1f },
  elves:     { skin: 0xd2e6b4, helmet: 0x4a8a4a, scaleY: 1.10, width: 0.90, accessory: 'ears',  capH: 0.65, hair: 0xd4b878 },
  skeletons: { skin: 0xeee5d0, helmet: 0x6a6a6a, scaleY: 0.95, width: 0.92, accessory: 'skull', capH: 0.0, hair: 0x000000 },
};

const LEG_PROFILE = [[0.20, 0.00], [0.22, 0.05], [0.20, 0.16], [0.16, 0.30], [0.21, 0.42], [0.16, 0.56], [0.18, 0.65], [0.20, 0.78], [0.22, 0.90], [0.20, 1.00]];
const ARM_PROFILE = [[0.10, 0.00], [0.11, 0.10], [0.13, 0.20], [0.14, 0.32], [0.12, 0.42], [0.10, 0.50]];
const TORSO_PROFILE = [[0.34, 0.00], [0.42, 0.10], [0.48, 0.30], [0.46, 0.50], [0.40, 0.65], [0.46, 0.80], [0.40, 0.85]];

function lathe(profile, segments) {
  const pts = profile.map(([x, y]) => new THREE.Vector2(x, y));
  return new THREE.LatheGeometry(pts, segments);
}

const BLOB_RIG = [
  [0.50, 0.92, 0.50, 0.45, 14],
  [0.50, 0.83, 0.50, 0.16, 14],
  [0.50, 0.76, 0.50, 0.40, 14],
  [0.50, 0.68, 0.50, 0.40, 14],
  [0.50, 0.60, 0.50, 0.36, 14],
  [0.50, 0.52, 0.50, 0.32, 14],
  [0.18, 0.78, 0.50, 0.20, 14], [0.82, 0.78, 0.50, 0.20, 14],
  [0.13, 0.70, 0.50, 0.16, 14], [0.87, 0.70, 0.50, 0.16, 14],
  [0.10, 0.62, 0.50, 0.16, 14], [0.90, 0.62, 0.50, 0.16, 14],
  [0.09, 0.54, 0.50, 0.16, 14], [0.91, 0.54, 0.50, 0.16, 14],
  [0.09, 0.46, 0.50, 0.16, 14], [0.91, 0.46, 0.50, 0.16, 14],
  [0.32, 0.46, 0.50, 0.22, 14], [0.68, 0.46, 0.50, 0.22, 14],
  [0.32, 0.38, 0.50, 0.20, 14], [0.68, 0.38, 0.50, 0.20, 14],
  [0.32, 0.30, 0.50, 0.18, 14], [0.68, 0.30, 0.50, 0.18, 14],
  [0.32, 0.22, 0.50, 0.18, 14], [0.68, 0.22, 0.50, 0.18, 14],
  [0.32, 0.14, 0.50, 0.18, 14], [0.68, 0.14, 0.50, 0.18, 14],
  [0.33, 0.06, 0.55, 0.18, 14], [0.67, 0.06, 0.55, 0.18, 14],
];

function generateSkinTexture(skinHex, accentHex, { width: w, height: h, darkSpecks, lightSpecks }) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#' + skinHex.toString(16).padStart(6, '0'); ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#' + accentHex.toString(16).padStart(6, '0');
  ctx.fillRect(0, h * 0.55, w, h * 0.20);
  ctx.fillRect(0, h * 0.42, w, h * 0.04);
  ctx.fillStyle = 'rgba(0,0,0,0.18)';
  for (let i = 0; i < darkSpecks; i++) ctx.fillRect(Math.random() * w, Math.random() * h, 1 + Math.random() * 2, 1 + Math.random() * 2);
  ctx.fillStyle = 'rgba(255,255,255,0.06)';
  for (let i = 0; i < lightSpecks; i++) ctx.fillRect(Math.random() * w, Math.random() * h, 1, 1);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; return tex;
}

/** The fields of `surface` buildBlobBody reads; each is the caller's, refused by name when absent. */
const BLOB_SURFACE = ['resolution', 'isolation', 'maxPolyCount', 'textureWidth', 'textureHeight', 'darkSpecks', 'lightSpecks'];

/**
 * The blob body: a marching-cubes surface sampled on a `surface.resolution`
 * grid at `surface.isolation`, holding at most `surface.maxPolyCount`
 * polygons, skinned with a `textureWidth` × `textureHeight` texture strewn
 * with `darkSpecks` and `lightSpecks`. Nothing here picks a detail level.
 */
export function buildBlobBody(skinHex, accentHex, surface) {
  const missing = BLOB_SURFACE.filter((field) => !Number.isFinite(surface?.[field]));
  if (missing.length) {
    throw new Error(`buildBlobBody needs surface.${missing.join(', surface.')}: the detail of the body is the caller's to state`);
  }
  const tex = generateSkinTexture(skinHex, accentHex, {
    width: surface.textureWidth, height: surface.textureHeight, darkSpecks: surface.darkSpecks, lightSpecks: surface.lightSpecks,
  });
  const mat = new THREE.MeshLambertMaterial({ map: tex });
  const mc = new MarchingCubes(surface.resolution, mat, true, true, surface.maxPolyCount);
  mc.position.set(0, 1.16, 0);
  mc.scale.setScalar(2.32);
  mc.isolation = surface.isolation;
  mc.reset();
  for (const [x, y, z, str, sub] of BLOB_RIG) mc.addBall(x, y, z, str, sub);
  mc.update();
  mc.castShadow = true;
  return mc;
}

function buildHead(v, raceKey, skinMat, boneMat, eyeMat) {
  const g = new THREE.Group();
  const headMat = raceKey === 'skeletons' ? boneMat : skinMat;
  const headR = raceKey === 'skeletons' ? 0.20 : 0.22;
  const head = new THREE.Mesh(new THREE.SphereGeometry(headR, 48, 32), headMat);
  head.position.y = 2.00; head.castShadow = true; head.scale.set(1.0, 1.10, 0.94);
  const brow = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.05, 0.07), headMat); brow.position.set(0, 2.07, 0.18);
  const browL = new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.025, 0.04), basic(0x3a2010)); browL.position.set(-0.08, 2.09, 0.21);
  const browR = new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.025, 0.04), basic(0x3a2010)); browR.position.set( 0.08, 2.09, 0.21);
  const cheekL = new THREE.Mesh(new THREE.SphereGeometry(0.07, 24, 16), headMat); cheekL.position.set(-0.14, 1.94, 0.15); cheekL.scale.set(0.7, 0.5, 0.7);
  const cheekR = new THREE.Mesh(new THREE.SphereGeometry(0.07, 24, 16), headMat); cheekR.position.set( 0.14, 1.94, 0.15); cheekR.scale.set(0.7, 0.5, 0.7);
  const chin = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.08, 0.09), headMat); chin.position.set(0, 1.82, 0.16);
  const eyeGeom = new THREE.SphereGeometry(raceKey === 'skeletons' ? 0.05 : 0.035, 10, 8);
  const eyeL = new THREE.Mesh(eyeGeom, eyeMat); eyeL.position.set(-0.08, 2.02, 0.19);
  const eyeR = new THREE.Mesh(eyeGeom, eyeMat); eyeR.position.set( 0.08, 2.02, 0.19);
  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.04, 0.14, 8), headMat);
  nose.position.set(0, 1.97, 0.24); nose.rotation.x = Math.PI / 2;
  const lipsMat = basic(0x6a2010);
  const upperLip = new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.02, 0.03), lipsMat); upperLip.position.set(0, 1.88, 0.22);
  const lowerLip = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.025, 0.03), lipsMat); lowerLip.position.set(0, 1.86, 0.22);
  g.add(head, brow, browL, browR, cheekL, cheekR, chin, eyeL, eyeR, nose, upperLip, lowerLip);
  if (v.hair && raceKey !== 'skeletons' && v.capH === 0) {
    const hairMat = lambert(v.hair, true);
    for (const [dx, dz] of [[0, 0], [-0.14, 0], [0.14, 0], [0, -0.14], [0, 0.14]]) {
      const tuft = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.18, 6), hairMat);
      tuft.position.set(dx, 2.18, dz); tuft.castShadow = true; g.add(tuft);
    }
  }
  return g;
}

function buildLegs(accentMat, dark) {
  const g = new THREE.Group();
  const legGeom = lathe(LEG_PROFILE, 32);
  const legL = new THREE.Mesh(legGeom, accentMat); legL.position.set(-0.18, 0.0, 0); legL.castShadow = true;
  const legR = new THREE.Mesh(legGeom, accentMat); legR.position.set( 0.18, 0.0, 0); legR.castShadow = true;
  const calfL = new THREE.Mesh(new THREE.SphereGeometry(0.13, 24, 16), accentMat); calfL.position.set(-0.18, 0.42, -0.06); calfL.scale.set(0.9, 1.4, 0.7);
  const calfR = new THREE.Mesh(new THREE.SphereGeometry(0.13, 24, 16), accentMat); calfR.position.set( 0.18, 0.42, -0.06); calfR.scale.set(0.9, 1.4, 0.7);
  const kneeGeom = new THREE.SphereGeometry(0.13, 24, 16);
  const kneeL = new THREE.Mesh(kneeGeom, accentMat); kneeL.position.set(-0.18, 0.55, 0.06); kneeL.scale.set(1, 0.6, 1);
  const kneeR = new THREE.Mesh(kneeGeom, accentMat); kneeR.position.set( 0.18, 0.55, 0.06); kneeR.scale.set(1, 0.6, 1);
  const bootL = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.18, 0.46), dark); bootL.position.set(-0.18, 0.10, 0.05); bootL.castShadow = true;
  const bootR = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.18, 0.46), dark); bootR.position.set( 0.18, 0.10, 0.05); bootR.castShadow = true;
  const heelL = new THREE.Mesh(new THREE.BoxGeometry(0.30, 0.10, 0.16), dark); heelL.position.set(-0.18, 0.05, -0.12);
  const heelR = new THREE.Mesh(new THREE.BoxGeometry(0.30, 0.10, 0.16), dark); heelR.position.set( 0.18, 0.05, -0.12);
  g.add(legL, legR, calfL, calfR, kneeL, kneeR, bootL, bootR, heelL, heelR);
  return g;
}

function buildRaceMarks(raceKey, liveryMat, boneMat) {
  const g = new THREE.Group();
  if (raceKey === 'dwarves') {
    const rivetMat = lambert(0x707378, true);
    for (const [x, y] of [[-0.18, 1.55], [0.18, 1.55], [-0.18, 1.30], [0.18, 1.30], [0, 1.42]]) {
      const r = new THREE.Mesh(new THREE.SphereGeometry(0.025, 12, 8), rivetMat); r.position.set(x, y, 0.42); g.add(r);
    }
  } else if (raceKey === 'skeletons') {
    for (let i = 0; i < 4; i++) {
      const rib = new THREE.Mesh(new THREE.TorusGeometry(0.36, 0.015, 6, 16, Math.PI), boneMat);
      rib.position.set(0, 1.55 - i * 0.10, 0.10); rib.rotation.x = Math.PI; g.add(rib);
    }
  } else if (raceKey === 'elves') {
    const vineMat = lambert(0x68b870);
    for (let i = 0; i < 6; i++) {
      const leaf = new THREE.Mesh(new THREE.SphereGeometry(0.04, 12, 8), vineMat);
      leaf.scale.set(1, 0.4, 0.6); leaf.position.set((i % 2 ? 1 : -1) * 0.50, 1.20 - Math.floor(i / 2) * 0.18, 0.10);
      g.add(leaf);
    }
  }
  return g;
}

function buildTorso(team, liveryMat, accentMat, beltMat, skinMat) {
  const g = new THREE.Group();
  const torso = new THREE.Mesh(lathe(TORSO_PROFILE, 32), liveryMat); torso.position.y = 1.05; torso.castShadow = true;
  const shoulderL = new THREE.Mesh(new THREE.SphereGeometry(0.20, 32, 24), liveryMat); shoulderL.position.set(-0.42, 1.78, 0); shoulderL.castShadow = true;
  const shoulderR = new THREE.Mesh(new THREE.SphereGeometry(0.20, 32, 24), liveryMat); shoulderR.position.set( 0.42, 1.78, 0); shoulderR.castShadow = true;
  const collar = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.06, 0.10), accentMat); collar.position.set(0, 1.80, 0.18);
  const belt = new THREE.Mesh(new THREE.TorusGeometry(0.40, 0.06, 12, 32), beltMat); belt.rotation.x = Math.PI / 2; belt.position.y = 0.95;
  const buckle = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.10, 0.06), accentMat); buckle.position.set(0, 0.95, 0.42);
  const pouchL = new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.16, 0.10), beltMat); pouchL.position.set(-0.30, 0.85, 0.30);
  const scabbard = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.65, 0.10), beltMat); scabbard.position.set(-0.42, 0.55, 0); scabbard.rotation.z = -0.15;
  g.add(torso, shoulderL, shoulderR, collar, belt, buckle, pouchL, scabbard);
  return g;
}

function buildShieldArm(team, raceKey, liveryMat, skinMat, accentMat, weaponStyle) {
  const TWO_HAND = new Set(['spear', 'pike', 'halberd', 'lance']);
  const twoHand = TWO_HAND.has(weaponStyle);
  const arm = new THREE.Group(); arm.position.set(-0.50, 1.65, 0);
  const upper = new THREE.Mesh(lathe(ARM_PROFILE, 32), liveryMat);
  upper.position.set(0.05, -0.50, 0); upper.castShadow = true;
  const bicep = new THREE.Mesh(new THREE.SphereGeometry(0.13, 24, 18), liveryMat);
  bicep.position.set(0.05, -0.18, 0.05); bicep.scale.set(1.0, 0.9, 0.7); bicep.castShadow = true;
  const fore = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.10, 0.32, 24), skinMat);
  fore.position.set(0.05, -0.74, 0); fore.castShadow = true;
  const bracer = new THREE.Mesh(new THREE.CylinderGeometry(0.115, 0.115, 0.20, 24), lambert(0x707378, true));
  bracer.position.set(0.05, -0.78, 0); bracer.castShadow = true;
  const bracerStrap = new THREE.Mesh(new THREE.TorusGeometry(0.115, 0.012, 12, 32), lambert(0x3a2a1a)); bracerStrap.position.set(0.05, -0.70, 0); bracerStrap.rotation.x = Math.PI / 2;
  const hand = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.10, 0.18), skinMat);
  hand.position.set(0.05, -0.92, 0.05); hand.castShadow = true;
  const fingerMat = skinMat;
  for (let i = 0; i < 4; i++) {
    const f = new THREE.Mesh(new THREE.BoxGeometry(0.030, 0.10, 0.04), fingerMat);
    f.position.set(0.05 + (i - 1.5) * 0.035, -1.02, 0.10);
    arm.add(f);
  }
  const shieldDisc = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 0.06, 48), liveryMat);
  shieldDisc.position.set(-0.08, -0.92, 0.10); shieldDisc.rotation.z = Math.PI / 2; shieldDisc.castShadow = true;
  const sboss = new THREE.Mesh(new THREE.SphereGeometry(0.08, 24, 16), accentMat); sboss.position.set(-0.13, -0.92, 0.10);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.32, 0.04, 16, 32), accentMat); rim.position.set(-0.10, -0.92, 0.10); rim.rotation.y = Math.PI / 2;
  arm.add(upper, bicep, fore, bracer, bracerStrap, hand, shieldDisc, sboss, rim);
  if (twoHand) { shieldDisc.visible = false; sboss.visible = false; rim.visible = false; arm.rotation.y = -0.55; }
  arm.userData.twoHand = twoHand;
  return arm;
}

function buildAccessory(v, helmetMat, skinMat, boneMat, raceKey, hair) {
  const g = new THREE.Group();
  if (v.capH > 0) {
    const cap = new THREE.Mesh(new THREE.ConeGeometry(0.30, v.capH, 32), helmetMat);
    cap.position.y = 2.20 + v.capH * 0.5 - 0.10; cap.castShadow = true;
    const brim = new THREE.Mesh(new THREE.TorusGeometry(0.28, 0.04, 12, 32), helmetMat);
    brim.rotation.x = Math.PI / 2; brim.position.y = 2.18;
    const flapL = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.16, 0.18), helmetMat); flapL.position.set(-0.22, 2.05, 0.02); flapL.castShadow = true;
    const flapR = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.16, 0.18), helmetMat); flapR.position.set( 0.22, 2.05, 0.02); flapR.castShadow = true;
    const plumeMat = lambert(0xc44545, true);
    const plume = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.40, 16), plumeMat);
    plume.position.y = 2.20 + v.capH + 0.14; plume.rotation.x = -0.3; plume.castShadow = true;
    g.add(cap, brim, flapL, flapR, plume);
  }
  if (v.accessory === 'beard') {
    const beard = new THREE.Mesh(new THREE.SphereGeometry(0.22, 32, 24), lambert(hair));
    beard.position.set(0, 1.78, 0.20); beard.scale.set(1.1, 1.0, 0.8); beard.castShadow = true;
    const moustache = new THREE.Mesh(new THREE.BoxGeometry(0.30, 0.06, 0.08), lambert(hair));
    moustache.position.set(0, 1.92, 0.27);
    g.add(beard, moustache);
  } else if (v.accessory === 'ears') {
    const earGeom = new THREE.ConeGeometry(0.06, 0.26, 8); const earMat = lambert(0xd2e6b4);
    const earL = new THREE.Mesh(earGeom, earMat); earL.position.set(-0.27, 2.10, 0); earL.rotation.z = Math.PI / 2;
    const earR = new THREE.Mesh(earGeom, earMat); earR.position.set( 0.27, 2.10, 0); earR.rotation.z = -Math.PI / 2;
    g.add(earL, earR);
  } else if (v.accessory === 'skull') {
    const jaw = new THREE.Mesh(new THREE.BoxGeometry(0.20, 0.06, 0.20), boneMat); jaw.position.set(0, 1.83, 0.06);
    g.add(jaw);
  }
  return g;
}

function buildCape(accentMat) {
  const g = new THREE.Group();
  const capeMat = new THREE.MeshLambertMaterial({ color: accentMat.color, side: THREE.DoubleSide });
  for (let i = 0; i < 7; i++) {
    const a = (i - 3) * 0.14;
    const seg = new THREE.Mesh(new THREE.PlaneGeometry(0.16, 1.00), capeMat);
    seg.position.set(Math.sin(a) * 0.34, 1.15, -0.42 - Math.cos(a) * 0.04);
    seg.rotation.y = a; seg.rotation.x = -0.06;
    g.add(seg);
  }
  const hood = new THREE.Mesh(new THREE.SphereGeometry(0.36, 18, 12, 0, Math.PI, 0, Math.PI / 2), capeMat);
  hood.position.set(0, 1.85, -0.10); hood.rotation.x = -0.30;
  g.add(hood);
  return g;
}

export function makeBody(team, raceKey, armorTier = 0, weaponTier = 0, klass = 'infantry', magicType = null, weaponStyle = null) {
  const v = RACE_VISUALS[raceKey] || RACE_VISUALS.humans;
  const liveryMat = lambert(team.livery);
  const accentMat = lambert(team.accent);
  const skinMat = lambert(v.skin);
  const helmetMat = lambert(v.helmet, true);
  const boneMat = lambert(0xeee5d0);
  const dark = lambert(0x2a2a2a);
  const beltMat = lambert(0x4a3a2a);
  const eyeMat = basic(0x101015);
  const g = new THREE.Group();
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.10, 0.13, 0.20, 24), raceKey === 'skeletons' ? boneMat : skinMat);
  neck.position.y = 1.80;
  g.add(buildLegs(accentMat, dark));
  g.add(buildTorso(team, liveryMat, accentMat, beltMat, skinMat));
  g.add(buildHead(v, raceKey, skinMat, boneMat, eyeMat));
  g.add(buildAccessory(v, helmetMat, skinMat, boneMat, raceKey, v.hair));
  g.add(buildRaceMarks(raceKey, liveryMat, boneMat));
  g.add(buildCape(accentMat));
  const tierArmor = buildArmorTier(team, raceKey, armorTier);
  g.add(tierArmor);
  const shieldArm = buildShieldArm(team, raceKey, liveryMat, skinMat, accentMat, weaponStyle);
  g.add(shieldArm);
  g.add(neck);
  const weaponArm = buildWeaponArm(team, raceKey, helmetMat, weaponTier, klass, magicType, weaponStyle);
  g.add(weaponArm);
  g.userData.weaponArm = weaponArm;
  g.userData.shieldArm = shieldArm;
  g.userData.twoHand = shieldArm.userData.twoHand;
  g.rotation.order = 'YXZ';
  const ks = klass === 'beast' ? 1.45 : klass === 'archer' ? 0.94 : 1.0;
  g.scale.set(v.width * ks, v.scaleY * ks, v.width * ks);
  return g;
}

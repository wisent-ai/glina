import * as THREE from 'three';

export function addBox(verts, colors, idx, color, cx, cy, cz, hx, hy, hz) {
  const v0 = verts.length / 3;
  const corners = [
    [cx - hx, cy - hy, cz - hz], [cx + hx, cy - hy, cz - hz],
    [cx + hx, cy + hy, cz - hz], [cx - hx, cy + hy, cz - hz],
    [cx - hx, cy - hy, cz + hz], [cx + hx, cy - hy, cz + hz],
    [cx + hx, cy + hy, cz + hz], [cx - hx, cy + hy, cz + hz],
  ];
  for (const [x, y, z] of corners) { verts.push(x, y, z); colors.push(color.r, color.g, color.b); }
  for (const [a, b, c, d] of [[0,1,2,3],[5,4,7,6],[1,5,6,2],[4,0,3,7],[3,2,6,7],[4,5,1,0]]) idx.push(v0+a, v0+b, v0+c, v0+a, v0+c, v0+d);
}

function stitchRings(idx, ringA, ringB, segments) {
  for (let i = 0; i < segments; i++) {
    const j = (i + 1) % segments;
    idx.push(ringA + i, ringA + j, ringB + i, ringB + i, ringA + j, ringB + j);
  }
}

/** The axe; `haftSegments` vertices go around each ring of its haft, as the caller states. */
export function buildAxe(verts, colors, idx, haftCol, bladeCol, haftSegments) {
  if (!Number.isInteger(haftSegments) || haftSegments <= 0) {
    throw new Error(`buildAxe needs haftSegments, the whole number of vertices around each haft ring; got ${JSON.stringify(haftSegments)}`);
  }
  const HX = 0.70, HY = 1.00, HZ = 0.72;
  const haftSeg = haftSegments;
  const haftRings = [];
  for (let i = 0; i <= 6; i++) {
    const t = i / 6;
    const cx = HX + (t - 0.5) * 0.08, cy = HY - 0.40 + t * 0.80, cz = HZ + (t - 0.5) * 0.30;
    const start = verts.length / 3;
    for (let j = 0; j < haftSeg; j++) {
      const a = (j / haftSeg) * Math.PI * 2;
      verts.push(cx + Math.cos(a) * 0.04, cy, cz + Math.sin(a) * 0.04);
      colors.push(haftCol.r, haftCol.g, haftCol.b);
    }
    haftRings.push(start);
  }
  for (let i = 0; i < haftRings.length - 1; i++) stitchRings(idx, haftRings[i], haftRings[i + 1], haftSeg);
  const HEAD_X = HX + 0.16, HEAD_Y = HY + 0.45, HEAD_Z = HZ + 0.28;
  const profile = [[-0.04,-0.10],[0.04,-0.18],[0.20,-0.20],[0.36,-0.14],[0.42,-0.04],[0.44,0.06],[0.40,0.16],[0.30,0.22],[0.16,0.22],[0.04,0.18],[-0.04,0.10]];
  const v0 = verts.length / 3;
  const T = 0.06;
  for (const [u, w] of profile) { verts.push(HEAD_X + u, HEAD_Y + w, HEAD_Z + T); colors.push(bladeCol.r, bladeCol.g, bladeCol.b); }
  for (const [u, w] of profile) { verts.push(HEAD_X + u, HEAD_Y + w, HEAD_Z - T); colors.push(bladeCol.r, bladeCol.g, bladeCol.b); }
  const N = profile.length;
  for (let i = 1; i < N - 1; i++) idx.push(v0, v0 + i, v0 + i + 1);
  for (let i = 1; i < N - 1; i++) idx.push(v0 + N, v0 + N + i + 1, v0 + N + i);
  for (let i = 0; i < N; i++) {
    const j = (i + 1) % N;
    idx.push(v0 + i, v0 + N + i, v0 + j, v0 + j, v0 + N + i, v0 + N + j);
  }
}

export function buildArmorDetails(verts, colors, idx, palette, opts) {
  const armorCol = new THREE.Color(opts.armor != null ? opts.armor : 0xc9a44a);
  const emblem = new THREE.Color(opts.emblem != null ? opts.emblem : 0xfff5b8);
  const buckle = new THREE.Color(0xc9a44a);
  const greave = new THREE.Color(0x9a9aa6);
  const trimGold = new THREE.Color(0xfff5b8);
  const rivet = new THREE.Color(0x404048);
  addBox(verts, colors, idx, emblem, 0.0, 1.42, 0.32, 0.04, 0.18, 0.02);
  addBox(verts, colors, idx, emblem, 0.0, 1.42, 0.32, 0.14, 0.04, 0.02);
  addBox(verts, colors, idx, buckle, 0.0, 1.06, 0.22, 0.10, 0.06, 0.02);
  addBox(verts, colors, idx, greave, -0.23, 0.20, 0.45, 0.10, 0.16, 0.03);
  addBox(verts, colors, idx, greave,  0.18, 0.20, -0.13, 0.10, 0.16, 0.03);
  addBox(verts, colors, idx, armorCol, -0.46, 1.72, 0.0, 0.10, 0.06, 0.16);
  addBox(verts, colors, idx, armorCol,  0.46, 1.72, 0.10, 0.10, 0.06, 0.16);
  addBox(verts, colors, idx, trimGold, 0.0, 1.66, 0.30, 0.40, 0.02, 0.02);
  for (const [hx, hy, hz] of [[-0.46, 0.86, 0.26], [0.58, 1.12, 0.62]]) {
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2;
      addBox(verts, colors, idx, rivet, hx + Math.cos(a) * 0.09, hy + Math.sin(a) * 0.04, hz + Math.sin(a) * 0.04, 0.018, 0.018, 0.018);
    }
  }
  addBox(verts, colors, idx, armorCol, -0.18, 0.36, 0.30, 0.14, 0.06, 0.02);
  addBox(verts, colors, idx, armorCol,  0.18, 0.36, -0.04, 0.14, 0.06, 0.02);
}

export function buildBodyDetails(verts, colors, idx, palette, opts) {
  const C = (h) => new THREE.Color(h);
  const helm = palette.helmet, boot = palette.boot, belt = palette.belt, gaunt = palette.gauntlet, armor = palette.armor;
  // Helmet — solid face plate covers eyes, leaving only narrow visor slot
  // Face plate (covers entire front of face, slightly forward)
  addBox(verts, colors, idx, helm, 0.0, 2.02, 0.245, 0.22, 0.12, 0.02);
  // Visor slot (dark horizontal cut where eyes peek through)
  addBox(verts, colors, idx, C(0x0a0a10), 0.0, 2.06, 0.260, 0.16, 0.02, 0.018);
  // Vertical brow ridge dividing the visor
  addBox(verts, colors, idx, helm, 0.0, 2.06, 0.275, 0.014, 0.10, 0.014);
  // Helmet crest (red plume strip front-to-back along top)
  addBox(verts, colors, idx, C(0x8a1a1a), 0.0, 2.34, 0.04, 0.025, 0.05, 0.22);
  // Cheek guards extending forward
  addBox(verts, colors, idx, helm, -0.22, 1.96, 0.14, 0.025, 0.10, 0.10);
  addBox(verts, colors, idx, helm,  0.22, 1.96, 0.14, 0.025, 0.10, 0.10);
  // Helmet skirt (neck guard ring just below helmet)
  addBox(verts, colors, idx, helm, 0.0, 1.88, 0.02, 0.245, 0.022, 0.245);
  // Boots
  addBox(verts, colors, idx, boot, -0.23, 0.04, 0.56, 0.10, 0.06, 0.10);
  addBox(verts, colors, idx, boot,  0.18, 0.04, -0.20, 0.10, 0.06, 0.10);
  addBox(verts, colors, idx, C(0xc9a44a), -0.22, 0.16, 0.40, 0.10, 0.025, 0.08);
  addBox(verts, colors, idx, C(0xc9a44a),  0.18, 0.16, -0.16, 0.10, 0.025, 0.08);
  // Belt + buckle bands
  addBox(verts, colors, idx, belt, 0.0, 1.04, 0.20, 0.32, 0.04, 0.04);
  addBox(verts, colors, idx, belt, -0.30, 1.04, 0.10, 0.04, 0.04, 0.16);
  addBox(verts, colors, idx, belt,  0.30, 1.04, 0.10, 0.04, 0.04, 0.16);
  // Knee plates + bracer
  addBox(verts, colors, idx, helm, -0.22, 0.44, 0.32, 0.10, 0.06, 0.04);
  addBox(verts, colors, idx, helm,  0.18, 0.44, -0.12, 0.10, 0.06, 0.04);
  addBox(verts, colors, idx, gaunt, -0.49, 1.10, 0.16, 0.06, 0.04, 0.06);
  // Tabard
  const tabardC = C(opts.tabard != null ? opts.tabard : (opts.cape != null ? opts.cape : 0x8a1a1a));
  addBox(verts, colors, idx, tabardC, 0.0, 0.84, 0.24, 0.16, 0.20, 0.02);
  addBox(verts, colors, idx, C(0xfff5b8), 0.0, 0.66, 0.245, 0.18, 0.014, 0.018);
  // Scabbard + hilt
  addBox(verts, colors, idx, C(0x3a2a1a), -0.34, 0.70, -0.10, 0.04, 0.34, 0.05);
  addBox(verts, colors, idx, C(0xc9a44a), -0.34, 0.94, -0.10, 0.06, 0.04, 0.06);
  addBox(verts, colors, idx, C(0x3a2a1a), -0.34, 1.04, -0.10, 0.025, 0.10, 0.025);
  addBox(verts, colors, idx, C(0xc9a44a), -0.34, 1.16, -0.10, 0.10, 0.025, 0.04);
  addBox(verts, colors, idx, C(0xfff5b8), -0.34, 1.21, -0.10, 0.030, 0.030, 0.030);
  // Pauldron rim + cape clasps
  addBox(verts, colors, idx, C(0xfff5b8), -0.58, 1.66, 0.02, 0.14, 0.012, 0.18);
  addBox(verts, colors, idx, C(0xfff5b8),  0.58, 1.66, 0.12, 0.14, 0.012, 0.18);
  addBox(verts, colors, idx, C(0xfff5b8), -0.36, 1.78, -0.14, 0.05, 0.05, 0.030);
  addBox(verts, colors, idx, C(0xfff5b8),  0.36, 1.78, -0.14, 0.05, 0.05, 0.030);
  // Chest plate detail
  const abShade = new THREE.Color(armor.r * 0.85, armor.g * 0.85, armor.b * 0.85);
  addBox(verts, colors, idx, abShade, 0.0, 1.18, 0.31, 0.20, 0.025, 0.02);
  addBox(verts, colors, idx, abShade, 0.0, 1.13, 0.31, 0.18, 0.025, 0.02);
  addBox(verts, colors, idx, new THREE.Color(armor.r * 0.7, armor.g * 0.7, armor.b * 0.7), 0.0, 1.45, 0.33, 0.012, 0.20, 0.014);
  const pec = new THREE.Color(armor.r * 1.1, armor.g * 1.1, armor.b * 1.1);
  addBox(verts, colors, idx, pec, -0.16, 1.50, 0.32, 0.10, 0.10, 0.020);
  addBox(verts, colors, idx, pec,  0.16, 1.50, 0.32, 0.10, 0.10, 0.020);
  // Fists + knuckles + grip + brows
  addBox(verts, colors, idx, gaunt, -0.50, 0.70, 0.36, 0.10, 0.10, 0.10);
  addBox(verts, colors, idx, gaunt,  0.70, 0.94, 0.74, 0.10, 0.10, 0.10);
  for (const [hx, hy, hz] of [[-0.50, 0.70, 0.36], [0.70, 0.94, 0.74]]) for (let i = 0; i < 4; i++) addBox(verts, colors, idx, C(0x404048), hx, hy + 0.06, hz + 0.06 - i * 0.030, 0.08, 0.014, 0.010);
  addBox(verts, colors, idx, C(0x33231a), 0.70, 1.00, 0.72, 0.07, 0.12, 0.07);
}

export function buildExtraDetails(verts, colors, idx, palette, opts) {
  const C = (h) => new THREE.Color(h);
  const helm = palette.helmet;
  // Pauldron spikes
  if (!opts.noSpikes) {
    const spikeCol = new THREE.Color(helm.r * 0.85, helm.g * 0.85, helm.b * 0.85);
    addBox(verts, colors, idx, spikeCol, -0.62, 1.78, 0.05, 0.04, 0.10, 0.04);
    addBox(verts, colors, idx, spikeCol, -0.55, 1.82, 0.02, 0.03, 0.06, 0.03);
    addBox(verts, colors, idx, spikeCol,  0.62, 1.78, 0.15, 0.04, 0.10, 0.04);
    addBox(verts, colors, idx, spikeCol,  0.55, 1.82, 0.12, 0.03, 0.06, 0.03);
  }
  // Fur trim
  if (opts.fur !== false) {
    const fur = C(opts.furColor != null ? opts.furColor : 0xe8e0d0);
    for (let i = 0; i < 7; i++) {
      const a = -1.0 + (i / 6) * 2.0;
      addBox(verts, colors, idx, fur, a * 0.40, 1.74, 0.16, 0.06, 0.05, 0.08);
    }
  }
  // Cape iconic stripes
  addBox(verts, colors, idx, C(0xfff5b8), -0.10, 1.30, -0.36, 0.020, 0.50, 0.014);
  addBox(verts, colors, idx, C(0xfff5b8),  0.10, 1.30, -0.36, 0.020, 0.50, 0.014);
  // Axe pommel cap
  addBox(verts, colors, idx, C(0xc9a44a), 0.65, 0.62, 0.66, 0.05, 0.05, 0.05);
  // Axe head decorative band — gold ring around where blade meets haft
  addBox(verts, colors, idx, C(0xc9a44a), 0.86, 1.45, 1.00, 0.05, 0.04, 0.10);
  // Axe head spike on top (counter-spike opposite the blade)
  addBox(verts, colors, idx, new THREE.Color(palette.gauntlet.r * 0.7, palette.gauntlet.g * 0.7, palette.gauntlet.b * 0.7), 0.74, 1.66, 1.00, 0.025, 0.10, 0.025);
  // Cape lower edge — wider tail flare
  const capeC = C(opts.cape != null ? opts.cape : 0x8a1a1a);
  addBox(verts, colors, idx, capeC, 0.0, 0.78, -0.42, 0.36, 0.04, 0.04);
  // Tabard bottom serration (V-cut suggestion via two angled boxes)
  addBox(verts, colors, idx, capeC, -0.06, 0.62, 0.245, 0.04, 0.04, 0.018);
  addBox(verts, colors, idx, capeC,  0.06, 0.62, 0.245, 0.04, 0.04, 0.018);
}

export function buildCape(verts, colors, idx, opts) {
  const c = new THREE.Color(opts.cape != null ? opts.cape : 0x8a1a1a);
  const c0 = verts.length / 3;
  const v = [[-0.30,1.78,-0.18],[0.30,1.78,-0.18],[-0.36,1.40,-0.34],[0.36,1.40,-0.34],[-0.32,0.80,-0.42],[0.32,0.80,-0.42]];
  for (const [x, y, z] of v) { verts.push(x, y, z); colors.push(c.r, c.g, c.b); }
  idx.push(c0+0, c0+2, c0+1, c0+1, c0+2, c0+3, c0+2, c0+4, c0+3, c0+3, c0+4, c0+5);
  for (const [x, y, z] of v) { verts.push(x, y, z + 0.02); colors.push(c.r * 0.7, c.g * 0.7, c.b * 0.7); }
  idx.push(c0+6, c0+7, c0+8, c0+7, c0+9, c0+8, c0+8, c0+9, c0+10, c0+9, c0+11, c0+10);
}

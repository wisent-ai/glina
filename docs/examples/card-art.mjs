// Generate one card-art SVG with the runtime-art half of Glina.
// src/art/card-art.js has no dependencies — no THREE.js, no network, no vault.
// Usage: node docs/examples/card-art.mjs <out.svg>
import { writeFile } from 'node:fs/promises';
import { cardArtSvg } from '../../src/art/card-art.js';

const [, , out] = process.argv;
if (!out) {
  throw new Error('Usage: node docs/examples/card-art.mjs <out.svg> — name the file the SVG is written to');
}
const svg = cardArtSvg({ id: 'd_forge', tier: 'rare', kind: 'building' }, 'dwarves');
await writeFile(out, svg);
console.log(`wrote ${out} (${svg.length} characters)`);

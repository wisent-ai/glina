// Generate one card-art SVG with the runtime-art half of Glina.
// card-art.js has no dependencies — no THREE.js, no network, no vault.
// Usage: node docs/examples/card-art.mjs [out.svg]
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const { cardArtSvg } = await import(`${root}/src/card-art.js`);

const svg = cardArtSvg({ id: 'd_forge', tier: 'rare', kind: 'building' }, 'dwarves');
const out = process.argv[2] ?? `${process.env.TMPDIR ?? '/tmp'}/glina-card.svg`;
await writeFile(out, svg);
console.log(`wrote ${out} (${svg.length} bytes)`);

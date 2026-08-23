// Tests for the asset verification gate + the package's own MCP server.
// Synthetic GLBs are built in-memory — no real models needed.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import readline from 'node:readline';

import {
  parseGlb,
  glbStats,
  verifyGlbStructure,
  verifyAsset,
  VerifyError,
  DEFAULT_THRESHOLDS,
} from '../pipeline/verify.js';
import { runTextToGameJob, PipelineError } from '../pipeline/text2game.js';

/** Build a minimal valid GLB buffer from a glTF JSON object. */
export function makeGlb(json) {
  let jsonStr = JSON.stringify(json);
  while (jsonStr.length % 4 !== 0) jsonStr += ' ';
  const jsonChunk = Buffer.from(jsonStr, 'utf8');
  const header = Buffer.alloc(12);
  header.write('glTF', 0, 'ascii');
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + jsonChunk.length, 8);
  const chunkHeader = Buffer.alloc(8);
  chunkHeader.writeUInt32LE(jsonChunk.length, 0);
  chunkHeader.write('JSON', 4, 'ascii');
  return Buffer.concat([header, chunkHeader, jsonChunk]);
}

function modelJson({ triangles = 6000, materials = 1, animations = 0, meshes = 1 } = {}) {
  return {
    asset: { version: '2.0' },
    accessors: [{ count: triangles * 3 }],
    meshes:
      meshes === 0 ? [] : [{ primitives: [{ attributes: { POSITION: 0 }, mode: 4 }] }],
    materials: Array.from({ length: materials }, () => ({})),
    animations: Array.from({ length: animations }, () => ({})),
  };
}

async function tempGlb(json) {
  const dir = await mkdtemp(join(tmpdir(), 'gac-verify-'));
  const path = join(dir, 'model.glb');
  await writeFile(path, makeGlb(json));
  return path;
}

test('parseGlb rejects bad magic and truncations', async () => {
  assert.throws(() => parseGlb(Buffer.from('NOPE')), VerifyError);
  assert.throws(() => parseGlb(Buffer.alloc(2)), VerifyError);
  const badChunk = makeGlb(modelJson());
  badChunk.write('NOPE', 16, 'ascii');
  assert.throws(() => parseGlb(badChunk), /not JSON/);
});

test('glbStats counts triangles from POSITION accessors', () => {
  const stats = glbStats(modelJson({ triangles: 6000, materials: 2, animations: 3 }));
  assert.equal(stats.triangles, 6000);
  assert.equal(stats.materials, 2);
  assert.equal(stats.animations, 3);
  assert.equal(stats.meshes, 1);
  assert.equal(stats.primitives, 1);
});

test('verifyGlbStructure: valid model passes', async () => {
  const path = await tempGlb(modelJson({ triangles: 6000 }));
  const report = await verifyGlbStructure(path);
  assert.equal(report.ok, true);
  assert.deepEqual(report.errors, []);
  assert.equal(report.stats.triangles, 6000);
});

test('verifyGlbStructure: over-budget, missing materials, empty mesh fail', async () => {
  const over = await verifyGlbStructure(await tempGlb(modelJson({ triangles: 99999 })));
  assert.equal(over.ok, false);
  assert.ok(over.errors.some((e) => e.includes('triangle budget')));

  const noMats = await verifyGlbStructure(await tempGlb(modelJson({ materials: 0 })));
  assert.equal(noMats.ok, false);
  assert.ok(noMats.errors.includes('no materials'));

  const empty = await verifyGlbStructure(await tempGlb(modelJson({ meshes: 0, triangles: 0 })));
  assert.equal(empty.ok, false);
  assert.ok(empty.errors.includes('no meshes'));
});

test('verifyGlbStructure: thresholds are configurable', async () => {
  const path = await tempGlb(modelJson({ triangles: 99999 }));
  const report = await verifyGlbStructure(path, { triTarget: 200000 });
  assert.equal(report.ok, true);
  const strict = await verifyGlbStructure(await tempGlb(modelJson({ animations: 0 })), {
    requireAnimations: true,
  });
  assert.equal(strict.ok, false);
  assert.ok(strict.errors.includes('no animation clips'));
});

test('verifyAsset: throwOnFail raises with the error list', async () => {
  const path = await tempGlb(modelJson({ triangles: 99999, materials: 0 }));
  await assert.rejects(
    verifyAsset(path, { verify: { throwOnFail: true } }),
    (error) => {
      assert.ok(error instanceof VerifyError);
      assert.ok(error.errors.length >= 2);
      return true;
    },
  );
});

test('text2game fails the job when verification fails', async () => {
  const config = {
    credentials: { username: 'u', password: 'p' },
    studio: {
      loginUrl: 'https://x/l',
      generateUrl: 'https://x/s',
      selectors: {
        loginUser: '#u',
        loginPassword: '#p',
        loginSubmit: '#g',
        promptInput: '#pr',
        generateSubmit: '#ge',
      },
      artifact: { pollExpression: 'p()', timeoutMs: 10, intervalMs: 1 },
    },
    // verify left enabled (default)
  };
  const fakePage = {
    goto: async () => {},
    fill: async () => {},
    click: async () => {},
    evaluate: async () => 'https://cdn.x/m.glb',
  };
  const dir = await mkdtemp(join(tmpdir(), 'gac-t2gv-'));
  await assert.rejects(
    runTextToGameJob(
      { prompt: 'x', outDir: dir, filename: 'm.glb' },
      config,
      {
        sessionFactory: async () => ({ newPage: async () => fakePage, close: async () => {} }),
        download: async () => Buffer.from('NOT-A-GLB'),
      },
    ),
    (error) => {
      assert.ok(error instanceof PipelineError);
      assert.equal(error.step, 'verify');
      return true;
    },
  );
});

// ---- the package's own MCP server ----

function mcpRequest(proc, message) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('MCP reply timeout')), 30_000);
    const rl = readline.createInterface({ input: proc.stdout });
    rl.on('line', (line) => {
      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        return;
      }
      if (msg.id === message.id) {
        clearTimeout(timer);
        rl.close();
        resolve(msg);
      }
    });
    proc.stdin.write(`${JSON.stringify(message)}\n`);
  });
}

test('pipeline/mcp.js serves initialize, tools/list and glina_verify_asset', async () => {
  const serverPath = new URL('../pipeline/mcp.js', import.meta.url).pathname;
  const proc = spawn('node', [serverPath], { stdio: ['pipe', 'pipe', 'inherit'] });
  try {
    const init = await mcpRequest(proc, { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });
    assert.equal(init.result.serverInfo.name, 'glina');

    const list = await mcpRequest(proc, { jsonrpc: '2.0', id: 2, method: 'tools/list' });
    const names = list.result.tools.map((t) => t.name);
    assert.deepEqual(names.sort(), [
      'glina_blender_health',
      'glina_check_config',
      'glina_create_asset',
      'glina_sculpt',
      'glina_verify_asset',
      'glina_weles_tools',
    ]);

    const glbPath = await tempGlb(modelJson({ triangles: 6000 }));
    const call = await mcpRequest(proc, {
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: { name: 'glina_verify_asset', arguments: { path: glbPath } },
    });
    const report = JSON.parse(call.result.content[0].text);
    assert.equal(report.ok, true);
    assert.equal(report.stats.triangles, 6000);
  } finally {
    proc.kill('SIGTERM');
  }
});

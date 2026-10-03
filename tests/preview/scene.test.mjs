import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { test } from 'node:test';

const root = resolve(import.meta.dirname, '../..');
const build = join(root, 'build', 'tests');

function glina(data, ...args) {
  return spawnSync(process.execPath, ['pipeline/cli.js', ...args], {
    cwd: root,
    env: { ...process.env, XDG_DATA_HOME: data },
    encoding: 'utf8',
  });
}

test('CLI renders a real GLB in a Blender scene and reports a missing input', async () => {
  await mkdir(build, { recursive: true });
  const data = await mkdtemp(join(build, 'scene-'));
  try {
    const missing = glina(data, 'preview-scene');
    assert.equal(missing.status, 2);
    assert.match(missing.stderr, /requires a .glb path or an active imported asset/);

    const missingConfig = glina(data, 'preview-scene', 'assets/models/smok.glb', '--config', join(data, 'absent.json'));
    assert.equal(missingConfig.status, 1);
    assert.match(missingConfig.stderr, /absent\.json.*ENOENT|ENOENT.*absent\.json/);

    const output = join(data, 'scene.png');
    const result = glina(data, 'preview-scene', 'assets/models/smok.glb', '--out', output);
    assert.equal(result.status, 0, `Blender MCP scene render failed:\n${result.stderr}\n${result.stdout}`);
    const report = JSON.parse(result.stdout);
    assert.equal(report.outPath, output);
    assert.equal(report.source, 'assets/models/smok.glb');
    assert.equal(report.scene, 'neutral-ground');
    const image = await readFile(output);
    assert.equal(image.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
    assert.equal((await stat(output)).size, report.bytes);

    const defaultResult = glina(data, 'preview-scene', 'assets/models/smok.glb');
    assert.equal(defaultResult.status, 0, `Default scene render failed:\n${defaultResult.stderr}\n${defaultResult.stdout}`);
    const defaultPath = join(data, 'glina', 'previews', 'smok-scene.png');
    assert.equal(JSON.parse(defaultResult.stdout).outPath, defaultPath);
    assert.equal((await readFile(defaultPath)).subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  } finally {
    await rm(data, { recursive: true, force: true });
  }
});

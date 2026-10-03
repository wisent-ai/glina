import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, stat } from 'node:fs/promises';
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

function successful(data, ...args) {
  const result = glina(data, ...args);
  assert.equal(result.status, 0, `${args.join(' ')}:\n${result.stderr}\n${result.stdout}`);
  return JSON.parse(result.stdout);
}

test('declared biped and generic motion produce verified animated GLBs through Blender', async () => {
  await mkdir(build, { recursive: true });
  const directory = await mkdtemp(join(build, 'animation-'));
  try {
    assert.ok(successful(directory, 'presets', 'list').names.includes('motion'));
    assert.ok(successful(directory, 'showcases', 'list').names.includes('biped'));
    const unknown = glina(directory, 'showcase', 'unlisted');
    assert.equal(unknown.status, 2);
    assert.match(unknown.stderr, /available: biped, dragon/);

    const biped = join(directory, 'glina', 'outputs', 'biped-showcase.glb');
    const showcase = successful(directory, 'showcase', 'biped');
    assert.equal(showcase.outputPath, biped);
    assert.equal(showcase.verification.ok, true);
    assert.ok((await stat(biped)).size > 0);

    const animated = join(directory, 'motion.glb');
    const motion = successful(directory, 'animate', biped, '--preset', 'motion', '--out', animated);
    assert.equal(motion.verification.ok, true);
    assert.ok(motion.verification.stats.movingAnimationChannels > 0);
    assert.ok((await stat(animated)).size > 0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

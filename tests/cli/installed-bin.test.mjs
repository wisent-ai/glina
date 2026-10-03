import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, symlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { test } from 'node:test';

const root = resolve(import.meta.dirname, '../..');
const build = join(root, 'build', 'tests');

test('the installed executable symlink runs commands and help without side effects', async () => {
  await mkdir(build, { recursive: true });
  const data = await mkdtemp(join(build, 'installed-bin-'));
  const binDir = join(data, 'bin');
  const bin = join(binDir, 'glina');
  try {
    await mkdir(binDir);
    await symlink(join(root, 'pipeline', 'cli.js'), bin);
    const run = (...args) => spawnSync(bin, args, {
      cwd: root,
      env: { ...process.env, XDG_DATA_HOME: join(data, 'home') },
      encoding: 'utf8',
    });

    const help = run('--help');
    assert.equal(help.status, 0, help.stderr);
    assert.match(help.stdout, /^usage: glina <command>/);
    assert.match(help.stdout, /preview-scene/);

    const commandHelp = run('import', '--help');
    assert.equal(commandHelp.status, 0, commandHelp.stderr);
    assert.match(commandHelp.stdout, /^usage: glina import <file\.glb>/);
    assert.match(commandHelp.stdout, /--variant-of base-id/);

    const workspace = run('workspace');
    assert.equal(workspace.status, 0, workspace.stderr);
    assert.deepEqual(JSON.parse(workspace.stdout), {
      schema: 'glina.workspace.v2', activeAsset: null, assets: [],
    });

    const unknown = run('not-a-command');
    assert.equal(unknown.status, 2);
    assert.match(unknown.stderr, /unknown command: not-a-command/);
  } finally {
    await rm(data, { recursive: true, force: true });
  }
});

// The active asset is the default input of verify, animate and preview. A
// workspace whose active asset is gone says it is missing; one whose asset
// cannot be inspected says why, instead of calling it missing. Both run the
// real CLI against a workspace under this checkout's ignored build directory.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { constants } from 'node:fs';
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';

const root = resolve(import.meta.dirname, '../..');
const build = join(root, 'build', 'tests');
/** The owner may list the directory but not search it: stat inside fails with EACCES. */
const NO_SEARCH = constants.S_IRUSR | constants.S_IWUSR;
const OWNER_ALL = constants.S_IRWXU;

function glina(data, ...args) {
  return spawnSync(process.execPath, ['pipeline/cli.js', ...args, '--config', join(data, 'pipeline.config.json')], {
    cwd: root,
    env: { ...process.env, XDG_DATA_HOME: data },
    encoding: 'utf8',
  });
}

test('verify names an active asset it cannot inspect apart from a missing one', async () => {
  await mkdir(build, { recursive: true });
  const data = await mkdtemp(join(build, 'active-'));
  await writeFile(join(data, 'pipeline.config.json'), '{}\n');
  let locked = null;
  try {
    const imported = glina(data, 'import', 'assets/models/smok.glb', '--name', 'creature');
    assert.ok(!imported.status, imported.stderr);
    const assetPath = JSON.parse(imported.stdout).path;

    locked = dirname(assetPath);
    await chmod(locked, NO_SEARCH);
    const unreadable = glina(data, 'verify');
    assert.ok(unreadable.status, 'verify passed on an asset it cannot inspect');
    assert.match(unreadable.stderr, /active Glina asset .* cannot be inspected: .*EACCES/);
    assert.doesNotMatch(unreadable.stderr, /is missing/);
    await chmod(locked, OWNER_ALL);
    locked = null;

    await rm(assetPath);
    const missing = glina(data, 'verify');
    assert.ok(missing.status, 'verify passed with no active asset file');
    assert.match(missing.stderr, /active Glina asset is missing/);
  } finally {
    if (locked) await chmod(locked, OWNER_ALL);
    await rm(data, { recursive: true, force: true });
  }
});

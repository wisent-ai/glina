// The active asset is the default input of verify, animate and preview. A
// workspace whose active asset is gone says it is missing; one whose asset
// cannot be inspected says why, instead of calling it missing. Both run the
// real CLI against a workspace under this checkout's ignored build directory.

import assert from 'node:assert/strict';
import { constants } from 'node:fs';
import { chmod, rm } from 'node:fs/promises';
import { dirname } from 'node:path';
import { test } from 'node:test';
import { journey } from '../support/journey.mjs';

/** The owner may list the directory but not search it: stat inside fails with EACCES. */
const NO_SEARCH = constants.S_IRUSR | constants.S_IWUSR;
const OWNER_ALL = constants.S_IRWXU;

test('verify names an active asset it cannot inspect apart from a missing one', async () => {
  const run = await journey(import.meta.url, 'active');
  let locked = null;
  try {
    const assetPath = run.glina('import', 'assets/models/smok.glb', '--name', 'creature').path;

    locked = dirname(assetPath);
    await chmod(locked, NO_SEARCH);
    const unreadable = run.refused('asset behind an unsearchable directory', 'verify');
    assert.match(unreadable.stderr, /active Glina asset .* cannot be inspected: .*EACCES/);
    assert.doesNotMatch(unreadable.stderr, /is missing/);
    await chmod(locked, OWNER_ALL);
    locked = null;

    await rm(assetPath);
    const missing = run.refused('asset file removed', 'verify');
    assert.match(missing.stderr, /active Glina asset is missing/);
  } finally {
    if (locked) await chmod(locked, OWNER_ALL);
    await rm(run.data, { recursive: true, force: true });
  }
  await run.passed();
});

// Onboarding starts over only when there is no progress file. A progress file
// that is not JSON, or that cannot be read, refuses the run naming the file
// and is left exactly as it was, instead of being read as a first run and
// overwritten.

import assert from 'node:assert/strict';
import { constants } from 'node:fs';
import { chmod, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import { journey } from '../support/journey.mjs';

test('onboarding starts on a missing progress file and refuses one it cannot read', async () => {
  const run = await journey(import.meta.url, 'onboarding');
  const file = join(run.data, 'glina', 'onboarding.json');
  let locked = false;
  try {
    run.runs('onboarding');
    const started = JSON.parse(await readFile(file, 'utf8'));
    assert.equal(started.status, 'in_progress');

    await writeFile(file, '{ not json');
    const corrupt = run.refused('progress file not JSON', 'onboarding');
    assert.match(corrupt.stderr, /onboarding progress .*onboarding\.json is not JSON/);
    assert.equal(await readFile(file, 'utf8'), '{ not json');

    await writeFile(file, `${JSON.stringify(started)}\n`);
    await chmod(file, constants.S_IWUSR);
    locked = true;
    const unreadable = run.refused('progress file unreadable', 'onboarding');
    assert.match(unreadable.stderr, /onboarding progress .*onboarding\.json cannot be read: .*EACCES/);
    await chmod(file, constants.S_IRUSR | constants.S_IWUSR);
    locked = false;
    assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), started);
  } finally {
    if (locked) await chmod(file, constants.S_IRUSR | constants.S_IWUSR);
    await rm(run.data, { recursive: true, force: true });
  }
  await run.passed();
});

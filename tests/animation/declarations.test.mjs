// Showcases and animation presets are declared data, not one asset's code:
// the real CLI lists the shipped declarations, adds one from a file into the
// user's data, refuses a duplicate, a file without actions and the removal of
// a shipped one, and removes the user's own. A legacy declaration beside the
// package moves into user data without overwriting different bytes.

import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import { migrateLegacy } from '../../pipeline/rigs/declared.js';
import { journey, root } from '../support/journey.mjs';

const build = join(root, 'build', 'tests');

// The exit glina gives a usage error, the shell convention for misuse that
// https://tldp.org/LDP/abs/html/exitcodes.html lists and glina's README uses
// for an undeclared name.
const USAGE_ERROR = 2;

test('CLI keeps custom declarations in user data and protects shipped declarations', async () => {
  const run = await journey(import.meta.url, 'declarations');
  try {
    for (const [command, builtIn, custom] of [
      ['presets', 'motion', 'my-motion'],
      ['showcases', 'biped', 'my-biped'],
    ]) {
      const source = join('assets', command, `${builtIn}.json`);
      assert.ok(run.glina(command, 'list').names.includes(builtIn));
      const protectedRemoval = run.refused(`${command}: remove shipped ${builtIn}`, command, 'remove', builtIn);
      assert.equal(protectedRemoval.status, USAGE_ERROR);
      assert.match(protectedRemoval.stderr, /is built in and cannot be removed/);

      const added = run.glina(command, 'add', custom, source);
      assert.equal(added.outcome, 'added');
      assert.equal(added.path, join(run.data, 'glina', command, `${custom}.json`));
      assert.deepEqual(JSON.parse(await readFile(added.path, 'utf8')),
        JSON.parse(await readFile(join(root, source), 'utf8')));
      assert.ok(run.glina(command, 'list').names.includes(custom));

      const duplicate = run.refused(`${command}: add ${custom} twice`, command, 'add', custom, source);
      assert.equal(duplicate.status, USAGE_ERROR);
      assert.match(duplicate.stderr, /is already declared/);
      const invalid = run.refused(`${command}: add a file without actions`, command, 'add', `bad-${custom}`, 'package.json');
      assert.equal(invalid.status, USAGE_ERROR);
      assert.match(invalid.stderr, /has no actions list/);

      const removed = run.glina(command, 'remove', custom);
      assert.equal(removed.outcome, 'removed');
      assert.ok(!existsSync(added.path));
      const remaining = run.glina(command, 'list').names;
      assert.ok(!remaining.includes(custom));
      assert.ok(remaining.includes(builtIn));
      const gone = run.refused(`${command}: remove ${custom} again`, command, 'remove', custom);
      assert.equal(gone.status, USAGE_ERROR);
    }
  } finally {
    await rm(run.data, { recursive: true, force: true });
  }
  await run.passed();
});

test('legacy package declarations move without overwriting user data', async () => {
  await mkdir(build, { recursive: true });
  const fixture = await mkdtemp(join(build, 'legacy-declarations-'));
  const priorHome = process.env.XDG_DATA_HOME;
  process.env.XDG_DATA_HOME = join(fixture, 'home');
  try {
    const oldDirectory = join(fixture, 'package', 'assets', 'showcases');
    await mkdir(oldDirectory, { recursive: true });
    const declaration = await readFile(join(root, 'assets', 'showcases', 'biped.json'));
    const legacy = join(oldDirectory, 'custom.json');
    const shipped = join(oldDirectory, 'biped.json');
    const target = join(fixture, 'home', 'glina', 'showcases', 'custom.json');
    await writeFile(legacy, declaration);
    await writeFile(shipped, declaration);
    await migrateLegacy('showcase', join(fixture, 'package'));
    assert.ok(!existsSync(legacy));
    assert.deepEqual(await readFile(target), declaration);
    assert.ok(existsSync(shipped));

    await writeFile(legacy, declaration);
    await writeFile(target, '{"different":true}');
    await assert.rejects(migrateLegacy('showcase', join(fixture, 'package')), /already holds different bytes/);
    assert.ok(existsSync(legacy));
    assert.equal((await readFile(target, 'utf8')), '{"different":true}');
  } finally {
    if (priorHome === undefined) delete process.env.XDG_DATA_HOME;
    else process.env.XDG_DATA_HOME = priorHome;
    await rm(fixture, { recursive: true, force: true });
  }
});

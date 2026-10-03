import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
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

function success(data, ...args) {
  const result = glina(data, ...args);
  assert.equal(result.status, 0, `${args.join(' ')}: ${result.stderr}\n${result.stdout}`);
  return JSON.parse(result.stdout);
}

test('CLI keeps custom declarations in user data and protects shipped declarations', async () => {
  await mkdir(build, { recursive: true });
  const data = await mkdtemp(join(build, 'declarations-'));
  try {
    for (const [command, kind, builtIn, custom] of [
      ['presets', 'preset', 'motion', 'my-motion'],
      ['showcases', 'showcase', 'biped', 'my-biped'],
    ]) {
      const source = join('assets', command, `${builtIn}.json`);
      assert.ok(success(data, command, 'list').names.includes(builtIn));
      const protectedRemoval = glina(data, command, 'remove', builtIn);
      assert.equal(protectedRemoval.status, 2);
      assert.match(protectedRemoval.stderr, /is built in and cannot be removed/);

      const added = success(data, command, 'add', custom, source);
      assert.equal(added.outcome, 'added');
      assert.equal(added.path, join(data, 'glina', command, `${custom}.json`));
      assert.deepEqual(JSON.parse(await readFile(added.path, 'utf8')),
        JSON.parse(await readFile(join(root, source), 'utf8')));
      assert.ok(success(data, command, 'list').names.includes(custom));

      const duplicate = glina(data, command, 'add', custom, source);
      assert.equal(duplicate.status, 2);
      assert.match(duplicate.stderr, /is already declared/);
      const invalid = glina(data, command, 'add', `bad-${custom}`, 'package.json');
      assert.equal(invalid.status, 2);
      assert.match(invalid.stderr, /has no actions list/);

      const removed = success(data, command, 'remove', custom);
      assert.equal(removed.outcome, 'removed');
      assert.ok(!existsSync(added.path));
      assert.ok(!success(data, command, 'list').names.includes(custom));
      assert.ok(success(data, command, 'list').names.includes(builtIn));
      assert.equal(glina(data, command, 'remove', custom).status, 2);
    }
  } finally {
    await rm(data, { recursive: true, force: true });
  }
});

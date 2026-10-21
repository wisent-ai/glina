#!/usr/bin/env node
// Qualifies one committed revision of glina by its journeys, for a defect
// register's revision-bound completion probe:
//
//   node tests/qualify.mjs <revision> <journey>...
//
// where a journey is a path below tests/ without .test.mjs (cli/shape,
// config/check, workspace/active, ...). The revision's committed tree is
// exported with git archive into build/qualify/<commit> of this checkout,
// and each journey runs there with node --test, so neither another
// session's uncommitted edit nor a later test reads in; the export uses this
// checkout's node_modules, as glina declares no lockfile. Standard output
// lists the journeys that failed, one per line, and is empty when every one
// passed; the journeys' own output goes to standard error. A revision git
// cannot export ends the run as failed.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, symlinkSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
// argv holds node and this script before the caller's words.
const [, , revision, ...journeys] = process.argv;
assert.ok(revision && journeys.length, 'usage: node tests/qualify.mjs <revision> <journey>...');
// A run succeeded when it started, no signal ended it and it exited zero
// (https://nodejs.org/api/child_process.html#child_processspawnsynccommand-args-options).
const succeeded = (run) => !run.error && run.signal === null && !run.status;

const resolved = spawnSync('git', ['-C', root, 'rev-parse', '--verify', `${revision}^{commit}`], { encoding: 'utf8' });
assert.ok(succeeded(resolved), `git cannot name ${revision} as a commit: ${resolved.stderr}`);
const commit = resolved.stdout.trim();
const exported = join(root, 'build', 'qualify', commit);
rmSync(exported, { recursive: true, force: true });
mkdirSync(exported, { recursive: true });
const archive = spawnSync('git', ['-C', root, 'archive', '--format=tar', commit], { maxBuffer: Infinity });
assert.ok(succeeded(archive), `git archive ${commit} failed: ${archive.stderr}`);
const unpacked = spawnSync('tar', ['-x', '-C', exported], { input: archive.stdout });
assert.ok(succeeded(unpacked), `tar could not unpack ${commit}: ${unpacked.stderr}`);
const modules = join(root, 'node_modules');
if (existsSync(modules)) symlinkSync(modules, join(exported, 'node_modules'));

for (const name of journeys) {
  const path = join(exported, 'tests', `${name}.test.mjs`);
  if (!existsSync(path)) {
    console.log(`${name}: no such journey at ${commit}`);
    continue;
  }
  const ran = spawnSync(process.execPath, ['--test', path], {
    cwd: exported,
    stdio: ['ignore', process.stderr, process.stderr],
  });
  if (!succeeded(ran)) console.log(`${name}: failed (${ran.status ?? ran.signal})`);
}

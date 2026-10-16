// The active asset is the default input of verify, animate and preview. A
// workspace whose active asset is gone says it is missing; one whose asset
// cannot be inspected says why, instead of calling it missing. Both run the
// real CLI against a workspace under this checkout's ignored build directory.
//
// A defect register that measures a repair by this journey names the defect
// and its criterion in GLINA_TEST_DEFECT and GLINA_TEST_CRITERION; a passing
// run on committed source then writes criterion.json under build/criterion:
// the defect, the criterion, the revision, the result, the digests of the
// Node binary and of this test, the commands that succeeded with their exits,
// and the refusals the CLI answered.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = resolve(import.meta.dirname, '../..');
const build = join(root, 'build', 'tests');
/** The owner may list the directory but not search it: stat inside fails with EACCES. */
const NO_SEARCH = constants.S_IRUSR | constants.S_IWUSR;
const OWNER_ALL = constants.S_IRWXU;

const defectId = process.env.GLINA_TEST_DEFECT?.trim();
const criterion = process.env.GLINA_TEST_CRITERION?.trim();
assert.equal(Boolean(defectId), Boolean(criterion),
  'GLINA_TEST_DEFECT and GLINA_TEST_CRITERION are named together or not at all');

const commands = [];
const refusals = [];

function run(executable, args, env) {
  const result = spawnSync(executable, args, { cwd: root, env: env ?? process.env, encoding: 'utf8' });
  return { executable, args, ...result };
}

/** A command the journey needs to succeed; recorded with its exit. */
function succeeds(executable, args, env) {
  const result = run(executable, args, env);
  assert.ok(!result.status, `${executable} ${args.join(' ')} failed: ${result.stderr}`);
  commands.push({ executable, args, exit: result.status });
  return result;
}

function glinaArgs(data, args) {
  return ['pipeline/cli.js', ...args, '--config', join(data, 'pipeline.config.json')];
}

function glinaEnv(data) {
  return { ...process.env, XDG_DATA_HOME: data };
}

/** A command the journey needs refused; its refusal is the observed state. */
function refused(data, name, args) {
  const result = run(process.execPath, glinaArgs(data, args), glinaEnv(data));
  assert.ok(result.status, `${args.join(' ')} was accepted: ${result.stdout}`);
  refusals.push({ name, args, refusal: result.stderr.trim() });
  return result;
}

const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');

async function writeCriterionReport(revision) {
  const directory = join(root, 'build', 'criterion', randomUUID());
  await mkdir(directory, { recursive: true });
  const path = join(directory, 'criterion.json');
  await writeFile(path, `${JSON.stringify({
    defectId,
    criterion,
    sourceRevision: revision,
    result: 'passed',
    binarySha256: digest(await readFile(process.execPath)),
    testSha256: digest(await readFile(fileURLToPath(import.meta.url))),
    observedFinalState: { refusals },
    commands,
  }, null, '  ')}\n`, { mode: constants.S_IRUSR | constants.S_IWUSR });
  console.log(`criterion report: ${path}`);
}

test('verify names an active asset it cannot inspect apart from a missing one', async () => {
  const revision = defectId ? succeeds('git', ['rev-parse', 'HEAD']).stdout.trim() : null;
  if (defectId) {
    assert.equal(succeeds('git', ['status', '--porcelain', '--untracked-files=normal']).stdout, '',
      'a criterion report is written only for committed source');
  }
  await mkdir(build, { recursive: true });
  const data = await mkdtemp(join(build, 'active-'));
  await writeFile(join(data, 'pipeline.config.json'), '{}\n');
  let locked = null;
  try {
    const imported = succeeds(process.execPath, glinaArgs(data, ['import', 'assets/models/smok.glb', '--name', 'creature']), glinaEnv(data));
    const assetPath = JSON.parse(imported.stdout).path;

    locked = dirname(assetPath);
    await chmod(locked, NO_SEARCH);
    const unreadable = refused(data, 'asset behind an unsearchable directory', ['verify']);
    assert.match(unreadable.stderr, /active Glina asset .* cannot be inspected: .*EACCES/);
    assert.doesNotMatch(unreadable.stderr, /is missing/);
    await chmod(locked, OWNER_ALL);
    locked = null;

    await rm(assetPath);
    const missing = refused(data, 'asset file removed', ['verify']);
    assert.match(missing.stderr, /active Glina asset is missing/);
  } finally {
    if (locked) await chmod(locked, OWNER_ALL);
    await rm(data, { recursive: true, force: true });
  }
  if (defectId) await writeCriterionReport(revision);
});

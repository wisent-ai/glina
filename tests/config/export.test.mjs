import assert from 'node:assert/strict';
import { constants } from 'node:fs';
import { chmod, lstat, mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import { journey, root } from '../support/journey.mjs';

const ownerOnly = constants.S_IRUSR | constants.S_IWUSR;
const permissionBits = constants.S_IRWXU | constants.S_IRWXG | constants.S_IRWXO;

test('config export resolves credentials, owns its marker and preserves refused destinations', async () => {
  const build = join(root, 'build', 'tests');
  await mkdir(build, { recursive: true });
  const fixture = await mkdtemp(join(build, 'export-credentials-'));
  const credentials = join(fixture, 'roles.json');
  const secret = 'credential-export-fixture';
  await writeFile(credentials, JSON.stringify({ handoff: { login: secret } }), { mode: ownerOnly });
  const previous = process.env.GLINA_CREDENTIALS_FILE;
  let run;
  try {
    process.env.GLINA_CREDENTIALS_FILE = credentials;
    run = await journey(import.meta.url, 'config-export');
    const source = { _resolved: false, credentials: { username: 'role://handoff/login' } };
    await writeFile(run.config, JSON.stringify(source));
    const output = join(run.data, 'resolved.json');
    const result = run.runs('config', 'export', '--out', output);
    assert.deepEqual(JSON.parse(result.stdout), { out: output, resolved: true });
    assert.ok(!result.stdout.includes(secret) && !result.stderr.includes(secret));
    assert.deepEqual(JSON.parse(await readFile(output, 'utf8')), {
      _resolved: true, credentials: { username: secret },
    });
    assert.equal((await stat(output)).mode & permissionBits, ownerOnly);
    assert.deepEqual(JSON.parse(await readFile(run.config, 'utf8')), source);

    const consumed = join(run.data, 'consumed-handoff.json');
    const roundTrip = run.command(process.execPath, 'pipeline/cli.js', 'config', 'export',
      '--config', output, '--out', consumed);
    assert.ok(!roundTrip.stdout.includes(secret) && !roundTrip.stderr.includes(secret));
    assert.deepEqual(JSON.parse(await readFile(consumed, 'utf8')), {
      _resolved: true, credentials: { username: secret },
    });
    assert.equal((await stat(consumed)).mode & permissionBits, ownerOnly);

    await chmod(output, ownerOnly | constants.S_IRGRP);
    run.runs('config', 'export', '--out', output);
    assert.equal((await stat(output)).mode & permissionBits, ownerOnly);
    assert.equal(JSON.parse(await readFile(output, 'utf8'))._resolved, true);

    const unrelated = join(run.data, 'unrelated.json');
    const linkedOutput = join(run.data, 'linked-handoff.json');
    const unrelatedContent = '{"keep":"this existing file"}';
    await writeFile(unrelated, unrelatedContent);
    await symlink(unrelated, linkedOutput);
    run.runs('config', 'export', '--out', linkedOutput);
    assert.equal(await readFile(unrelated, 'utf8'), unrelatedContent,
      'export followed a destination symlink and overwrote its unrelated target');
    assert.equal((await lstat(linkedOutput)).isSymbolicLink(), false);
    assert.deepEqual(JSON.parse(await readFile(linkedOutput, 'utf8')), {
      _resolved: true, credentials: { username: secret },
    });
    assert.equal((await stat(linkedOutput)).mode & permissionBits, ownerOnly);

    const blocked = join(run.data, 'destination-directory');
    await mkdir(blocked);
    const retained = join(blocked, 'existing-data');
    await writeFile(retained, 'preserve this destination');
    const entriesBeforeRefusal = (await readdir(run.data)).sort();
    const refused = run.refused('directory destination', 'config', 'export', '--out', blocked);
    assert.ok(refused.stderr.includes(blocked), refused.stderr);
    assert.equal(refused.stdout, '');
    assert.ok(!refused.stderr.includes(secret));
    assert.equal(await readFile(retained, 'utf8'), 'preserve this destination');
    assert.deepEqual((await readdir(run.data)).sort(), entriesBeforeRefusal,
      'refused export left an additional file beside the destination');

    const previousHandoff = await readFile(output);
    await writeFile(run.config, JSON.stringify({
      credentials: { username: 'role://absent/login' },
    }));
    const missingCredential = run.refused(
      'missing credential preserves handoff', 'config', 'export', '--out', output);
    assert.ok(missingCredential.stderr.includes("role 'absent'"), missingCredential.stderr);
    assert.ok(missingCredential.stderr.includes("field 'login'"), missingCredential.stderr);
    assert.ok(missingCredential.stderr.includes('credentials.username'), missingCredential.stderr);
    assert.equal(missingCredential.stdout, '');
    assert.ok(!missingCredential.stderr.includes(secret));
    assert.deepEqual(await readFile(output), previousHandoff,
      'credential refusal replaced the previous resolved handoff');
    assert.equal((await stat(output)).mode & permissionBits, ownerOnly);
    assert.deepEqual((await readdir(run.data)).sort(), entriesBeforeRefusal,
      'credential refusal left an additional file beside the destination');
  } finally {
    if (previous === undefined) delete process.env.GLINA_CREDENTIALS_FILE;
    else process.env.GLINA_CREDENTIALS_FILE = previous;
    await rm(fixture, { recursive: true, force: true });
    if (run) await rm(run.data, { recursive: true, force: true });
  }
  await run.passed();
});

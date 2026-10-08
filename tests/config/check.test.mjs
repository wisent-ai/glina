import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { test } from 'node:test';

const root = resolve(import.meta.dirname, '../..');

test('config check resolves supported model credentials and refuses unsupported backends', async () => {
  const build = join(root, 'build', 'tests');
  await mkdir(build, { recursive: true });
  const directory = await mkdtemp(join(build, 'config-'));
  const configPath = join(directory, 'pipeline.config.json');
  const credentialsPath = join(directory, 'credentials.json');
  const run = () => spawnSync(process.execPath, ['pipeline/cli.js', 'config', 'check', '--config', configPath], {
    cwd: root,
    env: { ...process.env, GLINA_CREDENTIALS_FILE: credentialsPath },
    encoding: 'utf8',
  });
  try {
    await writeFile(credentialsPath, JSON.stringify({ test: { key: 'signing-value', bearer: 'access-value', agent_id: 'test-agent' } }), { mode: 0o600 });
    const models = { brama: {
      url: 'https://brama.example',
      key: 'role://test/key',
      bearer: 'role://test/bearer',
      agent_id: 'role://test/agent_id',
      model: 'any',
    } };
    await writeFile(configPath, JSON.stringify({ models }));
    const accepted = run();
    assert.equal(accepted.status, 0, accepted.stderr);
    assert.equal(JSON.parse(accepted.stdout).models.brama.bearer, '<resolved: ok>');
    assert.deepEqual(JSON.parse(await readFile(configPath, 'utf8')).models, models);

    await writeFile(configPath, JSON.stringify({ models: { openai_compatible: {
      url: 'https://provider.example', bearer: 'inline-value', model: 'test',
    } } }));
    const inlineBearer = run();
    assert.equal(inlineBearer.status, 1, inlineBearer.stdout);
    assert.match(inlineBearer.stderr, /models\.openai_compatible\.bearer.*inline value/);
    assert.equal(inlineBearer.stdout, '');

    await writeFile(configPath, JSON.stringify({ models, credentials: { username: 'inline-value' } }));
    const inlineUsername = run();
    assert.equal(inlineUsername.status, 1, inlineUsername.stdout);
    assert.match(inlineUsername.stderr, /credentials\.username.*inline value/);
    assert.equal(inlineUsername.stdout, '');

    await writeFile(configPath, JSON.stringify({
      _resolved: true, models: { openai_compatible: {
        url: 'https://provider.example', bearer: 'worker-secret', model: 'test',
      } },
    }));
    const handoff = run();
    assert.equal(handoff.status, 1, handoff.stdout);
    assert.match(handoff.stderr, /resolved handoff.*check the original config/);
    assert.equal(handoff.stdout, '');

    await writeFile(configPath, JSON.stringify({ models: { backend: 'openrouter', openrouter: {} } }));
    const refused = run();
    assert.equal(refused.status, 1, refused.stdout);
    assert.match(refused.stderr, /models\.backend|models\.openrouter/);
    assert.equal(refused.stdout, '');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('the config group refuses a missing or unknown leaf and the retired spellings', () => {
  const glina = (...words) => spawnSync(process.execPath, ['pipeline/cli.js', ...words], { cwd: root, encoding: 'utf8' });
  const refuses = (words, message) => {
    const refused = glina(...words);
    assert.ok(refused.status, `glina ${words.join(' ')} succeeded: ${refused.stdout}`);
    assert.match(refused.stderr, message);
  };
  refuses(['config'], /config takes check or export --out <path>/);
  refuses(['config', 'sideways'], /config takes check or export --out <path>/);
  refuses(['config', 'export'], /config export requires --out <path>/);
  refuses(['preview', 'sideways'], /preview takes anim or scene/);
  for (const retired of ['check-config', 'export-config', 'preview-anim', 'preview-scene']) {
    refuses([retired], new RegExp(`unknown command: ${retired}`));
  }
  const help = glina('config', '--help');
  assert.ok(!help.status, help.stderr);
  assert.match(help.stdout, /usage: glina config check/);
  assert.match(help.stdout, /usage: glina config export --out <path>/);
});

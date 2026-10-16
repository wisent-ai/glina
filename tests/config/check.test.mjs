// A config names each secret by the role its vault item plays
// (role://<role>/<field>), never by an item. The real `glina config check`
// resolves role references from the owner-only credentials file
// GLINA_CREDENTIALS_FILE names and prints each as resolved without its value,
// leaving the file as written. An item reference (skarbiec://<item>/<field>),
// an inline secret, a resolved handoff and an unsupported model backend are
// refused naming the key, with nothing printed on stdout.

import assert from 'node:assert/strict';
import { constants } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import { journey, root } from '../support/journey.mjs';

const SECRETS = { key: 'signing-value', bearer: 'access-value', agent_id: 'test-agent' };

test('config check resolves role references and refuses item references, inline secrets and unsupported backends', async () => {
  const build = join(root, 'build', 'tests');
  await mkdir(build, { recursive: true });
  const credentials = join(build, `credentials-${process.pid}.json`);
  const prior = process.env.GLINA_CREDENTIALS_FILE;
  await writeFile(credentials, JSON.stringify({ test: SECRETS }), { mode: constants.S_IRUSR | constants.S_IWUSR });
  process.env.GLINA_CREDENTIALS_FILE = credentials;
  const run = await journey(import.meta.url, 'config-check');
  const write = (config) => writeFile(run.config, JSON.stringify(config));
  const refuses = (label, pattern) => {
    const refused = run.refused(label, 'config', 'check');
    assert.match(refused.stderr, pattern);
    assert.equal(refused.stdout, '');
    for (const value of Object.values(SECRETS)) assert.ok(!refused.stderr.includes(value));
  };
  try {
    const models = { brama: {
      url: 'https://brama.example',
      key: 'role://test/key',
      bearer: 'role://test/bearer',
      agent_id: 'role://test/agent_id',
      model: 'any',
    } };
    await write({ models });
    const accepted = run.runs('config', 'check');
    assert.equal(JSON.parse(accepted.stdout).models.brama.bearer, '<resolved: ok>');
    for (const value of Object.values(SECRETS)) assert.ok(!accepted.stdout.includes(value));
    assert.deepEqual(JSON.parse(await readFile(run.config, 'utf8')).models, models);

    await write({ models: { brama: { ...models.brama, bearer: 'skarbiec://brama-agent/bearer' } } });
    refuses('item reference', /models\.brama\.bearer.*role:\/\/<role>\/<field>/);

    await write({ models: { openai_compatible: { url: 'https://provider.example', bearer: 'inline-value', model: 'test' } } });
    refuses('inline bearer', /models\.openai_compatible\.bearer.*inline value/);

    await write({ models, credentials: { username: 'inline-value' } });
    refuses('inline credential', /credentials\.username.*inline value/);

    await write({ _resolved: true, models: { openai_compatible: { url: 'https://provider.example', bearer: 'worker-secret', model: 'test' } } });
    refuses('resolved handoff', /resolved handoff.*check the original config/);

    await write({ models: { backend: 'openrouter', openrouter: {} } });
    refuses('unsupported backend', /models\.backend, models\.openrouter is not a model backend/);
  } finally {
    if (prior === undefined) delete process.env.GLINA_CREDENTIALS_FILE;
    else process.env.GLINA_CREDENTIALS_FILE = prior;
    await rm(credentials, { force: true });
    await rm(run.data, { recursive: true, force: true });
  }
  await run.passed();
});

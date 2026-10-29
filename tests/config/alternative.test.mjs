// Brama is one alternative of Glina's model service, not a precondition. With
// models.brama naming no address, the real `glina config check` asks the real
// Stado GLINA_TEST_STADO names (`stado capabilities resolve inference
// --consumer glina`) in a home where no service directory places Brama. With
// no other alternative declared it is refused naming Brama and the endpoint
// alternative, each with why it did not answer; with an OpenAI-compatible
// endpoint declared in Brama's place, the check passes on it and Stado
// records the endpoint as the one that served Glina.

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { constants } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { once } from 'node:events';
import { test } from 'node:test';
import { journey, root } from '../support/journey.mjs';

const SECRETS = { key: 'signing-value', bearer: 'access-value', agent_id: 'test-agent' };

// The endpoint runs in its own process: glina runs synchronously, so a server
// in this process could not answer while it waits.
const ENDPOINT = `
const server = require('node:http').createServer((request, response) => {
  response.setHeader('content-type', 'application/json');
  response.end(JSON.stringify({ object: 'list', data: [{ id: 'endpoint-model', object: 'model' }] }));
});
server.listen(0, '127.0.0.1', () => console.log(server.address().port));
`;

test('config check is served by the endpoint declared in Brama\'s place, and names every alternative when none answers', async () => {
  const stado = process.env.GLINA_TEST_STADO;
  assert.ok(stado, 'GLINA_TEST_STADO names the real stado executable');
  const build = join(root, 'build', 'tests');
  const home = join(build, `alternative-home-${process.pid}`);
  await mkdir(home, { recursive: true });
  const credentials = join(build, `alternative-credentials-${process.pid}.json`);
  await writeFile(credentials, JSON.stringify({ test: SECRETS }), { mode: constants.S_IRUSR | constants.S_IWUSR });
  const names = ['HOME', 'STADO_BIN', 'GLINA_CREDENTIALS_FILE', 'STADO_CAPABILITIES_RECORD',
    'STADO_INFERENCE_ENDPOINT_URL', 'STADO_INFERENCE_ENDPOINT_MODEL'];
  const prior = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  for (const name of names) delete process.env[name];
  Object.assign(process.env, { HOME: home, STADO_BIN: stado, GLINA_CREDENTIALS_FILE: credentials });
  const server = spawn(process.execPath, ['-e', ENDPOINT], { stdio: ['ignore', 'pipe', 'inherit'] });
  try {
    const [port] = await once(server.stdout, 'data');
    const origin = `http://127.0.0.1:${String(port).trim()}`;
    const models = { brama: {
      key: 'role://test/key',
      bearer: 'role://test/bearer',
      agent_id: 'role://test/agent_id',
      model: 'any',
    } };

    const unanswered = await journey(import.meta.url, 'config-alternative-none');
    await writeFile(unanswered.config, JSON.stringify({ models }));
    const refused = unanswered.refused('no alternative answers', 'config', 'check');
    assert.match(refused.stderr, /no inference alternative answers glina: brama at [^;]+; model-endpoint at /);
    await rm(unanswered.data, { recursive: true, force: true });

    process.env.STADO_INFERENCE_ENDPOINT_URL = origin;
    process.env.STADO_INFERENCE_ENDPOINT_MODEL = 'endpoint-model';
    const served = await journey(import.meta.url, 'config-alternative-endpoint');
    await writeFile(served.config, JSON.stringify({ models }));
    const accepted = served.runs('config', 'check');
    for (const value of Object.values(SECRETS)) assert.ok(!accepted.stdout.includes(value));
    const record = JSON.parse(await readFile(join(home, '.stado', 'capabilities.json'), 'utf8'));
    assert.match(JSON.stringify(record), /model-endpoint/);
    assert.match(JSON.stringify(record), new RegExp(origin.replaceAll('.', '\\.')));
    await rm(served.data, { recursive: true, force: true });
    await served.passed();
  } finally {
    server.kill();
    for (const name of names) {
      if (prior[name] === undefined) delete process.env[name];
      else process.env[name] = prior[name];
    }
    await rm(credentials, { force: true });
    await rm(home, { recursive: true, force: true });
  }
});

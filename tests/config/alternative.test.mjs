// Brama is one alternative of Glina's model service, not a precondition, and
// Glina names none: with models.brama naming no address, the real
// `glina config check` needs only the model alias and a Stado to hand requests
// to — the real Stado GLINA_TEST_STADO names, in a home where no service
// directory places Brama. Without a Stado that runs it is refused naming why.
// A model request through the pipeline's transport is then refused by every
// alternative, naming Brama and the command that answers the kept request,
// and answered by the statement recorded for it, with Stado recording the
// attestation alternative as the one that served Glina.

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import { buildCompleter } from '../../pipeline/sculpt/llm.js';
import { journey, root } from '../support/journey.mjs';

test('requests go to whichever alternative Stado chooses, and config check needs no secret for it', async () => {
  const stado = process.env.GLINA_TEST_STADO;
  assert.ok(stado, 'GLINA_TEST_STADO names the real stado executable');
  const build = join(root, 'build', 'tests');
  const home = join(build, `alternative-home-${process.pid}`);
  await mkdir(home, { recursive: true });
  const names = ['HOME', 'STADO_BIN', 'STADO_CAPABILITIES_RECORD', 'STADO_ATTESTATIONS', 'STADO_INFERENCE_ORDER', 'STADO_CONFIG'];
  const prior = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  for (const name of names) delete process.env[name];
  Object.assign(process.env, { HOME: home, STADO_BIN: join(build, 'no-stado-here') });
  const run = (args, input) => execFileSync(stado, args, { encoding: 'utf8', input, stdio: ['pipe', 'pipe', 'pipe'] });
  try {
    const models = { brama: { model: 'any' } };

    const absent = await journey(import.meta.url, 'config-alternative-no-stado');
    await writeFile(absent.config, JSON.stringify({ models }));
    const refused = absent.refused('no stado', 'config', 'check');
    assert.match(refused.stderr, /models\.brama\.url is unset, so requests go to Stado, and Stado's inference alternatives cannot be read/);
    await rm(absent.data, { recursive: true, force: true });

    process.env.STADO_BIN = stado;
    run(['config', 'init']);
    const checked = await journey(import.meta.url, 'config-alternative-stado');
    await writeFile(checked.config, JSON.stringify({ models }));
    checked.runs('config', 'check');
    await rm(checked.data, { recursive: true, force: true });

    const complete = buildCompleter(models);
    const request = {
      system: 'Name the shape.',
      messages: [{ role: 'user', content: 'A ball.' }],
      maxTokens: 64,
      answer: { name: 'name_shape', schema: { type: 'object', properties: { shape: { type: 'string' } }, required: ['shape'], additionalProperties: false } },
    };
    await assert.rejects(complete(request), (error) => {
      assert.match(error.message, /no inference alternative answered `.* capabilities call inference --consumer glina --json`/);
      assert.match(error.message, /brama at /);
      assert.match(error.message, /stado capabilities attestation record inference --consumer glina/);
      return true;
    });

    const [kept] = JSON.parse(run(['capabilities', 'attestation', 'list', 'inference', '--consumer', 'glina', '--json']));
    run(['capabilities', 'attestation', 'record', 'inference', '--consumer', 'glina', kept.request,
      '--checked', 'the request asks for the shape of a ball'], JSON.stringify({ shape: 'sphere' }));
    const answered = await complete(request);
    assert.deepEqual(answered.object, { shape: 'sphere' });
    const record = await readFile(join(home, '.stado', 'capabilities.json'), 'utf8');
    assert.match(record, /"provider": "attestation"/);
    await checked.passed();
  } finally {
    for (const name of names) {
      if (prior[name] === undefined) delete process.env[name];
      else process.env[name] = prior[name];
    }
    await rm(home, { recursive: true, force: true });
  }
});

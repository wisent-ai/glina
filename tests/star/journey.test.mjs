// The GitHub star request: `glina sculpt` against a real OpenAI-compatible
// model and a live Blender MCP session. The record Glina keeps
// ($XDG_STATE_HOME/glina/star.json in the journey's own directory) is read
// after every prompt: four count without the request, the fifth shows it once
// on standard error (standard output keeps only the result), the sixth does
// not. A sculpt through glina-mcp counts too. Every verb and refusal of
// `glina star` is exercised, and a broken record is refused without losing
// the prompt's result.
//
// Inputs: GLINA_TEST_PROVIDER_URL and GLINA_TEST_MODEL name the real provider,
// GLINA_TEST_MAX_TOKENS the reply length sculpt asks it for (llm.maxTokens);
// GLINA_TEST_PROVIDER_BEARER when it takes a key. Without them the journey
// fails naming the variable: there is no simulated provider.

import assert from 'node:assert/strict';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import { journey, root } from '../support/journey.mjs';

const REQUEST = 'a star on GitHub helps other people find it';
const required = (name) => {
  const value = process.env[name]?.trim();
  assert.ok(value, `${name} must name the real model provider this journey sculpts with`);
  return value;
};

test('the fifth successful prompt asks once for a GitHub star', { timeout: 3_600_000 }, async () => {
  const url = required('GLINA_TEST_PROVIDER_URL');
  const model = required('GLINA_TEST_MODEL');
  const maxTokens = Number(required('GLINA_TEST_MAX_TOKENS'));
  assert.ok(Number.isInteger(maxTokens) && maxTokens > 0, 'GLINA_TEST_MAX_TOKENS must be a whole number above zero');
  // The harness takes its environment when it starts, so the owner-only file
  // Glina reads credentials from by role is named before it.
  const credentials = join(root, 'build', 'tests', `star-credentials-${process.pid}.json`);
  await mkdir(join(root, 'build', 'tests'), { recursive: true });
  await writeFile(credentials, `${JSON.stringify({ 'star-provider': { bearer: process.env.GLINA_TEST_PROVIDER_BEARER?.trim() || 'none' } })}\n`, { mode: 0o600 });
  process.env.GLINA_CREDENTIALS_FILE = credentials;
  const run = await journey(import.meta.url, 'star');
  const record = join(run.data, 'glina', 'star.json');
  const kept = async () => JSON.parse(await readFile(record, 'utf8'));
  await writeFile(run.config, `${JSON.stringify({
    models: { openai_compatible: { url, bearer: 'role://star-provider/bearer', model } },
    blender: { enabled: true, mcp: {} },
    llm: { maxTokens },
    verify: { enabled: false },
  }, null, '  ')}\n`);
  const out = join(run.data, 'out');
  const sculpt = (word) => run.runs('sculpt', `a ${word}-shaped cube`, '--out', out, '--filename', `${word}.glb`, '--rounds', '3');
  try {
    let status = run.glina('star');
    assert.equal(status.stage, 'counting');
    assert.equal(status.prompts, 0);
    assert.equal(status.threshold, 5);
    assert.equal(status.repository, 'https://github.com/wisent-ai/glina');
    assert.equal(status.file, record);

    const unknown = run.refused('unknown star action', 'star', 'later');
    assert.equal(unknown.status, 2);
    assert.match(unknown.stderr, /error: star: unknown action "later"; usage: glina star \[status \| dismiss \| reset\]/);
    const extra = run.refused('extra star argument', 'star', 'status', 'now');
    assert.equal(extra.status, 2);
    assert.match(extra.stderr, /error: star: unexpected argument "now"; usage: glina star/);

    for (const [index, word] of ['one', 'two', 'three', 'four'].entries()) {
      const done = sculpt(word);
      assert.ok(!done.stderr.includes(REQUEST), `prompt ${index + 1} must not show the request`);
      assert.deepEqual(await kept(), { prompts: index + 1 });
    }
    const fifth = sculpt('five');
    assert.ok(fifth.stderr.includes(REQUEST), `the fifth prompt must show the request: ${fifth.stderr}`);
    assert.ok(fifth.stderr.includes('https://github.com/wisent-ai/glina'));
    assert.ok(!fifth.stdout.includes(REQUEST), 'standard output keeps only the result');
    JSON.parse(fifth.stdout);
    const shown = await kept();
    assert.equal(shown.prompts, 5);
    assert.equal(typeof shown.shownAt, 'number');

    const sixth = sculpt('six');
    assert.ok(!sixth.stderr.includes(REQUEST), 'the request is shown once');
    assert.equal((await kept()).shownAt, shown.shownAt);

    // glina-mcp counts the same prompts and, when its prompt is the fifth,
    // carries the request in the result.
    run.glina('star', 'reset');
    assert.deepEqual(await kept(), { prompts: 0 });
    for (const word of ['a', 'b', 'c', 'd']) sculpt(word);
    const answer = run.mcp('glina_sculpt', { prompt: 'a pyramid', config: run.config, out_dir: out, filename: 'mcp.glb', max_rounds: 3 });
    assert.equal(answer.isError, false, answer.text);
    assert.equal((await kept()).prompts, 5);
    assert.equal(typeof (await kept()).shownAt, 'number');

    status = run.glina('star', 'dismiss');
    assert.equal(status.stage, 'dismissed');
    const after = sculpt('seven');
    assert.ok(!after.stderr.includes(REQUEST));
    assert.equal(run.glina('star').stage, 'dismissed');

    await writeFile(record, '{"prompts":"many"}\n');
    const broken = run.refused('star record not a star record', 'star');
    assert.equal(broken.status, 1);
    assert.match(broken.stderr, /star\.json is not a star record .*`glina star reset` writes a new one/);
    const uncounted = sculpt('eight');
    assert.match(uncounted.stderr, /glina: this prompt is not counted toward the GitHub star request: .*is not a star record/);
    assert.equal(await readFile(record, 'utf8'), '{"prompts":"many"}\n');
    run.glina('star', 'reset');
    assert.deepEqual(await kept(), { prompts: 0 });
  } finally {
    delete process.env.GLINA_CREDENTIALS_FILE;
    await rm(credentials, { force: true });
    await rm(run.data, { recursive: true, force: true });
  }
  await run.passed();
});

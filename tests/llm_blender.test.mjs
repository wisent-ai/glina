// Parsing and provider-configuration refusals without substitute providers.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCompleter, parseJsonFrom, LlmError } from '../pipeline/llm.js';
test('parseJsonFrom handles fences and prose', () => {
  assert.deepEqual(parseJsonFrom('```json\n{"a": 1}\n```'), { a: 1 });
  assert.deepEqual(parseJsonFrom('sure! {"b": 2} done'), { b: 2 });
  assert.throws(() => parseJsonFrom('no object'), LlmError);
});

test('buildCompleter: every backend other than Brama is refused by name', () => {
  for (const [models, named] of [
    [{ anthropic: { api_key: 'sk-test', consent: true } }, 'models.anthropic'],
    [{ openai: { api_key: 'sk-test' } }, 'models.openai'],
    [{ openrouter: { key: 'sk-test' } }, 'models.openrouter'],
    [{ backend: 'openrouter', brama: {} }, 'models.backend'],
  ]) {
    assert.throws(
      () => buildCompleter(models),
      (error) =>
        error instanceof LlmError && /through Brama only/.test(error.message) && error.message.includes(named),
    );
  }
});

test('buildCompleter: an incomplete Brama config names the missing fields', () => {
  assert.throws(
    () => buildCompleter({ brama: { url: 'https://brama.wisent.com', key: 'k' } }),
    (error) => error instanceof LlmError && /models\.brama\.bearer, models\.brama\.agent_id/.test(error.message),
  );
});

test('buildCompleter: no backend configured throws', () => {
  assert.throws(() => buildCompleter({}), LlmError);
});

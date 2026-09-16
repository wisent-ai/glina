// Parsing and provider-configuration refusals without substitute providers.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCompleter, parseJsonFrom, LlmError } from '../pipeline/llm.js';
test('parseJsonFrom handles fences and prose', () => {
  assert.deepEqual(parseJsonFrom('```json\n{"a": 1}\n```'), { a: 1 });
  assert.deepEqual(parseJsonFrom('sure! {"b": 2} done'), { b: 2 });
  assert.throws(() => parseJsonFrom('no object'), LlmError);
});

test('buildCompleter: direct provider configs are refused outright', () => {
  for (const models of [
    { anthropic: { api_key: 'sk-test', consent: true } },
    { openai: { api_key: 'sk-test' } },
    { direct: { api_key: 'sk-test' } },
  ]) {
    assert.throws(
      () => buildCompleter(models),
      (error) => error instanceof LlmError && /not supported/.test(error.message),
    );
  }
  // A consent flag doesn't revive it — the code path is gone entirely.
  assert.throws(() => buildCompleter({ anthropic: { api_key: 'x', consent: true } }), LlmError);
});

test('buildCompleter: no backend configured throws', () => {
  assert.throws(() => buildCompleter({}), LlmError);
});

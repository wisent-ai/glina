// Real parsing and configuration refusals; no substitute credential or MCP services.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  isSkarbiecRef,
  parseSkarbiecRef,
  nonSecretEnv,
} from '../pipeline/skarbiec.js';
import { loadPipelineConfig } from '../pipeline/config.js';
test('isSkarbiecRef / parseSkarbiecRef', () => {
  assert.ok(isSkarbiecRef('skarbiec://ITEM/field'));
  assert.ok(!isSkarbiecRef('plain-string'));
  assert.deepEqual(parseSkarbiecRef('skarbiec://TEXT2GAME_ACCOUNT/login_email'), {
    item: 'TEXT2GAME_ACCOUNT',
    field: 'login_email',
  });
  assert.throws(() => parseSkarbiecRef('skarbiec://missing-field'));
});

test('loadPipelineConfig rejects inline secrets', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'gac-config-'));
  const path = join(dir, 'bad.json');
  await writeFile(
    path,
    JSON.stringify({ credentials: { api_token: 'inline-not-allowed' } }),
  );
  await assert.rejects(loadPipelineConfig(path), /skarbiec:\/\/<item>\/<field>/);
});

test('nonSecretEnv refuses non-allowlisted vars', () => {
  assert.equal(nonSecretEnv('SKARBIEC_BIN'), process.env.SKARBIEC_BIN);
  assert.throws(() => nonSecretEnv('TEXT2GAME_PASSWORD'), /not allowlisted/);
});

test('skarbiec refs allow colons in item ids (agent:wisent-app)', () => {
  assert.deepEqual(parseSkarbiecRef('skarbiec://agent:wisent-app/value'), {
    item: 'agent:wisent-app',
    field: 'value',
  });
});

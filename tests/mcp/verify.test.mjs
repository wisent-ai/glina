// glina_verify_asset over the real glina-mcp server reads its thresholds the
// way `glina verify` does: a config it was given that is absent or not JSON is
// an error result naming the file, never the default thresholds; a readable
// one gates the asset.

import assert from 'node:assert/strict';
import { rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import { journey, root } from '../support/journey.mjs';

test('MCP verify refuses a config it cannot read and gates with a readable one', async () => {
  const run = await journey(import.meta.url, 'mcp-verify');
  try {
    const asset = join(root, 'assets', 'models', 'smok.glb');

    const absent = { path: asset, config: join(run.data, 'absent.json') };
    const missing = run.mcp('glina_verify_asset', absent);
    assert.equal(missing.isError, true, missing.text);
    assert.match(missing.text, /absent\.json/);
    assert.match(missing.text, /ENOENT/);
    run.observed('config file absent', ['glina_verify_asset', JSON.stringify(absent)], missing.text);

    const malformedPath = join(run.data, 'malformed.json');
    await writeFile(malformedPath, '{ not json');
    const malformed = { path: asset, config: malformedPath };
    const unparsed = run.mcp('glina_verify_asset', malformed);
    assert.equal(unparsed.isError, true, unparsed.text);
    assert.match(unparsed.text, /malformed\.json/);
    run.observed('config file not JSON', ['glina_verify_asset', JSON.stringify(malformed)], unparsed.text);

    const gated = run.mcp('glina_verify_asset', { path: asset, config: run.config });
    assert.equal(gated.isError, false, gated.text);
    assert.equal(typeof JSON.parse(gated.text).ok, 'boolean');
  } finally {
    await rm(run.data, { recursive: true, force: true });
  }
  await run.passed();
});

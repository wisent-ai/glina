// glina doctor runs the real MCP for Blender server (`uvx mcp-for-blender`,
// the bridge a config without blender.mcp starts) and calls the bridge healthy
// only when a printed marker comes back from Blender. With no Blender
// listening, the server still starts and answers the probe with its own
// "could not connect" text, and doctor must report the sculptor check failed
// with that answer and exit non-zero.

import assert from 'node:assert/strict';
import { rm } from 'node:fs/promises';
import { test } from 'node:test';
import { journey } from '../support/journey.mjs';

test('doctor reports the Blender bridge unhealthy when Blender is not running', async () => {
  const run = await journey(import.meta.url, 'doctor-blender');
  try {
    const refused = run.refused('Blender not listening', 'doctor');
    const report = JSON.parse(refused.stdout);
    assert.equal(report.healthy, false);
    const sculptor = report.checks.find((check) => check.name === 'sculptor');
    assert.ok(sculptor, `doctor reported no sculptor check: ${refused.stdout}`);
    assert.equal(sculptor.ok, false, `the bridge was called healthy: ${JSON.stringify(sculptor)}`);
    assert.match(sculptor.error, /execute_blender_code did not complete: .*Could not connect to Blender/);
  } finally {
    await rm(run.data, { recursive: true, force: true });
  }
  await run.passed();
});

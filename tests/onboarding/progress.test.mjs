import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { test } from 'node:test';

const root = resolve(import.meta.dirname, '../..');
const build = join(root, 'build', 'tests');

// Onboarding reads the empty config the test writes, never the checkout's
// own pipeline.config.json, so a developer's config cannot decide the run.
function onboarding(state, data, config) {
  return spawnSync(process.execPath, ['pipeline/cli.js', 'onboarding', '--config', config], {
    cwd: root,
    env: { ...process.env, XDG_STATE_HOME: state, XDG_DATA_HOME: data },
    encoding: 'utf8',
  });
}

test('onboarding starts on a missing progress file and refuses one that is not JSON', async () => {
  await mkdir(build, { recursive: true });
  const work = await mkdtemp(join(build, 'onboarding-'));
  try {
    const config = join(work, 'pipeline.config.json');
    await writeFile(config, '{}\n');
    const data = join(work, 'data');
    const fresh = join(work, 'fresh');
    const first = onboarding(fresh, data, config);
    assert.ok(!first.status, `first run failed:\n${first.stderr}`);
    const started = JSON.parse(await readFile(join(fresh, 'glina', 'onboarding.json'), 'utf8'));
    assert.equal(started.status, 'in_progress');

    const corrupt = join(work, 'corrupt');
    const file = join(corrupt, 'glina', 'onboarding.json');
    await mkdir(join(corrupt, 'glina'), { recursive: true });
    await writeFile(file, '{ not json');
    const refused = onboarding(corrupt, data, config);
    assert.ok(refused.status, 'a progress file that is not JSON was read as a first run');
    assert.match(refused.stderr, /onboarding progress .*onboarding\.json is not JSON/);
    assert.equal(await readFile(file, 'utf8'), '{ not json');
  } finally {
    await rm(work, { recursive: true, force: true });
  }
});

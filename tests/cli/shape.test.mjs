// The installed shape of the glina CLI: `glina` as the symlink a package
// install makes runs commands and answers --help; every result prints as JSON
// by default and as one `path: value` line per field with --text; config and
// preview are groups whose leaves are words, and the retired hyphenated verbs
// (check-config, export-config, preview-anim, preview-scene) are unknown
// commands, refused as usage errors.

import assert from 'node:assert/strict';
import { mkdir, rm, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import { journey, root } from '../support/journey.mjs';

// The exit glina gives a usage error, the shell convention for misuse that
// https://tldp.org/LDP/abs/html/exitcodes.html lists and glina's README uses
// for an undeclared name.
const USAGE_ERROR = 2;

test('the installed glina runs, prints JSON or text, and groups config and preview', async () => {
  const run = await journey(import.meta.url, 'cli-shape');
  try {
    const bin = join(run.data, 'bin');
    await mkdir(bin);
    const installed = join(bin, 'glina');
    await symlink(join(root, 'pipeline', 'cli.js'), installed);

    const help = run.command(installed, '--help');
    assert.match(help.stdout, /^usage: glina <command>/);
    assert.match(help.stdout, /config check/);
    const listed = JSON.parse(run.command(installed, 'workspace', 'list').stdout);
    assert.equal(listed.activeAsset, null);

    run.glina('import', 'assets/models/smok.glb', '--name', 'creature');
    const asJson = run.glina('workspace', 'list');
    assert.equal(asJson.activeAsset, 'creature');
    const asText = run.runs('workspace', 'list', '--text').stdout;
    assert.throws(() => JSON.parse(asText));
    assert.match(asText, /^activeAsset: creature$/m);
    assert.match(asText, /^assets\[\d+\]\.id: creature$/m);

    for (const retired of ['check-config', 'export-config', 'preview-anim', 'preview-scene']) {
      const refused = run.refused(`retired verb ${retired}`, retired);
      assert.equal(refused.status, USAGE_ERROR);
      assert.match(refused.stderr, new RegExp(`^unknown command: ${retired}`));
    }
    const groupHelp = run.runs('config', '--help').stdout;
    assert.match(groupHelp, /usage: glina config check/);
    assert.match(groupHelp, /usage: glina config export --out <path>/);
    for (const [label, words, message] of [
      ['config without a leaf', ['config'], /config takes check or export --out <path>/],
      ['config with an unknown leaf', ['config', 'sideways'], /config takes check or export --out <path>/],
      ['config export without --out', ['config', 'export'], /config export requires --out <path>/],
      ['preview with an unknown leaf', ['preview', 'sideways'], /preview takes anim or scene/],
    ]) {
      const refused = run.refused(label, ...words);
      assert.equal(refused.status, USAGE_ERROR);
      assert.match(refused.stderr, message);
    }
    const unchecked = run.refused('config check of a config without a model backend', 'config', 'check');
    assert.match(unchecked.stderr, /no model backend is configured/);
  } finally {
    await rm(run.data, { recursive: true, force: true });
  }
  await run.passed();
});

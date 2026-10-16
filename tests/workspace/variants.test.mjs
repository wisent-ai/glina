// Asset variants through the real CLI: an import is accepted or refused by
// the report's `accepted`, a base with variants cannot be removed, and the
// workspace and preview verbs the CLI accepts and names in its refusals are
// the ones its tables run.

import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import { journey, root } from '../support/journey.mjs';

test('CLI retains variants, refuses destructive parent removal, and migrates existing workspaces', async () => {
  const run = await journey(import.meta.url, 'variants');
  try {
    const base = run.glina('import', 'assets/models/smok.glb', '--name', 'creature');
    assert.equal(base.status, 'imported');
    assert.equal(base.accepted, true);
    assert.ok(existsSync(base.path));

    const manifestPath = join(run.data, 'glina', 'workspace.json');
    const legacy = JSON.parse(await readFile(manifestPath, 'utf8'));
    legacy.schema = 'glina.workspace.v1';
    for (const asset of legacy.assets) delete asset.variantOf;
    await writeFile(manifestPath, JSON.stringify(legacy));
    const migrated = run.glina('workspace');
    assert.equal(migrated.schema, 'glina.workspace.v2');
    assert.equal(migrated.assets[0].variantOf, null);

    const variant = run.glina('import', 'assets/models/humans_reference.glb', '--name', 'human', '--variant-of', 'creature');
    assert.equal(variant.status, 'imported');
    assert.equal(variant.variantOf, 'creature');
    assert.ok(existsSync(variant.path));
    const persisted = JSON.parse(await readFile(manifestPath, 'utf8'));
    assert.equal(persisted.schema, 'glina.workspace.v2');
    assert.equal(persisted.activeAsset, 'human');
    assert.equal(persisted.assets.find((asset) => asset.id === 'human').variantOf, 'creature');

    const parentRemoval = run.refused('base with variants removed', 'workspace', 'remove', 'creature');
    assert.match(parentRemoval.stderr, /has variants human; remove those variants/);
    assert.ok(existsSync(base.path));
    assert.ok(existsSync(variant.path));

    const sameContent = run.refused('variant with the base content', 'import', 'assets/models/smok.glb', '--name', 'copy', '--variant-of', 'creature');
    const sameReport = JSON.parse(sameContent.stdout);
    assert.equal(sameReport.accepted, false);
    assert.match(sameReport.reason, /same content as existing asset creature/);

    const missingParent = run.refused('variant of an unknown base', 'import', 'assets/models/humans_reference.glb', '--name', 'orphan', '--variant-of', 'missing');
    assert.match(JSON.parse(missingParent.stdout).reason, /parent missing is not in the Glina workspace/);

    const malformedInput = run.refused('import of a non-GLB file', 'import', 'package.json', '--name', 'invalid', '--variant-of', 'creature');
    assert.match(JSON.parse(malformedInput.stdout).reason, /only .glb files/);

    const unknownAction = run.refused('workspace verb outside its table', 'workspace', 'rename', 'creature');
    assert.match(unknownAction.stderr, /workspace takes list, select <id>, remove <id>, not rename creature/);
    const unknownPreview = run.refused('preview verb outside its table', 'preview', 'orbit');
    assert.match(unknownPreview.stderr, /preview takes anim or scene; got \["orbit"\]/);

    const selected = run.glina('workspace', 'select', 'creature');
    assert.equal(selected.activeAsset, 'creature');
    const withoutVariant = run.glina('workspace', 'remove', 'human');
    assert.deepEqual(withoutVariant.assets.map((asset) => asset.id), ['creature']);
    assert.ok(!existsSync(variant.path));
    const empty = run.glina('workspace', 'remove', 'creature');
    assert.equal(empty.activeAsset, null);
    assert.deepEqual(empty.assets, []);
    assert.ok(!existsSync(base.path));
    assert.ok(existsSync(join(root, 'assets/models/smok.glb')));
  } finally {
    await rm(run.data, { recursive: true, force: true });
  }
  await run.passed();
});

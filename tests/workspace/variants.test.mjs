import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { test } from 'node:test';

const root = resolve(import.meta.dirname, '../..');
const build = join(root, 'build', 'tests');

function glina(data, ...args) {
  return spawnSync(process.execPath, ['pipeline/cli.js', ...args], {
    cwd: root,
    env: { ...process.env, XDG_DATA_HOME: data },
    encoding: 'utf8',
  });
}

function success(data, ...args) {
  const result = glina(data, ...args);
  assert.equal(result.status, 0, `${args.join(' ')}: ${result.stderr}\n${result.stdout}`);
  return JSON.parse(result.stdout);
}

test('CLI retains variants, refuses destructive parent removal, and migrates existing workspaces', async () => {
  await mkdir(build, { recursive: true });
  const data = await mkdtemp(join(build, 'variants-'));
  try {
    const base = success(data, 'import', 'assets/models/smok.glb', '--name', 'creature');
    assert.equal(base.status, 'imported');
    assert.ok(existsSync(base.path));

    const manifestPath = join(data, 'glina', 'workspace.json');
    const legacy = JSON.parse(await readFile(manifestPath, 'utf8'));
    legacy.schema = 'glina.workspace.v1';
    for (const asset of legacy.assets) delete asset.variantOf;
    await writeFile(manifestPath, JSON.stringify(legacy));
    const migrated = success(data, 'workspace');
    assert.equal(migrated.schema, 'glina.workspace.v2');
    assert.equal(migrated.assets[0].variantOf, null);

    const variant = success(data, 'import', 'assets/models/humans_reference.glb', '--name', 'human', '--variant-of', 'creature');
    assert.equal(variant.status, 'imported');
    assert.equal(variant.variantOf, 'creature');
    assert.ok(existsSync(variant.path));
    const persisted = JSON.parse(await readFile(manifestPath, 'utf8'));
    assert.equal(persisted.schema, 'glina.workspace.v2');
    assert.equal(persisted.activeAsset, 'human');
    assert.equal(persisted.assets.find((asset) => asset.id === 'human').variantOf, 'creature');

    const parentRemoval = glina(data, 'workspace', 'remove', 'creature');
    assert.equal(parentRemoval.status, 1);
    assert.match(parentRemoval.stderr, /has variants human; remove those variants/);
    assert.ok(existsSync(base.path));
    assert.ok(existsSync(variant.path));

    const sameContent = glina(data, 'import', 'assets/models/smok.glb', '--name', 'copy', '--variant-of', 'creature');
    assert.equal(sameContent.status, 1);
    assert.match(JSON.parse(sameContent.stdout).reason, /same content as existing asset creature/);

    const missingParent = glina(data, 'import', 'assets/models/humans_reference.glb', '--name', 'orphan', '--variant-of', 'missing');
    assert.equal(missingParent.status, 1);
    assert.match(JSON.parse(missingParent.stdout).reason, /parent missing is not in the Glina workspace/);

    const malformedInput = glina(data, 'import', 'package.json', '--name', 'invalid', '--variant-of', 'creature');
    assert.equal(malformedInput.status, 1);
    assert.match(JSON.parse(malformedInput.stdout).reason, /only .glb files/);

    const selected = success(data, 'workspace', 'select', 'creature');
    assert.equal(selected.activeAsset, 'creature');
    const withoutVariant = success(data, 'workspace', 'remove', 'human');
    assert.equal(withoutVariant.assets.length, 1);
    assert.ok(!existsSync(variant.path));
    const empty = success(data, 'workspace', 'remove', 'creature');
    assert.equal(empty.activeAsset, null);
    assert.deepEqual(empty.assets, []);
    assert.ok(!existsSync(base.path));
    assert.ok(existsSync(join(root, 'assets/models/smok.glb')));
  } finally {
    await rm(data, { recursive: true, force: true });
  }
});

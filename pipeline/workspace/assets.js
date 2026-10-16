// Taking an asset into the persistent Glina workspace. Import is the single
// boundary shared by CLI onboarding, the reusable CLI command, and the
// `glina import` run Glina Desktop starts; the workspace document itself is
// in store.js, and choosing or removing an imported asset in manage.js.

import { createHash, randomUUID } from 'node:crypto';
import { constants as fsConstants, createReadStream } from 'node:fs';
import { chmod, copyFile, link, mkdir, realpath, rm, stat } from 'node:fs/promises';
import path from 'node:path';

import { verifyAsset } from '../gate/verify.js';
import { WORKSPACE_SCHEMA, readWorkspace, workspaceRoot, writeWorkspace } from './store.js';

/**
 * Remove a file this import made after the import already failed. The
 * import's own refusal is the answer; a file that cannot be removed is said
 * on stderr, because it stays in the workspace's assets directory.
 */
async function removeLeftover(file) {
  try {
    await rm(file, { force: true });
  } catch (error) {
    console.error(`[import] ${file} was left behind and could not be removed: ${error.message}`);
  }
}

// An asset id names files in the workspace, so it starts with an ASCII letter
// or digit and holds only letters, digits, dots, underscores and hyphens.
function validateName(name) {
  if (!/^[^\W_][\w.-]*$/.test(name)) {
    return `asset name ${JSON.stringify(name)} must start with an ASCII letter or digit and hold only letters, digits, dots, underscores, or hyphens; name it with --name`;
  }
  return null;
}

function derivedName(source) {
  const stem = path.basename(source, path.extname(source));
  return stem
    .normalize('NFKD')
    .replace(/[\W_]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

async function digestFile(file) {
  const digest = createHash('sha256');
  for await (const chunk of createReadStream(file)) {
    digest.update(chunk);
  }
  return digest.digest('hex');
}

function rejected(source, reason, verification) {
  return {
    status: 'rejected',
    accepted: false,
    source,
    id: null,
    path: null,
    reason,
    verification: verification === undefined ? null : verification,
  };
}

/**
 * Validate one existing GLB, copy it into Glina's durable asset workspace, and
 * make the accepted copy the active input. The staging file is the exact bytes
 * verified, closing the source-change gap between validation and persistence.
 * The report's `accepted` says whether the workspace now holds the asset as
 * the active input, so callers decide on that field rather than on status
 * names.
 */
export async function importAsset(source, { name, variantOf: requestedParent, config }) {
  if (config === undefined) {
    throw new Error('importAsset needs the pipeline config the import gate verifies against');
  }
  // No --variant-of is a base asset; the manifest records that as a null parent.
  const variantOf = requestedParent === undefined ? null : requestedParent;
  const sourceText = typeof source === 'string' ? source.trim() : '';
  if (!sourceText) return rejected(sourceText, 'asset import requires a .glb path');
  if (path.extname(sourceText).toLowerCase() !== '.glb') {
    return rejected(sourceText, 'asset import accepts only .glb files');
  }

  let resolvedSource;
  try {
    resolvedSource = await realpath(sourceText);
    const attributes = await stat(resolvedSource);
    if (!attributes.isFile()) throw new Error('source is not a regular file');
  } catch (error) {
    return rejected(sourceText, `asset import could not read ${sourceText}: ${error.message}`);
  }

  const id = name === undefined ? derivedName(resolvedSource) : String(name);
  const nameProblem = validateName(id);
  if (nameProblem) return rejected(resolvedSource, nameProblem);
  if (variantOf !== null && (typeof variantOf !== 'string' || !variantOf.trim())) {
    return rejected(resolvedSource, 'variant parent must be an existing base asset id');
  }


  const root = workspaceRoot();
  const assetsDirectory = path.join(root, 'assets');
  await mkdir(assetsDirectory, { recursive: true });
  const temporary = path.join(assetsDirectory, `.${id}.${process.pid}.${randomUUID()}.incoming.glb`);
  try {
    await copyFile(resolvedSource, temporary, fsConstants.COPYFILE_EXCL);
    await chmod(temporary, fsConstants.S_IRUSR | fsConstants.S_IWUSR);
  } catch (error) {
    await removeLeftover(temporary);
    return rejected(resolvedSource, `asset import could not stage ${resolvedSource}: ${error.message}`);
  }

  let verification;
  try {
    verification = await verifyAsset(temporary, config);
  } catch (error) {
    await removeLeftover(temporary);
    return rejected(resolvedSource, `asset import validation failed: ${error.message}`);
  }
  if (!verification.ok) {
    await removeLeftover(temporary);
    return rejected(
      resolvedSource,
      `asset failed verification: ${verification.errors.join('; ')}`,
      { ...verification, path: resolvedSource },
    );
  }

  const digest = await digestFile(temporary);
  const workspace = await readWorkspace();
  if (variantOf !== null) {
    const parent = workspace.assets.find((asset) => asset.id === variantOf);
    if (!parent) {
      await rm(temporary, { force: true });
      return rejected(resolvedSource, `variant parent ${variantOf} is not in the Glina workspace`);
    }
    if (parent.variantOf !== null) {
      await rm(temporary, { force: true });
      return rejected(resolvedSource, `variant parent ${variantOf} is itself a variant; choose a base asset`);
    }
  }
  const duplicate = workspace.assets.find((asset) => asset.digest === digest);
  if (duplicate && variantOf !== null) {
    await rm(temporary, { force: true });
    return rejected(resolvedSource, `variant has the same content as existing asset ${duplicate.id}; choose a distinct GLB`);
  }
  if (duplicate) {
    await rm(temporary, { force: true });
    workspace.activeAsset = duplicate.id;
    await writeWorkspace(workspace);
    return {
      status: 'unchanged',
      accepted: true,
      source: resolvedSource,
      id: duplicate.id,
      path: duplicate.path,
      variantOf: duplicate.variantOf,
      reason: null,
      verification: { ...verification, path: duplicate.path },
    };
  }

  const conflicting = workspace.assets.find((asset) => asset.id === id);
  if (conflicting) {
    await rm(temporary, { force: true });
    return {
      status: 'conflicting',
      accepted: false,
      source: resolvedSource,
      id,
      path: conflicting.path,
      reason: `asset name conflicts with existing content; choose another --name to preserve ${conflicting.path}`,
      verification: { ...verification, path: resolvedSource },
    };
  }

  const destination = path.join(assetsDirectory, `${id}.glb`);
  try {
    await link(temporary, destination);
  } catch (error) {
    await removeLeftover(temporary);
    if (error?.code === 'EEXIST') {
      return {
        status: 'conflicting',
        accepted: false,
        source: resolvedSource,
        id,
        path: destination,
        reason: 'the destination already exists outside the Glina workspace index; it was not replaced',
        verification: { ...verification, path: resolvedSource },
      };
    }
    throw error;
  }
  try {
    await rm(temporary, { force: true });
  } catch (error) {
    await removeLeftover(destination);
    throw error;
  }
  workspace.assets.push({
    id,
    digest,
    path: destination,
    source: resolvedSource,
    importedAt: new Date().toISOString(),
    stats: verification.stats,
    variantOf,
  });
  workspace.activeAsset = id;
  try {
    await writeWorkspace(workspace);
  } catch (error) {
    await removeLeftover(destination);
    throw error;
  }

  return {
    status: 'imported',
    accepted: true,
    source: resolvedSource,
    id,
    path: destination,
    variantOf,
    reason: null,
    verification: { ...verification, path: destination },
  };
}

export async function activeAssetPath() {
  const workspace = await readWorkspace();
  if (!workspace.activeAsset) return null;
  const asset = workspace.assets.find((candidate) => candidate.id === workspace.activeAsset);
  if (!asset) throw new Error(`Glina workspace names missing active asset ${workspace.activeAsset}`);
  let attributes;
  try {
    attributes = await stat(asset.path);
  } catch (error) {
    // Only an absent file is a missing asset; any other failure is its own cause.
    if (error.code === 'ENOENT') {
      throw new Error(`active Glina asset is missing: ${asset.path}; import it again or select another asset`);
    }
    throw new Error(`active Glina asset ${asset.path} cannot be inspected: ${error.message}`);
  }
  if (!attributes.isFile()) {
    throw new Error(`active Glina asset is not a file: ${asset.path}; import it again or select another asset`);
  }
  return asset.path;
}

export async function workspaceSummary() {
  const workspace = await readWorkspace();
  return {
    schema: WORKSPACE_SCHEMA,
    activeAsset: workspace.activeAsset,
    assets: workspace.assets.map((asset) => ({
      ...asset,
      active: asset.id === workspace.activeAsset,
    })),
  };
}

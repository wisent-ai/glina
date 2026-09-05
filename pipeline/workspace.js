// Persistent Glina asset workspace. Import is the single boundary shared by
// CLI onboarding, the reusable CLI command, and Glina Desktop's loopback API.

import { createHash, randomUUID } from 'node:crypto';
import { constants as fsConstants, createReadStream } from 'node:fs';
import { chmod, copyFile, link, mkdir, open, readFile, realpath, rename, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { verifyAsset } from './verify.js';

const WORKSPACE_SCHEMA = 'glina.workspace.v1';

function workspaceRoot() {
  const configured = process.env.XDG_DATA_HOME?.trim();
  const root = configured || (os.homedir() ? path.join(os.homedir(), '.local', 'share') : '');
  if (!root) {
    throw new Error('HOME is unavailable; set HOME or XDG_DATA_HOME before importing a Glina asset');
  }
  return path.join(root, 'glina');
}

function manifestPath() {
  return path.join(workspaceRoot(), 'workspace.json');
}

function emptyWorkspace() {
  return { schema: WORKSPACE_SCHEMA, activeAsset: null, assets: [] };
}

async function readWorkspace() {
  let body;
  try {
    body = await readFile(manifestPath(), 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') return emptyWorkspace();
    throw error;
  }
  let workspace;
  try {
    workspace = JSON.parse(body);
  } catch (error) {
    throw new Error(`Glina workspace is not valid JSON: ${manifestPath()}`, { cause: error });
  }
  if (
    workspace?.schema !== WORKSPACE_SCHEMA
    || !Array.isArray(workspace.assets)
    || !(workspace.activeAsset === null || typeof workspace.activeAsset === 'string')
  ) {
    throw new Error(`unsupported Glina workspace schema in ${manifestPath()}`);
  }
  for (const asset of workspace.assets) {
    const keys = Object.keys(asset).sort().join(',');
    if (
      keys !== 'digest,id,importedAt,path,source,stats'
      || typeof asset.id !== 'string'
      || typeof asset.digest !== 'string'
      || typeof asset.path !== 'string'
      || typeof asset.source !== 'string'
      || typeof asset.importedAt !== 'string'
      || !asset.stats
      || typeof asset.stats !== 'object'
    ) {
      throw new Error(`invalid Glina asset entry in ${manifestPath()}`);
    }
  }
  return workspace;
}

async function writeWorkspace(workspace) {
  const destination = manifestPath();
  await mkdir(path.dirname(destination), { recursive: true });
  const temporary = `${destination}.${process.pid}.${randomUUID()}.tmp`;
  const handle = await open(temporary, 'wx', 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(workspace, null, 2)}\n`);
    await handle.sync();
  } catch (error) {
    await handle.close().catch(() => {});
    await rm(temporary, { force: true }).catch(() => {});
    throw error;
  }
  await handle.close();
  try {
    await rename(temporary, destination);
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => {});
    throw error;
  }
}

function validateName(name) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(name)) {
    return 'asset name must start with an ASCII letter or digit and contain at most 64 letters, digits, dots, underscores, or hyphens';
  }
  return null;
}

function derivedName(source) {
  const stem = path.basename(source, path.extname(source));
  const normalized = stem
    .normalize('NFKD')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
    .replace(/-+$/g, '');
  return normalized || 'asset';
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
    source,
    id: null,
    path: null,
    reason,
    verification: verification ?? null,
  };
}

/**
 * Validate one existing GLB, copy it into Glina's durable asset workspace, and
 * make the accepted copy the active input. The staging file is the exact bytes
 * verified, closing the source-change gap between validation and persistence.
 */
export async function importAsset(source, { name, config = {} } = {}) {
  const sourceText = String(source ?? '').trim();
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

  const root = workspaceRoot();
  const assetsDirectory = path.join(root, 'assets');
  await mkdir(assetsDirectory, { recursive: true });
  const temporary = path.join(assetsDirectory, `.${id}.${process.pid}.${randomUUID()}.incoming.glb`);
  try {
    await copyFile(resolvedSource, temporary, fsConstants.COPYFILE_EXCL);
    await chmod(temporary, 0o600);
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => {});
    return rejected(resolvedSource, `asset import could not stage ${resolvedSource}: ${error.message}`);
  }

  let verification;
  try {
    verification = await verifyAsset(temporary, config);
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => {});
    return rejected(resolvedSource, `asset import validation failed: ${error.message}`);
  }
  if (!verification.ok) {
    await rm(temporary, { force: true }).catch(() => {});
    return rejected(
      resolvedSource,
      `asset failed verification: ${verification.errors.join('; ')}`,
      { ...verification, path: resolvedSource },
    );
  }

  const digest = await digestFile(temporary);
  const workspace = await readWorkspace();
  const duplicate = workspace.assets.find((asset) => asset.digest === digest);
  if (duplicate) {
    await rm(temporary, { force: true });
    workspace.activeAsset = duplicate.id;
    await writeWorkspace(workspace);
    return {
      status: 'unchanged',
      source: resolvedSource,
      id: duplicate.id,
      path: duplicate.path,
      reason: null,
      verification: { ...verification, path: duplicate.path },
    };
  }

  const conflicting = workspace.assets.find((asset) => asset.id === id);
  if (conflicting) {
    await rm(temporary, { force: true });
    return {
      status: 'conflicting',
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
    await rm(temporary, { force: true }).catch(() => {});
    if (error?.code === 'EEXIST') {
      return {
        status: 'conflicting',
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
    await rm(destination, { force: true }).catch(() => {});
    throw error;
  }
  workspace.assets.push({
    id,
    digest,
    path: destination,
    source: resolvedSource,
    importedAt: new Date().toISOString(),
    stats: verification.stats,
  });
  workspace.activeAsset = id;
  try {
    await writeWorkspace(workspace);
  } catch (error) {
    await rm(destination, { force: true }).catch(() => {});
    throw error;
  }

  return {
    status: 'imported',
    source: resolvedSource,
    id,
    path: destination,
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
  } catch {
    throw new Error(`active Glina asset is missing: ${asset.path}; import it again or select another asset`);
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

// The Glina workspace document: where it lives, how it is read and checked,
// and how a change to it is written so no reader sees half of one.

import { randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export const WORKSPACE_SCHEMA = 'glina.workspace.v1';

export function workspaceRoot() {
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

export async function readWorkspace() {
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

export async function writeWorkspace(workspace) {
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


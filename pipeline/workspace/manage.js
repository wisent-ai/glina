// What can be done to an asset already in the workspace: make it the active
// input, or take it out. The counterparts of importAsset, which adds an
// asset and activates it.

import { rm } from 'node:fs/promises';

import { readWorkspace, writeWorkspace } from './store.js';
import { workspaceSummary } from './assets.js';

function requireKnown(workspace, id) {
  const asset = workspace.assets.find((candidate) => candidate.id === id);
  if (asset) return asset;
  const held = workspace.assets.map((candidate) => candidate.id);
  throw new Error(held.length
    ? `the Glina workspace holds no asset named ${id}; it holds ${held.join(', ')}`
    : `the Glina workspace holds no asset named ${id}; it holds none — import one with \`glina import <file.glb>\``);
}

/** Make `id` the active asset every command reads when no file is named. */
export async function selectAsset(id) {
  const workspace = await readWorkspace();
  requireKnown(workspace, id);
  if (workspace.activeAsset === id) throw new Error(`asset ${id} is already the active one`);
  workspace.activeAsset = id;
  await writeWorkspace(workspace);
  return workspaceSummary();
}

/**
 * Take `id` out of the workspace and delete the workspace's copy; the file it
 * was imported from is not touched. Removing the active asset leaves no
 * active asset, rather than activating one nobody chose.
 */
export async function removeAsset(id) {
  const workspace = await readWorkspace();
  const asset = requireKnown(workspace, id);
  workspace.assets = workspace.assets.filter((candidate) => candidate.id !== id);
  if (workspace.activeAsset === id) workspace.activeAsset = null;
  await writeWorkspace(workspace);
  try {
    await rm(asset.path);
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      throw new Error(`asset ${id} left the workspace but its copy ${asset.path} was not deleted: ${error.message}`, { cause: error });
    }
  }
  return workspaceSummary();
}

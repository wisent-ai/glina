// doctor.js — `glina doctor`: one check per dependency the pipeline needs,
// each reaching the real thing (the config and its vault references, the
// Blender MCP bridge, the Weles MCP browser layer) and reporting what it
// observed. The report is the same for the CLI, the MCP tool and Glina
// Desktop; it never names a vendor as the operation, only as the detail.

import { checkPipelineConfig, loadPipelineConfig } from '../config.js';
import { BlenderSession } from '../gate/blender.js';
import { McpStdioClient } from './weles.js';

/**
 * Run every check. Each entry is {name, ok, detail} and a failed check
 * carries `error`, the message of the step that broke, so the operator
 * sees which dependency refused and why rather than one combined false.
 * @param {{configPath: string}} options
 * @returns {Promise<{healthy: boolean, checks: object[]}>}
 */
export async function runDoctor({ configPath }) {
  const checks = [
    await configCheck(configPath),
    await sculptorCheck(configPath),
    await browserCheck(),
  ];
  return { healthy: checks.every((check) => check.ok), checks };
}

async function configCheck(configPath) {
  try {
    const resolved = await checkPipelineConfig(configPath);
    return { name: 'config', ok: true, detail: { path: configPath, keys: Object.keys(resolved) } };
  } catch (error) {
    return { name: 'config', ok: false, detail: { path: configPath }, error: error.message };
  }
}

/** The Blender MCP bridge: handshake, tool list, and the trivial-code probe. */
async function sculptorCheck(configPath) {
  let sessionOptions;
  try {
    sessionOptions = (await loadPipelineConfig(configPath)).blender?.mcp;
  } catch {
    // The config check above already reports an unreadable config; the
    // bridge is still probed with its defaults so both facts are visible.
  }
  let session;
  try {
    session = await BlenderSession.start(sessionOptions ?? {});
  } catch (error) {
    return { name: 'sculptor', ok: false, detail: { bridge: 'mcp-for-blender' }, error: error.message };
  }
  try {
    const health = await session.health();
    const tools = (await session.listTools()).map((tool) => tool.name);
    const check = { name: 'sculptor', ok: health.healthy, detail: { bridge: 'mcp-for-blender', tools } };
    if (!health.healthy) check.error = health.error;
    return check;
  } catch (error) {
    return { name: 'sculptor', ok: false, detail: { bridge: 'mcp-for-blender' }, error: error.message };
  } finally {
    await session.close();
  }
}

/** The Weles MCP browser layer: handshake and the tools it exposes. */
async function browserCheck() {
  const client = new McpStdioClient({});
  try {
    await client.start();
    const tools = (await client.listTools()).map((tool) => tool.name);
    return { name: 'browser', ok: true, detail: { bridge: 'weles-mcp', tools } };
  } catch (error) {
    return { name: 'browser', ok: false, detail: { bridge: 'weles-mcp' }, error: error.message };
  } finally {
    await client.close();
  }
}

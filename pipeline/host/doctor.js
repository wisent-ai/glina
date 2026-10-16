// doctor.js — `glina doctor`: one check per dependency the pipeline needs,
// each reaching the real thing (the config and its vault references, the
// Blender MCP bridge, the browser layer the config declares) and reporting
// what it observed. The report is the same for the CLI, the MCP tool and
// Glina Desktop; it never names a vendor as the operation, only as the detail.

import { checkPipelineConfig, loadPipelineConfig } from '../config.js';
import { BlenderSession, releaseSession } from '../gate/blender.js';
import { probeBrowserBridge } from '../browser/bridge.js';

/** A failed check: its message is the cause, `detail` what was observed. */
class CheckFailure extends Error {
  constructor(message, detail) {
    super(message);
    this.name = 'CheckFailure';
    this.detail = detail;
  }
}

const CHECKS = [
  { name: 'config', run: configCheck },
  { name: 'sculptor', run: sculptorCheck },
  { name: 'browser', run: browserCheck },
];

/**
 * Run every check. Each entry is {name, ok, detail} and a failed check
 * carries `error`, the message of the step that broke, so the operator
 * sees which dependency refused and why rather than one combined false.
 * @param {{configPath: string}} options
 * @returns {Promise<{healthy: boolean, checks: object[]}>}
 */
export async function runDoctor({ configPath }) {
  const outcomes = await Promise.allSettled(CHECKS.map((check) => check.run(configPath)));
  const checks = outcomes.map((outcome, index) => {
    const { name } = CHECKS[index];
    if (outcome.status === 'fulfilled') {
      return { name, ok: true, detail: outcome.value };
    }
    return { name, ok: false, detail: outcome.reason.detail, error: outcome.reason.message };
  });
  return { healthy: checks.every((check) => check.ok), checks };
}

async function configCheck(configPath) {
  const resolved = await checkPipelineConfig(configPath).catch((error) => {
    throw new CheckFailure(error.message, { path: configPath });
  });
  return { path: configPath, keys: Object.keys(resolved) };
}

/** The config the bridge checks read their declarations from. */
async function declaredConfig(configPath, bridge) {
  return loadPipelineConfig(configPath).catch((error) => {
    throw new CheckFailure(
      `the config that declares the ${bridge} could not be loaded: ${error.message}`,
      { path: configPath },
    );
  });
}

/** The Blender MCP bridge: handshake, tool list, and the trivial-code probe. */
async function sculptorCheck(configPath) {
  const config = await declaredConfig(configPath, 'Blender MCP bridge');
  const detail = { bridge: 'mcp-for-blender' };
  const session = await BlenderSession.start(config.blender?.mcp).catch((error) => {
    throw new CheckFailure(error.message, detail);
  });
  try {
    const health = await session.health();
    const tools = (await session.listTools()).map((tool) => tool.name);
    if (!health.healthy) {
      throw new CheckFailure(health.error, { ...detail, tools });
    }
    return { ...detail, tools };
  } finally {
    // A close that fails is said by the releaser and does not replace the
    // check's own answer with the close's error.
    await releaseSession(session);
  }
}

/**
 * The declared browser layer (browser.weles or browser.playwright_mcp):
 * handshake with its MCP server and the tools it exposes.
 */
async function browserCheck(configPath) {
  const config = await declaredConfig(configPath, 'browser layer');
  return probeBrowserBridge(config.browser).catch((error) => {
    throw new CheckFailure(error.message, { path: configPath });
  });
}

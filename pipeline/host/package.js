// package.js — what the installed package says about itself: its version, as
// package.json states it, and whether a module is the program node was asked
// to run.

import { readFileSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const MANIFEST = new URL('../../package.json', import.meta.url);

/** The version package.json declares, named in every MCP handshake glina makes or answers. */
export const PACKAGE_VERSION = JSON.parse(readFileSync(MANIFEST, 'utf8')).version;

/**
 * Whether the module at `moduleUrl` is the program node runs, so importing it
 * does not take over the process. An installed `glina` or `glina-mcp` is a
 * symlink to the module, so both sides are compared after resolving links:
 * comparing the link's own path made every installed command print nothing
 * and exit 0. A program path that cannot be resolved is an error naming it,
 * never a silent "not invoked".
 */
export function invokedDirectly(moduleUrl) {
  const program = process.argv[1];
  if (program === undefined) return false;
  const module = fileURLToPath(moduleUrl);
  let invoked;
  try {
    invoked = realpathSync(program);
  } catch (error) {
    throw new Error(`glina cannot resolve the program node was started with, ${program}: ${error.message}`, { cause: error });
  }
  return invoked === realpathSync(module);
}

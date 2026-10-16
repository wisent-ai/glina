// bridge.js — which browser layer a pipeline run uses, read from the config's
// `browser` section the way `models` picks a model backend:
//
//   browser.weles           Weles through its MCP server (weles-mcp):
//                           {headless, engine, command, args}, every key optional
//   browser.playwright_mcp  the Playwright MCP server, for a user without Weles:
//                           {command, args}, both required
//
// Exactly one is declared. No section, an unknown key or both keys is an
// error that names what to declare; nothing is picked on the user's behalf.

import { McpStdioClient, WelesBrowserSession, welesServer } from '../host/weles.js';
import { PlaywrightMcpSession, requirePlaywrightServer } from './playwright_mcp.js';

export class BrowserConfigError extends Error {
  constructor(message) {
    super(message);
    this.name = 'BrowserConfigError';
  }
}

const DECLARE =
  'declare browser.weles to drive Weles, or browser.playwright_mcp (command, args) ' +
  'to drive the Playwright MCP server without Weles';

/** The declared bridge: `{name, settings}` with name `weles` or `playwright_mcp`. */
export function browserBridge(browser) {
  if (browser === undefined || browser === null || typeof browser !== 'object') {
    throw new BrowserConfigError(`no browser layer is configured: ${DECLARE}`);
  }
  const declared = Object.keys(browser);
  const unknown = declared.filter((key) => key !== 'weles' && key !== 'playwright_mcp');
  if (unknown.length) {
    throw new BrowserConfigError(`browser.${unknown.join(', browser.')} is not a browser layer: ${DECLARE}`);
  }
  const [name, ...extra] = declared;
  if (name === undefined) {
    throw new BrowserConfigError(`the browser section is empty: ${DECLARE}`);
  }
  if (extra.length) {
    throw new BrowserConfigError('both browser.weles and browser.playwright_mcp are declared: keep the one this pipeline uses');
  }
  const settings = browser[name];
  if (settings === null || typeof settings !== 'object') {
    throw new BrowserConfigError(`browser.${name} must be an object, got ${JSON.stringify(settings)}`);
  }
  return { name, settings };
}

/** Open one browser session on the declared layer. */
export async function startBrowserSession(browser) {
  const { name, settings } = browserBridge(browser);
  if (name === 'playwright_mcp') {
    return PlaywrightMcpSession.start(settings);
  }
  return WelesBrowserSession.start({
    command: settings.command,
    args: settings.args,
    headless: settings.headless,
    browser: settings.engine,
  });
}

/**
 * Handshake with the declared layer's MCP server and list its tools, without
 * opening a browser: what `glina doctor` reports for the browser check.
 */
export async function probeBrowserBridge(browser) {
  const { name, settings } = browserBridge(browser);
  if (name === 'playwright_mcp') {
    requirePlaywrightServer(settings);
  }
  const server = name === 'playwright_mcp' ? settings : welesServer(settings);
  const client = new McpStdioClient({ command: server.command, args: server.args });
  try {
    await client.start();
    const tools = (await client.listTools()).map((tool) => tool.name);
    return { bridge: name, command: client.command, tools };
  } finally {
    await client.close();
  }
}

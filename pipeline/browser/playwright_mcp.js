// playwright_mcp.js — the pipeline's browser layer without Weles: one page
// driven through the Playwright MCP server, for a user who runs Glina on its
// own. The server owns one browser and its current tab, so a session holds
// exactly one page. How the server is started (program and arguments) is the
// config's browser.playwright_mcp; nothing here names a package or a version.
//
// The studio selectors from the pipeline config are passed to the server as
// Playwright targets (a unique element selector). An evaluated value is read
// from the reply's `Result` section: the server answers one text item made of
// sections headed `### <title>`, and `Result` carries the value as JSON. A
// reply without that section, or with a section that is not JSON, is an error
// that quotes the reply, never a guessed value.

import { McpStdioClient } from '../host/weles.js';

export class PlaywrightMcpError extends Error {
  constructor(message, { cause } = {}) {
    super(message);
    this.name = 'PlaywrightMcpError';
    this.cause = cause;
  }
}

/** One browser session over a spawned Playwright MCP server. */
export class PlaywrightMcpSession {
  /** @param {{command: string, args: string[]}} server how the server is started */
  static async start(server) {
    requirePlaywrightServer(server);
    const client = new McpStdioClient({ command: server.command, args: server.args });
    await client.start();
    return new PlaywrightMcpSession(client);
  }

  constructor(client) {
    this.client = client;
  }

  /** The server's current tab; a navigation opens it when none is open. */
  async newPage() {
    return new PlaywrightMcpPage(this.client);
  }

  async close() {
    try {
      await call(this.client, 'browser_close', {});
    } finally {
      await this.client.close();
    }
  }
}

export class PlaywrightMcpPage {
  constructor(client) {
    this.client = client;
  }

  async goto(url) {
    return call(this.client, 'browser_navigate', { url });
  }

  async text() {
    return this.evaluate('document.body.innerText');
  }

  async click(selector) {
    return call(this.client, 'browser_click', { element: selector, target: selector });
  }

  async fill(selector, value) {
    return call(this.client, 'browser_type', { element: selector, target: selector, text: value });
  }

  /** `path` is resolved by the server against its workspace root. */
  async screenshot(path) {
    return call(this.client, 'browser_take_screenshot', { filename: path });
  }

  async evaluate(expression) {
    const reply = await call(this.client, 'browser_evaluate', { function: `() => (${expression})` });
    return resultValue(reply);
  }
}

async function call(client, tool, args) {
  try {
    return await client.callTool(tool, args);
  } catch (error) {
    throw new PlaywrightMcpError(`playwright MCP ${tool} failed: ${error.message}`, { cause: error });
  }
}

/** A Playwright MCP server declaration names its program and its arguments. */
export function requirePlaywrightServer(server) {
  if (server === undefined || server === null || typeof server !== 'object') {
    throw new PlaywrightMcpError(
      'browser.playwright_mcp must be an object naming the program that starts the Playwright MCP server (command) and its arguments (args)',
    );
  }
  if (typeof server.command !== 'string' || !server.command) {
    throw new PlaywrightMcpError('browser.playwright_mcp.command must name the program that starts the Playwright MCP server');
  }
  if (!Array.isArray(server.args) || !server.args.every((arg) => typeof arg === 'string')) {
    throw new PlaywrightMcpError(`browser.playwright_mcp.args must be a list of strings, got ${JSON.stringify(server.args)}`);
  }
}

const RESULT_HEADING = 'Result\n';

function resultValue(reply) {
  const content = reply.content;
  if (!Array.isArray(content)) {
    throw new PlaywrightMcpError(`playwright MCP browser_evaluate reply has no content: ${JSON.stringify(reply)}`);
  }
  const [first] = content;
  if (first === undefined || first.type !== 'text' || typeof first.text !== 'string') {
    throw new PlaywrightMcpError(`playwright MCP browser_evaluate reply does not start with a text item: ${JSON.stringify(reply)}`);
  }
  const section = first.text.split(/^### /m).find((part) => part.startsWith(RESULT_HEADING));
  if (section === undefined) {
    throw new PlaywrightMcpError(`playwright MCP browser_evaluate reply has no Result section: ${first.text}`);
  }
  const body = section.slice(RESULT_HEADING.length).trim();
  try {
    return JSON.parse(body);
  } catch (error) {
    throw new PlaywrightMcpError(`playwright MCP browser_evaluate Result is not JSON (${error.message}): ${body}`);
  }
}

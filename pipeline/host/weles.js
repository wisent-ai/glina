// weles.js — the pipeline's MCP stdio client, and browser access through the
// Weles MCP server.
//
// The pipeline never launches its own browser and never touches a local
// browser profile (no Chrome cookie DBs, no user-data-dir scraping). With
// browser.weles, page automation goes through the Weles MCP stdio server,
// whose tool surface is:
//
//   weles_browser_start / weles_browser_close
//   weles_page_new / weles_page_goto / weles_page_text
//   weles_page_click / weles_page_fill / weles_page_screenshot / weles_page_evaluate
//
// Weles answers every tool with one text item: a JSON object for ids, the
// page text as it is for weles_page_text, and the JSON of the value for
// weles_page_evaluate. A reply of any other shape is an error that quotes it.
//
// McpStdioClient is the JSON-RPC 2.0 client every MCP server here is spoken
// to with (Weles, the Playwright MCP server, the Blender MCP server); its
// errors name the program it started.

import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import readline from 'node:readline';
import { PACKAGE_VERSION } from './package.js';

/** The program that starts the Weles MCP server when browser.weles names none. */
const WELES_MCP = 'weles-mcp';

export class WelesError extends Error {
  /** @param {string} message @param {{code?: number, cause?: Error}} details */
  constructor(message, details) {
    super(message);
    this.name = 'WelesError';
    this.code = details.code;
    this.cause = details.cause;
  }
}

/**
 * Low-level JSON-RPC client over a spawned MCP stdio server.
 *
 * `env` is the child's whole environment. Without one the child gets PATH
 * and HOME only, so no credential of this process leaks through inheritance.
 */
export class McpStdioClient {
  /** @param {{command: string, args?: string[], env?: object}} server */
  constructor(server) {
    if (typeof server.command !== 'string' || !server.command) {
      throw new WelesError(`an MCP server needs the program that starts it, got ${JSON.stringify(server.command)}`, {});
    }
    this.command = server.command;
    this.args = server.args;
    this.env = server.env === undefined ? { PATH: process.env.PATH, HOME: process.env.HOME } : server.env;
    this.label = `MCP server ${server.command}`;
    this.process = null;
    this.pending = new Map();
  }

  async start() {
    if (this.process) return;
    this.process = spawn(this.command, this.args, {
      env: this.env,
      stdio: ['pipe', 'pipe', 'inherit'],
    });
    this.process.on('error', (error) => {
      this._failAll(new WelesError(`${this.label} process failed to start: ${error.message}`, { cause: error }));
    });
    this.process.on('exit', (code, signal) => {
      this._failAll(new WelesError(`${this.label} process exited (code ${code}, signal ${signal})`, {}));
    });
    const rl = readline.createInterface({ input: this.process.stdout });
    rl.on('line', (line) => this._onLine(line));
    await this._request('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'glina', version: PACKAGE_VERSION },
    });
    this._notify('notifications/initialized');
  }

  _onLine(line) {
    const trimmed = line.trim();
    if (!trimmed) return;
    let message;
    try {
      message = JSON.parse(trimmed);
    } catch (parseError) {
      // stdout is the JSON-RPC stream; a line that is not JSON is the server
      // breaking the protocol, so it is said instead of dropped
      process.stderr.write(`glina: ${this.label} wrote a line that is not JSON-RPC (${parseError.message}): ${trimmed}\n`);
      return;
    }
    const entry = this.pending.get(message.id);
    if (entry === undefined) return;
    this.pending.delete(message.id);
    if (message.error) {
      entry.reject(new WelesError(
        `${this.label} answered error ${message.error.code}: ${message.error.message}`,
        { code: message.error.code },
      ));
    } else {
      entry.resolve(message.result);
    }
  }

  _send(message) {
    this.process.stdin.write(`${JSON.stringify(message)}\n`);
  }

  _notify(method) {
    this._send({ jsonrpc: '2.0', method });
  }

  _request(method, params) {
    if (!this.process) return Promise.reject(new WelesError(`${this.label} is not started`, {}));
    const id = randomUUID();
    // No deadline: a request settles with the server's answer, or with the
    // process `error`/`exit` that `_failAll` turns into a named WelesError.
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this._send({ jsonrpc: '2.0', id, method, params });
    });
  }

  _failAll(error) {
    for (const [, entry] of this.pending) {
      entry.reject(error);
    }
    this.pending.clear();
    this.process = null;
  }

  /** Call an MCP tool; a reply flagged isError is thrown with its content. */
  async callTool(name, args) {
    const result = await this._request('tools/call', { name, arguments: args });
    if (result.isError) {
      throw new WelesError(`${this.label} tool ${name} failed: ${JSON.stringify(result.content)}`, {});
    }
    return result;
  }

  async listTools() {
    const result = await this._request('tools/list', {});
    if (!Array.isArray(result.tools)) {
      throw new WelesError(`${this.label} answered tools/list without a tools list: ${JSON.stringify(result)}`, {});
    }
    return result.tools;
  }

  async close() {
    if (!this.process) return;
    this.process.stdin.end();
    this.process.kill('SIGTERM');
    this.process = null;
  }
}

/** How the Weles MCP server is started: browser.weles's command and args. */
export function welesServer(settings) {
  return { command: settings.command === undefined ? WELES_MCP : settings.command, args: settings.args };
}

/**
 * High-level browser session over one Weles browser slot.
 *
 * Usage:
 *   const session = await WelesBrowserSession.start({ headless: true });
 *   const page = await session.newPage();
 *   await page.goto('https://studio.example/login');
 *   await page.fill('#email', email);
 *   await page.click('button[type=submit]');
 *   await session.close();
 */
export class WelesBrowserSession {
  /** @param {{command?: string, args?: string[], env?: object, headless?: boolean, browser?: string}} options */
  static async start(options) {
    const client = new McpStdioClient({ ...welesServer(options), env: options.env });
    await client.start();
    const session = new WelesBrowserSession(client);
    const launch = {};
    if (options.headless !== undefined) launch.headless = options.headless;
    if (options.browser !== undefined) launch.browser = options.browser;
    const result = await client.callTool('weles_browser_start', launch);
    session.browserId = replyField(result, 'browserId');
    return session;
  }

  constructor(client) {
    this.client = client;
    this.browserId = null;
  }

  async newPage() {
    const result = await this.client.callTool('weles_page_new', { browserId: this.browserId });
    const pageId = replyField(result, 'pageId');
    return new WelesPage(this.client, pageId);
  }

  async close() {
    try {
      if (this.browserId) {
        await this.client.callTool('weles_browser_close', { browserId: this.browserId });
      }
    } finally {
      await this.client.close();
    }
  }
}

export class WelesPage {
  constructor(client, pageId) {
    this.client = client;
    this.pageId = pageId;
  }

  async goto(url) {
    return this.client.callTool('weles_page_goto', { pageId: this.pageId, url });
  }

  async text() {
    return replyText(await this.client.callTool('weles_page_text', { pageId: this.pageId }));
  }

  async click(selector) {
    return this.client.callTool('weles_page_click', { pageId: this.pageId, selector });
  }

  async fill(selector, value) {
    return this.client.callTool('weles_page_fill', { pageId: this.pageId, selector, value });
  }

  async screenshot(path) {
    return this.client.callTool('weles_page_screenshot', { pageId: this.pageId, path });
  }

  /** The value of `expression` in the page, from the JSON Weles answers. */
  async evaluate(expression) {
    const result = await this.client.callTool('weles_page_evaluate', { pageId: this.pageId, expression });
    return replyJson(result);
  }
}

/** The one text item a Weles reply carries; any other shape is an error naming it. */
function replyText(result) {
  const content = result.content;
  if (!Array.isArray(content)) {
    throw new WelesError(`weles MCP reply has no content: ${JSON.stringify(result)}`, {});
  }
  const [item, ...extra] = content;
  if (item === undefined || extra.length || typeof item.text !== 'string') {
    throw new WelesError(`weles MCP reply is not one text item: ${JSON.stringify(result)}`, {});
  }
  return item.text;
}

function replyJson(result) {
  const text = replyText(result);
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new WelesError(`weles MCP reply is not JSON (${error.message}): ${text}`, { cause: error });
  }
}

/**
 * The `field` of a Weles MCP tool reply: Weles answers with one text item
 * holding a JSON object (`{"browserId":"browser-1"}`). A reply without that
 * field is an error naming the reply; guessing a number out of its text sent
 * a browser id Weles never issued.
 */
function replyField(result, field) {
  const reply = replyJson(result);
  const value = reply === null || typeof reply !== 'object' ? undefined : reply[field];
  if (typeof value !== 'string' || !value) {
    throw new WelesError(`weles MCP reply carries no ${field}: ${JSON.stringify(reply)}`, {});
  }
  return value;
}

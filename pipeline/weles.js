// weles.js — browser access for the pipeline, ONLY through the Weles MCP API.
//
// The pipeline never launches its own browser and never touches a local
// browser profile (no Chrome cookie DBs, no user-data-dir scraping). All
// page automation goes through the Weles MCP stdio server, whose tool
// surface is:
//
//   weles_browser_start / weles_browser_close
//   weles_page_new / weles_page_goto / weles_page_text
//   weles_page_click / weles_page_fill / weles_page_screenshot / weles_page_evaluate
//
// This module is a minimal JSON-RPC 2.0 stdio client plus a session
// wrapper that owns one browser slot end-to-end.

import { spawn } from 'node:child_process';
import readline from 'node:readline';

export class WelesError extends Error {
  constructor(message, { code, cause } = {}) {
    super(message);
    this.name = 'WelesError';
    this.code = code;
    this.cause = cause;
  }
}

const REQUEST_TIMEOUT_MS = 120_000;

/** Low-level JSON-RPC client over a spawned MCP stdio server. */
export class McpStdioClient {
  constructor({ command = 'weles-mcp', args = [], env } = {}) {
    this.command = command;
    this.args = args;
    this.env = env;
    this.process = null;
    this.nextId = 1;
    this.pending = new Map();
  }

  async start() {
    if (this.process) return;
    // The pipeline's own secrets stay in this process — the MCP child
    // gets a scrubbed environment (PATH/HOME only) so no credential can
    // leak through env inheritance either.
    this.process = spawn(this.command, this.args, {
      env: this.env ?? { PATH: process.env.PATH, HOME: process.env.HOME },
      stdio: ['pipe', 'pipe', 'inherit'],
    });
    this.process.on('error', (error) => {
      this._failAll(new WelesError(`weles MCP process failed to start: ${error.message}`, { cause: error }));
    });
    this.process.on('exit', (code) => {
      this._failAll(new WelesError(`weles MCP process exited (code ${code})`));
    });
    const rl = readline.createInterface({ input: this.process.stdout });
    rl.on('line', (line) => this._onLine(line));
    await this._request('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'glina', version: '1.0.0' },
    });
    this._notify('notifications/initialized');
  }

  _onLine(line) {
    const trimmed = line.trim();
    if (!trimmed) return;
    let message;
    try {
      message = JSON.parse(trimmed);
    } catch {
      return; // non-JSON noise on stdout — the server should not emit any
    }
    const { id, result, error } = message;
    if (id === undefined || id === null) return;
    const entry = this.pending.get(id);
    if (!entry) return;
    this.pending.delete(id);
    clearTimeout(entry.timer);
    if (error) {
      entry.reject(new WelesError(error.message ?? 'weles MCP error', { code: error.code }));
    } else {
      entry.resolve(result);
    }
  }

  _send(message) {
    this.process.stdin.write(`${JSON.stringify(message)}\n`);
  }

  _notify(method, params) {
    this._send({ jsonrpc: '2.0', method, ...(params ? { params } : {}) });
  }

  _request(method, params) {
    if (!this.process) return Promise.reject(new WelesError('MCP client not started'));
    const id = this.nextId;
    this.nextId += 1;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new WelesError(`weles MCP request timed out: ${method}`));
      }, REQUEST_TIMEOUT_MS);
      this.pending.set(id, { resolve, reject, timer });
      this._send({ jsonrpc: '2.0', id, method, params });
    });
  }

  _failAll(error) {
    for (const [, entry] of this.pending) {
      clearTimeout(entry.timer);
      entry.reject(error);
    }
    this.pending.clear();
    this.process = null;
  }

  /** Call an MCP tool and unwrap its text content. */
  async callTool(name, args = {}) {
    const result = await this._request('tools/call', { name, arguments: args });
    if (result?.isError) {
      const text = result.content?.map((c) => c.text ?? '').join('\n');
      throw new WelesError(`weles tool ${name} failed: ${text || 'unknown error'}`);
    }
    return result;
  }

  async listTools() {
    const result = await this._request('tools/list', {});
    return result?.tools ?? [];
  }

  async close() {
    if (!this.process) return;
    try {
      this.process.stdin.end();
      this.process.kill('SIGTERM');
    } catch {
      // already gone
    }
    this.process = null;
  }
}

/**
 * High-level browser session over one Weles browser slot.
 *
 * Usage:
 *   const session = await WelesBrowserSession.start({ headless: true });
 *   const page = await session.newPage();
 *   await page.goto('https://example.com');
 *   await page.fill('#email', email);
 *   await page.click('button[type=submit]');
 *   await session.close();
 */
export class WelesBrowserSession {
  static async start(options = {}) {
    const client = new McpStdioClient({
      command: options.command ?? 'weles-mcp',
      args: options.args ?? [],
      env: options.env,
    });
    await client.start();
    const session = new WelesBrowserSession(client);
    const launch = {};
    if (options.headless !== undefined) launch.headless = options.headless;
    if (options.browser) launch.browser = options.browser;
    const result = await client.callTool('weles_browser_start', launch);
    session.browserId = result?.browserId ?? result?.browser_id ?? extractId(result);
    return session;
  }

  constructor(client) {
    this.client = client;
    this.browserId = null;
  }

  async newPage() {
    const result = await this.client.callTool('weles_page_new', { browserId: this.browserId });
    const pageId = result?.pageId ?? result?.page_id ?? extractId(result);
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

  async goto(url, options = {}) {
    return this.client.callTool('weles_page_goto', { pageId: this.pageId, url, ...options });
  }

  async text() {
    const result = await this.client.callTool('weles_page_text', { pageId: this.pageId });
    return result?.text ?? result?.content?.map((c) => c.text ?? '').join('') ?? '';
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

  async evaluate(expression) {
    const result = await this.client.callTool('weles_page_evaluate', {
      pageId: this.pageId,
      expression,
    });
    return result?.value ?? result?.text ?? result;
  }
}

function extractId(result) {
  const text = result?.content?.map((c) => c.text ?? '').join('\n') ?? '';
  const match = /"(?:browser|page)(?:_?[Ii]d)?"\s*:\s*"?(\d+)"?/.exec(text);
  if (match) return Number(match[1]);
  const bare = /(\d+)/.exec(text);
  if (bare) return Number(bare[1]);
  throw new WelesError(`could not parse id from weles MCP reply: ${text.slice(0, 200)}`);
}

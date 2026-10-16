// The browser layer a run uses is the one the config declares. These tests
// drive the real CLI: `glina doctor` refuses every malformed browser section
// by name, probes the Playwright MCP server a user without Weles declares,
// and `glina create` runs the whole studio flow through that server against
// a studio page served here, writing the artifact the page links to.

import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { constants } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { join, resolve } from 'node:path';
import { test } from 'node:test';

const root = resolve(import.meta.dirname, '../..');
const OWNER_ONLY = constants.S_IRUSR | constants.S_IWUSR;
const PLAYWRIGHT_MCP = { command: 'npx', args: ['--yes', '@playwright/mcp', '--headless', '--isolated'] };
const ACCOUNT = { login_email: 'maker@studio.example', login_password: 'studio-pass' };

async function workspace(name) {
  const build = join(root, 'build', 'tests');
  await mkdir(build, { recursive: true });
  return mkdtemp(join(build, `${name}-`));
}

function doctor(configPath) {
  const run = spawnSync(process.execPath, ['pipeline/cli.js', 'doctor', '--config', configPath], {
    cwd: root,
    encoding: 'utf8',
  });
  const report = JSON.parse(run.stdout);
  return { run, browser: report.checks.find((check) => check.name === 'browser') };
}

test('doctor refuses a missing, unknown, doubled or incomplete browser layer by name', async () => {
  const directory = await workspace('browser-refusals');
  const configPath = join(directory, 'pipeline.config.json');
  const refuses = async (config, message) => {
    await writeFile(configPath, JSON.stringify(config));
    const { run, browser } = doctor(configPath);
    assert.ok(run.status, `doctor passed with ${JSON.stringify(config)}`);
    assert.equal(browser.ok, false);
    assert.match(browser.error, message);
  };
  try {
    await refuses({}, /no browser layer is configured: declare browser\.weles.*browser\.playwright_mcp/);
    await refuses({ browser: {} }, /the browser section is empty/);
    await refuses({ browser: { engine: 'chromium', headless: true } }, /browser\.engine, browser\.headless is not a browser layer/);
    await refuses({ browser: { weles: {}, playwright_mcp: PLAYWRIGHT_MCP } }, /both browser\.weles and browser\.playwright_mcp are declared/);
    await refuses({ browser: { playwright_mcp: { args: [] } } }, /browser\.playwright_mcp\.command must name the program/);
    await refuses({ browser: { playwright_mcp: { command: 'npx' } } }, /browser\.playwright_mcp\.args must be a list of strings/);
    await refuses(
      { browser: { playwright_mcp: { command: join(directory, 'no-such-server'), args: [] } } },
      /process failed to start/,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('doctor probes the declared Playwright MCP server and names its tools', async () => {
  const directory = await workspace('browser-probe');
  const configPath = join(directory, 'pipeline.config.json');
  try {
    await writeFile(configPath, JSON.stringify({ browser: { playwright_mcp: PLAYWRIGHT_MCP } }));
    const { browser } = doctor(configPath);
    assert.equal(browser.ok, true, browser.error);
    assert.equal(browser.detail.bridge, 'playwright_mcp');
    assert.equal(browser.detail.command, PLAYWRIGHT_MCP.command);
    for (const tool of ['browser_navigate', 'browser_type', 'browser_click', 'browser_evaluate', 'browser_close']) {
      assert.ok(browser.detail.tools.includes(tool), `the server lists no ${tool}: ${browser.detail.tools}`);
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

/** A studio with a login form, a prompt form and the link the prompt produces. */
function studio(asset) {
  const seen = { sessions: [], prompts: [] };
  const page = (body) => `<!doctype html><html><body>${body}</body></html>`;
  const server = createServer((request, response) => {
    const url = new URL(request.url, `http://${request.headers.host}`);
    if (url.pathname === '/login') {
      response.end(page('<form action="/session"><input type="email" name="email"><input type="password" name="password"><button type="submit">Sign in</button></form>'));
    } else if (url.pathname === '/session') {
      seen.sessions.push(Object.fromEntries(url.searchParams));
      response.end(page('signed in'));
    } else if (url.pathname === '/generate') {
      response.end(page(`<textarea></textarea><button class="generate" onclick="
        fetch('/prompt', { method: 'POST', body: document.querySelector('textarea').value }).then(() => {
          const link = document.createElement('a');
          link.className = 'download-glb';
          link.href = '/asset.glb';
          document.body.append(link);
        })">Generate</button>`));
    } else if (url.pathname === '/prompt') {
      const chunks = [];
      request.on('data', (chunk) => chunks.push(chunk));
      request.on('end', () => {
        seen.prompts.push(Buffer.concat(chunks).toString('utf8'));
        response.end();
      });
    } else if (url.pathname === '/asset.glb') {
      response.end(asset);
    } else {
      response.end();
    }
  });
  return { server, seen };
}

function cli(args, env) {
  return new Promise((resolveRun) => {
    const child = spawn(process.execPath, ['pipeline/cli.js', ...args], { cwd: root, env });
    const out = [];
    const err = [];
    child.stdout.on('data', (chunk) => out.push(chunk));
    child.stderr.on('data', (chunk) => err.push(chunk));
    child.on('close', (status) => resolveRun({
      status,
      stdout: Buffer.concat(out).toString('utf8'),
      stderr: Buffer.concat(err).toString('utf8'),
    }));
  });
}

test('create runs the studio flow through the Playwright MCP server and writes the linked artifact', async () => {
  const directory = await workspace('browser-create');
  const asset = await readFile(join(root, 'assets', 'models', 'kamien.glb'));
  const { server, seen } = studio(asset);
  await new Promise((listening) => server.listen(listening));
  const base = `http://localhost:${server.address().port}`;
  const configPath = join(directory, 'pipeline.config.json');
  const credentialsPath = join(directory, 'credentials.json');
  const outDir = join(directory, 'out');
  try {
    await writeFile(credentialsPath, JSON.stringify({ 'text2game-account': ACCOUNT }), { mode: OWNER_ONLY });
    await writeFile(configPath, JSON.stringify({
      browser: { playwright_mcp: PLAYWRIGHT_MCP },
      credentials: {
        username: 'role://text2game-account/login_email',
        password: 'role://text2game-account/login_password',
      },
      studio: {
        loginUrl: `${base}/login`,
        generateUrl: `${base}/generate`,
        selectors: {
          loginUser: 'input[type=email]',
          loginPassword: 'input[type=password]',
          loginSubmit: 'button[type=submit]',
          promptInput: 'textarea',
          generateSubmit: 'button.generate',
        },
        artifact: { expression: "document.querySelector('a.download-glb')?.href" },
      },
      verify: { enabled: false },
    }));
    const run = await cli(
      ['create', 'granite boulder', '--out', outDir, '--config', configPath],
      { ...process.env, GLINA_CREDENTIALS_FILE: credentialsPath },
    );
    assert.ok(!run.status, run.stderr);
    const result = JSON.parse(run.stdout);
    assert.equal(result.outPath, join(outDir, 'granite-boulder.glb'));
    assert.equal(result.artifactUrl, `${base}/asset.glb`);
    assert.deepEqual(await readFile(result.outPath), asset);
    assert.deepEqual(seen.sessions, [{ email: ACCOUNT.login_email, password: ACCOUNT.login_password }]);
    assert.deepEqual(seen.prompts, ['granite boulder']);
  } finally {
    server.close();
    await rm(directory, { recursive: true, force: true });
  }
});

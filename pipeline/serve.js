// serve.js — `glina serve`: loopback HTTP/JSON backend for desktop apps.
//
// The desktop app spawns this once (`glina serve --port 0`) and talks to it
// over 127.0.0.1 HTTP — it never builds argv for the other CLI commands.
// On bind, exactly one line lands on stdout:
//
//   {"ready":true,"port":<number>}
//
// After that, stdout carries no protocol traffic; every failure is an HTTP
// response. All endpoints live under /v1 and every handler reuses the exact
// functions the CLI commands use (config.js, llm_blender.js, verify.js,
// preview.js, blender.js, weles.js) — no parallel implementation.
//
// Errors are non-2xx with body {"error": "<one sentence>"} — the product's
// own refusal sentence, verbatim from the underlying failure.
//
// Long-running jobs (sculpt / verify / preview-anim) stream NDJSON:
//   {"type":"log","stream":"stdout"|"stderr","chunk":"..."}  (zero or more)
//   {"type":"result","status":0,"json":{...}}                (exactly one, last)
// where `json` is the same document the CLI prints and `status` mirrors the
// CLI exit code.

import { createServer } from 'node:http';
import { format } from 'node:util';

import { loadPipelineConfig } from './config.js';
import { sculptWithLlm } from './llm_blender.js';
import { verifyAsset } from './verify.js';
import { renderAnimationPreview } from './preview.js';
import { BlenderSession } from './blender.js';
import { McpStdioClient } from './weles.js';
import { redactSecrets } from './cli.js';

const MAX_BODY_BYTES = 1024 * 1024;

function sendJson(res, status, document) {
  const body = JSON.stringify(document, null, 2);
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(body);
}

function sendError(res, status, error) {
  sendJson(res, status, { error: error instanceof Error ? error.message : String(error) });
}

function badRequest(message) {
  return Object.assign(new Error(message), { status: 400 });
}

async function readJsonBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw badRequest('request body too large');
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString('utf8');
  try {
    return text.trim() ? JSON.parse(text) : {};
  } catch {
    throw badRequest('request body is not valid JSON');
  }
}

/**
 * Redirect console output into NDJSON log events while a job runs.
 * Returns the restore function. The job functions log through console.*
 * (directly and inside the MCP/Blender layers), so patching console is how
 * the process's own stdout/stderr interleaving reaches the stream.
 */
function captureConsole(emit) {
  const original = {
    log: console.log,
    info: console.info,
    warn: console.warn,
    error: console.error,
  };
  console.log = console.info = (...args) => emit('stdout', `${format(...args)}\n`);
  console.warn = console.error = (...args) => emit('stderr', `${format(...args)}\n`);
  return () => Object.assign(console, original);
}

/**
 * Start the serve backend.
 * @param {object} opts { port, configPath }
 * @returns {Promise<{port: number}>} resolves once bound (server keeps the
 *   process alive; it serves until killed).
 */
export async function startServe({ port = 8080, configPath } = {}) {
  // After the ready line stdout is protocol-clean: anything the process
  // would log outside a streamed job goes to stderr instead.
  console.log = console.info = (...args) => process.stderr.write(`${format(...args)}\n`);

  // Streamed jobs patch the global console, so they run one at a time —
  // this keeps each job's log events on its own response.
  let jobChain = Promise.resolve();
  const enqueueJob = (task) => {
    const result = jobChain.then(() => task());
    jobChain = result.catch(() => {});
    return result;
  };

  /** Config the way the CLI commands treat it: required for sculpt, best-effort elsewhere. */
  const loadOptionalConfig = async () => {
    try {
      return await loadPipelineConfig(configPath);
    } catch {
      return {};
    }
  };

  const routes = {
    'GET /v1/health': async (req, res) => {
      sendJson(res, 200, { status: 'ok' });
    },

    'GET /v1/config': async (req, res) => {
      try {
        const config = await loadPipelineConfig(configPath);
        sendJson(res, 200, redactSecrets(config));
      } catch (error) {
        sendError(res, 500, error);
      }
    },

    'GET /v1/blender-health': async (req, res) => {
      try {
        const config = await loadOptionalConfig();
        const session = await BlenderSession.start(config.blender?.mcp ?? {});
        const healthy = await session.isHealthy();
        const tools = await session.listTools().catch(() => []);
        await session.close().catch(() => {});
        if (healthy) {
          sendJson(res, 200, {
            ok: true,
            detail: `Blender MCP handshake and execute probe succeeded; tools: ${tools.map((t) => t.name).join(', ')}`,
          });
        } else {
          sendJson(res, 200, {
            ok: false,
            error: 'Blender MCP server answered but the execute_blender_code probe failed',
          });
        }
      } catch (error) {
        sendJson(res, 200, { ok: false, error: error instanceof Error ? error.message : String(error) });
      }
    },

    'GET /v1/weles-tools': async (req, res) => {
      try {
        const client = new McpStdioClient({});
        await client.start();
        const tools = await client.listTools();
        await client.close();
        sendJson(res, 200, {
          tools: tools.map((tool) => ({ name: tool.name, description: tool.description ?? '' })),
        });
      } catch (error) {
        sendError(res, 500, error);
      }
    },

    'POST /v1/sculpt': (req, res) =>
      streamJob(req, res, {
        async prepare(body) {
          const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : '';
          if (!prompt) throw badRequest('sculpt requires a prompt');
          const config = await loadPipelineConfig(configPath);
          return {
            job: {
              prompt,
              outDir: body.outDir ?? undefined,
              maxRounds:
                body.rounds === undefined || body.rounds === null ? undefined : Number(body.rounds),
            },
            config,
          };
        },
        async run({ job, config }, emit) {
          const result = await sculptWithLlm(job, config, {
            onRound: (r) => emit('stderr', `[round ${r.round}] ${r.step.thought ?? ''}\n`),
          });
          return { status: 0, json: { ...result, transcript: undefined, rounds: result.rounds } };
        },
      }),

    'POST /v1/verify': (req, res) =>
      streamJob(req, res, {
        async prepare(body) {
          const path = typeof body.path === 'string' ? body.path : '';
          if (!path) throw badRequest('verify requires a .glb path');
          const config = await loadOptionalConfig();
          return { path, config };
        },
        async run({ path, config }) {
          const report = await verifyAsset(path, config);
          return { status: report.ok ? 0 : 1, json: report };
        },
      }),

    'POST /v1/preview-anim': (req, res) =>
      streamJob(req, res, {
        async prepare(body) {
          const path = typeof body.path === 'string' ? body.path : '';
          if (!path) throw badRequest('preview-anim requires a .glb path');
          const config = await loadOptionalConfig();
          return { path, clip: body.clip || undefined, config };
        },
        async run({ path, clip, config }) {
          const result = await renderAnimationPreview({
            glbPath: path,
            clip,
            sessionOptions: config.blender?.mcp,
          });
          return { status: 0, json: result };
        },
      }),
  };

  /**
   * Read + validate the request, then stream one job as NDJSON.
   * Failures before streaming (bad body, missing fields, config refusal)
   * are non-2xx error envelopes; failures mid-job mirror the CLI instead:
   * the refusal sentence on a stderr log event plus one status-1 result.
   */
  async function streamJob(req, res, { prepare, run }) {
    let context;
    try {
      const body = await readJsonBody(req);
      context = await prepare(body);
    } catch (error) {
      sendError(res, error.status ?? 500, error);
      return;
    }
    res.writeHead(200, { 'content-type': 'application/x-ndjson', 'cache-control': 'no-cache' });
    const emit = (stream, chunk) => {
      res.write(`${JSON.stringify({ type: 'log', stream, chunk })}\n`);
    };
    await enqueueJob(async () => {
      const restore = captureConsole(emit);
      try {
        const { status, json } = await run(context, emit);
        res.write(`${JSON.stringify({ type: 'result', status, json })}\n`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        emit('stderr', `error: ${message}\n`);
        res.write(`${JSON.stringify({ type: 'result', status: 1, json: { error: message } })}\n`);
      } finally {
        restore();
        res.end();
      }
    });
  }

  const server = createServer((req, res) => {
    const path = new URL(req.url, 'http://127.0.0.1').pathname;
    const handler = routes[`${req.method} ${path}`];
    if (!handler) {
      sendError(res, 404, `unknown endpoint: ${req.method} ${path}`);
      return;
    }
    Promise.resolve(handler(req, res)).catch((error) => {
      if (!res.headersSent) sendError(res, 500, error);
      else res.end();
    });
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });

  const bound = server.address().port;
  process.stdout.write(`${JSON.stringify({ ready: true, port: bound })}\n`);
  return { port: bound };
}

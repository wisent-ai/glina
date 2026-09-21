// The small HTTP manners the loopback server keeps: one JSON answer, one
// refusal, the body size it accepts, and the console capture that turns a
// job's output into stream events.
//
// Split out of `serve.js`, which had grown past the three-hundred-line
// limit.

import { format } from 'node:util';

const MAX_BODY_BYTES = 1024 * 1024;

export function sendJson(res, status, document) {
  const body = JSON.stringify(document, null, 2);
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(body);
}

export function sendError(res, status, error) {
  sendJson(res, status, { error: error instanceof Error ? error.message : String(error) });
}

export function badRequest(message) {
  return Object.assign(new Error(message), { status: 400 });
}

export async function readJsonBody(req) {
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
export function captureConsole(emit) {
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

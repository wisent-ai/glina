// skarbiec.js — the ONLY source of secrets for the asset-creation pipeline.
//
// Hard rule: every credential the pipeline uses is resolved from the local
// Skarbiec vault via its CLI. Nothing is read from process.env, browser
// profiles, cookie databases, or key files on disk. Config carries
// `skarbiec://<item-id>/<field>` references; this module is the single
// place that turns them into values (in memory, never written out).
//
// The skarbiec CLI enforces the vault's own policy + audit on every read,
// so callers inherit the vault's gating instead of re-implementing it.

import { execFile } from 'node:child_process';

export const SKARBIEC_REF_PATTERN = /^skarbiec:\/\/([A-Za-z0-9._:-]+)\/([A-Za-z0-9._-]+)$/;

export class SkarbiecError extends Error {
  constructor(message, { item, field, cause } = {}) {
    super(message);
    this.name = 'SkarbiecError';
    this.item = item;
    this.field = field;
    this.cause = cause;
  }
}

/** True when the value is a skarbiec reference string. */
export function isSkarbiecRef(value) {
  return typeof value === 'string' && SKARBIEC_REF_PATTERN.test(value);
}

/** Parse a skarbiec:// reference into { item, field }. Throws on malformed input. */
export function parseSkarbiecRef(ref) {
  const match = SKARBIEC_REF_PATTERN.exec(ref ?? '');
  if (!match) {
    throw new SkarbiecError(`malformed skarbiec reference: ${JSON.stringify(ref)}`);
  }
  return { item: match[1], field: match[2] };
}

function runSkarbiec(args, { binary, timeoutMs = 15_000 } = {}) {
  const bin = binary ?? process.env.SKARBIEC_BIN ?? 'skarbiec';
  return new Promise((resolve, reject) => {
    execFile(bin, args, { timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        reject(
          new SkarbiecError(`skarbiec CLI failed: ${stderr?.trim() || error.message}`, {
            cause: error,
          }),
        );
        return;
      }
      resolve(stdout);
    });
  });
}

/**
 * Resolve one skarbiec:// reference to its value via `skarbiec get <id>`.
 *
 * `get` prints the item's decrypted fields as JSON; we pick the requested
 * field. The value lives only in this process's memory — it is never
 * logged, cached to disk, or written to an env file by this module.
 */
export async function resolveSkarbiecRef(ref, options = {}) {
  const { item, field } = parseSkarbiecRef(ref);
  let parsed;
  try {
    const stdout = await runSkarbiec(['get', item], options);
    parsed = JSON.parse(stdout);
  } catch (error) {
    if (error instanceof SkarbiecError) {
      error.item = item;
      error.field = field;
      throw error;
    }
    throw new SkarbiecError(`skarbiec get ${item} returned non-JSON output`, {
      item,
      field,
      cause: error,
    });
  }
  const fields = parsed?.fields ?? parsed;
  const value = fields?.[field];
  if (typeof value !== 'string' || value.length === 0) {
    throw new SkarbiecError(`skarbiec item '${item}' has no non-empty field '${field}'`, {
      item,
      field,
    });
  }
  return value;
}

/**
 * Deep-resolve every skarbiec:// reference in a config tree.
 *
 * Strings that are references become their resolved values; all other
 * values pass through untouched. Resolution is sequential on purpose —
 * each vault read is a distinct audit entry, and the burst rate is tiny.
 */
export async function resolveConfigSecrets(node, options = {}, path = []) {
  if (isSkarbiecRef(node)) {
    try {
      return await resolveSkarbiecRef(node, options);
    } catch (error) {
      error.message = `${error.message} (at config path ${path.join('.') || '<root>'})`;
      throw error;
    }
  }
  if (Array.isArray(node)) {
    const out = [];
    for (let i = 0; i < node.length; i += 1) {
      out.push(await resolveConfigSecrets(node[i], options, [...path, i]));
    }
    return out;
  }
  if (node && typeof node === 'object') {
    const out = {};
    for (const [key, value] of Object.entries(node)) {
      out[key] = await resolveConfigSecrets(value, options, [...path, key]);
    }
    return out;
  }
  return node;
}

/** Names the pipeline is allowed to pull from process.env (non-secret only). */
const ENV_ALLOWLIST = new Set(['SKARBIEC_BIN', 'WELES_BIN', 'WELES_MCP_ARGS', 'NODE_ENV']);

/**
 * Guard used by the config loader: returns the env var only when it is a
 * non-secret operational override. Anything credential-shaped
 * (token/secret/key/password/cookie in the name) is refused so a leaked
 * env can't silently replace the vault.
 */
export function nonSecretEnv(name) {
  if (!ENV_ALLOWLIST.has(name)) {
    throw new SkarbiecError(
      `env var ${name} is not allowlisted — secrets must come from skarbiec:// references`,
    );
  }
  return process.env[name];
}

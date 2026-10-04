// credentials.js — resolves pipeline credential references.
//
// Config keeps role://<role>/<field> references: the role the vault item
// plays (its tag stado:role:<role>) and the field to read. No item is named,
// so replacing or renaming an item changes nothing in any config. Each value
// comes either from `stado credentials get --role ROLE --field FIELD` or from
// an owner-only JSON file of role -> field -> value selected by
// GLINA_CREDENTIALS_FILE. No credential value is read from an environment
// variable.

import { execFile } from 'node:child_process';

export const ROLE_REF_PATTERN = /^role:\/\/([A-Za-z0-9._:-]+)\/([A-Za-z0-9._-]+)$/;

export class CredentialError extends Error {
  constructor(message, { role, field, cause } = {}) {
    super(message);
    this.name = 'CredentialError';
    this.role = role;
    this.field = field;
    this.cause = cause;
  }
}

/** True when the value is a role reference string. */
export function isRoleRef(value) {
  return typeof value === 'string' && ROLE_REF_PATTERN.test(value);
}

/** Parse a role:// reference into { role, field }. Throws on malformed input. */
export function parseRoleRef(ref) {
  const match = ROLE_REF_PATTERN.exec(ref ?? '');
  if (!match) {
    throw new CredentialError(`malformed role reference: ${JSON.stringify(ref)}`);
  }
  return { role: match[1], field: match[2] };
}

function readThroughStado(role, field, { binary } = {}) {
  const bin = binary ?? nonSecretEnv('STADO_BIN') ?? 'stado';
  const args = ['credentials', 'get', '--role', role, '--field', field];
  return new Promise((resolve, reject) => {
    execFile(bin, args, { maxBuffer: 4 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        // A Stado that cannot be started is answered with the way to run
        // without it; a running Stado's own refusal is passed on as said.
        const missing = error.code === 'ENOENT';
        const detail = missing
          ? `${bin} cannot be started (${error.message}); without Stado set GLINA_CREDENTIALS_FILE ` +
            'to an owner-only JSON file of role -> field -> value'
          : stderr?.trim() || error.message;
        reject(
          new CredentialError(`${bin} ${args.join(' ')} failed: ${detail}`, { role, field, cause: error }),
        );
        return;
      }
      resolve(stdout.replace(/\n$/, ''));
    });
  });
}

/**
 * Resolve one role:// reference to its value. The value lives only in this
 * process's memory — it is never logged, cached to disk, or written to an
 * env file by this module.
 */
export async function resolveRoleRef(ref, options = {}) {
  const { role, field } = parseRoleRef(ref);
  const credentialsFile = options.credentialsFile ?? nonSecretEnv('GLINA_CREDENTIALS_FILE');
  const value = credentialsFile
    ? (await localRoles(credentialsFile))?.[role]?.[field]
    : await readThroughStado(role, field, options);
  if (typeof value !== 'string' || value.length === 0) {
    const source = credentialsFile ?? 'stado';
    throw new CredentialError(`${source}: the item playing role '${role}' has no non-empty field '${field}'`, {
      role,
      field,
    });
  }
  return value;
}

/**
 * The alternative to Stado for a user without it: GLINA_CREDENTIALS_FILE
 * names an owner-only JSON file of role -> field -> value, read in place of
 * `stado credentials get`. A file other users can read is refused.
 */
async function localRoles(path) {
  const { readFile, stat } = await import('node:fs/promises');
  let mode;
  try {
    mode = (await stat(path)).mode;
  } catch (error) {
    throw new CredentialError(`GLINA_CREDENTIALS_FILE ${path} cannot be read: ${error.message}`, {
      cause: error,
    });
  }
  if ((mode & 0o077) !== 0) {
    throw new CredentialError(
      `GLINA_CREDENTIALS_FILE ${path} must be readable by its owner only (mode ${(mode & 0o777).toString(8)})`,
    );
  }
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    throw new CredentialError(`GLINA_CREDENTIALS_FILE ${path} is not a JSON object of role -> field -> value`, {
      cause: error,
    });
  }
}

/**
 * Deep-resolve every role:// reference in a config tree.
 *
 * Strings that are references become their resolved values; all other
 * values pass through untouched. Resolution is sequential on purpose —
 * each vault read is a distinct audit entry, and the burst rate is tiny.
 */
export async function resolveConfigSecrets(node, options = {}, path = []) {
  if (isRoleRef(node)) {
    try {
      return await resolveRoleRef(node, options);
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
const ENV_ALLOWLIST = new Set([
  'STADO_BIN',
  'GLINA_CREDENTIALS_FILE',
  'WELES_BIN',
  'WELES_MCP_ARGS',
  'NODE_ENV',
]);

/**
 * Guard used by the config loader: returns the env var only when it is a
 * non-secret operational override, so a leaked env can't silently replace
 * the vault.
 */
export function nonSecretEnv(name) {
  if (!ENV_ALLOWLIST.has(name)) {
    throw new CredentialError(
      `env var ${name} is not allowlisted — secrets must come from role:// references`,
    );
  }
  return process.env[name];
}

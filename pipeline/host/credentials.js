// credentials.js — resolves pipeline credential references.
//
// Config keeps role://<role>/<field> references: the role the vault item
// plays (its tag stado:role:<role>) and the field to read. No item is named,
// so replacing or renaming an item changes nothing in any config. Each value
// comes either from `stado credentials get --role ROLE --field FIELD` (the
// program STADO_BIN names, `stado` when it names none) or from an owner-only
// JSON file of role -> field -> value selected by GLINA_CREDENTIALS_FILE.
// No credential value is read from an environment variable.

import { execFile } from 'node:child_process';
import { constants } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';

const ROLE_REF_PATTERN = /^role:\/\/([\w.:-]+)\/([\w.-]+)$/;

/** The program `stado credentials get` runs as when STADO_BIN names none. */
const STADO = 'stado';
/** Permission bits that let anyone but the owner read or change a file. */
const NOT_OWNER_ONLY = constants.S_IRWXG | constants.S_IRWXO;

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
function parseRoleRef(ref) {
  const match = typeof ref === 'string' ? ROLE_REF_PATTERN.exec(ref) : null;
  if (!match) {
    throw new CredentialError(`malformed role reference: ${JSON.stringify(ref)}`);
  }
  const [, role, field] = match;
  return { role, field };
}

/** An environment setting, `undefined` when it is unset or empty. */
function setting(name) {
  const value = process.env[name];
  return value === undefined || value === '' ? undefined : value;
}

function readThroughStado(role, field) {
  const configured = setting('STADO_BIN');
  const bin = configured === undefined ? STADO : configured;
  const args = ['credentials', 'get', '--role', role, '--field', field];
  return new Promise((resolve, reject) => {
    execFile(bin, args, { maxBuffer: Infinity }, (error, stdout, stderr) => {
      if (error) {
        // A Stado that cannot be started is answered with the way to run
        // without it; a running Stado's own refusal is passed on as said.
        const said = stderr.trim();
        let detail;
        if (error.code === 'ENOENT') {
          detail =
            `${bin} cannot be started (${error.message}); without Stado set GLINA_CREDENTIALS_FILE ` +
            'to an owner-only JSON file of role -> field -> value';
        } else if (said) {
          detail = said;
        } else {
          detail = error.message;
        }
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
async function resolveRoleRef(ref) {
  const { role, field } = parseRoleRef(ref);
  const credentialsFile = setting('GLINA_CREDENTIALS_FILE');
  const source = credentialsFile === undefined ? STADO : credentialsFile;
  const value =
    credentialsFile === undefined
      ? await readThroughStado(role, field)
      : fieldOf(await localRoles(credentialsFile), role, field);
  if (typeof value !== 'string' || !value) {
    throw new CredentialError(`${source}: the item playing role '${role}' has no non-empty field '${field}'`, {
      role,
      field,
    });
  }
  return value;
}

/** `roles[role][field]`, undefined when either level is absent. */
function fieldOf(roles, role, field) {
  const fields = roles[role];
  return fields !== null && typeof fields === 'object' ? fields[field] : undefined;
}

/**
 * The alternative to Stado for a user without it: GLINA_CREDENTIALS_FILE
 * names an owner-only JSON file of role -> field -> value, read in place of
 * `stado credentials get`. A file other users can read is refused.
 */
async function localRoles(path) {
  let mode;
  try {
    mode = (await stat(path)).mode;
  } catch (error) {
    throw new CredentialError(`GLINA_CREDENTIALS_FILE ${path} cannot be read: ${error.message}`, {
      cause: error,
    });
  }
  if (mode & NOT_OWNER_ONLY) {
    throw new CredentialError(
      `GLINA_CREDENTIALS_FILE ${path} must be readable by its owner only; its group or other users have access`,
    );
  }
  let roles;
  try {
    roles = JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    throw new CredentialError(`GLINA_CREDENTIALS_FILE ${path} is not a JSON object of role -> field -> value`, {
      cause: error,
    });
  }
  if (roles === null || typeof roles !== 'object' || Array.isArray(roles)) {
    throw new CredentialError(`GLINA_CREDENTIALS_FILE ${path} is not a JSON object of role -> field -> value`);
  }
  return roles;
}

/**
 * Deep-resolve every role:// reference in a config tree; `path` is where
 * `node` sits in it, named in a refusal.
 *
 * Strings that are references become their resolved values; all other
 * values pass through untouched. Resolution is sequential on purpose —
 * each vault read is a distinct audit entry, and the burst rate is tiny.
 */
export async function resolveConfigSecrets(node, path) {
  if (isRoleRef(node)) {
    try {
      return await resolveRoleRef(node);
    } catch (error) {
      const where = path.length ? path.join('.') : '<root>';
      error.message = `${error.message} (at config path ${where})`;
      throw error;
    }
  }
  if (Array.isArray(node)) {
    const out = [];
    for (const [index, item] of node.entries()) {
      out.push(await resolveConfigSecrets(item, [...path, index]));
    }
    return out;
  }
  if (node && typeof node === 'object') {
    const out = {};
    for (const [key, value] of Object.entries(node)) {
      out[key] = await resolveConfigSecrets(value, [...path, key]);
    }
    return out;
  }
  return node;
}

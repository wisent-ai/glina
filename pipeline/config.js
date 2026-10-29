// config.js — pipeline configuration loader with a strict secrets policy.
//
// Credential fields have a declared structure. A hand-written config must
// address those fields by the role their vault item plays
// (role://<role>/<field>); URLs, model names and selectors are not guessed to
// be secrets from their spelling. References are resolved only in memory. An
// `config export` handoff marks its root as already resolved.

import { lstat, readFile } from 'node:fs/promises';
import { isRoleRef, resolveConfigSecrets, CredentialError } from './host/credentials.js';
import { buildCompleter } from './sculpt/llm.js';
import { writeOwnerOnly } from './workspace/store.js';

function assertReference(value, path) {
  if (value !== undefined && !isRoleRef(value)) {
    throw new CredentialError(
      `config key '${path}' holds an inline value; ` +
        'secrets must be role://<role>/<field> references',
    );
  }
}

function assertNoInlineSecrets(config) {
  if (config._resolved === true) return;
  for (const [field, value] of Object.entries({ ...config.credentials })) {
    assertReference(value, `credentials.${field}`);
  }
  assertReference(config.models?.brama?.key, 'models.brama.key');
  assertReference(config.models?.brama?.bearer, 'models.brama.bearer');
  assertReference(config.models?.openai_compatible?.bearer, 'models.openai_compatible.bearer');
}

/**
 * Load + validate + resolve a pipeline config file.
 *
 * Returns the config with every role:// reference replaced by its
 * vault value. Non-secret settings (URLs, selectors, the browser layer)
 * pass through verbatim.
 */
export async function loadPipelineConfig(path) {
  return resolveConfigSecrets(await readPipelineConfig(path), []);
}

/** Only an absent default file is optional; explicit or malformed config fails. */
export async function loadOptionalPipelineConfig(path, implicitDefault) {
  try {
    return await loadPipelineConfig(path);
  } catch (error) {
    if (implicitDefault && error.code === 'ENOENT') return {};
    throw error;
  }
}

/**
 * `glina config export`: resolve every reference of the config at `path` and
 * write the result to `out` as a handoff for a remote run, owner-only from its
 * first byte, marked `_resolved: true` whatever the source said. Nothing is
 * written until every reference resolved; a directory at `out` is refused.
 */
export async function exportPipelineConfig(path, out) {
  const config = await loadPipelineConfig(path);
  let existing;
  try {
    existing = await lstat(out);
  } catch (error) {
    if (error.code !== 'ENOENT') throw new Error(`config export cannot inspect ${out}: ${error.message}`, { cause: error });
  }
  if (existing?.isDirectory()) {
    throw new Error(`config export --out ${out} is a directory; name the file the resolved config is written to`);
  }
  await writeOwnerOnly(out, `${JSON.stringify({ ...config, _resolved: true }, null, 2)}\n`);
  return { out, resolved: true };
}

/**
 * Resolve every reference in a pipeline config and answer the config as it
 * may be printed: each value that came from a reference reads
 * `<resolved: ok>`, every other value is shown as written. What is hidden is
 * decided by where the value came from, not by what its key is called, so a
 * bearer or an account e-mail resolved from the vault is never printed.
 */
export async function checkPipelineConfig(path) {
  const config = await readPipelineConfig(path);
  if (config._resolved === true) {
    throw new CredentialError(
      'resolved handoff files contain inline secrets; check the original config instead',
    );
  }
  const resolved = await resolveConfigSecrets(config, []);
  buildCompleter(resolved.models);
  return hideReferences(config);
}

function hideReferences(node) {
  if (isRoleRef(node)) return '<resolved: ok>';
  if (Array.isArray(node)) return node.map(hideReferences);
  if (node && typeof node === 'object') {
    return Object.fromEntries(Object.entries(node).map(([key, value]) => [key, hideReferences(value)]));
  }
  return node;
}

async function readPipelineConfig(path) {
  const raw = await readFile(path, 'utf8');
  let config;
  try {
    config = JSON.parse(raw);
  } catch (error) {
    throw new CredentialError(`pipeline config is not valid JSON: ${path}`, { cause: error });
  }
  if (config === null || typeof config !== 'object' || Array.isArray(config)) {
    throw new CredentialError(`pipeline config must be a JSON object: ${path}`);
  }
  assertNoInlineSecrets(config);
  return config;
}

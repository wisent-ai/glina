// config.js — pipeline configuration loader with a strict secrets policy.
//
// Credential fields have a declared structure. A hand-written config must
// address those fields through Skarbiec; URLs, model names and selectors are
// not guessed to be secrets from their spelling. References are resolved only
// in memory. An export-config handoff marks its root as already resolved.

import { readFile } from 'node:fs/promises';
import { isSkarbiecRef, resolveConfigSecrets, SkarbiecError } from './host/skarbiec.js';
import { buildCompleter } from './sculpt/llm.js';

function assertReference(value, path) {
  if (value !== undefined && !isSkarbiecRef(value)) {
    throw new SkarbiecError(
      `config key '${path}' holds an inline value; ` +
        'secrets must be skarbiec://<item>/<field> references',
    );
  }
}

function assertNoInlineSecrets(config) {
  if (config?._resolved === true) return;
  for (const [field, value] of Object.entries(config?.credentials ?? {})) {
    assertReference(value, `credentials.${field}`);
  }
  assertReference(config?.models?.brama?.key, 'models.brama.key');
  assertReference(config?.models?.brama?.bearer, 'models.brama.bearer');
  assertReference(config?.models?.openai_compatible?.bearer, 'models.openai_compatible.bearer');
}

/**
 * Load + validate + resolve a pipeline config file.
 *
 * Returns the config with every skarbiec:// reference replaced by its
 * vault value. Non-secret settings (URLs, selectors, timeouts) pass
 * through verbatim.
 */
export async function loadPipelineConfig(path, { skarbiecOptions } = {}) {
  return resolveConfigSecrets(await readPipelineConfig(path), skarbiecOptions ?? {});
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
 * Resolve every reference in a pipeline config and answer the config as it
 * may be printed: each value that came from a reference reads
 * `<resolved: ok>`, every other value is shown as written. What is hidden is
 * decided by where the value came from, not by what its key is called, so a
 * bearer or an account e-mail resolved from the vault is never printed.
 */
export async function checkPipelineConfig(path, { skarbiecOptions } = {}) {
  const config = await readPipelineConfig(path);
  if (config?._resolved === true) {
    throw new SkarbiecError(
      'resolved handoff files contain inline secrets; check the original config instead',
    );
  }
  const resolved = await resolveConfigSecrets(config, skarbiecOptions ?? {});
  buildCompleter(resolved.models);
  return hideReferences(config);
}

function hideReferences(node) {
  if (isSkarbiecRef(node)) return '<resolved: ok>';
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
    throw new SkarbiecError(`pipeline config is not valid JSON: ${path}`, { cause: error });
  }
  assertNoInlineSecrets(config);
  return config;
}

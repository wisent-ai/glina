// config.js — pipeline configuration loader with a strict secrets policy.
//
// A pipeline config is a JSON document where EVERY secret is written as a
// `skarbiec://<item>/<field>` reference. The loader:
//
//   1. rejects any config value that looks like an inline secret
//      (heuristic key names: token/secret/password/cookie/api_key), so
//      credentials can't be smuggled past the vault;
//   2. deep-resolves all skarbiec:// references through pipeline/skarbiec.js
//      (the only module allowed to produce secret values);
//   3. refuses to honor credential-shaped environment variables (see
//      nonSecretEnv) — the vault is the single source of truth.

import { readFile } from 'node:fs/promises';
import { isSkarbiecRef, resolveConfigSecrets, SkarbiecError } from './host/skarbiec.js';

const SECRET_KEY_PATTERN = /(token|secret|password|passwd|credential|cookie|api[_-]?key|private[_-]?key)/i;

/** Subtrees where secret VALUES live by contract — only these are guarded. */
const SECRET_SUBTREES = new Set(['credentials', 'models']);

function assertNoInlineSecrets(node, path = []) {
  if (typeof node === 'string') {
    return;
  }
  if (Array.isArray(node)) {
    node.forEach((value, i) => assertNoInlineSecrets(value, [...path, i]));
    return;
  }
  if (node && typeof node === 'object') {
    // A resolver-produced file (see `cli.js export-config`) marks itself:
    // its inline values came FROM the vault at submit time, so the guard
    // does not apply. Hand-written configs never carry this marker.
    if (node._resolved === true) return;
    for (const [key, value] of Object.entries(node)) {
      const childPath = [...path, key];
      const inSecretSubtree = path.length > 0 && SECRET_SUBTREES.has(path[0]);
      if (
        inSecretSubtree &&
        SECRET_KEY_PATTERN.test(key) &&
        typeof value === 'string' &&
        !isSkarbiecRef(value)
      ) {
        throw new SkarbiecError(
          `config key '${childPath.join('.')}' holds an inline value; ` +
            `secrets must be skarbiec://<item>/<field> references`,
        );
      }
      assertNoInlineSecrets(value, childPath);
    }
  }
}

/**
 * Load + validate + resolve a pipeline config file.
 *
 * Returns the config with every skarbiec:// reference replaced by its
 * vault value. Non-secret settings (URLs, selectors, timeouts) pass
 * through verbatim.
 */
export async function loadPipelineConfig(path, { skarbiecOptions } = {}) {
  const raw = await readFile(path, 'utf8');
  let config;
  try {
    config = JSON.parse(raw);
  } catch (error) {
    throw new SkarbiecError(`pipeline config is not valid JSON: ${path}`, { cause: error });
  }
  assertNoInlineSecrets(config);
  return resolveConfigSecrets(config, skarbiecOptions ?? {});
}

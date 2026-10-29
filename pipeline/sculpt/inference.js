// inference.js — where Glina's model calls go when models.brama names no
// address: Stado's capability resolution (`stado capabilities resolve
// inference --consumer glina`), which hands out Brama when it answers Glina
// and otherwise the next alternative the operator declared — an
// OpenAI-compatible endpoint, its model and the role of the item holding
// its key — or refuses naming every alternative's product, route and cause.
// Stado is the program STADO_BIN names, `stado` when it names none, as for
// credentials (host/credentials.js).

import { execFileSync } from 'node:child_process';

const CONSUMER = 'glina';

export class InferenceUnreachable extends Error {
  constructor(message, details) {
    super(message);
    this.name = 'InferenceUnreachable';
    this.cause = details?.cause;
  }
}

/** Every alternative a refusal envelope (stdout or stderr) names, as one sentence. */
function named(printed) {
  for (const text of printed) {
    try {
      const items = JSON.parse(text).details?.unreachable ?? [];
      const sentence = items.map((item) => `${item.product} at ${item.route}: ${item.cause}`).join('; ');
      if (sentence) return sentence;
    } catch {
      // Not the envelope; the next stream may be.
    }
  }
  return undefined;
}

function stado(args) {
  const bin = process.env.STADO_BIN || 'stado';
  return execFileSync(bin, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

/**
 * The model service that answers Glina: `{ provider: 'brama', url }`, or
 * `{ provider, url, model, bearer }` for an endpoint answering in Brama's
 * place. `failed` reports that Brama refused Glina, so Stado proves it again
 * now. Refused with InferenceUnreachable naming every alternative when none
 * answers, or naming Stado when it cannot be asked.
 */
export function resolveInference({ failed = false } = {}) {
  const args = ['capabilities', 'resolve', 'inference', '--consumer', CONSUMER];
  if (failed) args.push('--failed', 'brama');
  args.push('--json');
  let printed;
  try {
    printed = stado(args);
  } catch (error) {
    if (typeof error.status !== 'number') {
      throw new InferenceUnreachable(`no inference alternative could be asked: stado did not run: ${error.message}`, {
        cause: error,
      });
    }
    const said = named([String(error.stdout ?? ''), String(error.stderr ?? '')]);
    throw new InferenceUnreachable(
      `no inference alternative answers ${CONSUMER}: ${said ?? String(error.stderr ?? '').trim()}`,
    );
  }
  const answer = JSON.parse(printed);
  if (answer.provider === 'brama') return { provider: 'brama', url: answer.route };
  if (!answer.model) {
    throw new InferenceUnreachable(
      `${answer.provider} at ${answer.route} answers ${CONSUMER} in Brama's place but declares no model: ` +
        'set capabilities.inference.endpoint.model',
    );
  }
  let bearer = '';
  if (answer.key_role) {
    try {
      bearer = stado(['credentials', 'get', '--role', answer.key_role, '--field', 'token']).trim();
    } catch (error) {
      throw new InferenceUnreachable(
        `${answer.provider} at ${answer.route} answers ${CONSUMER} in Brama's place, but the key of role ` +
          `${answer.key_role} cannot be read: ${String(error.stderr ?? error.message).trim()}`,
        { cause: error },
      );
    }
  }
  return { provider: answer.provider, url: answer.route, model: answer.model, bearer };
}

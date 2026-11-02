// inference.js — where Glina's model requests go when models.brama names no
// address: each request is handed to Stado (`stado capabilities call
// inference --consumer glina`), which sends it to the first alternative in
// its selected order that answers — Brama, or a statement recorded for that
// exact request — and prints that answer, or refuses naming every
// alternative with its cause. Glina names no alternative and reads no bearer
// then, so one Stado adds is used without a change here. Stado is the
// program STADO_BIN names, `stado` when it names none, as for credentials
// (host/credentials.js).

import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);
const CONSUMER = 'glina';
/** The command each request is handed to. */
export const STADO_CALL = ['capabilities', 'call', 'inference', '--consumer', CONSUMER, '--json'];

export class InferenceUnreachable extends Error {
  constructor(message, details) {
    super(message);
    this.name = 'InferenceUnreachable';
    this.cause = details?.cause;
  }
}

function stadoBin() {
  return process.env.STADO_BIN || 'stado';
}

/** The `Error:` line of a failed Stado command, else its last line. */
function stadoCause(said) {
  const lines = said.split('\n').map((line) => line.trim()).filter(Boolean).reverse();
  const error = lines.find((line) => line.startsWith('Error: '));
  return error ? error.slice('Error: '.length) : (lines[0] ?? 'it said nothing');
}

/**
 * That Stado can be asked for Glina's inference alternatives, without asking
 * any of them: the family's order as `stado capabilities inference` lists it.
 * Refused with InferenceUnreachable naming why Stado could not be read.
 */
export function inferenceOrder() {
  const bin = stadoBin();
  let printed;
  try {
    printed = execFileSync(bin, ['capabilities', 'inference', '--json'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (error) {
    const said = typeof error.status === 'number' ? stadoCause(String(error.stderr ?? '')) : error.message;
    throw new InferenceUnreachable(`Stado's inference alternatives cannot be read: \`${bin} capabilities inference\` failed: ${said}`, { cause: error });
  }
  const order = JSON.parse(printed).alternatives?.[0]?.order;
  if (!Array.isArray(order) || !order.length) {
    throw new InferenceUnreachable(`\`${bin} capabilities inference\` declares no inference alternative`);
  }
  return order;
}

/**
 * One chat-completions request body, handed to Stado's inference
 * alternatives: `{ provider, answer }`, the alternative that answered and its
 * answer. Refused with InferenceUnreachable carrying Stado's sentence when
 * none answers, or naming Stado when it cannot run.
 */
export async function callInference(body) {
  const bin = stadoBin();
  const operation = `${bin} ${STADO_CALL.join(' ')}`;
  const pending = run(bin, STADO_CALL, { encoding: 'utf8', maxBuffer: Number.MAX_SAFE_INTEGER });
  pending.child.stdin.end(body);
  let stdout;
  try {
    ({ stdout } = await pending);
  } catch (error) {
    if (typeof error.code !== 'number') {
      throw new InferenceUnreachable(`\`${operation}\` could not run: ${error.message}`, { cause: error });
    }
    throw new InferenceUnreachable(
      `no inference alternative answered \`${operation}\` (exit ${error.code}): ${stadoCause(String(error.stderr ?? ''))}`,
      { cause: error },
    );
  }
  const printed = JSON.parse(stdout);
  return { provider: printed.resolution?.provider ?? 'stado', answer: printed.answer };
}

// The request for a GitHub star: after the operator's fifth successful prompt
// (`glina create` or `glina sculpt`, from the CLI, MCP or Glina Desktop, which
// runs this CLI) Glina asks once for a star on its public repository. The
// count and the answer live in $XDG_STATE_HOME/glina/star.json (default
// ~/.local/state/glina/star.json); `glina star` reads, dismisses and resets it.

import { mkdir, open, readFile, rename, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const INDENT = '  ';
const numbers = JSON.parse(await readFile(path.join(here, 'numeric-provenance.json'), 'utf8'));
const manifest = JSON.parse(await readFile(path.join(here, '..', '..', 'package.json'), 'utf8'));

/** How many successful prompts are sent before the request is made. */
export const THRESHOLD = numbers.prompts_before_request.value;

/** The public repository the request links to, from package.json. */
export const REPOSITORY = manifest.repository?.url?.replace(/^git\+/, '').replace(/\.git$/, '');
if (!REPOSITORY?.startsWith('https://github.com/')) {
  throw new Error(`package.json repository.url must name the public GitHub repository, not ${JSON.stringify(manifest.repository)}`);
}

export function stateFile() {
  const declared = process.env.XDG_STATE_HOME;
  const base = typeof declared === 'string' && declared.trim()
    ? declared.trim()
    : path.join(os.homedir(), '.local', 'state');
  return path.join(base, 'glina', 'star.json');
}

const KEYS = new Set(['prompts', 'shownAt', 'dismissedAt']);

async function read(file) {
  let text;
  try {
    text = await readFile(file, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return { prompts: 0 };
    throw new Error(`${file} cannot be read: ${error.message}`);
  }
  let record;
  try {
    record = JSON.parse(text);
  } catch (error) {
    throw new Error(`${file} is not a star record (${error.message}); \`glina star reset\` writes a new one`);
  }
  const unknown = Object.keys(record ?? {}).filter((key) => !KEYS.has(key));
  const whole = (value) => value === undefined || (Number.isInteger(value) && value >= 0);
  if (!record || typeof record !== 'object' || unknown.length || !Number.isInteger(record.prompts)
    || record.prompts < 0 || !whole(record.shownAt) || !whole(record.dismissedAt)) {
    throw new Error(`${file} is not a star record (it holds ${JSON.stringify(record)}); \`glina star reset\` writes a new one`);
  }
  return record;
}

// The whole record replaces the file at once, so a reader never sees half.
async function write(file, record) {
  await mkdir(path.dirname(file), { recursive: true });
  const staged = `${file}.${process.pid}.staged`;
  await writeFile(staged, `${JSON.stringify(record, null, INDENT)}\n`, { mode: 0o600 });
  try {
    await rename(staged, file);
  } catch (error) {
    await rm(staged, { force: true });
    throw new Error(`${file} cannot be replaced: ${error.message}`);
  }
}

// Exclusive creation of a lock beside the record: two glina processes
// finishing a prompt at once both count. A lock left by a process that is no
// longer running is named with its holder, never waited on silently.
async function locked(file, change) {
  await mkdir(path.dirname(file), { recursive: true });
  const lock = `${file}.lock`;
  let handle;
  try {
    handle = await open(lock, 'wx');
  } catch (error) {
    if (error.code !== 'EEXIST') throw new Error(`${lock} cannot be created: ${error.message}`);
    const holder = (await readFile(lock, 'utf8').catch(() => '')).trim();
    throw new Error(`${lock} is held${holder ? ` by process ${holder}` : ''}; another glina is changing the star record, or one stopped while it did — remove ${lock} when no glina runs`);
  }
  try {
    await handle.writeFile(`${process.pid}\n`);
    return await change();
  } finally {
    await handle.close();
    await rm(lock, { force: true });
  }
}

const seconds = () => Math.floor(Date.now() / 1000);

function status(file, record) {
  let stage = 'counting';
  if (record.dismissedAt !== undefined) stage = 'dismissed';
  else if (record.shownAt !== undefined) stage = 'shown';
  else if (record.prompts >= THRESHOLD) stage = 'due';
  return {
    stage,
    prompts: record.prompts,
    threshold: THRESHOLD,
    repository: REPOSITORY,
    file,
    shownAt: record.shownAt ?? null,
    dismissedAt: record.dismissedAt ?? null,
  };
}

export async function starStatus() {
  const file = stateFile();
  return status(file, await read(file));
}

/** Count one successful prompt; the status when this prompt makes the request due, else null. */
export async function observePrompt() {
  const file = stateFile();
  return locked(file, async () => {
    const record = await read(file);
    record.prompts += 1;
    const due = record.prompts >= THRESHOLD && record.shownAt === undefined && record.dismissedAt === undefined;
    if (due) record.shownAt = seconds();
    await write(file, record);
    return due ? status(file, record) : null;
  });
}

export async function dismiss() {
  const file = stateFile();
  return locked(file, async () => {
    const record = await read(file);
    record.dismissedAt ??= seconds();
    await write(file, record);
    return status(file, record);
  });
}

export async function reset() {
  const file = stateFile();
  return locked(file, async () => {
    const record = { prompts: 0 };
    await write(file, record);
    return status(file, record);
  });
}

export function requestText(request) {
  return `★ You have sent ${request.prompts} prompts with Glina. If it helps you, a star on GitHub helps other people find it: ${request.repository}\n\`glina star dismiss\` stops this message.`;
}

/**
 * Count a prompt that succeeded and say the request on standard error when
 * it is due, so standard output keeps only the result. A record that cannot
 * be kept is said on standard error and the prompt's own result stands.
 * Answers the request, or null.
 */
export async function countPrompt() {
  try {
    const request = await observePrompt();
    if (request) console.error(requestText(request));
    return request;
  } catch (error) {
    console.error(`glina: this prompt is not counted toward the GitHub star request: ${error.message}`);
    return null;
  }
}

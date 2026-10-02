// declared.js — the showcase assets and animation presets glina knows, as
// JSON files under assets/showcases and assets/presets. `glina showcases` and
// `glina presets` list, add and remove them; `glina showcase <asset>` and
// `glina animate --preset <name>` read them. Adding one is adding a file.

import { copyFile, mkdir, readdir, readFile, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export class DeclarationError extends Error {}

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

const DIRECTORIES = {
  showcase: join(ROOT, 'assets', 'showcases'),
  preset: join(ROOT, 'assets', 'presets'),
};

const NAME = /^[a-z0-9][a-z0-9-]*$/;

function directoryOf(kind) {
  const found = DIRECTORIES[kind];
  if (!found) throw new DeclarationError(`unknown declaration kind ${kind}`);
  return found;
}

function pathOf(kind, name) {
  if (typeof name !== 'string' || !NAME.test(name)) {
    throw new DeclarationError(`${kind} name must be lowercase letters, digits and dashes; got ${JSON.stringify(name)}`);
  }
  return join(directoryOf(kind), `${name}.json`);
}

/** Every declared name of `kind`, sorted. */
export async function list(kind) {
  let entries;
  try {
    entries = await readdir(directoryOf(kind));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    entries = [];
  }
  return entries.filter((entry) => entry.endsWith('.json')).map((entry) => entry.slice(0, -5)).sort();
}

/** What glina says when asked for a name it does not have. */
export async function availability(kind) {
  const known = await list(kind);
  return known.length
    ? `available: ${known.join(', ')}`
    : `none is declared; add one with glina ${kind}s add <name> <file.json>`;
}

/**
 * The declaration's refusal, or nothing when Blender can be given it: a JSON
 * object whose actions include the one it names active. Every other field is
 * read by the interpreter, which names the one it did not find.
 */
function problem(spec) {
  if (typeof spec !== 'object' || spec === null || Array.isArray(spec)) return 'is not a JSON object';
  if (!Array.isArray(spec.actions)) return 'has no actions list';
  if (!spec.actions.some((action) => action.name === spec.active)) {
    return `names active action ${JSON.stringify(spec.active)}, which is not one of its actions`;
  }
  return null;
}

async function parsed(path) {
  let spec;
  try {
    spec = JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    throw new DeclarationError(`${path}: ${error.message}`);
  }
  const wrong = problem(spec);
  if (wrong) throw new DeclarationError(`${path} ${wrong}`);
  return spec;
}

/** The declaration `name` of `kind`; a refusal names the ones that exist. */
export async function load(kind, name) {
  if (!(await list(kind)).includes(name)) {
    throw new DeclarationError(`unknown ${kind} ${name}; ${await availability(kind)}`);
  }
  return parsed(pathOf(kind, name));
}

/** Declare `name` from the JSON file at `source`, after checking it. */
export async function add(kind, name, source) {
  const target = pathOf(kind, name);
  await parsed(source);
  if ((await list(kind)).includes(name)) {
    throw new DeclarationError(`${kind} ${name} is already declared; remove it first`);
  }
  await mkdir(directoryOf(kind), { recursive: true });
  await copyFile(source, target);
  return { kind, name, path: target, outcome: 'added' };
}

/** Withdraw the declaration `name`. */
export async function remove(kind, name) {
  const target = pathOf(kind, name);
  if (!(await list(kind)).includes(name)) {
    throw new DeclarationError(`${kind} ${name} is not declared`);
  }
  await rm(target);
  return { kind, name, path: target, outcome: 'removed' };
}

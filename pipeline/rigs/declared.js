// Built-in declarations ship with the package; user additions live alongside
// the workspace so an installed or read-only package remains usable.

import { constants as fsConstants } from 'node:fs';
import { copyFile, mkdir, readdir, readFile, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { workspaceRoot } from '../workspace/store.js';

export class DeclarationError extends Error {}

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

const DIRECTORIES = {
  showcase: 'showcases',
  preset: 'presets',
};

const NAME = /^[a-z0-9][a-z0-9-]*$/;

function directoryOf(kind, user = false) {
  const suffix = DIRECTORIES[kind];
  if (!suffix) throw new DeclarationError(`unknown declaration kind ${kind}`);
  return user ? join(workspaceRoot(), suffix) : join(ROOT, 'assets', suffix);
}

function pathOf(kind, name, user = false) {
  if (typeof name !== 'string' || !NAME.test(name)) {
    throw new DeclarationError(`${kind} name must be lowercase letters, digits and dashes; got ${JSON.stringify(name)}`);
  }
  return join(directoryOf(kind, user), `${name}.json`);
}

/** Every declared name of `kind`, sorted. */
export async function list(kind) {
  const names = new Set();
  for (const directory of [directoryOf(kind), directoryOf(kind, true)]) {
    let entries;
    try {
      entries = await readdir(directory);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      entries = [];
    }
    for (const entry of entries) {
      if (entry.endsWith('.json')) names.add(entry.slice(0, -5));
    }
  }
  return [...names].sort();
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
    throw new DeclarationError(`${path}: ${error.message}`, { cause: error });
  }
  const wrong = problem(spec);
  if (wrong) throw new DeclarationError(`${path} ${wrong}`);
  return spec;
}

/** The declaration `name` of `kind`; a refusal names the ones that exist. */
export async function load(kind, name) {
  const builtIn = pathOf(kind, name);
  const user = pathOf(kind, name, true);
  if (!(await list(kind)).includes(name)) {
    throw new DeclarationError(`unknown ${kind} ${name}; ${await availability(kind)}`);
  }
  try {
    return await parsed(user);
  } catch (error) {
    if (error.cause?.code !== 'ENOENT') throw error;
  }
  return parsed(builtIn);
}

/** Declare `name` from the JSON file at `source`, after checking it. */
export async function add(kind, name, source) {
  const target = pathOf(kind, name, true);
  await parsed(source);
  if ((await list(kind)).includes(name)) {
    throw new DeclarationError(`${kind} ${name} is already declared; remove it first`);
  }
  await mkdir(directoryOf(kind, true), { recursive: true });
  await copyFile(source, target, fsConstants.COPYFILE_EXCL);
  return { kind, name, path: target, outcome: 'added' };
}

/** Withdraw only a user declaration, never one shipped with Glina. */
export async function remove(kind, name) {
  const target = pathOf(kind, name, true);
  if (!(await list(kind)).includes(name)) {
    throw new DeclarationError(`${kind} ${name} is not declared`);
  }
  try {
    await rm(target);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    throw new DeclarationError(`${kind} ${name} is built in and cannot be removed`);
  }
  return { kind, name, path: target, outcome: 'removed' };
}

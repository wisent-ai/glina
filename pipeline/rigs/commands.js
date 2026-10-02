// commands.js — `glina showcases` and `glina presets`: list, add and remove
// the declarations `glina showcase` and `glina animate --preset` read.

import { DeclarationError, add, list, remove } from './declared.js';

/** Run `glina <kind>s [list | add <name> <file.json> | remove <name>]`. */
export async function declarationCommand(kind, positional) {
  const [verb, name, file] = positional;
  if (verb === undefined || verb === 'list') {
    return { kind, names: await list(kind) };
  }
  if (verb === 'add') {
    if (!name || !file) throw new DeclarationError(`${kind}s add needs <name> <file.json>`);
    return add(kind, name, file);
  }
  if (verb === 'remove') {
    if (!name) throw new DeclarationError(`${kind}s remove needs <name>`);
    return remove(kind, name);
  }
  throw new DeclarationError(`${kind}s takes list, add or remove; got ${verb}`);
}

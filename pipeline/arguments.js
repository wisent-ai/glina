// What the command line accepts and what it prints when it does not
// recognise a verb.
//
// Split out of `cli.js`, which had grown past the three-hundred-line
// limit; running a command stays there.

export const DEFAULT_CONFIG = new URL('../pipeline.config.json', import.meta.url).pathname;

const FLAG = '--';

/** A command line glina refuses before running anything; the CLI exits 2 for it. */
export class UsageError extends Error {
  constructor(message) {
    super(message);
    this.name = 'UsageError';
  }
}

/** The whole number above zero a flag gives, `undefined` when it is absent. */
export function countOption(options, name) {
  const value = options[name];
  if (value === undefined) return undefined;
  const count = Number(value);
  if (!Number.isInteger(count) || !(count > 0)) {
    throw new UsageError(`--${name} takes a whole number above zero, got ${JSON.stringify(value)}`);
  }
  return count;
}

/** The number above zero a flag gives (a rate may be fractional), `undefined` when it is absent. */
export function rateOption(options, name) {
  const value = options[name];
  if (value === undefined) return undefined;
  const rate = Number(value);
  if (!Number.isFinite(rate) || !(rate > 0)) {
    throw new UsageError(`--${name} takes a number above zero, got ${JSON.stringify(value)}`);
  }
  return rate;
}

/** The indentation of the JSON a command prints. */
const JSON_INDENT = '  ';

/**
 * One result as people or machines read it, from the same value (cli.md
 * rule 13): pretty JSON by default, `path: value` lines with `--text`.
 */
export function render(value, text) {
  if (!text) return JSON.stringify(value, null, JSON_INDENT);
  const lines = [];
  const walk = (node, path) => {
    if (Array.isArray(node) && node.length) {
      node.forEach((item, index) => walk(item, `${path}[${index}]`));
    } else if (node && typeof node === 'object' && Object.keys(node).length) {
      for (const [key, item] of Object.entries(node)) walk(item, path ? `${path}.${key}` : key);
    } else if (node !== undefined) {
      const shown = node === null || typeof node === 'object' ? '-' : String(node);
      lines.push(path ? `${path}: ${shown}` : shown);
    }
  };
  walk(value, '');
  return lines.join('\n');
}

// One table, two readers: the top-level usage is every row in this order,
// and `glina <command> --help` is that command's rows (cli.md rule 11): a
// group such as `config` or `preview` answers with every one of its leaves.
export const COMMANDS = [
  { name: 'onboarding', usage: 'onboarding [--reset] [--asset file.glb] [--name id] [--config path]', help: 'first-run import or walkthrough replay' },
  { name: 'import', usage: 'import <file.glb> [--name id] [--variant-of base-id] [--config path]', help: 'validate, persist, and activate an asset or a variant of a base' },
  { name: 'workspace', usage: 'workspace [list | select <id> | remove <id>]', help: 'list imported assets and the active input; make one active; or take one out and delete its copy (the source file stays)' },
  { name: 'create', usage: 'create <prompt> [--race r] [--out dir] [--config path]', help: 'studio flow: generate one asset through the browser layer the config declares (browser.weles or browser.playwright_mcp)' },
  { name: 'sculpt', usage: 'sculpt <prompt> [--out dir] [--filename f.glb] [--rounds n] [--config path]', help: 'the model the config declares builds the asset in Blender round by round; --rounds or llm.maxRounds caps the rounds' },
  { name: 'preview anim', usage: 'preview anim [file.glb] [--clip name] [--frames n] [--fps n] [--out f.gif] [--config path]', help: 'render an animated GIF of one clip through Blender' },
  { name: 'preview scene', usage: 'preview scene [file.glb] [--out f.png] [--size px] [--config path]', help: 'render the asset on neutral ground in a framed Blender scene' },
  { name: 'animate', usage: 'animate [file.glb] --preset <name> [--out animated.glb] [--config path]', help: "apply a declared preset's visibly moving actions" },
  { name: 'showcase', usage: 'showcase <asset> [--out file.glb] [--config path]', help: 'build a declared animated reference asset' },
  { name: 'showcases', usage: 'showcases [list | add <name> <file.json> | remove <name>]', help: 'manage bundled and user showcase declarations' },
  { name: 'presets', usage: 'presets [list | add <name> <file.json> | remove <name>]', help: 'manage bundled and user animation presets' },
  { name: 'verify', usage: 'verify [file.glb] [--config path]', help: 'structural + optional render gate' },
  { name: 'config check', usage: 'config check [--config path]', help: 'validate the config, resolve vault references and check the model backend' },
  { name: 'config export', usage: 'config export --out <path> [--config path]', help: 'write a resolved, owner-only config for a remote run' },
  { name: 'doctor', usage: 'doctor [--config path]', help: 'check the config and vault references, the Blender MCP bridge (handshake + code probe) and the declared browser layer (its MCP server and tools); exits 1 when any check fails' },
  { name: 'setup', usage: 'setup [--check] [--dry-run]', help: 'provision Blender, uv and the MCP for Blender addon; --check inspects tools only' },
];

/**
 * Flags every command accepts, with whether each takes a value: `--text`
 * prints the same result as text, `--config` names the pipeline config the
 * commands whose usage lists it read.
 */
const GLOBAL_FLAGS = [['text', false], ['config', true]];

/** `--name` with the word after it in a usage row, when the flag takes one. */
const USAGE_FLAG = /--([a-z][\w-]*)( [^\s\]]+)?/g;

/**
 * The flags `glina <command> [leaf]` accepts, read from the usage rows the
 * help prints, so a flag is declared once: `--x value` in a row takes a value,
 * `[--x]` takes none. `null` when the words name no row (an unknown command or
 * group leaf), which that command's own refusal answers.
 */
function declaredFlags(command, leaf) {
  const rows = COMMANDS.filter((row) => {
    const [word, sub] = row.name.split(' ');
    return word === command && (sub === undefined || sub === leaf);
  });
  if (!rows.length) return null;
  const flags = new Map(GLOBAL_FLAGS);
  for (const row of rows) {
    for (const [, name, value] of row.usage.matchAll(USAGE_FLAG)) flags.set(name, value !== undefined);
  }
  return flags;
}

export function parseArgs(argv) {
  const [command, ...rest] = argv;
  const [leaf] = rest;
  const flags = declaredFlags(command, leaf);
  const grouped = COMMANDS.some((row) => row.name.startsWith(`${command} `));
  const words = grouped && leaf !== undefined && !leaf.startsWith(FLAG) ? `${command} ${leaf}` : command;
  const positional = [];
  const options = {};
  const queue = [...rest];
  while (queue.length) {
    const arg = queue.shift();
    if (!arg.startsWith(FLAG)) {
      positional.push(arg);
      continue;
    }
    const key = arg.slice(FLAG.length);
    if (Object.hasOwn(options, key)) {
      throw new UsageError(`glina ${words} was given ${arg} twice; give it once`);
    }
    const [next] = queue;
    let takesValue;
    if (flags === null) {
      // No row to read: a word after the flag is its value, except after --text.
      takesValue = key !== 'text' && next !== undefined && !next.startsWith(FLAG);
    } else if (flags.has(key)) {
      takesValue = flags.get(key);
    } else {
      const known = [...flags.keys()].map((name) => `${FLAG}${name}`).join(', ');
      throw new UsageError(`glina ${words} does not take ${arg}; it takes ${known}`);
    }
    if (!takesValue) {
      options[key] = true;
    } else if (next === undefined || next.startsWith(FLAG)) {
      throw new UsageError(`${arg} needs a value; glina ${command} --help shows what it takes`);
    } else {
      options[key] = queue.shift();
    }
  }
  return { command, positional, options };
}

/** Each row is the usage, then its help on the next line, one level deeper. */
const USAGE_INDENT = '  ';
const HELP_INDENT = '      ';

function rows(commands) {
  return commands.map((command) => `${USAGE_INDENT}${command.usage}\n${HELP_INDENT}${command.help}`);
}

const BOUNDARIES = `credentials come from role:// references in the config, answered by
stado credentials get --role or, without Stado, by the owner-only file GLINA_CREDENTIALS_FILE names;
models come from models.brama or, without Brama, models.openai_compatible;
browser automation goes through browser.weles (the Weles MCP server) or, without Weles,
browser.playwright_mcp (the Playwright MCP server);
Blender work goes only through the Blender MCP server.`;

export const USAGE = `usage: glina <command> [args] [--text]

Every command prints its result as JSON; --text prints the same result as
one path: value line per field. glina <command> --help prints one command.
A command takes only the flags its usage lists; any other flag, a flag
without its value or one given twice is a usage error (exit 2).

commands:
${rows(COMMANDS).join('\n')}

${BOUNDARIES}`;

/** The help for one command or group, or the whole usage when the word is neither. */
export function commandHelp(name) {
  const own = COMMANDS.filter((command) => {
    const [word] = command.name.split(' ');
    return word === name;
  });
  if (!own.length) return USAGE;
  const usage = own.map((command) => `usage: glina ${command.usage} [--text]`).join('\n');
  return `${usage}\n\n${rows(own).join('\n')}\n\n${BOUNDARIES}`;
}

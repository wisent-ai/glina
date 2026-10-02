// What the command line accepts and what it prints when it does not
// recognise a verb.
//
// Split out of `cli.js`, which had grown past the three-hundred-line
// limit; running a command stays there.

export const DEFAULT_CONFIG = new URL('../pipeline.config.json', import.meta.url).pathname;

export function parseArgs(argv) {
  const [command, ...rest] = argv;
  const positional = [];
  const options = {};
  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const next = rest[i + 1];
      // `--text` takes no value, so it never swallows the word after it.
      if (key !== 'text' && next && !next.startsWith('--')) {
        options[key] = next;
        i += 1;
      } else {
        options[key] = true;
      }
    } else {
      positional.push(arg);
    }
  }
  return { command, positional, options };
}

/**
 * One result as people or machines read it, from the same value (cli.md
 * rule 13): pretty JSON by default, `path: value` lines with `--text`.
 */
export function render(value, text) {
  if (!text) return JSON.stringify(value, null, 2);
  const lines = [];
  const walk = (node, path) => {
    if (Array.isArray(node) && node.length > 0) {
      node.forEach((item, index) => walk(item, `${path}[${index}]`));
    } else if (node && typeof node === 'object' && Object.keys(node).length > 0) {
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
// and `glina <command> --help` is that command's row (cli.md rule 11).
export const COMMANDS = [
  { name: 'onboarding', usage: 'onboarding [--reset] [--asset file.glb] [--name id]', help: 'first-run import or walkthrough replay' },
  { name: 'import', usage: 'import <file.glb> [--name id] [--config path]', help: 'validate, persist, and activate an existing asset' },
  { name: 'workspace', usage: 'workspace', help: 'list imported assets and the active input' },
  { name: 'create', usage: 'create <prompt> [--race r] [--out dir] [--config path]', help: 'studio flow: generate one asset through the Weles browser layer' },
  { name: 'sculpt', usage: 'sculpt <prompt> [--out dir] [--filename f.glb] [--rounds n] [--config path]', help: 'LLM (Opus) iteratively builds the model in Blender' },
  { name: 'preview-anim', usage: 'preview-anim [file.glb] [--clip name] [--frames n] [--fps n] [--out f.gif]', help: 'render an animated GIF of one clip through Blender' },
  { name: 'animate', usage: 'animate [file.glb] --preset <name> [--out animated.glb]', help: "apply a declared preset's visibly moving actions" },
  { name: 'showcase', usage: 'showcase <asset> [--out <asset>-showcase.glb]', help: 'build a declared animated reference asset' },
  { name: 'showcases', usage: 'showcases [list | add <name> <file.json> | remove <name>]', help: 'the declarations showcase reads (assets/showcases)' },
  { name: 'presets', usage: 'presets [list | add <name> <file.json> | remove <name>]', help: 'the declarations animate reads (assets/presets)' },
  { name: 'verify', usage: 'verify [file.glb] [--config path]', help: 'structural + optional render gate' },
  { name: 'check-config', usage: 'check-config [--config path]', help: 'validate the config and resolve its vault references' },
  { name: 'export-config', usage: 'export-config --out <path> [--config path]', help: 'write a resolved, owner-only config for a remote run' },
  { name: 'doctor', usage: 'doctor [--config path]', help: 'check the config and vault references, the Blender MCP bridge (handshake + code probe) and the browser layer (Weles MCP tools); exits 1 when any check fails' },
  { name: 'setup', usage: 'setup [--check] [--dry-run]', help: 'provision Blender + uv + blender-mcp' },
];

const WIDTH = 34;

function rows(commands) {
  return commands.map((command) =>
    command.usage.length < WIDTH - 2
      ? `  ${command.usage.padEnd(WIDTH)}${command.help}`
      : `  ${command.usage}\n${''.padEnd(WIDTH + 2)}${command.help}`,
  );
}

const BOUNDARIES = `credentials come from skarbiec:// references in the config, answered by
Skarbiec or, without it, by the owner-only file GLINA_CREDENTIALS_FILE names;
models come from models.brama or, without Brama, models.openai_compatible;
browser automation goes only through the Weles MCP server;
Blender work goes only through the Blender MCP server.`;

export const USAGE = `usage: node pipeline/cli.js <command> [args] [--text]

Every command prints its result as JSON; --text prints the same result as
one path: value line per field. glina <command> --help prints one command.

commands:
${rows(COMMANDS).join('\n')}

${BOUNDARIES}`;

/** The help for one command, or the whole usage when the word is not a command. */
export function commandHelp(name) {
  const own = COMMANDS.filter((command) => command.name === name);
  if (own.length === 0) return USAGE;
  return `usage: node pipeline/cli.js ${own[0].usage} [--text]\n\n${rows(own).join('\n')}\n\n${BOUNDARIES}`;
}


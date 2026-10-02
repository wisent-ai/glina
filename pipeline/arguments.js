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

export const USAGE = `usage: node pipeline/cli.js <command> [args] [--text]

Every command prints its result as JSON; --text prints the same result as
one path: value line per field.

commands:
  onboarding [--reset] [--asset file.glb] [--name id]
                                  first-run import or walkthrough replay
  import <file.glb> [--name id] [--config path]
                                  validate, persist, and activate an existing asset
  workspace                       list imported assets and the active input
  create <prompt> [--race r] [--out dir] [--config path]
  sculpt <prompt> [--out dir] [--filename f.glb] [--rounds n] [--config path]
                                  LLM (Opus) iteratively builds the model in Blender
  preview-anim [file.glb] [--clip name] [--frames n] [--fps n] [--out f.gif]
                                  render an animated GIF of one clip through Blender
  animate [file.glb] --preset <name> [--out animated.glb]
                                  apply a declared preset's visibly moving actions
  showcase <asset> [--out <asset>-showcase.glb]
                                  build a declared animated reference asset
  showcases [list | add <name> <file.json> | remove <name>]
  presets [list | add <name> <file.json> | remove <name>]
                                  the declarations showcase and animate read
                                  (assets/showcases, assets/presets)
  verify [file.glb] [--config path]   structural + optional render gate
  check-config [--config path]
  doctor [--config path]      check the config and vault references, the
                                  Blender MCP bridge (handshake + code probe)
                                  and the browser layer (Weles MCP tools);
                                  exits 1 when any check fails
  setup [--check] [--dry-run] provision Blender + uv + blender-mcp

credentials come from skarbiec:// references in the config, answered by
Skarbiec or, without it, by the owner-only file GLINA_CREDENTIALS_FILE names;
models come from models.brama or, without Brama, models.openai_compatible;
browser automation goes only through the Weles MCP server;
Blender work goes only through the Blender MCP server.`;


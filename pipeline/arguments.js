// What the command line accepts, what it prints when it does not
// recognise a verb, and the redaction every printed configuration goes
// through.
//
// Split out of `cli.js`, which had grown past the three-hundred-line
// limit; running a command stays there.


export function redactSecrets(node, path = []) {
  if (Array.isArray(node)) return node.map((v, i) => redactSecrets(v, [...path, i]));
  if (node && typeof node === 'object') {
    const out = {};
    for (const [key, value] of Object.entries(node)) {
      const inSecretSubtree = path.length > 0 && ['credentials', 'models'].includes(path[0]);
      if (inSecretSubtree && /(key|secret|token|password)/i.test(key) && typeof value === 'string') {
        out[key] = '<resolved: ok>';
      } else {
        out[key] = redactSecrets(value, [...path, key]);
      }
    }
    return out;
  }
  return node;
}

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
      if (next && !next.startsWith('--')) {
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

export const USAGE = `usage: node pipeline/cli.js <command> [args]

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
  animate [file.glb] [--preset dragon] [--out animated.glb]
                                  apply deterministic, visibly moving actions
  showcase dragon [--out dragon.glb]
                                  build a cohesive animated reference asset
  verify [file.glb] [--config path]   structural + optional render gate
  check-config [--config path]
  weles-tools
  blender-health              MCP handshake + execute_blender_code probe
  setup [--check] [--dry-run] provision Blender + uv + blender-mcp

credentials come only from skarbiec:// references in the config;
browser automation goes only through the Weles MCP server;
Blender work goes only through the Blender MCP server.`;


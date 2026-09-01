#!/usr/bin/env node
// cli.js — `node pipeline/cli.js` entry point for the asset-creation pipeline.
//
// Commands:
//   create <prompt> [--race <race>] [--out <dir>] [--config <path>]
//   check-config [--config <path>]     validate + resolve the config (no browser)
//   weles-tools                        list the tools the Weles MCP server exposes
//
// Credentials: resolved ONLY from Skarbiec (skarbiec:// refs in the config).
// Browser:     driven ONLY through the Weles MCP server.

import { resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadPipelineConfig } from './config.js';
import { runTextToGameJob } from './text2game.js';
import { McpStdioClient } from './weles.js';
import { BlenderSession } from './blender.js';
import { provisionBlender } from './setup.js';
import { verifyAsset } from './verify.js';
import { sculptWithLlm } from './llm_blender.js';
import { renderAnimationPreview } from './preview.js';
import { animatePreset } from './animate.js';
import { buildShowcase } from './showcase.js';


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

const DEFAULT_CONFIG = new URL('../pipeline.config.json', import.meta.url).pathname;

function parseArgs(argv) {
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

const USAGE = `usage: node pipeline/cli.js <command> [args]

commands:
  create <prompt> [--race r] [--out dir] [--config path]
  sculpt <prompt> [--out dir] [--filename f.glb] [--rounds n] [--config path]
                                  LLM (Opus) iteratively builds the model in Blender
  preview-anim <file.glb> [--clip name] [--frames n] [--fps n] [--out f.gif]
                                  render an animated GIF of one clip through Blender
  animate <file.glb> [--preset dragon] [--out animated.glb]
                                  apply deterministic, visibly moving actions
  showcase dragon [--out dragon.glb]
                                  build a cohesive animated reference asset
  verify <file.glb> [--config path]   structural + optional render gate
  check-config [--config path]
  weles-tools
  serve [--port n] [--config path]   loopback HTTP/JSON backend for desktop apps
  blender-health              MCP handshake + execute_blender_code probe
  setup [--check] [--dry-run] provision Blender + uv + blender-mcp

credentials come only from skarbiec:// references in the config;
browser automation goes only through the Weles MCP server;
Blender work goes only through the Blender MCP server.`;

async function main() {
  const { command, positional, options } = parseArgs(process.argv.slice(2));
  const configPath = options.config ?? DEFAULT_CONFIG;

  switch (command) {
    case 'create': {
      const prompt = positional.join(' ').trim();
      if (!prompt) {
        console.error('error: create requires a prompt');
        process.exitCode = 2;
        return;
      }
      const config = await loadPipelineConfig(configPath);
      const result = await runTextToGameJob(
        {
          prompt: options.race ? `${options.race} ${prompt}` : prompt,
          race: options.race,
          outDir: options.out,
        },
        config,
      );
      console.log(JSON.stringify(result, null, 2));
      return;
    }
    case 'check-config': {
      const config = await loadPipelineConfig(configPath);
      console.log(JSON.stringify(redactSecrets(config), null, 2));
      return;
    }
    case 'serve': {
      const port = options.port === undefined ? 8080 : Number(options.port);
      if (!Number.isInteger(port) || port < 0 || port > 65535) {
        console.error('error: serve requires --port <n> (0 = ephemeral)');
        process.exitCode = 2;
        return;
      }
      const { startServe } = await import('./serve.js');
      await startServe({ port, configPath });
      return;
    }
    case 'weles-tools': {
      const client = new McpStdioClient({});
      await client.start();
      const tools = await client.listTools();
      for (const tool of tools) console.log(`${tool.name} — ${tool.description ?? ''}`);
      await client.close();
      return;
    }
    case 'blender-health': {
      const session = await BlenderSession.start({});
      const healthy = await session.isHealthy();
      const tools = await session.listTools().catch(() => []);
      console.log(JSON.stringify({ healthy, tools: tools.map((t) => t.name) }, null, 2));
      await session.close();
      process.exitCode = healthy ? 0 : 1;
      return;
    }
    case 'setup': {
      const report = await provisionBlender({
        checkOnly: Boolean(options.check),
        dryRun: Boolean(options['dry-run']),
      });
      console.log(JSON.stringify(report, null, 2));
      if (!report.healthy) process.exitCode = 1;
      return;
    }
    case 'export-config': {
      // Submit-time secret resolution for REMOTE runs (stado): resolves all
      // skarbiec:// refs locally (the vault never leaves this host) and
      // writes a mode-0600 resolved config the worker consumes directly —
      // the same owner-only-env-file pattern as `skarbiec resolve --emit`.
      // Nothing secret is printed.
      const out = options.out;
      if (!out) {
        console.error('error: export-config requires --out <path>');
        process.exitCode = 2;
        return;
      }
      const config = await loadPipelineConfig(configPath);
      const { writeFile, chmod } = await import('node:fs/promises');
      await writeFile(out, JSON.stringify({ _resolved: true, ...config }, null, 2));
      await chmod(out, 0o600);
      console.log(JSON.stringify({ out, resolved: true }));
      return;
    }
    case 'verify': {
      const file = positional[0];
      if (!file) {
        console.error('error: verify requires a .glb path');
        process.exitCode = 2;
        return;
      }
      let config = {};
      try {
        config = await loadPipelineConfig(configPath);
      } catch {
        // config is optional for verify — defaults kick in without it
      }
      const report = await verifyAsset(file, config);
      console.log(JSON.stringify(report, null, 2));
      if (!report.ok) process.exitCode = 1;
      return;
    }
    case 'sculpt': {
      const prompt = positional.join(' ').trim();
      if (!prompt) {
        console.error('error: sculpt requires a prompt');
        process.exitCode = 2;
        return;
      }
      const config = await loadPipelineConfig(configPath);
      const result = await sculptWithLlm(
        {
          prompt,
          outDir: options.out,
          filename: options.filename,
          maxRounds: options.rounds ? Number(options.rounds) : undefined,
        },
        config,
        { onRound: (r) => console.error(`[round ${r.round}] ${r.step.thought ?? ''}`) },
      );
      console.log(JSON.stringify({ ...result, transcript: undefined, rounds: result.rounds }, null, 2));
      return;
    }
    case 'showcase': {
      const asset = positional[0] ?? 'dragon';
      let config = {};
      try {
        config = await loadPipelineConfig(configPath);
      } catch {
        // config optional — blender.mcp defaults apply without it
      }
      const output = options.out ?? `assets/models/${asset}-showcase.glb`;
      const result = await buildShowcase({
        asset,
        outputPath: output,
        sessionOptions: config.blender?.mcp,
      });
      console.log(JSON.stringify(result, null, 2));
      return;
    }
    case 'animate': {
      const file = positional[0];
      if (!file) {
        console.error('error: animate requires a .glb path');
        process.exitCode = 2;
        return;
      }
      let config = {};
      try {
        config = await loadPipelineConfig(configPath);
      } catch {
        // config optional — blender.mcp defaults apply without it
      }
      const output = options.out ?? file.replace(/\.glb$/i, '-animated.glb');
      const result = await animatePreset({
        inputPath: file,
        outputPath: output,
        preset: options.preset ?? 'dragon',
        sessionOptions: config.blender?.mcp,
      });
      console.log(JSON.stringify(result, null, 2));
      return;
    }
    case 'preview-anim': {
      const file = positional[0];
      if (!file) {
        console.error('error: preview-anim requires a .glb path');
        process.exitCode = 2;
        return;
      }
      let config = {};
      try {
        config = await loadPipelineConfig(configPath);
      } catch {
        // config optional — blender.mcp defaults apply without it
      }
      const result = await renderAnimationPreview({
        glbPath: file,
        outPath: options.out,
        clip: options.clip,
        frames: options.frames ? Number(options.frames) : undefined,
        fps: options.fps ? Number(options.fps) : undefined,
        sessionOptions: config.blender?.mcp,
      });
      console.log(JSON.stringify(result, null, 2));
      return;
    }
    case 'help':
    case undefined:
      console.log(USAGE);
      return;
    default:
      console.error(`unknown command: ${command}\n\n${USAGE}`);
      process.exitCode = 2;
  }
}

// Run main() only when invoked directly — serve.js imports redactSecrets
// from this module without taking over the process.
const invokedDirectly =
  process.argv[1] && fileURLToPath(import.meta.url) === resolvePath(process.argv[1]);
if (invokedDirectly) {
  main().catch((error) => {
    console.error(`error: ${error.message}`);
    process.exitCode = 1;
  });
}

#!/usr/bin/env node
// cli.js — `node pipeline/cli.js` entry point for the asset-creation pipeline.
//
// Commands:
//   create <prompt> [--race <race>] [--out <dir>] [--config <path>]
//   check-config [--config <path>]     validate + resolve the config (no browser)
//   doctor [--config <path>]           check the config, the Blender bridge and the browser layer
//
// Credentials: skarbiec:// refs in the config, answered by Skarbiec or by the
//              owner-only GLINA_CREDENTIALS_FILE on a machine without it.
// Browser:     driven ONLY through the Weles MCP server.

import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { checkPipelineConfig, loadPipelineConfig } from './config.js';
import { runTextToGameJob } from './show/text2game.js';
import { runDoctor } from './host/doctor.js';
import { provisionBlender } from './host/setup.js';
import { verifyAsset } from './gate/verify.js';
import { sculptWithLlm } from './sculpt/llm_blender.js';
import { renderAnimationPreview } from './sculpt/preview.js';
import { animatePreset } from './sculpt/animate.js';
import { buildShowcase } from './sculpt/showcase.js';
import { DeclarationError, availability } from './rigs/declared.js';
import { declarationCommand } from './rigs/commands.js';
import { recordAssetImported, runOnboarding } from './onboarding/onboarding.js';
import { activeAssetPath, importAsset, workspaceSummary } from './host/workspace.js';
import { DEFAULT_CONFIG, USAGE, parseArgs, render } from "./arguments.js";

async function main() {
  const words = process.argv.slice(2);
  // `--help` or `-h` anywhere prints the usage and runs nothing.
  if (words.some((word) => word === '--help' || word === '-h')) {
    console.log(USAGE);
    return;
  }
  const { command, positional, options } = parseArgs(words);
  const configPath = options.config ?? DEFAULT_CONFIG;
  const print = (value) => console.log(render(value, options.text === true));

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
      print(result);
      return;
    }
    case 'onboarding': {
      let config = {};
      try {
        config = await loadPipelineConfig(configPath);
      } catch {
        // Configuration is optional for local import; the built-in gate applies.
      }
      const report = await runOnboarding({
        reset: Boolean(options.reset),
        asset: options.asset,
        name: options.name,
        config,
      });
      if (report && report.status !== 'imported' && report.status !== 'unchanged') {
        process.exitCode = 1;
      }
      return;
    }
    case 'import': {
      const source = positional[0];
      let config = {};
      try {
        config = await loadPipelineConfig(configPath);
      } catch {
        // Configuration is optional for local import; the built-in gate applies.
      }
      const report = await importAsset(source, { name: options.name, config });
      if (report.status === 'imported' || report.status === 'unchanged') {
        await recordAssetImported(report);
      } else {
        process.exitCode = 1;
      }
      print(report);
      return;
    }
    case 'workspace': {
      print(await workspaceSummary());
      return;
    }
    case 'check-config': {
      print(await checkPipelineConfig(configPath));
      return;
    }
    case 'doctor': {
      const report = await runDoctor({ configPath });
      print(report);
      if (!report.healthy) process.exitCode = 1;
      return;
    }
    case 'setup': {
      const report = await provisionBlender({
        checkOnly: Boolean(options.check),
        dryRun: Boolean(options['dry-run']),
      });
      print(report);
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
      print({ out, resolved: true });
      return;
    }
    case 'verify': {
      const file = positional[0] ?? await activeAssetPath();
      if (!file) {
        console.error('error: verify requires a .glb path or an active imported asset');
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
      print(report);
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
      print({ ...result, transcript: undefined, rounds: result.rounds });
      return;
    }
    case 'showcases':
    case 'presets': {
      print(await declarationCommand(command.slice(0, -1), positional));
      return;
    }
    case 'showcase': {
      const asset = positional[0];
      if (!asset) {
        console.error(`error: showcase requires an asset name; ${await availability('showcase')}`);
        process.exitCode = 2;
        return;
      }
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
      print(result);
      return;
    }
    case 'animate': {
      const file = positional[0] ?? await activeAssetPath();
      if (!file) {
        console.error('error: animate requires a .glb path or an active imported asset');
        process.exitCode = 2;
        return;
      }
      let config = {};
      try {
        config = await loadPipelineConfig(configPath);
      } catch {
        // config optional — blender.mcp defaults apply without it
      }
      if (!options.preset || options.preset === true) {
        console.error(`error: animate requires --preset <name>; ${await availability('preset')}`);
        process.exitCode = 2;
        return;
      }
      const output = options.out ?? file.replace(/\.glb$/i, '-animated.glb');
      const result = await animatePreset({
        inputPath: file,
        outputPath: output,
        preset: options.preset,
        sessionOptions: config.blender?.mcp,
      });
      print(result);
      return;
    }
    case 'preview-anim': {
      const file = positional[0] ?? await activeAssetPath();
      if (!file) {
        console.error('error: preview-anim requires a .glb path or an active imported asset');
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
      print(result);
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

// Run main() only when invoked directly, so importing this file does not
// take over the process. The installed
// `glina` is a symlink to this file, so both sides are compared after
// resolving links: comparing the link's own path made every installed
// command print nothing and exit 0.
const invokedDirectly = (() => {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
})();
if (invokedDirectly) {
  main().catch((error) => {
    console.error(`error: ${error.message}`);
    // A name glina has not declared is a usage error, like an unknown command.
    process.exitCode = error instanceof DeclarationError ? 2 : 1;
  });
}

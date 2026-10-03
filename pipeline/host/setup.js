// setup.js — automatic provisioning for the Blender pipeline layer.
//
// Installs + verifies the tools Glina needs, then installs the matching
// Blender addon through the MCP package's supported installer:
//   1. Blender itself        (brew cask on macOS, apt/snap on Linux)
//   2. uv / uvx              (brew/installer)
//   3. mcp-for-blender       (resolved through uvx)
//   4. Blender addon        (installed by mcp-for-blender)
// `glina setup [--check] [--dry-run]` is the only command surface.
// Idempotent: anything already present is verified, not reinstalled.

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { platform } from 'node:os';

const execFileAsync = promisify(execFile);

export class SetupError extends Error {
  constructor(message, { step, cause } = {}) {
    super(message);
    this.name = 'SetupError';
    this.step = step;
    this.cause = cause;
  }
}

async function which(binary, { env } = {}) {
  try {
    const { stdout } = await execFileAsync('which', [binary], { env });
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

async function run(cmd, args, { dryRun, log } = {}) {
  log?.(`$ ${cmd} ${args.join(' ')}`);
  if (dryRun) return { stdout: '', stderr: '' };
  return execFileAsync(cmd, args, { maxBuffer: 8 * 1024 * 1024 });
}

/** The provisioning plan as data, so tests can inspect it without installing. */
export function buildSetupPlan(os = platform()) {
  const steps = [];
  if (os === 'darwin') {
    steps.push(
      { name: 'blender', check: 'blender', install: ['brew', ['install', '--cask', 'blender']] },
      { name: 'uv', check: 'uvx', install: ['brew', ['install', 'uv']] },
    );
  } else if (os === 'linux') {
    steps.push(
      { name: 'blender', check: 'blender', install: ['sh', ['-c', 'sudo apt-get update && sudo apt-get install -y blender || sudo snap install blender --classic']] },
      { name: 'uv', check: 'uvx', install: ['sh', ['-c', 'curl -LsSf https://astral.sh/uv/install.sh | sh']] },
    );
  } else {
    throw new SetupError(`unsupported platform: ${os} (install Blender + uv manually)`);
  }
  return steps;
}

export async function provisionBlender({ dryRun = false, checkOnly = false, log = console.log, os, exec } = {}) {
  const steps = buildSetupPlan(os ?? platform());
  const runExec = exec ?? run;
  const report = [];

  for (const step of steps) {
    const present = await which(step.check);
    if (present) {
      report.push({ step: step.name, status: 'present', path: present });
      log?.(`ok: ${step.name} already installed (${present})`);
      continue;
    }
    if (checkOnly) {
      report.push({ step: step.name, status: 'missing' });
      log?.(`missing: ${step.name}`);
      continue;
    }
    log?.(`installing ${step.name}…`);
    try {
      await runExec(step.install[0], step.install[1], { dryRun, log });
      report.push({ step: step.name, status: dryRun ? 'would-install' : 'installed' });
    } catch (error) {
      throw new SetupError(`failed to install ${step.name}: ${error.message}`, {
        step: step.name,
        cause: error,
      });
    }
  }

  // The MCP server alone is not enough: Blender needs the corresponding
  // addon. The upstream installer preserves an unchanged addon and its backup.
  const uvx = await which('uvx');
  if (uvx && !checkOnly) {
    try {
      await runExec(uvx, ['mcp-for-blender', 'install-addon'], { dryRun, log });
      report.push({ step: 'blender-addon', status: dryRun ? 'would-install' : 'installed' });
    } catch (error) {
      throw new SetupError(`failed to install blender-addon: ${error.message}`, {
        step: 'blender-addon',
        cause: error,
      });
    }
  } else if (!uvx) {
    report.push({ step: 'blender-addon', status: 'blocked', reason: 'uvx missing' });
  } else {
    report.push({ step: 'blender-addon', status: 'not-checked', reason: 'run glina doctor to probe the live Blender addon' });
  }

  const healthy = report.every((r) => ['present', 'installed', 'would-install', 'not-checked'].includes(r.status));
  return { healthy, steps: report };
}


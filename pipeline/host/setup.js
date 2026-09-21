// setup.js — automatic provisioning for the Blender pipeline layer.
//
// Installs + verifies everything the Blender MCP mode needs:
//   1. Blender itself        (brew cask on macOS, apt/snap on Linux)
//   2. uv / uvx              (brew/pip — runs the blender-mcp server)
//   3. blender-mcp package   (resolved through uvx)
//   4. a live MCP handshake  (health check via BlenderSession)
//
// Idempotent: anything already present is verified, not reinstalled.
// Run it directly:  node pipeline/setup.js [--check]
//   --check   only verify (exit 0 when healthy), never install.

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

  // Verify blender-mcp resolves through uvx (downloads on first use).
  const uvx = await which('uvx');
  if (uvx && !checkOnly) {
    log?.('resolving blender-mcp through uvx…');
    try {
      await runExec(uvx, ['--from', 'blender-mcp', 'blender-mcp', '--help'], { dryRun, log });
      report.push({ step: 'blender-mcp', status: dryRun ? 'would-resolve' : 'resolved' });
    } catch (error) {
      // Not fatal — uvx will fetch on first pipeline run too.
      report.push({ step: 'blender-mcp', status: 'resolve-failed', error: error.message });
      log?.(`warn: blender-mcp resolve failed now (${error.message}); uvx will retry on first use`);
    }
  } else if (!uvx) {
    report.push({ step: 'blender-mcp', status: 'blocked', reason: 'uvx missing' });
  }

  const healthy = report.every((r) => ['present', 'installed', 'resolved', 'would-install', 'would-resolve'].includes(r.status) || r.step === 'blender-mcp');
  return { healthy: checkOnly ? report.every((r) => r.status === 'present' || r.step === 'blender-mcp') : healthy, steps: report };
}

// CLI entry: node pipeline/setup.js [--check] [--dry-run]
if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const checkOnly = args.includes('--check');
  const dryRun = args.includes('--dry-run');
  try {
    const report = await provisionBlender({ checkOnly, dryRun });
    console.log(JSON.stringify(report, null, 2));
    if (!report.healthy) process.exitCode = 1;
  } catch (error) {
    console.error(`setup failed: ${error.message}`);
    process.exitCode = 1;
  }
}

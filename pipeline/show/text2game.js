// text2game.js — the AI asset-generation flow, driven end-to-end through
// Skarbiec (credentials) and Weles (browser).
//
// The flow logs into the configured text-to-3D studio, submits a prompt,
// waits for the artifact, and downloads it. All endpoints/selectors come
// from the pipeline config — nothing platform-specific is hardcoded here,
// so swapping studios is a config change, not a code change.

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { WelesBrowserSession } from '../host/weles.js';
import { postProcessModel } from '../blender.js';
import { verifyAsset } from '../verify.js';

export class PipelineError extends Error {
  constructor(message, { step, cause } = {}) {
    super(message);
    this.name = 'PipelineError';
    this.step = step;
    this.cause = cause;
  }
}

async function step(name, fn) {
  try {
    return await fn();
  } catch (error) {
    throw new PipelineError(`text2game step '${name}' failed: ${error.message}`, {
      step: name,
      cause: error,
    });
  }
}

/**
 * Run one asset-generation job.
 *
 * @param {object} job        { prompt, race?, outDir, filename? }
 * @param {object} config     resolved pipeline config (secrets already
 *                            expanded from skarbiec:// by config.js)
 * @param {object} [deps]     test seams: { sessionFactory, download }
 */
export async function runTextToGameJob(job, config, deps = {}) {
  const studio = config.studio ?? {};
  const sessionFactory =
    deps.sessionFactory ?? ((opts) => WelesBrowserSession.start(opts));
  const download = deps.download ?? defaultDownload;

  const session = await sessionFactory({
    headless: config.browser?.headless ?? true,
    browser: config.browser?.engine ?? 'chromium',
  });

  try {
    const page = await step('open-session', () => session.newPage());

    // ---- login ----
    await step('login:goto', () => page.goto(studio.loginUrl));
    await step('login:user', () => page.fill(studio.selectors.loginUser, config.credentials.username));
    await step('login:pass', () =>
      page.fill(studio.selectors.loginPassword, config.credentials.password));
    await step('login:submit', () => page.click(studio.selectors.loginSubmit));

    // ---- generate ----
    await step('studio:goto', () => page.goto(studio.generateUrl));
    await step('studio:prompt', () => page.fill(studio.selectors.promptInput, job.prompt));
    await step('studio:submit', () => page.click(studio.selectors.generateSubmit));

    // ---- wait for the artifact ----
    const artifactUrl = await step('studio:wait-artifact', async () => {
      const expression = studio.artifact.pollExpression;
      const timeoutMs = studio.artifact.timeoutMs ?? 300_000;
      const intervalMs = studio.artifact.intervalMs ?? 5_000;
      const deadline = Date.now() + timeoutMs;
      for (;;) {
        const value = await page.evaluate(expression);
        if (typeof value === 'string' && value.startsWith('http')) return value;
        if (Date.now() > deadline) {
          throw new PipelineError(`artifact not ready within ${timeoutMs}ms`);
        }
        await new Promise((resolve) => setTimeout(resolve, intervalMs));
      }
    });

    // ---- download ----
    const outDir = job.outDir ?? 'assets/models';
    await mkdir(outDir, { recursive: true });
    const filename = job.filename ?? `${slugify(job.prompt)}.glb`;
    const outPath = join(outDir, filename);
    const bytes = await step('artifact:download', () => download(artifactUrl, config));
    await writeFile(outPath, bytes);

    // ---- optional Blender post-processing (remesh/decimate/rig) ----
    let processedPath = null;
    if (config.blender?.enabled) {
      processedPath = join(outDir, filename.replace(/\.glb$/i, '.processed.glb'));
      await step('blender:postprocess', () =>
        (deps.postProcess ?? postProcessModel)({
          inputPath: outPath,
          outputPath: processedPath,
          processCode: config.blender.processCode,
          sessionOptions: config.blender.mcp,
        }));
    }

    // ---- verification gate (default on; a failed asset fails the job) ----
    const targetPath = processedPath ?? outPath;
    let verification = null;
    if (config.verify?.enabled !== false) {
      const verifyConfig = {
        verify: { ...(config.verify ?? {}), throwOnFail: true },
        blender: config.blender,
      };
      verification = await step('verify', () =>
        (deps.verify ?? verifyAsset)(targetPath, verifyConfig));
    }

    return { outPath, processedPath, artifactUrl, prompt: job.prompt, verification };
  } finally {
    await session.close().catch(() => {});
  }
}

async function defaultDownload(url, config) {
  const headers = { ...(config.artifact?.downloadHeaders ?? {}) };
  const response = await fetch(url, { headers });
  if (!response.ok) {
    throw new PipelineError(`download failed: HTTP ${response.status}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

function slugify(text) {
  return (
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || 'asset'
  );
}

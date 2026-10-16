// text2game.js — the AI asset-generation flow: credentials from the vault and
// one browser session on the layer the config's `browser` section declares
// (Weles, or the Playwright MCP server without Weles).
//
// The flow logs into the configured text-to-3D studio, submits a prompt,
// waits for the artifact, and downloads it. All endpoints/selectors come
// from the pipeline config — nothing platform-specific is hardcoded here,
// so swapping studios is a config change, not a code change.

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { startBrowserSession } from '../browser/bridge.js';
import { postProcessModel } from '../gate/blender.js';
import { verifyAsset } from '../gate/verify.js';

/** Where `create` writes the asset when the request names no directory. */
const DEFAULT_OUT_DIR = 'assets/models';

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
 * @param {object} job        { prompt, race?, outDir?, filename? }
 * @param {object} config     resolved pipeline config (secrets already
 *                            expanded from role:// by config.js)
 */
export async function runTextToGameJob(job, config) {
  const studio = config.studio;
  if (studio === undefined) {
    throw new PipelineError('the pipeline config has no studio section: create needs studio.loginUrl, studio.generateUrl, studio.selectors and studio.artifact.expression');
  }
  const outDir = job.outDir === undefined ? DEFAULT_OUT_DIR : job.outDir;
  const filename = job.filename === undefined ? `${slugify(job.prompt)}.glb` : job.filename;

  const session = await step('open-session', () => startBrowserSession(config.browser));

  try {
    const page = await step('open-page', () => session.newPage());

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

    // ---- the artifact appears ----
    // One evaluation that resolves inside the page when the artifact link is
    // present: a MutationObserver re-reads `artifactExpression` on every DOM
    // change, so nothing here pauses, re-asks or gives up after a fixed time
    // (cli.md rule 8). A studio that never produces the link leaves the run
    // open until the operator stops it; a closed page is the browser layer's
    // own error.
    const artifactUrl = await step('studio:artifact', async () => {
      const read = studio.artifact.expression;
      const value = await page.evaluate(`new Promise((resolve) => {
        const read = () => { const value = (${read}); return typeof value === 'string' && value.startsWith('http') ? value : null; };
        const found = read();
        if (found) return resolve(found);
        const observer = new MutationObserver(() => { const value = read(); if (value) { observer.disconnect(); resolve(value); } });
        observer.observe(document, { subtree: true, childList: true, attributes: true });
      })`);
      if (typeof value !== 'string' || !value.startsWith('http')) {
        throw new PipelineError(`studio.artifact.expression resolved to ${JSON.stringify(value)}, not an http URL`);
      }
      return value;
    });

    // ---- download ----
    await mkdir(outDir, { recursive: true });
    const outPath = join(outDir, filename);
    const bytes = await step('artifact:download', () => download(artifactUrl, config));
    await writeFile(outPath, bytes);

    // ---- optional Blender post-processing (remesh/decimate/rig) ----
    let processedPath = null;
    if (config.blender?.enabled) {
      processedPath = join(outDir, filename.replace(/\.glb$/i, '.processed.glb'));
      await step('blender:postprocess', () =>
        postProcessModel({
          inputPath: outPath,
          outputPath: processedPath,
          processCode: config.blender.processCode,
          sessionOptions: config.blender.mcp,
        }));
    }

    // ---- verification gate (default on; a failed asset fails the job) ----
    const targetPath = processedPath === null ? outPath : processedPath;
    let verification = null;
    if (config.verify?.enabled !== false) {
      const verifyConfig = {
        verify: { ...config.verify, throwOnFail: true },
        blender: config.blender,
      };
      verification = await step('verify', () => verifyAsset(targetPath, verifyConfig));
    }

    return { outPath, processedPath, artifactUrl, prompt: job.prompt, verification };
  } finally {
    await releaseBrowserSession(session);
  }
}

/**
 * Close the browser session from the job's `finally` block. A failed close
 * must not replace the job's own outcome, but it can leave the browser held,
 * so it is said on stderr with its cause instead of being dropped.
 */
async function releaseBrowserSession(session) {
  try {
    await session.close();
  } catch (error) {
    console.error(`[text2game] browser session close failed, the browser may still be held: ${error.message}`);
  }
}

async function download(url, config) {
  const headers = { ...config.artifact?.downloadHeaders };
  const response = await fetch(url, { headers });
  if (!response.ok) {
    throw new PipelineError(`download failed: HTTP ${response.status}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

/**
 * The asset file name a prompt gives: its letters and digits, lower-cased,
 * joined by hyphens. A prompt with none is refused; the request then names
 * the file itself.
 */
function slugify(text) {
  const slug = text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '');
  if (!slug) {
    throw new PipelineError(`the prompt ${JSON.stringify(text)} has no letters or digits to name the asset file: name the file`);
  }
  return slug;
}

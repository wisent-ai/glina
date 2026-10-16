// CLI preview inputs share the active workspace choice and optional Blender
// bridge configuration; the two renderers retain their own output contracts.
import { loadOptionalPipelineConfig } from './config.js';
import { renderAnimationPreview, renderScenePreview } from './sculpt/preview.js';

// `glina preview <verb>`: each verb is one renderer, and the verbs the CLI
// accepts and names in its refusal are this table's keys.
export const PREVIEW_RENDERERS = Object.freeze({
  anim: (file, options, sessionOptions) => renderAnimationPreview({
    glbPath: file,
    outPath: options.out,
    clip: options.clip,
    frames: options.frames ? Number(options.frames) : undefined,
    fps: options.fps ? Number(options.fps) : undefined,
    sessionOptions,
  }),
  scene: (file, options, sessionOptions) => renderScenePreview({
    glbPath: file,
    outPath: options.out,
    size: options.size === undefined ? undefined : Number(options.size),
    sessionOptions,
  }),
});

export function previewVerb(leaf) {
  return Object.hasOwn(PREVIEW_RENDERERS, leaf);
}

export async function runPreviewCommand(leaf, file, options, configPath) {
  if (!previewVerb(leaf)) {
    throw new Error(`preview takes ${Object.keys(PREVIEW_RENDERERS).join(' or ')}; got ${JSON.stringify(leaf)}`);
  }
  const config = await loadOptionalPipelineConfig(configPath, options.config === undefined);
  return PREVIEW_RENDERERS[leaf](file, options, config.blender?.mcp);
}

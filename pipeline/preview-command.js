// CLI preview inputs share the active workspace choice and optional Blender
// bridge configuration; the two renderers retain their own output contracts.
import { loadOptionalPipelineConfig } from './config.js';
import { renderAnimationPreview, renderScenePreview } from './sculpt/preview.js';

// `glina preview anim|scene`: `leaf` is the verb after `preview`.
export async function runPreviewCommand(leaf, file, options, configPath) {
  const config = await loadOptionalPipelineConfig(configPath, options.config === undefined);
  const sessionOptions = config.blender?.mcp;
  if (leaf === 'scene') {
    return renderScenePreview({
      glbPath: file,
      outPath: options.out,
      size: options.size === undefined ? undefined : Number(options.size),
      sessionOptions,
    });
  }
  return renderAnimationPreview({
    glbPath: file,
    outPath: options.out,
    clip: options.clip,
    frames: options.frames ? Number(options.frames) : undefined,
    fps: options.fps ? Number(options.fps) : undefined,
    sessionOptions,
  });
}

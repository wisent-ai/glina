// blender.js — Blender access for the pipeline, through the Blender MCP API.
//
// Same transport discipline as the Weles layer: the pipeline talks to a
// Blender MCP server over stdio JSON-RPC (never hand-rolled sockets to
// Blender, never a hand-managed Blender subprocess). The MCP server
// bridges into Blender's own addon; `pipeline/setup.js` provisions both.
//
// Tool surface used (blender-mcp): get_scene_info, execute_blender_code.
// Anything else (export, decimate, rig) is expressed as Blender Python
// executed through execute_blender_code, so the wrapper stays tiny and
// every Blender behavior lives in config-driven code strings.

import { McpStdioClient, WelesError } from './weles.js';

export class BlenderError extends Error {
  constructor(message, { code, cause } = {}) {
    super(message);
    this.name = 'BlenderError';
    this.code = code;
    this.cause = cause;
  }
}

/** Default spawn for a blender-mcp server: uvx resolver first, binary fallback. */
export function blenderMcpSpawn(config = {}) {
  if (config.command) {
    return { command: config.command, args: config.args ?? [] };
  }
  if (config.uvx !== false) {
    return { command: config.uvxBin ?? 'uvx', args: ['blender-mcp'] };
  }
  return { command: 'blender-mcp', args: [] };
}

export class BlenderSession {
  /**
   * Start a Blender MCP session.
   * @param {object} options { command, args, uvx, uvxBin, timeoutMs }
   */
  static async start(options = {}) {
    const spawn_ = blenderMcpSpawn(options);
    const client = new McpStdioClient({
      command: spawn_.command,
      args: spawn_.args,
      env: options.env,
    });
    try {
      await client.start();
    } catch (error) {
      throw new BlenderError(
        `blender MCP server failed to start (${spawn_.command} ${spawn_.args.join(' ')}): ${error.message}. ` +
          `Run 'node pipeline/setup.js' to provision Blender + blender-mcp.`,
        { cause: error },
      );
    }
    return new BlenderSession(client);
  }

  constructor(client) {
    this.client = client;
  }

  async listTools() {
    return this.client.listTools();
  }

  /**
   * True when the server answers, exposes execute_blender_code, AND a
   * trivial execution round-trips into Blender. The MCP server starts
   * fine even when the Blender side of the bridge is dead, so tool
   * listing alone lies about health.
   */
  async isHealthy() {
    try {
      const tools = await this.listTools();
      if (!tools.some((t) => t.name === 'execute_blender_code')) return false;
      await this.execute('print("health-probe")');
      return true;
    } catch {
      return false;
    }
  }

  async sceneInfo() {
    const result = await this.client.callTool('get_scene_info', {});
    return result?.content?.map((c) => c.text ?? '').join('') ?? result;
  }

  /**
   * Run Blender Python (`bpy`) inside the connected Blender instance.
   * Returns whatever the MCP tool reports back (usually the captured
   * stdout / last expression value as text).
   *
   * The model's code is wrapped in try/except BEFORE sending: the addon's
   * execute path has a nasty failure mode where an exception escaping the
   * executed block kills the addon's server thread (every subsequent call
   * gets "connection refused"). Wrapping turns model bugs into captured
   * "GAC-EXEC-ERROR" output instead — the error still reaches the model
   * on the next round, but the session survives.
   */
  async execute(code) {
    const indented = code
      .split('\n')
      .map((line) => (line.trim() ? `    ${line}` : ''))
      .join('\n');
    const wrapped = [
      'import traceback as _gac_tb',
      'try:',
      indented || '    pass',
      'except Exception as _gac_e:',
      '    print("GAC-EXEC-ERROR:", _gac_tb.format_exc())',
    ].join('\n');
    const result = await this.client.callTool('execute_blender_code', { code: wrapped });
    return result?.content?.map((c) => c.text ?? '').join('') ?? result;
  }

  /** Convenience: import a model file into the scene (data-API scene reset). */
  async importModel(path, format = 'glb') {
    const code = [
      'import bpy',
      // Data-API cleanup only — read_factory_settings would wipe the
      // addon's scene properties and kill the MCP server thread.
      'for obj in list(bpy.data.objects): bpy.data.objects.remove(obj, do_unlink=True)',
      format === 'glb'
        ? `bpy.ops.import_scene.gltf(filepath=${JSON.stringify(path)})`
        : `bpy.ops.wm.obj_import(filepath=${JSON.stringify(path)})`,
      'print("imported", len(bpy.data.objects), "objects")',
    ].join('\n');
    return this.execute(code);
  }

  /** Convenience: export the whole scene as GLB. Verifies the file landed. */
  async exportGlb(path) {
    const code = [
      'import bpy',
      `bpy.ops.export_scene.gltf(filepath=${JSON.stringify(path)}, export_format='GLB')`,
      'print("exported", ' + JSON.stringify(path) + ')',
    ].join('\n');
    await this.execute(code);
    const { stat } = await import('node:fs/promises');
    try {
      const info = await stat(path);
      if (!(info.size > 0)) throw new Error(`empty file (${info.size} bytes)`);
    } catch (error) {
      throw new BlenderError(`export produced no file at ${path}: ${error.message}`);
    }
    return path;
  }

  async close() {
    await this.client.close();
  }
}

/**
 * One post-processing job on a model file: import → run a config-supplied
 * Blender Python body → export GLB. The body sees `INPUT_PATH` and
 * `OUTPUT_PATH` as injected globals.
 */
export async function postProcessModel({ inputPath, outputPath, processCode, sessionOptions } = {}) {
  const session = await BlenderSession.start(sessionOptions ?? {});
  try {
    await session.importModel(inputPath);
    if (processCode) {
      const header = `INPUT_PATH = ${JSON.stringify(inputPath)}\nOUTPUT_PATH = ${JSON.stringify(outputPath)}\n`;
      await session.execute(header + processCode);
    }
    await session.exportGlb(outputPath);
    return { outputPath };
  } finally {
    await session.close().catch(() => {});
  }
}

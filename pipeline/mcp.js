#!/usr/bin/env node
// mcp.js — MCP stdio server for game_asset_creator.
//
// Exposes the whole pipeline to MCP clients (agents): asset creation,
// verification, config check, Weles/Blender health probes. Same wire
// discipline as the rest of the pipeline — stdout carries JSON-RPC
// frames only, diagnostics go to stderr.

import readline from 'node:readline';
import { loadPipelineConfig } from './config.js';
import { runTextToGameJob } from './text2game.js';
import { verifyAsset } from './verify.js';
import { BlenderSession } from './blender.js';
import { McpStdioClient } from './weles.js';
import { sculptWithLlm } from './llm_blender.js';

const PROTOCOL_VERSION = '2024-11-05';
const DEFAULT_CONFIG = new URL('../pipeline.config.json', import.meta.url).pathname;

const TOOLS = [
  {
    name: 'glina_create_asset',
    description:
      'Generate one 3D asset end-to-end: login (Skarbiec creds) → text prompt → poll artifact → download GLB → optional Blender postprocess → verification gate. Returns paths + verification report.',
    inputSchema: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: 'Asset description, e.g. "dwarven axe warrior, low-poly"' },
        race: { type: 'string', enum: ['humans', 'dwarves', 'elves', 'skeletons'] },
        out_dir: { type: 'string', description: 'Output directory (default: assets/models)' },
        filename: { type: 'string', description: 'Output .glb filename' },
        config: { type: 'string', description: 'Path to pipeline.config.json' },
      },
      required: ['prompt'],
    },
  },
  {
    name: 'glina_verify_asset',
    description:
      'Run the asset quality gate on a .glb: GLB structure, triangle budget (default ~6k), materials/skins/animations presence, optional Blender render smoke. Returns { ok, errors, stats }.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path to the .glb file' },
        config: { type: 'string', description: 'Path to pipeline.config.json (thresholds)' },
      },
      required: ['path'],
    },
  },
  {
    name: 'glina_check_config',
    description:
      'Validate pipeline.config.json and resolve all skarbiec:// references against the vault (no browser, no Blender). Returns the config with credentials redacted.',
    inputSchema: {
      type: 'object',
      properties: { config: { type: 'string', description: 'Path to pipeline.config.json' } },
    },
  },
  {
    name: 'glina_sculpt',
    description:
      'LLM-driven Blender sculpting: the model (Opus via Skarbiec-held key or Brama) iteratively writes bpy code, executes it through the Blender MCP session, then exports GLB and runs the verification gate. "Opus wyklepuje" the asset for you.',
    inputSchema: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: 'What to build, e.g. "gothic dwarven tower, low-poly"' },
        out_dir: { type: 'string' },
        filename: { type: 'string' },
        max_rounds: { type: 'number', description: 'Max LLM iterations (default 12)' },
        config: { type: 'string', description: 'Path to pipeline.config.json' },
      },
      required: ['prompt'],
    },
  },
  {
    name: 'glina_blender_health',
    description: 'Probe the Blender MCP server (handshake + execute_blender_code availability).',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'glina_weles_tools',
    description: 'List the tools exposed by the Weles MCP server (browser layer).',
    inputSchema: { type: 'object', properties: {} },
  },
];


function redactSecrets(node, path = []) {
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

function textResult(value) {
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  return { content: [{ type: 'text', text }] };
}

function errorResult(message) {
  return { content: [{ type: 'text', text: String(message) }], isError: true };
}

async function callTool(name, args = {}) {
  const configPath = typeof args.config === 'string' ? args.config : DEFAULT_CONFIG;
  switch (name) {
    case 'glina_create_asset': {
      if (typeof args.prompt !== 'string' || !args.prompt.trim()) {
        return errorResult('prompt is required');
      }
      const config = await loadPipelineConfig(configPath);
      const result = await runTextToGameJob(
        {
          prompt: args.race ? `${args.race} ${args.prompt}` : args.prompt,
          race: args.race,
          outDir: args.out_dir,
          filename: args.filename,
        },
        config,
      );
      return textResult(result);
    }
    case 'glina_verify_asset': {
      if (typeof args.path !== 'string' || !args.path) {
        return errorResult('path is required');
      }
      let config = {};
      try {
        config = await loadPipelineConfig(configPath);
      } catch {
        // thresholds fall back to defaults
      }
      return textResult(await verifyAsset(args.path, config));
    }
    case 'glina_sculpt': {
      if (typeof args.prompt !== 'string' || !args.prompt.trim()) {
        return errorResult('prompt is required');
      }
      const config = await loadPipelineConfig(configPath);
      const result = await sculptWithLlm(
        {
          prompt: args.prompt,
          outDir: args.out_dir,
          filename: args.filename,
          maxRounds: args.max_rounds,
        },
        config,
      );
      return textResult({ ...result, transcript: undefined });
    }
    case 'glina_check_config': {
      const config = await loadPipelineConfig(configPath);
      return textResult(redactSecrets(config));
    }
    case 'glina_blender_health': {
      const session = await BlenderSession.start({});
      const healthy = await session.isHealthy();
      const tools = await session.listTools().catch(() => []);
      await session.close();
      return textResult({ healthy, tools: tools.map((t) => t.name) });
    }
    case 'glina_weles_tools': {
      const client = new McpStdioClient({});
      await client.start();
      const tools = await client.listTools();
      await client.close();
      return textResult(tools.map((t) => ({ name: t.name, description: t.description })));
    }
    default:
      return errorResult(`unknown tool: ${name}`);
  }
}

function respond(id, result) {
  return { jsonrpc: '2.0', id, result };
}

function respondError(id, code, message) {
  return { jsonrpc: '2.0', id, error: { code, message } };
}

async function handle(request) {
  const { id, method, params } = request;
  if (method === 'initialize') {
    return respond(id, {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: { tools: {} },
      serverInfo: { name: 'glina', version: '1.0.0' },
    });
  }
  if (method === 'ping') return respond(id, {});
  if (method === 'tools/list') return respond(id, { tools: TOOLS });
  if (method === 'tools/call') {
    const name = params?.name;
    if (typeof name !== 'string') return respondError(id, -32602, 'params.name must be a string');
    try {
      const result = await callTool(name, params.arguments ?? {});
      return respond(id, result);
    } catch (error) {
      return respond(id, errorResult(`${error.name}: ${error.message}`));
    }
  }
  return respondError(id, -32601, `method not found: ${method}`);
}

export async function serve() {
  const rl = readline.createInterface({ input: process.stdin });
  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let request;
    try {
      request = JSON.parse(trimmed);
    } catch {
      process.stdout.write(`${JSON.stringify(respondError(null, -32700, 'parse error'))}\n`);
      continue;
    }
    // Notifications (no id) get no reply, except never for unknown methods.
    if (request.id === undefined || request.id === null) continue;
    const response = await handle(request);
    process.stdout.write(`${JSON.stringify(response)}\n`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  serve().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

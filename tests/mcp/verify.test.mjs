import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { test } from 'node:test';

const root = resolve(import.meta.dirname, '../..');
const build = join(root, 'build', 'tests');

// One tools/call to the real glina-mcp server over stdio; answers the text
// of its single content block and whether the server marked it an error.
function verifyOverMcp(args) {
  const frames = [
    { jsonrpc: '2.0', id: 'init', method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test', version: 'test' } } },
    { jsonrpc: '2.0', id: 'verify', method: 'tools/call', params: { name: 'glina_verify_asset', arguments: args } },
  ];
  const run = spawnSync(process.execPath, ['pipeline/mcp.js'], {
    cwd: root,
    input: frames.map((frame) => `${JSON.stringify(frame)}\n`).join(''),
    encoding: 'utf8',
  });
  assert.ok(!run.status, `glina-mcp exited ${run.status}:\n${run.stderr}`);
  const answer = run.stdout.trim().split('\n').map((line) => JSON.parse(line)).find((frame) => frame.id === 'verify');
  assert.ok(answer, `no answer to tools/call:\n${run.stdout}`);
  const [block] = answer.result.content;
  return { isError: answer.result.isError === true, text: block.text };
}

test('MCP verify refuses a config it cannot read and gates with a readable one', async () => {
  await mkdir(build, { recursive: true });
  const work = await mkdtemp(join(build, 'mcp-verify-'));
  try {
    const asset = join(root, 'assets', 'models', 'smok.glb');

    const missing = verifyOverMcp({ path: asset, config: join(work, 'absent.json') });
    assert.equal(missing.isError, true);
    assert.match(missing.text, /absent\.json/);
    assert.match(missing.text, /ENOENT/);

    const malformed = join(work, 'malformed.json');
    await writeFile(malformed, '{ not json');
    const unparsed = verifyOverMcp({ path: asset, config: malformed });
    assert.equal(unparsed.isError, true);
    assert.match(unparsed.text, /malformed\.json|JSON/);

    const readable = join(work, 'readable.json');
    await writeFile(readable, '{}\n');
    const gated = verifyOverMcp({ path: asset, config: readable });
    assert.equal(gated.isError, false, gated.text);
    assert.equal(typeof JSON.parse(gated.text).ok, 'boolean');
  } finally {
    await rm(work, { recursive: true, force: true });
  }
});

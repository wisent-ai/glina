// One real CLI or MCP journey: the commands it needs to succeed, recorded
// with their exits, and the refusals it needs, recorded as the state it
// observed. Each glina run reads the empty config its data directory holds,
// never the checkout's own pipeline.config.json, and keeps its data and its
// state (onboarding progress) in that directory.
//
// A defect register that measures a repair by a journey names the defect and
// its criterion in GLINA_TEST_DEFECT and GLINA_TEST_CRITERION; a passing run
// on committed source then writes criterion.json under build/criterion: the
// defect, the criterion, the revision, the result, the digests of the Node
// binary and of the test, the commands with their exits and the refusals.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = resolve(import.meta.dirname, '../..');
const build = join(root, 'build', 'tests');
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');

/** @param {string} testUrl the journey's own import.meta.url, digested into its report */
export async function journey(testUrl, name) {
  const defectId = process.env.GLINA_TEST_DEFECT?.trim();
  const criterion = process.env.GLINA_TEST_CRITERION?.trim();
  assert.equal(Boolean(defectId), Boolean(criterion),
    'GLINA_TEST_DEFECT and GLINA_TEST_CRITERION are named together or not at all');
  const commands = [];
  const refusals = [];

  const run = (executable, args, env, input) => ({
    executable,
    args,
    ...spawnSync(executable, args, { cwd: root, env, input, encoding: 'utf8' }),
  });

  /** A command the journey needs to succeed; recorded with its exit. */
  const succeeds = (executable, args, env, input) => {
    const result = run(executable, args, env, input);
    assert.ok(!result.status, `${executable} ${args.join(' ')} failed: ${result.stderr}\n${result.stdout}`);
    commands.push({ executable, args, exit: result.status });
    return result;
  };

  const revision = defectId ? succeeds('git', ['rev-parse', 'HEAD'], process.env).stdout.trim() : null;
  if (defectId) {
    assert.equal(succeeds('git', ['status', '--porcelain', '--untracked-files=normal'], process.env).stdout, '',
      'a criterion report is written only for committed source');
  }

  await mkdir(build, { recursive: true });
  const data = await mkdtemp(join(build, `${name}-`));
  const config = join(data, 'pipeline.config.json');
  await writeFile(config, '{}\n');
  const glinaArgs = (args) => ['pipeline/cli.js', ...args, '--config', config];
  const env = { ...process.env, XDG_DATA_HOME: data, XDG_STATE_HOME: data };

  return {
    data,
    config,
    /** `glina <args>` that must succeed; its JSON answer. */
    glina(...args) {
      return JSON.parse(succeeds(process.execPath, glinaArgs(args), env).stdout);
    },
    /** `glina <args>` that must succeed and answers text; the finished process. */
    runs(...args) {
      return succeeds(process.execPath, glinaArgs(args), env);
    },
    /** `glina <args>` that must be refused; the refusal is observed state. */
    refused(label, ...args) {
      const result = run(process.execPath, glinaArgs(args), env);
      assert.ok(result.status, `${args.join(' ')} was accepted: ${result.stdout}`);
      refusals.push({ name: label, args, refusal: `${result.stderr}${result.stdout}`.trim() });
      return result;
    },
    /**
     * One exchange with glina-mcp over stdio: initialize, then one tools/call.
     * The server process must exit cleanly; the call's answer is returned as
     * the text of its content block and whether it was marked an error.
     */
    mcp(tool, args) {
      const frames = [
        { jsonrpc: '2.0', id: 'init', method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'glina-journey', version: 'test' } } },
        { jsonrpc: '2.0', id: 'call', method: 'tools/call', params: { name: tool, arguments: args } },
      ];
      const input = frames.map((frame) => `${JSON.stringify(frame)}\n`).join('');
      const result = succeeds(process.execPath, ['pipeline/mcp.js'], env, input);
      const answer = result.stdout.trim().split('\n').map((line) => JSON.parse(line)).find((frame) => frame.id === 'call');
      assert.ok(answer, `glina-mcp answered no tools/call:\n${result.stdout}`);
      const [block] = answer.result.content;
      return { isError: answer.result.isError === true, text: block.text };
    },
    /** A refusal answered inside a successful exchange, such as an MCP error result. */
    observed(label, args, refusal) {
      refusals.push({ name: label, args, refusal });
    },
    /** Write criterion.json when a register named the journey; call after every check passed. */
    async passed() {
      if (!defectId) return;
      const directory = join(root, 'build', 'criterion', randomUUID());
      await mkdir(directory, { recursive: true });
      const path = join(directory, 'criterion.json');
      await writeFile(path, `${JSON.stringify({
        defectId,
        criterion,
        sourceRevision: revision,
        result: 'passed',
        binarySha256: digest(await readFile(process.execPath)),
        testSha256: digest(await readFile(fileURLToPath(testUrl))),
        observedFinalState: { refusals },
        commands,
      }, null, '  ')}\n`, { mode: constants.S_IRUSR | constants.S_IWUSR });
      console.log(`criterion report: ${path}`);
    },
  };
}

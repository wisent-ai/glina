#!/usr/bin/env node
// Refuses the code shapes glina has repaired once and must not grow again,
// over every file of the package source (pipeline/, src/, docs/examples/):
//
//   node tests/shapes.mjs
//
// Standard output carries one `path:line: <rule>` per instance and the run
// exits 1 when there is any; it is empty and exits 0 when none remains. The
// release manifest runs it as a lint, so a new instance is refused where it
// arises. A file git cannot list or this script cannot read fails the run
// with that reason.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const SOURCES = ['pipeline', 'src', 'docs/examples'];

const RULES = [
  [/\bcatch\s*\{/, 'a catch that binds no error answers every failure the same: bind it, treat only the absence it means (ENOENT) as absent, and name any other cause'],
  [/\.catch\(\s*\(\s*\)\s*=>/, 'a rejection handler that ignores its error drops the cause: say it (on stderr when the job outcome must stand) or let it propagate'],
  [/Number\.MIN_VALUE|Math\.sign\(\s*Infinity\s*\)/, 'a disguised zero or one: compare with 0 or name the quantity'],
  [/import\.meta\.url\s*===\s*`file:\/\//, 'an entry guard comparing paths without resolving links runs nothing when installed as a symlink: use invokedDirectly from pipeline/host/package.js'],
  [/Number\([^)]*(\?\?|\|\|)\s*0\s*\)/, 'an absent value is not zero: refuse it naming the field, or keep it absent'],
  [/rejectUnauthorized\s*:\s*false/, 'TLS verification stays on: give the server its CA instead'],
  [/(\?\?|\|\|)\s*['"](default|unknown)['"]/, "a missing key is not 'default' or 'unknown': refuse it naming what is missing"],
  [/^\s*(await\s+)?fetch\(/, "a fetch whose response is thrown away looks done when it was refused: read the response and check response.ok"],
  [/\.slice\(\s*-\d+\s*\)/, 'a cut reply hides the cause: quote what the program said whole'],
  [/AbortSignal\.timeout|\bsetTimeout\(|\bretr(y|ies)\b/i, 'a fixed deadline, pause or retry hides the cause (cli.md rule 8): one request, and its refusal is the error'],
  [/openrouter\.ai|api\.openai\.com|api\.anthropic\.com/, 'model calls go through models.brama, or models.openai_compatible without Brama, never a provider named in code'],
  [/skarbiec:\/\//, 'a config names the role its credential plays (role://<role>/<field>), never a vault item'],
];

const listed = spawnSync('git', ['-C', root, 'ls-files', '--cached', '--others', '--exclude-standard', '--', ...SOURCES], { encoding: 'utf8' });
assert.ok(!listed.error && listed.signal === null && !listed.status, `git ls-files failed: ${listed.error?.message ?? listed.stderr}`);
const files = listed.stdout.split('\n').filter((path) => /\.(m?js|sh|json)$/.test(path));

const found = [];
for (const path of files) {
  const lines = readFileSync(join(root, path), 'utf8').split('\n');
  lines.forEach((text, index) => {
    for (const [shape, rule] of RULES) {
      if (shape.test(text)) found.push(`${path}:${index + 1}: ${rule}`);
    }
  });
}
if (found.length) {
  process.stdout.write(`${found.join('\n')}\n`);
  process.exitCode = 1;
}

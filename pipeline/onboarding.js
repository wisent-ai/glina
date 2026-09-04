// Glina CLI onboarding. The journey beside this file is the only source of
// screen copy; this presenter owns only local progress and terminal layout.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const DEFINITION = path.join(here, 'onboarding_first_use.json');

function stateFile() {
  const root = process.env.XDG_STATE_HOME?.trim()
    ? process.env.XDG_STATE_HOME.trim()
    : path.join(os.homedir(), '.local', 'state');
  return path.join(root, 'glina', 'onboarding.json');
}

async function readDefinition() {
  return JSON.parse(await readFile(DEFINITION, 'utf8'));
}

async function readProgress() {
  try {
    return JSON.parse(await readFile(stateFile(), 'utf8'));
  } catch {
    return null;
  }
}

async function writeProgress(progress) {
  const file = stateFile();
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(progress, null, 2)}\n`);
}

function screensInOrder(definition) {
  const byId = new Map(definition.screens.map((screen) => [screen.screen_id, screen]));
  const ordered = [];
  let current = byId.get(definition.entry_screen_id);
  while (current && !ordered.includes(current)) {
    ordered.push(current);
    const next = [...current.transitions].sort((left, right) => left.priority - right.priority)[0];
    current = next ? byId.get(next.next_screen_id) : undefined;
  }
  return ordered;
}

/** Record the fact only after the real verification gate returns an accepted report. */
export async function recordAssetQualityGatePassed() {
  try {
    const progress = (await readProgress()) ?? {};
    if (progress.status === 'completed') return;
    const definition = await readDefinition();
    await writeProgress({
      ...progress,
      product_id: definition.product_id,
      journey_id: definition.journey_id,
      journey_version: definition.journey_version,
      status: 'completed',
      evidence: { [definition.first_success_fact]: true },
      completed_at: new Date().toISOString(),
    });
  } catch {
    // Onboarding progress must never turn an accepted asset into a failed command.
  }
}

export async function runOnboarding(options = {}) {
  const definition = await readDefinition();
  const screens = screensInOrder(definition);

  let progress = await readProgress();
  let reset = false;
  if (options.reset && progress) {
    progress = null;
    reset = true;
    await writeProgress({
      product_id: definition.product_id,
      journey_id: definition.journey_id,
      journey_version: definition.journey_version,
      status: 'in_progress',
      evidence: {},
      started_at: new Date().toISOString(),
    });
  } else if (!progress) {
    await writeProgress({
      product_id: definition.product_id,
      journey_id: definition.journey_id,
      journey_version: definition.journey_version,
      status: 'in_progress',
      evidence: {},
      started_at: new Date().toISOString(),
    });
  }

  const done = progress?.status === 'completed';
  if (reset) {
    console.log('First-run walkthrough reset: recorded progress discarded, showing it again now.');
    console.log('');
  }
  for (const [index, screen] of screens.entries()) {
    console.log(`${index + 1}/${screens.length}  ${screen.presentation?.title ?? screen.title_key}`);
    console.log(`       ${screen.presentation?.body ?? screen.body_key}`);
    if (screen.presentation?.command) console.log(`       $ ${screen.presentation.command}`);
    console.log('');
  }
  console.log(
    done
      ? `First-run journey already complete: ${definition.first_success_fact} was observed on an earlier run.`
      : `No asset has passed Glina's quality gate from this shell yet, so ${definition.first_success_fact} is still open; the next successful verify closes it.`,
  );
}

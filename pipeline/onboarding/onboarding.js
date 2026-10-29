// Glina CLI onboarding. The journey beside this file is the only source of
// screen copy; this presenter owns only local progress and terminal layout.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { importAsset } from '../workspace/assets.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const DEFINITION = path.join(here, 'onboarding_first_use.json');
const INDENT = '  ';

// XDG_STATE_HOME when it names a directory, else the XDG default under home.
function stateFile() {
  const declared = process.env.XDG_STATE_HOME;
  if (typeof declared === 'string' && declared.trim()) {
    return path.join(declared.trim(), 'glina', 'onboarding.json');
  }
  return path.join(os.homedir(), '.local', 'state', 'glina', 'onboarding.json');
}

async function readDefinition() {
  return JSON.parse(await readFile(DEFINITION, 'utf8'));
}

// Only a missing progress file is a first run. One that cannot be read or is
// not JSON throws naming the file: read as no progress, the next write
// replaced it and the operator's onboarding started over.
async function readProgress() {
  const file = stateFile();
  let text;
  try {
    text = await readFile(file, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw new Error(`onboarding progress ${file} cannot be read: ${error.message}`);
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`onboarding progress ${file} is not JSON: ${error.message}`);
  }
}

async function writeProgress(progress) {
  const file = stateFile();
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(progress, null, INDENT)}\n`);
}

function startedProgress(definition) {
  return {
    product_id: definition.product_id,
    journey_id: definition.journey_id,
    journey_version: definition.journey_version,
    status: 'in_progress',
    evidence: {},
    started_at: new Date().toISOString(),
  };
}

// The screens from the entry, each followed by its highest-priority
// transition, until a screen has none or repeats.
function screensInOrder(definition) {
  const byId = new Map(definition.screens.map((screen) => [screen.screen_id, screen]));
  const ordered = [];
  let current = byId.get(definition.entry_screen_id);
  while (current && !ordered.includes(current)) {
    ordered.push(current);
    let next;
    for (const transition of current.transitions) {
      if (next === undefined || transition.priority < next.priority) next = transition;
    }
    if (next === undefined) break;
    current = byId.get(next.next_screen_id);
  }
  return ordered;
}

// A screen's copy as the journey states it; a screen without its copy is a
// broken journey file, named.
function presented(screen) {
  const presentation = screen.presentation;
  if (!presentation || typeof presentation.title !== 'string' || typeof presentation.body !== 'string') {
    throw new Error(`onboarding screen ${screen.screen_id} in ${DEFINITION} has no presentation title and body`);
  }
  return presentation;
}

/** Record the fact only after the workspace accepted and persisted a real asset. */
export async function recordAssetImported(asset) {
  // No stored progress is a first run; spreading it adds nothing.
  const progress = await readProgress();
  if (progress !== null && progress.status === 'completed') return;
  const definition = await readDefinition();
  await writeProgress({
    ...progress,
    product_id: definition.product_id,
    journey_id: definition.journey_id,
    journey_version: definition.journey_version,
    status: 'completed',
    evidence: {
      [definition.first_success_fact]: true,
      asset_path: asset.path,
      asset_id: asset.id,
    },
    completed_at: new Date().toISOString(),
  });
}

export async function runOnboarding(options = {}) {
  const definition = await readDefinition();
  const screens = screensInOrder(definition);

  let progress = await readProgress();
  let reset = false;
  if (options.reset && progress) {
    progress = null;
    reset = true;
    await writeProgress(startedProgress(definition));
  } else if (!progress) {
    await writeProgress(startedProgress(definition));
  }
  if (options.asset) {
    // The import gate verifies against the config the CLI loaded, exactly as
    // `glina import` passes it; an import without one is the gate's to refuse.
    const report = await importAsset(options.asset, {
      name: options.name,
      config: options.config,
    });
    if (report.accepted) {
      await recordAssetImported(report);
    }
    // The CLI prints the report, as JSON or with --text, like glina import.
    return report;
  }

  if (reset) {
    console.log('First-run walkthrough reset: recorded progress discarded, showing it again now.');
    console.log('');
  }
  const shown = [];
  for (const screen of screens) {
    shown.push(screen);
    const presentation = presented(screen);
    console.log(`${shown.length}/${screens.length}  ${presentation.title}`);
    console.log(`       ${presentation.body}`);
    if (presentation.command) console.log(`       $ ${presentation.command}`);
    console.log('');
  }
  if (progress !== null && progress.status === 'completed') {
    console.log(`First-run journey already complete: ${definition.first_success_fact} was observed on an accepted import.`);
  } else {
    console.log(
      `No existing asset has been accepted into Glina's workspace yet, so ${definition.first_success_fact} is still open; import one with the command shown above.`,
    );
  }
}

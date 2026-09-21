// All character geometry is built procedurally in art/anatomy.js. No GLB downloads.
export function loadHumanoid() { return Promise.resolve(null); }
export function isHumanoidReady() { return false; }
export function isRaceReady() { return false; }
export function loadAllRaces() { return Promise.resolve([]); }
export function loadRaceModel() { return Promise.reject(new Error('procedural-only')); }
export function buildRaceUnit() { return null; }
export function buildHumanoidUnit() { return null; }
export function playClip() { return null; }
export function crossFadeTo(unitGltf, currentAction) { return currentAction; }

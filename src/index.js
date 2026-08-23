// glina — public entry point.
//
// The asset-creation pipeline of simple-rts-unity, extracted from
// web/art/ into a standalone module. Everything the game renders is
// built at runtime from THREE.js primitives — no downloaded models.

export { makeBody, buildBlobBody } from './anatomy.js';
export { sculptHumanoid } from './sculpt.js';
export {
  addBox,
  buildAxe,
  buildArmorDetails,
  buildBodyDetails,
  buildExtraDetails,
  buildCape,
} from './sculpt-gear.js';
export { cardArtSvg } from './card-art.js';
export {
  loadHumanoid,
  isHumanoidReady,
  isRaceReady,
  loadAllRaces,
  loadRaceModel,
  buildRaceUnit,
  buildHumanoidUnit,
  playClip,
  crossFadeTo,
} from './loader.js';

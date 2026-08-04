/** Game-wide constants & tuning knobs. */

/** Logical pixel resolution of a world tile. All art uses integer scales. */
export const TILE = 16;

/** Artist-recommended sprite frame size (chibi 32x32; see pixel-art-sprites). */
export const FRAME = 32;

/** Engine selection always draws at 1x logical, scaled for display by integer factor. */
export const CAMERA_INTEGER_SCALE = 2;

/** Simulated map dimensions (tiles). */
export const MAP_W = 160;
export const MAP_H = 120;

/** Simulation tick length in ms. Logic runs at a fixed cadence for determinism. */
export const TICK_MS = 100;

/** How many simulated ticks advance per rendered frame at normal speed. */
export const TICKS_PER_FRAME = 1;

/** Deterministic simulation seed for a new game (overridable in UI). */
export const DEFAULT_SEED = 1337;

export const COLONY_START = {
  colonistCount: 3,
  /** Starting food rations per colonist. */
  startingFood: 12,
  /** Starting wood and steel. */
  startingWood: 20,
  startingSteel: 8,
};

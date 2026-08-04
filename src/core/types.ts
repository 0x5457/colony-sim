/** Shared foundational types used across the simulation. */

import type { RNG } from './rng';

export interface Vec2 {
  x: number;
  y: number;
}

/** A seeded generator embedded so worlds can be regenerated from a string seed. */
export function hashStringToInt(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
export { RNG };

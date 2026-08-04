/** World grid structures: the map (int-per-cell for cheap routing + solid grid). */

import { TILES } from '../data/tiles';

/** 2D grid of tile ids (strings) for rendering & logic. */
export type TileGrid = string[][];

/** Texture-variant seed grid (parallel to TileGrid) to break visual repetition. */
export type VariantGrid = number[][];

/** Solid/walkable occupancy grid for pathfinding (true = blocked). */
export type SolidGrid = boolean[][];

export function createGrid<T>(w: number, h: number, fill: () => T): T[][] {
  const g: T[][] = [];
  for (let y = 0; y < h; y++) {
    const row: T[] = [];
    for (let x = 0; x < w; x++) row.push(fill());
    g.push(row);
  }
  return g;
}

export interface Terrain {
  w: number;
  h: number;
  tiles: TileGrid;
  variants: VariantGrid;
  /** Solid from base terrain + structures. Kept in sync. */
  solid: SolidGrid;
  /** Elevation/moisture for saving & debugging. */
  elevation?: number[];
  moisture?: number[];
}

export function tileWalkable(id: string): boolean {
  const def = TILES[id];
  return !!def && def.walkable;
}

export function inBounds(t: Terrain, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < t.w && y < t.h;
}

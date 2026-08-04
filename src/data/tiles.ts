/** Tile (terrain structure) definitions. */

export interface TileDef {
  id: string;
  name: string;
  /** Walkability for pathfinding (walls/animals collide; floor/trees don't). */
  walkable: boolean;
  /** Buildable as a structure (walls etc.). */
  isStructure?: boolean;
  /** Does this tile block line of sight / can be built as a wall. */
  blocksSight?: boolean;
  /** Movement cost multiplier (higher = slower). Default 1. */
  cost?: number;
  /** Tile health for structures (0 for non-structures). */
  maxHp?: number;
  /** Category for rendering pass. */
  layer: 'floor' | 'floorDeco' | 'wall' | 'water';
  /** Palette role for the texture generator. */
  color: number;
  /** Variant count to reduce repetition. */
  variants?: number;
}

export const TILES: Record<string, TileDef> = {
  void: {
    id: 'void', name: 'Void', walkable: false, layer: 'floor', color: 0x000000,
  },
  grass: {
    id: 'grass', name: 'Grass', walkable: true, layer: 'floor', color: 0x4c8037,
    variants: 4,
  },
  dirt: {
    id: 'dirt', name: 'Dirt', walkable: true, layer: 'floor', color: 0x8a6a3a,
    variants: 3,
  },
  sand: {
    id: 'sand', name: 'Sand', walkable: true, layer: 'floor', color: 0xd8c080,
    variants: 3,
  },
  shallowWater: {
    id: 'shallowWater', name: 'Shallow Water', walkable: false, layer: 'water',
    color: 0x3a6ca8, variants: 2,
  },
  deepWater: {
    id: 'deepWater', name: 'Deep Water', walkable: false, layer: 'water',
    color: 0x28486f, variants: 2,
  },
  stone: {
    id: 'stone', name: 'Mountain Floor', walkable: true, layer: 'floor', color: 0x9aa0a8,
    variants: 3,
  },
  wall: {
    id: 'wall', name: 'Wall', walkable: false, isStructure: true, blocksSight: true,
    layer: 'wall', color: 0x7a7a82, maxHp: 100,
  },
};

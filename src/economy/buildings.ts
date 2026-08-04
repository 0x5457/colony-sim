/** Structures & blueprints (construct → build → functional). */

export type BuildingKind = 'campfire' | 'workbench' | 'bed' | 'wall' | 'door' | 'farmPlot' | 'torch' | 'hearth';

export interface Structure {
  id: number;
  kind: BuildingKind;
  x: number;
  y: number;
  hp: number;
  /** Tech needed to build (recipe only). */
  /** For farmPlot: is a crop planted? 0..1 growth. */
  planted?: boolean;
  growth?: number;
}

export interface BlueprintDef {
  kind: BuildingKind;
  name: string;
  /** Inputs required to construct (from colony stockpiles). */
  cost: Record<string, number>;
  /** Tech required (empty = none). */
  requiresTech?: string;
  hp: number;
  color: number;
  /** Footprint (w x h in tiles) for placement. Covers only the anchor tile. */
  w: number;
  h: number;
}

export const BLUEPRINTS: Record<BuildingKind, BlueprintDef> = {
  // All buildings are available from the start (tech gating reserved for a
  // future research system; requiresTech is honoured but left empty here).
  campfire: { kind: 'campfire', name: 'Campfire', cost: { wood: 10 }, hp: 120, color: 0xd07030, w: 1, h: 1 },
  workbench: { kind: 'workbench', name: 'Workbench', cost: { wood: 25 }, hp: 200, color: 0x8a6a3a, w: 2, h: 1 },
  bed: { kind: 'bed', name: 'Bed', cost: { wood: 12 }, hp: 80, color: 0xc8a84a, w: 2, h: 1 },
  wall: { kind: 'wall', name: 'Wall', cost: { wood: 5 }, hp: 100, color: 0x7a7a82, w: 1, h: 1 },
  door: { kind: 'door', name: 'Door', cost: { wood: 4 }, hp: 80, color: 0x8a6a3a, w: 1, h: 1 },
  farmPlot: { kind: 'farmPlot', name: 'Farm Plot', cost: { wood: 6 }, hp: 40, color: 0x6a8f4a, w: 1, h: 1 },
  torch: { kind: 'torch', name: 'Torch', cost: { wood: 3 }, hp: 60, color: 0xd89a4a, w: 1, h: 1 },
  hearth: { kind: 'hearth', name: 'Hearth', cost: { wood: 18, steel: 4 }, hp: 300, color: 0xa06a3a, w: 2, h: 1 },
};

export interface Blueprint {
  kind: BuildingKind;
  x: number;
  y: number;
  /** Construction progress 0..1. */
  progress: number;
  occupied: boolean;
}

/** Resource nodes scattered across the map (trees, rocks, wild berries, animals). */

export type NodeKind = 'tree' | 'rock' | 'berry' | 'animal';

export interface ResourceNode {
  id: number;
  kind: NodeKind;
  x: number;
  y: number;
  /** Remaining harvest hp (higher for rocks). */
  hp: number;
  maxHp: number;
  /** Tool tier required to harvest (fist = 0). */
  requiredTier: number;
  /** Item + qty drops on complete harvest. */
  drops: Array<[string, number]>;
  /** Regrowth delay in seconds; -1 = never. */
  respawn: number;
  alive: boolean;
  /** For animals/corpses: dead state. */ 
  isCorpse?: boolean;
}

export const NODE_STATS: Record<
  NodeKind,
  { hp: number; tier: number; respawn: number; color: number }
> = {
  tree: { hp: 40, tier: 0, respawn: 180, color: 0x2d6b2f },
  rock: { hp: 120, tier: 0, respawn: -1, color: 0x7a7a82 },
  berry: { hp: 20, tier: 0, respawn: 150, color: 0xc84a4a },
  animal: { hp: 50, tier: 0, respawn: 240, color: 0xb08a5a },
};

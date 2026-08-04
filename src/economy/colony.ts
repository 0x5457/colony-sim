/** Colony state: colonists, stockpiles, buildings, work priorities, tech, research. */

import { Colonist } from '../agents/colonist';
import { WORK_TYPES } from '../data/work-types';
import { Structure, Blueprint } from '../economy/buildings';
import { GroundStack } from '../economy/inventory';

export class Colony {
  colonists: Colonist[] = [];

  /** Player work priorities: workTypeId -> 0..4 (0 = disabled). */
  priorities: Record<string, number> = {};
  /** Per-work override for whether enabled (derived from priorities). */
  enabled: Record<string, boolean> = {};

  structures: Structure[] = [];
  blueprints: Blueprint[] = [];
  ground: GroundStack[] = [];

  /** Tech already researched (ids). */
  tech: Set<string> = new Set();
  /** Research points accumulated toward the current research project. */
  researchPoints = 0;
  activeResearch: string | null = null;

  moodAverage = 50;

  constructor() {
    for (const wt of WORK_TYPES) {
      this.priorities[wt.id] = wt.defaultPriority;
      this.enabled[wt.id] = wt.defaultEnabled;
    }
  }

  addColonist(c: Colonist): void {
    this.colonists.push(c);
  }

  /** Work weight for a workType (0 = disabled). Higher priority = bigger weight. */
  workWeight(typeId: string): number {
    return this.enabled[typeId] ? this.priorities[typeId] ?? 0 : 0;
  }

  hasTech(id: string): boolean {
    return this.tech.has(id);
  }
}

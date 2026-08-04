/** Work types (colony job categories) the player can toggle & prioritise. */

export interface WorkTypeDef {
  id: string;
  name: string;
  /** Chinese display name. */
  cn: string;
  /** Skill name used for colonist aptitude. */
  skill: string;
  /** Player priority 0-4; 0 = disabled. Defaults set for balanced play. */
  defaultPriority: number;
  /** Whether enabled by default. */
  defaultEnabled: boolean;
  /** Color for UI badges. */
  color: number;
  /** Virtual max per-task weight for sorting (approx). */
}

export const WORK_TYPES: WorkTypeDef[] = [
  { id: 'haul', name: 'Hauling', cn: '搬运', skill: 'hauling', defaultPriority: 3, defaultEnabled: true, color: 0x9aa0a8 },
  { id: 'chop', name: 'Chopping', cn: '伐木', skill: 'plants', defaultPriority: 2, defaultEnabled: true, color: 0x8a5a2a },
  { id: 'mine', name: 'Mining', cn: '采矿', skill: 'mining', defaultPriority: 2, defaultEnabled: true, color: 0x6a6a72 },
  { id: 'cook', name: 'Cooking', cn: '烹饪', skill: 'cooking', defaultPriority: 3, defaultEnabled: true, color: 0xc8a84a },
  { id: 'construct', name: 'Construction', cn: '建造', skill: 'construction', defaultPriority: 2, defaultEnabled: true, color: 0x7a7a82 },
  { id: 'hunt', name: 'Hunting', cn: '狩猎', skill: 'shooting', defaultPriority: 1, defaultEnabled: true, color: 0xb04a4a },
  { id: 'clean', name: 'Cleaning', cn: '清洁', skill: 'cleaning', defaultPriority: 1, defaultEnabled: false, color: 0x6ab8b8 },
  { id: 'research', name: 'Research', cn: '研究', skill: 'intellectual', defaultPriority: 1, defaultEnabled: false, color: 0x8a6ad8 },
];

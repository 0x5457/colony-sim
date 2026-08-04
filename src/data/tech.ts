/** Tech tree definitions. */

export interface TechDef {
  id: string;
  name: string;
  description: string;
  /** Cost in research points. */
  cost: number;
  requires?: string[];
  /** Unlocks are matched by id across recipes/buildings; kept human-listable. */
  unlocks: string[];
}

export const TECHS: Record<string, TechDef> = {
  basicTools: {
    id: 'basicTools', name: 'Basic Tools',
    description: 'Craft stone/wooden axes for faster gathering.',
    cost: 40, unlocks: ['axe', 'workbench'],
  },
  toolSmithing: {
    id: 'toolSmithing', name: 'Tool Smithing',
    description: 'Forge steel pickaxes to mine stone and ore.',
    cost: 80, requires: ['basicTools'], unlocks: ['pickaxe'],
  },
  construction: {
    id: 'construction', name: 'Construction',
    description: 'Build walls, beds and proper workshops.',
    cost: 60, unlocks: ['wall', 'bed'],
  },
};

export function techAvailable(owned: Set<string>, tech: TechDef): boolean {
  return tech.requires ? tech.requires.every((r) => owned.has(r)) : true;
}

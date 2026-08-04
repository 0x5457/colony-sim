/** Item definitions. */

export interface ItemDef {
  id: string;
  name: string;
  /** Category ties into storage/billboards and UI grouping. */
  category: 'vegetation' | 'material' | 'food' | 'tool' | 'medicine' | 'corpse';
  /** Weight per unit, influences carry capacity. */
  weight: number;
  /** Stack limit in a single inventory slot / stockpile cell. */
  stackLimit: number;
  /** Is this edible raw? Nutrition value (filled when eaten). */
  nutritional?: number;
  /** Requires cooking first before safe to eat (raw food penalty). */
  rawPenalty?: number;
  /** Tool tier: what resource nodes it can harvest. */
  toolTier?: number;
  /** Rendering color (programmatic pixel). */
  color: number;
  /** Food/growth: does not rot (corpses/food may have spoilage; MVP flavor). */
  perishable?: boolean;
}

export const ITEMS: Record<string, ItemDef> = {
  wood: {
    id: 'wood', name: 'Wood', category: 'material', weight: 0.5, stackLimit: 100,
    color: 0x8a5a2a,
  },
  steel: {
    id: 'steel', name: 'Steel', category: 'material', weight: 1.0, stackLimit: 100,
    color: 0x8a8f9a,
  },
  plantFibre: {
    id: 'plantFibre', name: 'Plant Fibre', category: 'material', weight: 0.2,
    stackLimit: 100, color: 0x9ab86a,
  },
  rawFood: {
    id: 'rawFood', name: 'Raw Food', category: 'food', weight: 0.4, stackLimit: 100,
    nutritional: 12, rawPenalty: 0.15, color: 0xd8b06a,
  },
  cookedMeal: {
    id: 'cookedMeal', name: 'Cooked Meal', category: 'food', weight: 0.4,
    stackLimit: 50, nutritional: 40, color: 0xc8a84a, perishable: true,
  },
  medicine: {
    id: 'medicine', name: 'Medicine', category: 'medicine', weight: 0.2,
    stackLimit: 50, color: 0xd8d8e8,
  },
  axe: {
    id: 'axe', name: 'Axe', category: 'tool', weight: 1.5, stackLimit: 1, toolTier: 1,
    color: 0x9a7a4a,
  },
  pickaxe: {
    id: 'pickaxe', name: 'Pickaxe', category: 'tool', weight: 1.5, stackLimit: 1,
    toolTier: 2, color: 0x6a6a72,
  },
  corpse: {
    id: 'corpse', name: 'Corpse', category: 'corpse', weight: 20, stackLimit: 1,
    color: 0x5a4036, perishable: true,
  },
};

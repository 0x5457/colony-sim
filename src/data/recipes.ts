/** Crafting recipes, keyed by id; supports station + tech gating (survival-crafting). */

export interface RecipeDef {
  id: string;
  name: string;
  inputs: Record<string, number>;
  outputs: Record<string, number>;
  /** Required station type; omit = handcrafted. */
  station?: 'campfire' | 'workbench';
  /** Required tech id; none if empty. */
  requiresTech?: string;
  /** Crafting time in seconds. */
  time: number;
}

export const RECIPES: Record<string, RecipeDef> = {
  cookMeal: {
    id: 'cookMeal', name: 'Cook Meal',
    inputs: { rawFood: 3 }, outputs: { cookedMeal: 1 },
    station: 'campfire', time: 4,
  },
  axe: {
    id: 'axe', name: 'Make Axe',
    inputs: { wood: 4 }, outputs: { axe: 1 },
    station: 'workbench', requiresTech: 'basicTools', time: 6,
  },
  pickaxe: {
    id: 'pickaxe', name: 'Make Pickaxe',
    inputs: { wood: 3, steel: 3 }, outputs: { pickaxe: 1 },
    station: 'workbench', requiresTech: 'toolSmithing', time: 8,
  },
  campfire: {
    id: 'campfire', name: 'Build Campfire',
    inputs: { wood: 10 }, outputs: { campfire: 1 },
    time: 3,
  },
  workbench: {
    id: 'workbench', name: 'Build Workbench',
    inputs: { wood: 25 }, outputs: { workbench: 1 },
    time: 6,
  },
};

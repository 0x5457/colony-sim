/** Logistics: inventory stacks, storage (stockpiles/buildings), item stacks on the map. */

import { ITEMS, ItemDef } from '../data/items';

export interface ItemStack {
  item: string;
  qty: number;
}

/** An inventory owned by a colonist (carry capacity in weight). */
export class Inventory {
  stacks: ItemStack[] = [];
  maxWeight: number;

  constructor(maxWeight: number) {
    this.maxWeight = maxWeight;
  }

  weight(): number {
    let sum = 0;
    for (const s of this.stacks) sum += (ITEMS[s.item]?.weight ?? 1) * s.qty;
    return sum;
  }

  count(item: string): number {
    return this.stacks.filter((s) => s.item === item).reduce((a, s) => a + s.qty, 0);
  }

  canCarry(item: string, qty: number): boolean {
    const def: ItemDef | undefined = ITEMS[item];
    if (!def) return false;
    return this.weight() + (def.weight ?? 1) * qty <= this.maxWeight + 1e-6;
  }

  add(item: string, qty: number): boolean {
    const def = ITEMS[item];
    if (!def) return false;
    if (!this.canCarry(item, qty)) return false;
    // Merge into existing stacks first.
    for (const s of this.stacks) {
      if (s.item === item && s.qty < def.stackLimit) {
        const add = Math.min(def.stackLimit - s.qty, qty);
        s.qty += add;
        qty -= add;
        if (qty <= 0) return true;
      }
    }
    if (qty > 0) this.stacks.push({ item, qty });
    return qty === 0;
  }

  remove(item: string, qty: number): boolean {
    let needed = qty;
    for (let i = this.stacks.length - 1; i >= 0 && needed > 0; i--) {
      const s = this.stacks[i];
      if (s.item !== item) continue;
      const take = Math.min(s.qty, needed);
      s.qty -= take;
      needed -= take;
      if (s.qty <= 0) this.stacks.splice(i, 1);
    }
    return needed === 0;
  }
}

/** A ground stockpile that accepts one or more categories. */
export interface Stockpile {
  x: number;
  y: number;
  /** Categories accepted (empty = any non-tool). */
  accept: string[];
  stacks: ItemStack[];
  maxItems: number;
}

/** Shared colony storage grid: item stacks dropped on the ground (world pickups). */
export interface GroundStack {
  id: number;
  x: number;
  y: number;
  item: string;
  qty: number;
}

/**
 * Seeded, deterministic RNG (mulberry32).
 * Per the procedural-gen discipline: never use global/static random in
 * generation code. All randomness flows through one seeded instance so a seed
 * reproduces the same world.
 */
export class RNG {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
    if (this.state === 0) this.state = 1;
  }

  /** Uniform float in [0, 1). Does not include 1. */
  next(): number {
    let t = (this.state += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Integer in [min, max] inclusive. */
  int(min: number, max: number): number {
    return Math.floor(this.next() * (max - min + 1)) + min;
  }

  range(min: number, max: number): number {
    return this.next() * (max - min) + min;
  }

  /** True with probability p (0..1). */
  chance(p: number): boolean {
    return this.next() < p;
  }

  /** Pick a random element. */
  pick<T>(arr: readonly T[]): T {
    return arr[Math.floor(this.next() * arr.length)];
  }

  /** Weighted pick. table = [item, weight][]. */
  weighted<T>(table: ReadonlyArray<readonly [T, number]>): T {
    let total = 0;
    for (const [, w] of table) total += w;
    let roll = this.next() * total;
    for (const [item, w] of table) {
      roll -= w;
      if (roll <= 0) return item;
    }
    return table[table.length - 1][0];
  }

  /** Shuffle a copy of the array (Fisher-Yates). */
  shuffle<T>(arr: readonly T[]): T[] {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }
}

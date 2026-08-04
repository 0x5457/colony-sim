/** Colonist: the AI agent. Holds needs, skills, current job, movement state. */

import { RNG } from '../core/rng';
import { TILE } from '../core/config';
import { TRAITS, TraitDef } from '../data/needs';
import { WORK_TYPES } from '../data/work-types';

export type SkillName =
  | 'hauling' | 'plants' | 'mining' | 'cooking' | 'construction'
  | 'shooting' | 'cleaning' | 'intellectual';

export interface NeedState {
  /** 0..100, higher is better. */
  value: number;
  max: number;
}

export interface SkillState {
  name: SkillName;
  /** 0..10. */
  level: number;
}

export type Gender = 'm' | 'f';

export interface ColonistInit {
  id: number;
  name: string;
  x: number;
  y: number;
  seed: number;
  traitId?: string;
}

export class Colonist {
  id: number;
  name: string;
  gender: Gender;
  trait?: TraitDef;

  // Tile position (integer, snapped) + sub-pixel offset for smooth motion.
  tileX: number;
  tileY: number;
  /** Render offset in pixels within the current tile (-TILE..TILE). */
  offX: number;
  offY: number;

  /** Velocity for movement animation (sub-pixel accumulation). */
  sx: number;
  sy: number;

  needs: Record<string, NeedState> = {};
  skills: SkillState[] = [];

  // Combat/health.
  hp: number;
  maxHp: number;

  // Current work: what the colonist is doing, or null when idle.
  currentJob: import('./jobs').Job | null = null;

  // Path state.
  /** Tile-space waypoints (x,y). */
  path: Array<[number, number]> = [];
  pathIndex = 0;
  pathCooldown = 0;
  /** Whether a recompute was requested (target moved). */
  needRepath = false;

  // Per-job accumulated time.
  workProgress = 0;

  /** Timestamp of last player-issued command (for a brief highlight); sim-agnostic. */
  commandFx = 0;

  // Per-job ephemeral state.
  jobParam: unknown = null;

  // Current animation intent for renderer.
  moving: boolean = false;
  direction: 'down' | 'left' | 'right' | 'up' = 'down';

  // Whether the colonist is doing heavy work (play 'work' anim).
  working: boolean = false;

  /** Equipped tool ('axe' | 'pickaxe' | null). Speeds up harvesting. */
  tool: 'axe' | 'pickaxe' | null = null;

  /** Harvest-speed multiplier derived from the equipped tool. */
  toolMultiplier(jobKind?: string): number {
    if (jobKind === 'chop' && this.tool === 'axe') return 2.0;
    if (jobKind === 'mine' && this.tool === 'pickaxe') return 2.2;
    if (jobKind === 'mine' && this.tool === 'axe') return 1.3; // blunt axe on rock
    return 1.0;
  }

  private rng: RNG;

  constructor(init: ColonistInit) {
    this.id = init.id;
    this.name = init.name;
    this.gender = Math.floor(init.seed) % 2 === 0 ? 'm' : 'f';
    this.tileX = init.x;
    this.tileY = init.y;
    this.offX = 0;
    this.offY = 0;
    this.sx = 0;
    this.sy = 0;
    this.hp = 100;
    this.maxHp = 100;

    this.rng = new RNG(init.seed);
    if (init.traitId && TRAITS[init.traitId]) this.trait = TRAITS[init.traitId];

    // Needs default 100.
    this.needs.hunger = { value: 100, max: 100 };
    this.needs.rest = { value: 100, max: 100 };
    this.needs.joy = { value: 100, max: 100 };
    this.needs.mood = { value: 100, max: 100 };

    // Roll skills 0..5 biased low-middle.
    for (const wt of WORK_TYPES) {
      let level = this.rng.int(1, 5);
      if (this.trait?.skillMod) {
        for (const sm of this.trait.skillMod) {
          if (sm.skill === '*' || sm.skill === wt.skill) {
            level = Math.min(10, Math.round(level * sm.mult));
          }
        }
      }
      this.skills.push({ name: wt.skill as SkillName, level });
    }
  }

  skillLevel(name: SkillName): number {
    const s = this.skills.find((k) => k.name === name);
    return s ? s.level : 1;
  }

  /** Update a single need with a trait modifier applied. dt in seconds. */
  decayNeed(id: string, baseRate: number, dt: number): void {
    let rate = baseRate;
    if (this.trait?.needMod) {
      for (const nm of this.trait.needMod) {
        if (nm.need === id) rate *= nm.mult;
      }
    }
    if (this.needs[id]) {
      this.needs[id].value = Math.max(0, this.needs[id].value - rate * dt);
    }
  }

  getPositionPx(): { x: number; y: number } {
    return {
      x: this.tileX * TILE + this.offX + TILE / 2,
      y: this.tileY * TILE + this.offY + TILE / 2,
    };
  }
}

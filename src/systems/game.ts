/** Core simulation state & update loop. Owns world, colony, jobs, time, threats. */

import { Colonist } from '../agents/colonist';
import { JobBoard, Job } from '../agents/jobs';
import { findPath, isWalkable } from '../agents/pathfind';
import { regenerateWorld, GeneratedWorld } from '../world/generate';
import { ResourceNode } from '../world/nodes';
import { Terrain, inBounds } from '../world/grid';
import { Colony } from '../economy/colony';
import { Structure, Blueprint, BLUEPRINTS } from '../economy/buildings';
import { COLONY_START } from '../core/config';
import { RNG } from '../core/rng';

export interface GameHooks {
  onDirtyTile?: (x: number, y: number) => void;
  onNotify?: (message: string) => void;
  onColonistStates?: () => void;
  onGroundChange?: () => void;
  onBlueprintChange?: () => void;
  onStructureChange?: () => void;
  /** A gameplay event worth recording (icon, message) for the in-game log. */
  onLog?: (kind: LogKind, message: string) => void;
  // --- audio hooks ---
  /** A work tick happened on a colonist (chop/mine/forage/build/cook). */
  onWorkTick?: (colonist: Colonist) => void;
  /** A resource node finished (chop/mine/forage); kind is 'chop'|'mine'|'forage'. */
  onHarvestDone?: (kind: 'chop' | 'mine' | 'forage') => void;
  /** A building finished construction. */
  onBuilt?: () => void;
  /** A meal finished cooking. */
  onCooked?: () => void;
  /** A colonist took a bite from stockpile. */
  onAte?: () => void;
  /** A colonist hauled one item into stockpile. */
  onHauled?: () => void;
  /** A threat/raid pinged. */
  onThreat?: () => void;
}

/** Category of a logged gameplay event (drives the log icon/visual). */
export type LogKind =
  | 'build' | 'craft' | 'harvest' | 'haul' | 'cook' | 'eat' | 'sleep'
  | 'plant' | 'danger' | 'info';

const ZH_BUILD: Record<string, string> = {
  Campfire: '篝火', Workbench: '工作台', Bed: '床铺', Wall: '墙壁', Door: '门',
  'Farm Plot': '农田', Torch: '火把', Hearth: '火炉',
};

/** Chinese display names for item ids used in logs. */
const ZH_ITEM: Record<string, string> = {
  wood: '木材', steel: '钢铁', rawFood: '生食', cookedMeal: '熟食',
  plantFibre: '植物纤维', medicine: '药品', axe: '斧头', pickaxe: '镐',
};

/** Seconds for a planted crop to fully mature. */
const FARM_GROW_TIME = 40;

const WORK_BY_TILE: Record<string, 'chop' | 'mine' | 'forage'> = {
  tree: 'chop',
  rock: 'mine',
  berry: 'forage',
};

/** Item stacks on the ground waiting to be hauled. */
interface GroundItem {
  id: number;
  x: number;
  y: number;
  item: string;
  qty: number;
}

export class Game {
  world: GeneratedWorld;
  terrain: Terrain;
  colony = new Colony();
  jobs = new JobBoard();
  time = 0;
  seed: number;
  hooks: GameHooks = {};

  /** Shared colony storage (abstract "resource pool" for MVP). */
  stockpile: Record<string, number> = {};
  items: GroundItem[] = [];
  blueprints: Blueprint[] = [];
  structures: Structure[] = [];

  // World/timing.
  daySeconds = 90;
  night = false;
  raidRisk = 0; // 0..1, ramps up over time.
  private rng: RNG;
  private nextId = 1;

  constructor(seed: number, hooks: GameHooks = {}) {
    this.seed = seed;
    this.rng = new RNG(seed);
    this.hooks = hooks;
    this.world = regenerateWorld(seed);
    this.terrain = this.world.terrain;
    this.seedStockpile();
  }

  private seedStockpile(): void {
    this.stockpile.wood = COLONY_START.startingWood;
    this.stockpile.steel = COLONY_START.startingSteel;
  }

  /** Derive a deterministic personal RNG seed for a colonist id. */
  rngSeedFor(id: number): number {
    const s = new RNG(this.seed + 7919 * 17);
    // replicate spawn order seeds deterministically.
    let acc = s.int(1, 0xffffff);
    for (let i = 0; i < id; i++) acc = (acc + 2654435761) >>> 0;
    return acc;
  }

  spawnColonists(count: number = COLONY_START.colonistCount): void {
    const names = ['Aurelia', 'Bram', 'Cinder', 'Dana', 'Elias', 'Fenna'];
    for (let i = 0; i < count; i++) {
      const c = new Colonist({
        id: i,
        name: names[i % names.length],
        x: this.world.spawnX + (i % 2),
        y: this.world.spawnY + (i >> 1),
        seed: this.rng.int(1, 0xffffff),
        traitId: this.pickTrait(),
      });
      this.colony.addColonist(c);
    }
    // Bootstrap: drop food near spawn so they can survive early.
    this.dropOnGround(this.world.spawnX + 1, this.world.spawnY + 1, 'cookedMeal', 4);
    this.dropOnGround(this.world.spawnX - 1, this.world.spawnY + 1, 'rawFood', 10);
    // A campfire blueprint to build.
    this.placeBlueprint('campfire', this.world.spawnX, this.world.spawnY + 3, true);
  }

  private pickTrait(): string | undefined {
    if (this.rng.chance(0.4)) return undefined;
    const list = ['hardWorker', 'nightOwl', 'gourmand', 'pessimist', 'brave', 'skittish'];
    return this.rng.pick(list);
  }

  /* ============ Item logistics ============ */

  dropOnGround(x: number, y: number, item: string, qty: number): void {
    this.items.push({ id: this.nextId++, x, y, item, qty });
    this.hooks.onGroundChange?.();
  }

  addStockpile(item: string, qty: number): void {
    this.stockpile[item] = (this.stockpile[item] ?? 0) + qty;
  }

  removeStockpile(item: string, qty: number): boolean {
    const have = this.stockpile[item] ?? 0;
    if (have < qty) return false;
    this.stockpile[item] = have - qty;
    return true;
  }

  stockpileCount(item: string): number {
    return this.stockpile[item] ?? 0;
  }

  /* ============ Blueprints & structures ============ */

  placeBlueprint(kind: Blueprint['kind'], x: number, y: number, free = false): boolean {
    const def = BLUEPRINTS[kind];
    // Whole footprint must be in bounds + walkable (and not blocked).
    for (let o = 0; o < (def.w ?? 1); o++) {
      const xx = x + o;
      if (!inBounds(this.terrain, xx, y)) return false;
      if (free) continue;
      if (this.terrain.solid[y][xx]) return false;
      if (this.structures.some((s) => s.x === xx && s.y === y)) return false;
      if (this.blueprints.some((b) => b.x === xx && b.y === y)) return false;
      if (this.colony.colonists.some((cc) => cc.tileX === xx && cc.tileY === y)) return false;
    }
    if (def.requiresTech && !this.colony.hasTech(def.requiresTech)) return false;
    // Materials are NOT required to place a blueprint: the plot is queued and
    // colonists build it once the stockpile has what it needs.
    const bp: Blueprint = { kind, x, y, progress: 0, occupied: false };
    this.blueprints.push(bp);
    this.hooks.onBlueprintChange?.();
    return true;
  }

  private completeBlueprint(bp: Blueprint): void {
    const idx = this.blueprints.indexOf(bp);
    if (idx >= 0) this.blueprints.splice(idx, 1);
    const s: Structure = { id: this.nextId++, kind: bp.kind, x: bp.x, y: bp.y, hp: BLUEPRINTS[bp.kind].hp };
    this.structures.push(s);
    if (bp.kind === 'wall') this.terrain.solid[bp.y][bp.x] = true;
    this.hooks.onStructureChange?.();
    this.hooks.onDirtyTile?.(bp.x, bp.y);
    this.hooks.onBuilt?.();
  }

  /* ============ Job generation (refresh) ============ */

  /** Record a gameplay event into the in-game log (throttled so spam is capped). */
  log(kind: LogKind, message: string): void {
    this.hooks.onLog?.(kind, message);
  }

  /** Force an immediate job refresh (e.g. after priority change). */
  refreshJobsNow(): void {
    this.refreshJobs();
  }

  private respawnJobTimer = 0;

  private maybeRescanJobs(dt: number): void {
    this.respawnJobTimer -= dt;
    if (this.respawnJobTimer > 0) return;
    this.respawnJobTimer = 0.5; // regenerate available jobs a few times/sec
    this.refreshJobs();
  }

  /** Whether an active job already targets the given resource/bp/item reference. */
  private jobExists<Ref>(predicate: (j: Job) => Ref): boolean {
    for (const j of this.jobs.all) {
      if (predicate(j)) return true;
    }
    return false;
  }

  private refreshJobs(): void {
    // Remove stale jobs: unclaimed ones whose target is gone/depleted, plus all
    // unclaimed jobs each cycle. We keep only ACTIVE jobs (claimed or still-valid)
    // and ADD missing ones WITHOUT duplicating a resource that already has a job.
    for (const job of [...this.jobs.all]) {
      if (job.claimedBy !== null) continue; // keep claimed jobs
      // Determine if the underlying target is still valid.
      const ref = job.ref as ResourceNode | undefined;
      if (ref && !ref.alive) { this.jobs.remove(job.id); continue; }
      if (job.kind === 'haul') { // ground item still exists?
        const it = job.payload as GroundItem | undefined;
        if (!it || it.qty <= 0) { this.jobs.remove(job.id); continue; }
      }
      if (job.kind === 'build') {
        const bp = job.payload as Blueprint | undefined;
        if (bp && this.blueprints.indexOf(bp) < 0) { this.jobs.remove(job.id); continue; }
      }
    }

    // --- Resource nodes: one job per node, never duplicated. ---
    for (const node of this.world.nodes) {
      if (!node.alive) continue;
      const workKind = WORK_BY_TILE[node.kind];
      if (!workKind) continue;
      const exists = this.jobExists((j) => j.ref === node);
      if (exists) continue;
      this.jobs.add({
        kind: workKind, x: node.x, y: node.y, rating: 30, workWeight: 1, ref: node,
      });
    }
    // --- Ground items → one haul job per item stack. ---
    if (this.colony.workWeight('haul') > 0) {
      for (const gi of this.items) {
        const exists = this.jobExists((j) => j.kind === 'haul' && j.payload === gi);
        if (exists) continue;
        this.jobs.add({ kind: 'haul', x: gi.x, y: gi.y, rating: 20, workWeight: 1, payload: gi });
      }
    }
    // --- Blueprints → one build job per blueprint. ---
    if (this.colony.workWeight('construct') > 0) {
      for (const bp of this.blueprints) {
        const exists = this.jobExists((j) => j.kind === 'build' && j.payload === bp);
        if (exists) continue;
        this.jobs.add({ kind: 'build', x: bp.x, y: bp.y, rating: 50, workWeight: 1, payload: bp });
      }
    }
    // --- Cook meal: one cook job per campfire (when enough raw food). ---
    if (this.colony.workWeight('cook') > 0) {
      for (const s of this.structures) {
        if (s.kind !== 'campfire' || this.stockpileCount('rawFood') < 3) continue;
        const exists = this.jobExists((j) => j.kind === 'cook' && j.payload === s);
        if (exists) continue;
        this.jobs.add({ kind: 'cook', x: s.x, y: s.y + 1, rating: 40, workWeight: 1, payload: s });
      }
    }
    // --- Craft a tool at the workbench for colonists that lack one. ---
    if (this.colony.workWeight('construct') > 0) {
      const bench = this.structures.find((s) => s.kind === 'workbench');
      if (bench) {
        // Prefer axe (cheap) if any colonist lacks one, else pickaxe.
        for (const want of (['axe', 'pickaxe'] as const)) {
          if (this.jobExists((j) => j.kind === 'craft' && (j.payload as { tool?: string })?.tool === want)) continue;
          const cost: Record<string, number> = want === 'axe' ? { wood: 4 } : { wood: 3, steel: 3 };
          if (!this.canAfford(cost)) continue;
          const anyoneNeeds = this.colony.colonists.some((c) => (c.tool === null) || (want === 'axe' ? c.tool === 'pickaxe' : c.tool === 'axe'));
          if (!anyoneNeeds) continue;
          this.jobs.add({ kind: 'craft', x: bench.x, y: bench.y + 1, rating: 45, workWeight: 1, payload: { tool: want } });
          if (this.jobs.all.some((j) => j.kind === 'craft')) break;
        }
      }
    }
    // --- Farm jobs: plant empty plots, harvest mature ones. ---
    if (this.colony.workWeight('construct') > 0) {
      for (const s of this.structures) {
        if (s.kind !== 'farmPlot') continue;
        if (!s.planted) {
          if (!this.jobExists((j) => j.kind === 'plant' && j.payload === s)) {
            this.jobs.add({ kind: 'plant', x: s.x, y: s.y, rating: 46, workWeight: 1, payload: s });
          }
        } else if ((s.growth ?? 0) >= 0.999) {
          if (!this.jobExists((j) => j.kind === 'harvest' && j.payload === s)) {
            this.jobs.add({ kind: 'harvest', x: s.x, y: s.y, rating: 48, workWeight: 1, payload: s });
          }
        }
      }
    }
  }

  /** True if the colony stockpile can cover a cost dict. */
  private canAfford(cost: Record<string, number>): boolean {
    for (const [item, n] of Object.entries(cost)) if (this.stockpileCount(item) < n) return false;
    return true;
  }

  /* ============ Main update ============ */

  update(dt: number): void {
    this.time += dt;
    this.updateDayCycle(dt);
    this.updateFarms(dt);
    this.updateTorches(dt);
    this.maybeRescanJobs(dt);
    for (const c of this.colony.colonists) this.updateColonist(c, dt);
    this.separateColonists();
    this.updateThreats(dt);
    this.hooks.onColonistStates?.();
    this.hooks.onGroundChange?.();
    this.hooks.onBlueprintChange?.();
  }

  private updateDayCycle(_dt: number): void {
    const phase = (this.time % this.daySeconds) / this.daySeconds;
    // Night when phase outside 0.25..0.75 → roughly ~half night/half day.
    this.night = phase < 0.25 || phase > 0.75;
  }

  /** Grow crops in planted farm plots; mature plots become harvestable. */
  private updateFarms(dt: number): void {
    for (const s of this.structures) {
      if (s.kind !== 'farmPlot') continue;
      if (s.planted && s.growth !== undefined) {
        s.growth = Math.min(1, s.growth + dt / FARM_GROW_TIME);
      }
    }
  }

  /** Torch flame flicker is visual (handled in renderer); nothing to sim each tick. */
  private updateTorches(_dt: number): void {}



  /* ============ Colonist AI ============ */

  /** Is this tile occupied by another colonist? (soft collision avoidance). */
  private isTileOccupiedByOther(me: Colonist, x: number, y: number): boolean {
    for (const o of this.colony.colonists) {
      if (o.id === me.id) continue;
      if (o.tileX === x && o.tileY === y) return true;
    }
    return false;
  }

  /** Push overlapping colonists apart so they never stack on one tile. Only
   *  acts on true same-tile overlap and never blocks movement (no hard clamp on
   *  the off offsets, which would freeze walking). */
  private separateColonists(): void {
    const list = this.colony.colonists;
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i];
        const b = list[j];
        if (a.tileX !== b.tileX || a.tileY !== b.tileY) continue;
        // Both genuinely share the tile: separate along x, or if x would wrap,
        // nudge the one closer to leaving.
        if (Math.abs(a.offX) < 14 && Math.abs(b.offX) < 14) {
          const sign = a.id > b.id ? 1 : -1;
          a.offX -= sign * 2;
          b.offX += sign * 2;
        } else {
          // one is near a boundary already; keep them apart without forcing a tile switch
          a.offY -= 2;
          b.offY += 2;
        }
      }
    }
  }

  private updateColonist(c: Colonist, dt: number): void {
    this.decayColonistNeeds(c, dt);

    // 1. Critical survival need overrides everything.
    const critical = this.criticalNeed(c);
    if (critical && !this.hasUrgentJob(c)) {
      this.queueCriticalJob(c, critical);
    }

    // 2. If no job, pick one.
    if (!c.currentJob) {
      this.chooseJob(c);
    }

    // 3. If we have a job, work toward it (move/execute).
    if (c.currentJob) {
      this.executeJob(c, dt);
    } else {
      // Idle: stand still.
      c.moving = false;
      c.working = false;
    }
  }

  /** Decay the colonist's needs over dt seconds; recover mood toward baseline. */
  private decayColonistNeeds(c: Colonist, dt: number): void {
    c.decayNeed('hunger', 0.6, dt);
    c.decayNeed('rest', 0.45, dt);
    c.decayNeed('joy', 0.18, dt);
    const baseline = 60 + (c.trait?.moodMod ?? 0);
    const m = c.needs.mood;
    m.value += (baseline - m.value) * Math.min(1, dt * 0.05);
    m.value = Math.max(0, Math.min(100, m.value));
  }

  private hasUrgentJob(c: Colonist): boolean {
    return c.currentJob ? c.currentJob.rating >= 80 : false;
  }

  private criticalNeed(c: Colonist): 'hunger' | 'rest' | null {
    if (c.needs.hunger.value < 25) return 'hunger';
    if (c.needs.rest.value < 20) return 'rest';
    return null;
  }

  private clearJob(c: Colonist): void {
    c.currentJob = null;
    c.path = [];
    c.pathIndex = 0;
    c.workProgress = 0;
    c.working = false;
    c.jobParam = null;
  }

  private queueCriticalJob(c: Colonist, need: 'hunger' | 'rest'): void {
    if (need === 'hunger') {
      // Eat from colony stockpile if available (consumes directly).
      const mealCount = this.stockpileCount('cookedMeal') + this.stockpileCount('rawFood');
      if (mealCount > 0) {
        // Assign a personal 'eat' job anchored on the colonist's position; it
        // consumes stockpile food in place.
        this.assignPersonalJob(c, 'eat', c.tileX, c.tileY, 100, { fromStockpile: true });
      } else {
        // Otherwise find a ground meal.
        const meal = this.findFood(c.tileX, c.tileY, 20);
        if (meal) this.assignPersonalJob(c, 'eat', meal.x, meal.y, 100, meal);
      }
      // If still no food, keep current work.
    } else if (need === 'rest') {
      // Sleep at the nearest bed if one exists (else rest in place).
      const bed = this.findNearestBed(c.tileX, c.tileY);
      if (bed) this.assignPersonalJob(c, 'sleep', bed.x, bed.y + (bed.kind === 'bed' ? 0 : 0), 95, { bed });
      else this.assignPersonalJob(c, 'sleep', c.tileX, c.tileY, 95);
    }
  }

  /** Nearest owned bed structure (for sleep jobs). Bed spans 2 tiles; return anchor. */
  private findNearestBed(x: number, y: number): Structure | null {
    let best: Structure | null = null;
    let bestD = Infinity;
    for (const s of this.structures) {
      if (s.kind !== 'bed') continue;
      const d = Math.hypot(s.x - x, s.y - y);
      if (d < bestD) { bestD = d; best = s; }
    }
    return best;
  }

  private findFood(x: number, y: number, radius: number): GroundItem | null {
    let best: GroundItem | null = null;
    let bestD = Infinity;
    for (const it of this.items) {
      if (it.item !== 'cookedMeal' && it.item !== 'rawFood') continue;
      const d = Math.hypot(it.x - x, it.y - y);
      if (d <= radius && d < bestD) {
        bestD = d;
        best = it;
      }
    }
    return best;
  }

  /** Create a private (personal) job assigned directly to a colonist. */
  private assignPersonalJob(c: Colonist, kind: Job['kind'], x: number, y: number, rating: number, payload?: unknown, ref?: ResourceNode): void {
    const j: Job = {
      id: -c.id - 100,
      kind, x, y, rating,
      workWeight: 1,
      claimedBy: c.id,
      progress: 0,
      ref,
      payload,
    };
    c.currentJob = j;
    c.needRepath = true;
  }

  private chooseJob(c: Colonist): void {
    const weights: Record<string, number> = {};
    for (const wt of ['haul', 'chop', 'mine', 'cook', 'construct', 'clean']) {
      weights[wt] = this.colony.workWeight(wt);
    }
    const best = this.jobs.findBest(c, weights);
    if (best) {
      best.claimedBy = c.id;
      c.currentJob = best;
      c.needRepath = true;
    }
  }

  private executeJob(c: Colonist, dt: number): void {
    const job = c.currentJob!;
    // If already at target (within 1 tile), perform work.
    if (Math.max(Math.abs(c.tileX - job.x), Math.abs(c.tileY - job.y)) <= 1) {
      this.performWork(c, dt);
      return;
    }
    // Otherwise move.
    this.moveToward(c, job.x, job.y, dt);
  }

  private moveToward(c: Colonist, tx: number, ty: number, dt: number): void {
    if (!isWalkable(this.terrain, tx, ty)) {
      const alt = this.nearestWalkable(tx, ty);
      if (alt) { tx = alt[0]; ty = alt[1]; }
      else return;
    }

    // Recompute path when empty, invalidated, or periodically. The dynamic
    // obstacle map avoids other colonists (soft collision) while keeping the
    // goal + one ring walkable so jobs complete.
    if (c.needRepath || c.path.length === 0 || c.pathCooldown <= 0) {
      c.path = findPath(this.terrain, c.tileX, c.tileY, tx, ty, 9000, (nx, ny) => {
        // Don't block the goal or its immediate ring (we work from there).
        if (Math.max(Math.abs(nx - tx), Math.abs(ny - ty)) <= 1) return false;
        return this.isTileOccupiedByOther(c, nx, ny);
      }).points;
      c.pathIndex = 0;
      c.needRepath = false;
      c.pathCooldown = 0.25;
      if (c.path.length === 0) {
        this.clearJob(c); // unreachable
        return;
      }
    }
    c.pathCooldown -= dt;

    const speed = 3.2; // tiles/sec
    let target = c.path[c.pathIndex];
    // Skip waypoints we're already on.
    while (target && target[0] === c.tileX && target[1] === c.tileY && Math.abs(c.offX) < 1 && Math.abs(c.offY) < 1) {
      c.pathIndex++;
      target = c.path[c.pathIndex];
    }
    if (!target) { this.clearJob(c); return; }

    // Compute world-pixel goal (center of tile).
    const goalPxX = target[0] * 16 + 8;
    const goalPxY = target[1] * 16 + 8;
    const curPxX = c.tileX * 16 + 8 + c.offX;
    const curPxY = c.tileY * 16 + 8 + c.offY;
    const dx = goalPxX - curPxX;
    const dy = goalPxY - curPxY;
    const dist = Math.hypot(dx, dy);
    if (dist < 0.5) {
      c.offX = 0; c.offY = 0;
      c.tileX = target[0]; c.tileY = target[1];
      c.pathIndex++;
      if (c.pathIndex >= c.path.length) c.path = [];
      return;
    }
    const stepPx = Math.min(speed * 16 * dt, dist);
    c.offX += (dx / dist) * stepPx;
    c.offY += (dy / dist) * stepPx;
    c.moving = true;
    c.working = false;

    // Snap when crossing tile boundary.
    while (Math.abs(c.offX) >= 16) {
      if (c.offX > 0) { c.tileX++; c.offX -= 16; } else { c.tileX--; c.offX += 16; }
    }
    while (Math.abs(c.offY) >= 16) {
      if (c.offY > 0) { c.tileY++; c.offY -= 16; } else { c.tileY--; c.offY += 16; }
    }
    if (dx === 0 && dy === 0) return;
    c.direction = Math.abs(dx) > Math.abs(dy)
      ? (dx > 0 ? 'right' : 'left')
      : (dy > 0 ? 'down' : 'up');
  }

  private nearestWalkable(x: number, y: number): [number, number] | null {
    for (let r = 1; r <= 4; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.abs(dx) === r || Math.abs(dy) === r) {
            if (isWalkable(this.terrain, x + dx, y + dy)) return [x + dx, y + dy];
          }
        }
      }
    }
    return null;
  }

  private performWork(c: Colonist, dt: number): void {
    const job = c.currentJob!;
    c.moving = false;
    c.working = true;
    switch (job.kind) {
      case 'eat': this.doEat(c, dt); break;
      case 'sleep': this.doSleep(c, dt); break;
      case 'chop': case 'mine': case 'forage': this.doHarvest(c, dt); break;
      case 'haul': this.doHaul(c, dt); break;
      case 'build': this.doBuild(c, dt); break;
      case 'cook': this.doCook(c, dt); break;
      case 'craft': this.doCraft(c, dt); break;
      case 'plant': this.doPlant(c, dt); break;
      case 'harvest': this.doHarvestFarm(c, dt); break;
      default: this.clearJob(c);
    }
  }

  private doEat(c: Colonist, dt: number): void {
    const payload = c.currentJob?.payload as { fromStockpile?: boolean } | GroundItem | undefined;
    c.workProgress += dt;
    const eatTime = 1.5;
    if (c.workProgress >= eatTime) {
      c.workProgress = 0;
      const eatenStockpile = this.eatFromStockpile(c);
      if (eatenStockpile) {
        // continue (may eat another); keep at it while food remains and hunger low
        if (c.needs.hunger.value >= 85) this.clearJob(c);
        return;
      }
      // Ground item path.
      const it = payload as GroundItem | undefined;
      if (it && it.qty > 0) {
        const idx = this.items.indexOf(it);
        if (idx >= 0) {
          it.qty--;
          if (it.qty <= 0) this.items.splice(idx, 1);
          this.hooks.onGroundChange?.();
          const nutrition = it.item === 'cookedMeal' ? 40 : 12;
          c.needs.hunger.value = Math.min(100, c.needs.hunger.value + nutrition);
          if (it.item === 'cookedMeal') c.needs.mood.value = Math.min(100, c.needs.mood.value + 3);
        }
      }
      if (c.needs.hunger.value >= 85) this.clearJob(c);
    }
  }

  /** Eat directly from the colony stockpile. Returns true if anything was eaten. */
  private eatFromStockpile(c: Colonist): boolean {
    if (this.stockpileCount('cookedMeal') > 0) {
      this.removeStockpile('cookedMeal', 1);
      c.needs.hunger.value = Math.min(100, c.needs.hunger.value + 40);
      c.needs.mood.value = Math.min(100, c.needs.mood.value + 3);
      this.hooks.onColonistStates?.();
      this.hooks.onAte?.();
      return true;
    }
    if (this.stockpileCount('rawFood') > 0) {
      this.removeStockpile('rawFood', 1);
      c.needs.hunger.value = Math.min(100, c.needs.hunger.value + 12);
      this.hooks.onColonistStates?.();
      this.hooks.onAte?.();
      return true;
    }
    return false;
  }

  private doSleep(c: Colonist, dt: number): void {
    c.workProgress += dt;
    // Sleeping in a real bed recovers rest faster and gently lifts mood.
    const inBed = !!((c.currentJob?.payload ?? {}) as { bed?: Structure }).bed
      || this.structures.some((s) => s.kind === 'bed' && Math.max(Math.abs(s.x - c.tileX), Math.abs(s.y - c.tileY)) <= 1);
    const rate = inBed ? 55 : 32; // per sec
    c.needs.rest.value = Math.min(100, c.needs.rest.value + rate * dt);
    if (inBed && c.workProgress > 4) {
      c.needs.mood.value = Math.min(100, c.needs.mood.value + 0.5 * dt);
    }
    if (c.needs.rest.value >= 92) {
      this.log('sleep', `${c.name} 在${inBed ? '床上' : '地上'}休息好了`);
      this.clearJob(c);
    }
  }

  private doHarvest(c: Colonist, dt: number): void {
    const job = c.currentJob;
    const node = job?.ref as ResourceNode | undefined;
    if (!job || !node || !node.alive) { this.clearJob(c); return; }
    const skill: 'mining' | 'plants' = job.kind === 'mine' ? 'mining' : 'plants';
    const speed = (8 + c.skillLevel(skill) * 1.2) * c.toolMultiplier(job.kind);
    node.hp -= speed * dt;
    this.hooks.onWorkTick?.(c);
    if (node.hp <= 0) {
      node.alive = false;
      // Drop items on the ground next to the node.
      for (const [item, qty] of node.drops) {
        this.dropOnGround(node.x, node.y, item, qty);
      }
      this.hooks.onDirtyTile?.(node.x, node.y);
      this.hooks.onHarvestDone?.(job.kind as 'chop' | 'mine' | 'forage');
      this.log('harvest', `${c.name} 完成了${job.kind === 'chop' ? '伐木' : job.kind === 'mine' ? '采矿' : '采集'}`);
      this.clearJob(c);
    }
  }

  private doHaul(c: Colonist, dt: number): void {
    const it = c.currentJob?.payload as GroundItem | undefined;
    if (!it || it.qty <= 0) { this.clearJob(c); return; }
    c.workProgress += dt;
    const haulSpeed = 0.4; // seconds per item batch
    if (c.workProgress >= haulSpeed) {
      c.workProgress = 0;
      if (it.qty > 0) {
        this.addStockpile(it.item, 1);
        it.qty--;
        const idx = this.items.indexOf(it);
        if (idx >= 0 && it.qty <= 0) this.items.splice(idx, 1);
        this.hooks.onGroundChange?.();
        this.hooks.onHauled?.();
        this.log('haul', `${c.name} 将${ZH_ITEM[it.item] ?? it.item}搬运入库`);
      }
    }
    // If the item was fully collected, stop.
    if (!it || it.qty <= 0) this.clearJob(c);
  }

  private doBuild(c: Colonist, dt: number): void {
    const bp = c.currentJob?.payload as Blueprint | undefined;
    if (!bp) { this.clearJob(c); return; }
    if (this.blueprints.indexOf(bp) < 0) { this.clearJob(c); return; }
    const def = BLUEPRINTS[bp.kind];
    // Ensure materials exist once (already deducted at placement).
    bp.progress += (5 + c.skillLevel('construction') * 0.8) * dt / (def.hp / 40 + 0.001);
    if (bp.progress >= 1) {
      this.completeBlueprint(bp);
      const zh = ZH_BUILD[def.name as keyof typeof ZH_BUILD] ?? def.name;
      this.hooks.onNotify?.('已建成：' + zh);
      this.log('build', `${c.name} 建成了${zh}`);
      this.hooks.onBlueprintChange?.();
      this.clearJob(c);
    }
  }

  private doCook(c: Colonist, dt: number): void {
    const s = c.currentJob?.payload as Structure | undefined;
    if (!s || s.kind !== 'campfire') { this.clearJob(c); return; }
    c.workProgress += dt;
    const cookTime = 4;
    if (c.workProgress >= cookTime) {
      c.workProgress = 0;
      if (this.stockpileCount('rawFood') >= 3) {
        this.removeStockpile('rawFood', 3);
        this.addStockpile('cookedMeal', 1);
        this.hooks.onNotify?.('一道餐食做好了。');
        this.log('cook', `${c.name} 烹饪了一份餐食`);
        this.hooks.onCooked?.();
      } else {
        this.clearJob(c);
        return;
      }
    }
    if (this.stockpileCount('rawFood') < 3) this.clearJob(c);
  }

  private doCraft(c: Colonist, dt: number): void {
    const payload = c.currentJob?.payload as { tool?: 'axe' | 'pickaxe' } | undefined;
    const tool = payload?.tool;
    if (!tool) { this.clearJob(c); return; }
    // Bench must still exist.
    if (!this.structures.some((s) => s.kind === 'workbench')) { this.clearJob(c); return; }
    c.workProgress += dt;
    const craftTime = tool === 'axe' ? 5 : 7;
    if (c.workProgress >= craftTime) {
      c.workProgress = 0;
      const cost: Record<string, number> = tool === 'axe' ? { wood: 4 } : { wood: 3, steel: 3 };
      if (this.canAfford(cost)) {
        for (const [item, n] of Object.entries(cost)) this.removeStockpile(item, n);
        // Equip this colonist (they made it) and prefer he gives it to one who needs it.
        const needer = this.colony.colonists.find((cc) => cc.tool !== tool && (tool === 'axe' ? cc.tool === null || cc.tool === 'pickaxe' : cc.tool === null || cc.tool === 'axe'));
        (needer ?? c).tool = tool;
        const zhTool = tool === 'axe' ? '斧头' : '镐'; 
        this.log('craft', `${c.name} 在${tool === 'axe' ? '工作台制斧' : '工作台锻镐'}${(needer && needer.id !== c.id) ? ` · 交给${needer.name}` : ''}`);
        this.hooks.onNotify?.(`${c.name} 制作了${zhTool}`);
        this.hooks.onStructureChange?.();
      }
      this.clearJob(c);
    }
  }

  private doPlant(c: Colonist, dt: number): void {
    const plot = c.currentJob?.payload as Structure | undefined;
    if (!plot || plot.kind !== 'farmPlot') { this.clearJob(c); return; }
    if (plot.planted) { this.clearJob(c); return; }
    c.workProgress += dt;
    if (c.workProgress >= 3) {
      c.workProgress = 0;
      plot.planted = true;
      plot.growth = 0;
      this.log('plant', `${c.name} 在农田里种下了作物`);
      this.hooks.onStructureChange?.();
      this.clearJob(c);
    }
  }

  private doHarvestFarm(c: Colonist, dt: number): void {
    const plot = c.currentJob?.payload as Structure | undefined;
    if (!plot || plot.kind !== 'farmPlot' || !plot.planted || (plot.growth ?? 0) < 0.999) { this.clearJob(c); return; }
    c.workProgress += dt;
    if (c.workProgress >= 3) {
      c.workProgress = 0;
      plot.planted = false;
      plot.growth = 0;
      this.addStockpile('rawFood', 4); // yields raw food
      this.log('harvest', `${c.name} 收获了一批作物（+4 生食）`);
      this.hooks.onGroundChange?.();
      this.hooks.onStructureChange?.();
      this.clearJob(c);
    }
  }

  /* ============ Threats ============ */

  private raidTimer = 0;

  private updateThreats(dt: number): void {
    this.raidRisk = Math.min(1, (this.time / 300) * 0.5);
    this.raidTimer -= dt;
    if (this.raidTimer > 0) return;
    this.raidTimer = 40;
    // Simple flavor event for now.
    if (this.raidRisk > 0.2 && this.rng.chance(0.3)) {
      const r = this.rng.int(1, 3);
      this.hooks.onNotify?.(`有${r > 1 ? '掠夺者' : '野兽'}在附近徘徊……`);
      this.hooks.onThreat?.();
    }
  }

  get hour(): number {
    return Math.floor(this.time / 5) % 24;
  }

  /** Player-ordered prioritization: a colonist drops their current job and
   *  focuses any work near (x,y). MVP: force-hoists the nearest available job. */
  commandColonist(id: number, x: number, y: number): void {
    const col = this.colony.colonists.find((c) => c.id === id);
    if (!col) return;
    col.commandFx = Date.now();
    // Clear current job so they re-pick, biasing distance to the ordered tile.
    this.clearJob(col);
    // Find an unclaimed work job near the tile and assign it directly.
    let best: Job | null = null;
    let bestD = Infinity;
    for (const j of this.jobs.all) {
      if (j.claimedBy !== null) continue;
      // Personal jobs and future 'wander' aren't ordered.
      if (j.kind === 'eat' || j.kind === 'sleep' || j.kind === 'recreate' || j.kind === 'wander') continue;
      const d = Math.hypot(j.x - x, j.y - y);
      if (d < bestD) {
        bestD = d;
        best = j;
      }
    }
    if (best) {
      best.claimedBy = col.id;
      col.currentJob = best;
      col.needRepath = true;
      this.hooks.onNotify?.(`${col.name} 在那里优先工作。`);
    } else {
      this.hooks.onNotify?.(`${col.name} 在那附近无事可做。`);
    }
  }
}



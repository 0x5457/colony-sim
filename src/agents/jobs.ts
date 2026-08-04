/** Job definitions & the job resolution system.
 * This is the "soul" of the colony sim (per the design doc §4.2): colonists
 * pick the highest-scoring, most-important available job with a scoring pass
 * that biases toward critical personal needs, then execute it multi-frame.
 */

import type { Colonist } from './colonist';
import type { ResourceNode } from '../world/nodes';

export type JobKind =
  | 'haul'
  | 'chop'
  | 'mine'
  | 'forage'
  | 'build'
  | 'cook'
  | 'craft'
  | 'plant'
  | 'harvest'
  | 'eat'
  | 'sleep'
  | 'recreate'
  | 'wander';

export interface Job {
  id: number;
  kind: JobKind;
  /** Tile target (goal for pathfinding). */
  x: number;
  y: number;
  /** Optional long-range: work site versus supply pickup. */
  workX?: number;
  workY?: number;
  /** Priority rating (higher = more urgent) computed by the world. */
  rating: number;
  /** Work type weight multiplier from player priority. */
  workWeight: number;
  /** Claimed by a colonist id, if any. */
  claimedBy: number | null;
  /** Resource node or structure target reference. */
  ref?: ResourceNode;
  /** Amount of "progress" needed vs amount done (for multi-tick jobs). */
  progress: number;
  /** Custom payload for specific job logic (e.g. blueprints). */
  payload?: unknown;
}

/** Register/deregister the world's available jobs. Represents all work a colonist may do. */
export class JobBoard {
  private jobs: Job[] = [];
  private nextId = 1;

  add(partial: Omit<Job, 'id' | 'claimedBy' | 'workWeight' | 'progress'> & { workWeight?: number }): Job {
    const job: Job = {
      ...partial,
      id: this.nextId++,
      claimedBy: null,
      workWeight: partial.workWeight ?? 1,
      progress: 0,
    };
    this.jobs.push(job);
    return job;
  }

  remove(id: number): void {
    const i = this.jobs.findIndex((j) => j.id === id);
    if (i >= 0) this.jobs.splice(i, 1);
  }

  get all(): Job[] {
    return this.jobs;
  }

  clear(): void {
    this.jobs = [];
    this.nextId = 1;
  }

  /** Find the best unclaimed job for a colonist given their work priorities & position. */
  findBest(colonist: Colonist, workWeights: Record<string, number>): Job | null {
    let best: Job | null = null;
    let bestScore = -Infinity;
    for (const job of this.jobs) {
      if (job.claimedBy !== null) continue;
      // Skip jobs whose work type is disabled.
      const weight = this.workWeightFor(job, workWeights);
      if (weight <= 0) continue;
      const d = Math.hypot(job.x - colonist.tileX, job.y - colonist.tileY);
      // Rating dominates; distance is a mild tiebreaker. Criticality weighted via workWeight.
      const distFactor = 1 / (1 + d * 0.02);
      const score = job.rating * weight * distFactor;
      if (score > bestScore) {
        bestScore = score;
        best = job;
      }
    }
    return best;
  }

  private workWeightFor(job: Job, workWeights: Record<string, number>): number {
    const map: Record<JobKind, keyof typeof workWeights | null> = {
      haul: 'haul', chop: 'chop', mine: 'mine', forage: 'chop',
      build: 'construct', cook: 'cook', craft: 'construct', plant: 'construct',
      harvest: 'construct', eat: null, sleep: null, recreate: null, wander: null,
    };
    const key = map[job.kind];
    if (!key) return 1; // personal jobs always available
    const v = workWeights[key];
    return v ?? 1;
  }
}

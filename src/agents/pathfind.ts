/** A* pathfinding over the walkable grid.
 * Implementation owned; octile heuristic (8-direction moves). Structured to
 * avoid pathfinding every frame (only recompute on demand).
 */
import { Terrain, inBounds } from '../world/grid';

export interface PathResult {
  /** Waypoints in tile coords (excluding the start, includes goal). */
  points: Array<[number, number]>;
  /** Iteration cost counter (for debug/throttling). */
  iterations: number;
}

const DIRS: Array<[number, number, number]> = [
  [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
  [1, 1, 1.414], [1, -1, 1.414], [-1, 1, 1.414], [-1, -1, 1.414],
];

export function isWalkable(terrain: Terrain, x: number, y: number): boolean {
  return inBounds(terrain, x, y) && !terrain.solid[y][x];
}

/** A* using a binary heap for the open set. Returns an empty array if unreachable. */
export function findPath(
  terrain: Terrain,
  startX: number,
  startY: number,
  goalX: number,
  goalY: number,
  maxIterations = 8000,
  /** Dynamic block: treat a tile as impassable (false = passable). Called per step. */
  extraBlocked?: (x: number, y: number) => boolean,
): PathResult {
  if (startX === goalX && startY === goalY) return { points: [], iterations: 1 };
  if (!isWalkable(terrain, goalX, goalY)) {
    const alt = nearestWalkable(terrain, goalX, goalY);
    if (!alt) return { points: [], iterations: 1 };
    [goalX, goalY] = alt;
    if (startX === goalX && startY === goalY) return { points: [], iterations: 1 };
  }

  const { w, h } = terrain;
  const gScore = new Float64Array(w * h).fill(Infinity);
  const cameFrom = new Int32Array(w * h).fill(-1);
  const closed = new Uint8Array(w * h);
  const startI = startY * w + startX;
  const goalI = goalY * w + goalX;
  gScore[startI] = 0;

  const open = new BinaryHeap();
  open.push([startX, startY], heuristic(startX, startY, goalX, goalY));

  let iterations = 0;
  while (open.size > 0 && iterations < maxIterations) {
    iterations++;
    const cur = open.pop()!;
    const [cx, cy] = cur;
    const ci = cy * w + cx;
    if (ci === goalI) {
      return { points: reconstruct(cameFrom, startI, goalI, w), iterations };
    }
    if (closed[ci]) continue;
    closed[ci] = 1;

    for (const [dx, dy, cost] of DIRS) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (!isWalkable(terrain, nx, ny)) continue;
      if (nx === startX && ny === startY) { /* allow leaving start */ }
      else if (extraBlocked && extraBlocked(nx, ny)) continue; // can't step onto someone
      const ni = ny * w + nx;
      if (closed[ni]) continue;
      const tentative = gScore[ci] + cost;
      if (tentative < gScore[ni]) {
        gScore[ni] = tentative;
        cameFrom[ni] = ci;
        open.push([nx, ny], tentative + heuristic(nx, ny, goalX, goalY));
      }
    }
  }
  return { points: [], iterations }; // exhausted or exceeded budget => no path
}

function heuristic(x: number, y: number, gx: number, gy: number): number {
  const dx = Math.abs(x - gx);
  const dy = Math.abs(y - gy);
  return dx + dy + (Math.SQRT2 - 2) * Math.min(dx, dy); // octile
}

function nearestWalkable(terrain: Terrain, gx: number, gy: number): [number, number] | null {
  const maxR = 4;
  for (let r = 1; r <= maxR; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.abs(dx) === r || Math.abs(dy) === r) {
          const nx = gx + dx;
          const ny = gy + dy;
          if (isWalkable(terrain, nx, ny)) return [nx, ny];
        }
      }
    }
  }
  return null;
}

function reconstruct(cameFrom: Int32Array, startI: number, goalI: number, w: number): Array<[number, number]> {
  const path: Array<[number, number]> = [];
  let cur = goalI;
  while (cur !== -1 && cur !== startI) {
    path.push([cur % w, Math.floor(cur / w)]);
    cur = cameFrom[cur];
    if (path.length > 10000) break; // safety
  }
  path.reverse();
  return path;
}

/** Minimal binary heap (ascending) storing [x,y] + f-score. */
class BinaryHeap {
  private items: Array<{ node: [number, number]; f: number }> = [];

  get size(): number {
    return this.items.length;
  }

  push(node: [number, number], f: number): void {
    this.items.push({ node, f });
    let i = this.items.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.items[i].f >= this.items[parent].f) break;
      [this.items[i], this.items[parent]] = [this.items[parent], this.items[i]];
      i = parent;
    }
  }

  pop(): [number, number] | undefined {
    const top = this.items[0];
    const last = this.items.pop();
    if (this.items.length > 0 && last) {
      this.items[0] = last;
      this.siftDown(0);
    }
    return top ? top.node : undefined;
  }

  private siftDown(i: number): void {
    const n = this.items.length;
    for (;;) {
      let smallest = i;
      const left = 2 * i + 1;
      const right = 2 * i + 2;
      if (left < n && this.items[left].f < this.items[smallest].f) smallest = left;
      if (right < n && this.items[right].f < this.items[smallest].f) smallest = right;
      if (smallest === i) break;
      [this.items[i], this.items[smallest]] = [this.items[smallest], this.items[i]];
      i = smallest;
    }
  }
}

/** Procedural world generation: seeded terrain + resource scatter.
 * Follows the procedural-gen playbook: one seeded RNG, elevation/moisture on
 * different noise, data-grid first (decoupled from rendering), then place
 * resources & validate connectivity from spawn.
 */
import { RNG } from '../core/rng';
import { fbm } from './noise';
import { TILES } from '../data/tiles';
import { MAP_W, MAP_H } from '../core/config';
import {
  Terrain, tileWalkable, SolidGrid,
} from './grid';
import { ResourceNode, NODE_STATS } from './nodes';

export interface GeneratedWorld {
  terrain: Terrain;
  nodes: ResourceNode[];
  spawnX: number;
  spawnY: number;
  seed: number;
}

export function regenerateWorld(seed: number): GeneratedWorld {
  const rng = new RNG(seed);
  const w = MAP_W;
  const h = MAP_H;

  const tiles: string[][] = [];
  const variants: number[][] = [];
  const elevation: number[] = new Array(w * h);
  const moisture: number[] = new Array(w * h);

  for (let y = 0; y < h; y++) {
    const row: string[] = [];
    const vrow: number[] = [];
    for (let x = 0; x < w; x++) {
      const e = Math.pow(
        fbm(x * 0.06, y * 0.06, 4, 2.2, 0.5),
        1.6,
      ); // elevation, carve valleys
      const m = fbm(x * 0.06 + 100, y * 0.06 + 100, 3, 2.2, 0.5); // moisture, separate offset
      elevation[y * w + x] = e;
      moisture[y * w + x] = m;

      let id: string;
      if (e < 0.18) id = 'deepWater';
      else if (e < 0.24) id = 'shallowWater';
      else if (e > 0.64) id = 'stone';
      else if (e > 0.56) id = 'sand';
      else if (e > 0.30) {
        id = m > 0.62 ? 'grass' : 'dirt';
      } else id = 'grass';

      let def = TILES[id];
      if (!def) def = TILES.grass;
      row.push(id);
      vrow.push(rng.int(0, (def.variants || 1) - 1));
    }
    tiles.push(row);
    variants.push(vrow);
  }

  const solid = buildSolid(tiles);
  const terrain: Terrain = { w, h, tiles, variants, solid, elevation, moisture };

  // Find a safe, connected spawn area. It must be a walkable region of a
  // reasonable size (so colonists are not stranded on a water-surrounded island
  // or a tiny peninsula) and reachable to the rest of the map.
  const spawn = findSafeSpawn(terrain);

  const nodes = scatterNodes(terrain, rng, spawn.x, spawn.y);
  return { terrain, nodes, spawnX: spawn.x, spawnY: spawn.y, seed };
}

/** Locate a spawn tile on the largest connected landmass so colonists are never
 *  stranded on a small island. Within that landmass choose the central, most
 *  buildable tile (max walkable neighbours in a patch). */
function findSafeSpawn(terrain: Terrain): { x: number; y: number } {
  const { w, h, solid } = terrain;

  // 1) Label connected walkable components (4-way flood fill).
  const comp = new Int32Array(w * h).fill(-1);
  let nComp = 0;
  const compSize: number[] = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (solid[y][x] || comp[y * w + x] !== -1) continue;
      // BFS this component.
      const queue: Array<[number, number]> = [[x, y]];
      comp[y * w + x] = nComp;
      let size = 0;
      while (queue.length) {
        const [cx, cy] = queue.pop()!;
        size++;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = cx + dx, ny = cy + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          if (solid[ny][nx] || comp[ny * w + nx] !== -1) continue;
          comp[ny * w + nx] = nComp;
          queue.push([nx, ny]);
        }
      }
      compSize.push(size);
      nComp++;
    }
  }
  if (nComp === 0) return { x: Math.floor(w / 2), y: Math.floor(h / 2) };

  // 2) The largest component is the mainland.
  let main = 0;
  for (let i = 1; i < nComp; i++) if (compSize[i] > compSize[main]) main = i;

  // 3) Within the mainland, pick the most buildable tile (max walkable pad).
  //    Avoid the outermost 2 tiles so the colony has room to expand.
  let bestX = Math.floor(w / 2);
  let bestY = Math.floor(h / 2);
  let bestScore = -1;
  for (let y = 2; y < h - 2; y++) {
    for (let x = 2; x < w - 2; x++) {
      if (solid[y][x] || comp[y * w + x] !== main) continue;
      let open = 0;
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          const yy = y + dy, xx = x + dx;
          if (yy >= 0 && yy < h && xx >= 0 && xx < w && comp[yy * w + xx] === main) open++;
        }
      }
      if (open > bestScore) {
        bestScore = open;
        bestX = x;
        bestY = y;
      }
    }
  }
  return { x: bestX, y: bestY };
}

function buildSolid(tiles: string[][]): SolidGrid {
  return tiles.map((row) => row.map((id) => !tileWalkable(id)));
}

function scatterNodes(terrain: Terrain, rng: RNG, sx: number, sy: number): ResourceNode[] {
  const nodes: ResourceNode[] = [];
  let id = 0;
  const { w, h, tiles } = terrain;
  const MIN_SPAWN_DIST = 8;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const t = tiles[y][x];
      if (t === 'deepWater' || t === 'shallowWater') continue;
      const d = Math.hypot(x - sx, y - sy);
      const treeDensity = t === 'grass' ? 0.035 : 0.012;
      const rockDensity = t === 'stone' ? 0.12 : 0.02;
      const berryDensity = t === 'grass' ? 0.008 : 0.003;
      const animalDensity = t === 'grass' ? 0.0025 : 0.001;

      // Keep spawn area clear-ish.
      const nearSpawn = d < MIN_SPAWN_DIST;

      if (!nearSpawn && rng.chance(treeDensity)) {
        nodes.push(makeNode(++id, 'tree', x, y));
      } else if (!nearSpawn && rng.chance(rockDensity)) {
        nodes.push(makeNode(++id, 'rock', x, y));
      } else if (!nearSpawn && rng.chance(berryDensity)) {
        nodes.push(makeNode(++id, 'berry', x, y));
      } else if (!nearSpawn && rng.chance(animalDensity)) {
        nodes.push(makeNode(++id, 'animal', x, y));
      }
    }
  }
  return nodes;
}

function makeNode(id: number, kind: ResourceNode['kind'], x: number, y: number): ResourceNode {
  const s = NODE_STATS[kind];
  const base: ResourceNode = {
    id, kind, x, y, hp: s.hp, maxHp: s.hp, requiredTier: s.tier,
    drops: [], respawn: s.respawn, alive: true,
  };
  if (kind === 'tree') base.drops = [['wood', 5]];
  else if (kind === 'rock') base.drops = [['wood', 1], ['steel', 1]];
  else if (kind === 'berry') base.drops = [['rawFood', 4]];
  else if (kind === 'animal') base.drops = [['rawFood', 6]];
  return base;
}

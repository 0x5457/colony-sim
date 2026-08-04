/** Save/load for the colony sim. Serializes the minimal deterministic state:
 * world seed (regenerates terraim), colony (needs/skills/positions/priorities),
 * stockpile, items, blueprints, structures, time, tech. Versioned for migration.
 */
import { Game } from './game';
import { Colonist } from '../agents/colonist';

const SAVE_KEY = 'colony-sim-save-v1';
export const SAVE_VERSION = 1;

interface SaveDataV1 {
  version: number;
  seed: number;
  time: number;
  colonists: Array<{
    id: number; name: string; x: number; y: number; offX: number; offY: number;
    hp: number; needs: Record<string, number>; traitId?: string;
  }>;
  priorities: Record<string, number>;
  stockpile: Record<string, number>;
  items: Array<{ id: number; x: number; y: number; item: string; qty: number }>;
  blueprints: Array<{ kind: string; x: number; y: number; progress: number }>;
  structures: Array<{ id: number; kind: string; x: number; y: number; hp: number }>;
  tech: string[];
  daySeconds: number;
}

export function saveGame(game: Game): boolean {
  const data: SaveDataV1 = {
    version: SAVE_VERSION,
    seed: game.seed,
    time: game.time,
    colonists: game.colony.colonists.map((c) => ({
      id: c.id, name: c.name, x: c.tileX, y: c.tileY, offX: c.offX, offY: c.offY,
      hp: c.hp,
      needs: {
        hunger: c.needs.hunger.value, rest: c.needs.rest.value,
        joy: c.needs.joy.value, mood: c.needs.mood.value,
      },
      traitId: c.trait?.id,
    })),
    priorities: { ...game.colony.priorities },
    stockpile: { ...game.stockpile },
    items: game.items.map((it) => ({ id: it.id, x: it.x, y: it.y, item: it.item, qty: it.qty })),
    blueprints: game.blueprints.map((b) => ({ kind: b.kind, x: b.x, y: b.y, progress: b.progress })),
    structures: game.structures.map((s) => ({ id: s.id, kind: s.kind, x: s.x, y: s.y, hp: s.hp })),
    tech: Array.from(game.colony.tech),
    daySeconds: game.daySeconds,
  };
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(data));
    return true;
  } catch {
    return false;
  }
}

export function hasSave(): boolean {
  try {
    return localStorage.getItem(SAVE_KEY) !== null;
  } catch {
    return false;
  }
}

/** Restore a saved game onto a fresh Game instance. Returns the seed used. */
export function loadGame(seed: number): Game | null {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const data: SaveDataV1 = JSON.parse(raw);
    if (data.version !== SAVE_VERSION) return null; // future/migrate hook
    const game = new Game(data.seed ?? seed);
    game.time = data.time ?? 0;
    game.daySeconds = data.daySeconds ?? game.daySeconds;
    game.stockpile = data.stockpile ?? {};
    game.items = data.items ?? [];
    game.blueprints = (data.blueprints ?? []).map((b) => ({ kind: b.kind as never, x: b.x, y: b.y, progress: b.progress, occupied: false }));
    game.structures = (data.structures ?? []).map((s) => ({ id: s.id, kind: s.kind as never, x: s.x, y: s.y, hp: s.hp }));
    game.colony.priorities = { ...(data.priorities ?? {}) };
    for (const t of data.tech ?? []) game.colony.tech.add(t);
    // Restore colonists.
    for (const cd of data.colonists ?? []) {
      const c: Colonist = new Colonist({
        id: cd.id, name: cd.name, x: cd.x, y: cd.y,
        seed: game.rngSeedFor(cd.id), traitId: cd.traitId,
      });
      c.offX = cd.offX ?? 0;
      c.offY = cd.offY ?? 0;
      c.hp = cd.hp ?? 100;
      c.needs.hunger.value = cd.needs?.hunger ?? 100;
      c.needs.rest.value = cd.needs?.rest ?? 100;
      c.needs.joy.value = cd.needs?.joy ?? 100;
      c.needs.mood.value = cd.needs?.mood ?? 100;
      game.colony.addColonist(c);
    }
    return game;
  } catch {
    return null;
  }
}

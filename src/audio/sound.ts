/** Sound controller: bridges the AudioEngine to the simulation.
 *
 *  Maps discrete game events → named SFX on the right bus, applies SFX pitch
 *  variation (engine-side), drives **adaptive BGM** (day ↔ night crossfade,
 *  plus ducking under threat), and emits footstep ticks while colonists move.
 *
 *  One place to funnel every sound; volume stays in the engine's dB-staged
 *  buses (per the audio-design skill: mix on buses, not per-clip).
 */
import { Game } from '../systems/game';
import type { SfxName, BusName, BgmMood, AudioEngine } from './audio';

export class SoundController {
  engine: AudioEngine;
  private game: Game;

  private footAcc = 0;
  private workAcc = 0;
  private mood: BgmMood = 'day';

  // Minimum seconds between repeated discrete sounds (stops "machine-gun"
  // spam when e.g. several colonists haul at once). Per sound name.
  private lastAt: Record<string, number> = {};

  constructor(game: Game, engine: AudioEngine) {
    this.game = game;
    this.engine = engine;
  }

  /** Fire a sound unless the same one played within `minGap` seconds. Frequent
   *  minor sounds like pickup/eat/drop get throttled so they never spam. */
  private emit(name: SfxName, bus: BusName = 'SFX', opts?: { pitchMul?: number; gainDb?: number; minGap?: number }): void {
    const gap = opts?.minGap ?? 0;
    if (gap > 0) {
      const now = performance.now() / 1000;
      const last = this.lastAt[name] ?? -Infinity;
      if (now - last < gap) return;
      this.lastAt[name] = now;
    }
    this.engine.play(name, bus, opts);
  }

  /** Current BGM mood (exposed for the unlock path + UI). */
  currentMood(): BgmMood {
    return this.mood;
  }

  /** Expose volume control to the UI panel (forwards to the engine buses). */
  setVolume(bus: BusName, v01: number): void {
    this.engine.setVolume(bus, v01);
  }

  /* ---------------- UI / command shorthands ---------------- */
  uiClick(): void { this.emit('uiClick', 'UI'); }
  uiError(): void { this.emit('uiError', 'UI'); }
  uiBuy(): void { this.emit('buy', 'UI'); }
  commandFx(): void { this.emit('commandFx', 'SFX'); }
  threat(): void { this.emit('threat', 'SFX'); this.engine.duck(-12, 1400); }

  /**
   * Per-frame driver: keeps adaptive BGM in sync with day/night + raid, and
   * emits footstep/working ticks. Call from the render loop.
   */
  update(dt: number): void {
    // --- Adaptive BGM ---
    const mood: BgmMood = this.game.night ? 'night' : 'day';
    if (mood !== this.mood) {
      this.mood = mood;
      this.engine.setBgm(mood);
      // Play a transition sting on the boundary change.
      if (mood === 'day') this.emit('daybreak', 'SFX');
      else this.emit('nightfall', 'SFX');
      this.engine.duck(-8, 900); // let the sting breathe through
    }

    // --- Footsteps while colonists move (throttled). ---
    if (this.engine.isReady()) {
      let moving = false;
      for (const c of this.game.colony.colonists) if (c.moving) { moving = true; break; }
      if (moving) {
        this.footAcc += dt;
        if (this.footAcc >= 0.38) {
          this.footAcc = 0;
          this.emit('footstep', 'SFX', { gainDb: -8 }); // footsteps are subtle
        }
      }
    }

    // --- Working ticks (chop / mine / hammer / sizzle). ---
    let working: SfxName | null = null;
    for (const c of this.game.colony.colonists) {
      if (c.working && c.currentJob) {
        const k = c.currentJob.kind;
        if (k === 'chop') working = 'chop';
        else if (k === 'mine') working = 'mine';
        else if (k === 'build') working = 'hammer';
        else if (k === 'cook') working = 'cookSizzle';
        if (working) break;
      }
    }
    if (working) {
      this.workAcc += dt;
      const interval = working === 'cookSizzle' ? 1.2 : 0.5;
      if (this.workAcc >= interval) {
        this.workAcc = 0;
        this.emit(working, 'SFX');
      }
    }
  }

  /* ---------------- discrete game events ---------------- */
  /** Resource finished → drop thud (throttled, quiet). */
  onHarvestComplete(_kind: string): void { this.emit('drop', 'SFX', { gainDb: -6, minGap: 0.25 }); }
  onBuildComplete(): void { this.emit('buildDone', 'SFX'); }
  onMealCooked(): void { this.emit('mealReady', 'SFX'); }
  onEating(): void { this.emit('eat', 'SFX', { gainDb: -6, minGap: 0.3 }); }
  /** Haul pickup — frequent, so throttle AND keep it very quiet. */
  onHaul(): void { this.emit('pickup', 'SFX', { gainDb: -12, minGap: 0.45 }); }
}

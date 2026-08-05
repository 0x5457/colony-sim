/** Audio engine for Colony Sim — loads real audio files (see tools/gen_audio.py
 *  which synthesizes the WAVs into public/audio/) and plays them through a
 *  bus mixing graph.
 *
 *  Follows the audio-design skill practice:
 *    - a **bus graph** (Master → {Music, SFX, UI, Ambience}; Ambience routes
 *      into the music bed) with gain staged in **decibels** (slider 0..1 mapped
 *      through `linearToDb`), never assigned straight as amplitude
 *    - a **master limiter** (DynamicsCompressor) as a safety net only, while
 *      leaves are mixed well below 0 dBFS so it sits idle (headroom)
 *    - **SFX variation**: random `playbackRate` per trigger so repeated sounds
 *      never feel like a tape loop
 *    - **ducking**: the music/ambience bed dips under important bursts then
 *      recovers slowly (avoid pumping)
 *    - **adaptive music**: a day track, a night track, and duck/tense changes —
 *      the BGM reacts to game state via crossfades instead of one flat loop.
 */

export type BusName = 'Master' | 'Music' | 'SFX' | 'UI' | 'Ambience';

const NOMINAL = -12; // dBFS staging at each leaf; limiter stays idle at rest

export interface AudioConfig {
  master: number; music: number; sfx: number; ui: number; ambience: number;
}
// Rebalanced so the (inherently soft) BGM reads clearly against SFX: music and
// ambience beds sit up near the top, while one-shot SFX are deliberately staged
// a bit quieter (they're also throttled + dampened per-event in SoundController).
const DEFAULT_CONFIG: AudioConfig = {
  master: 0.85, music: 0.92, sfx: 0.7, ui: 0.6, ambience: 0.6,
};

function linearToDb(v: number): number {
  return 20 * Math.log10(Math.max(v, 0.0001));
}
function dbToLinear(db: number): number {
  return Math.pow(10, db / 20);
}
function rand(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

/** Every loadable sound file. */
export type SfxName =
  | 'chop' | 'mine' | 'forage'
  | 'hammer' | 'buildDone'
  | 'cookSizzle' | 'mealReady' | 'eat'
  | 'pickup' | 'drop' | 'footstep'
  | 'uiClick' | 'uiError' | 'buy'
  | 'threat' | 'commandFx'
  | 'daybreak' | 'nightfall';

/** filename for each named sound. */
const FILES: Record<SfxName, string> = {
  chop: 'chop.wav', mine: 'mine.wav', forage: 'forage.wav',
  hammer: 'hammer.wav', buildDone: 'build_done.wav',
  cookSizzle: 'cook_sizzle.wav', mealReady: 'meal_ready.wav', eat: 'eat.wav',
  pickup: 'pickup.wav', drop: 'drop.wav', footstep: 'footstep.wav',
  uiClick: 'ui_click.wav', uiError: 'ui_error.wav', buy: 'buy.wav',
  threat: 'threat.wav', commandFx: 'command_fx.wav',
  daybreak: 'daybreak.wav', nightfall: 'nightfall.wav',
};

const BGM_FILES = {
  day: 'bgm_day.wav',
  night: 'bgm_night.wav',
} as const;
export type BgmMood = 'day' | 'night';

export class AudioEngine {
  config: AudioConfig = { ...DEFAULT_CONFIG };
  private ctx: AudioContext | null = null;
  private buffers: Partial<Record<SfxName, AudioBuffer>> = {};
  private bgm: Partial<Record<BgmMood, AudioBuffer>> = {};

  private buses: Partial<Record<BusName, GainNode>> = {};
  private limiter: DynamicsCompressorNode | null = null;

  // BGM scheduling state (one looping source per mood, crossfaded on switch).
  private activeBgm: BgmMood | null = null;
  private bgmSource: AudioBufferSourceNode | null = null;
  private bgmGain: GainNode | null = null;

  private duckRecovery: ReturnType<typeof setTimeout> | null = null;
  private loaded = false;

  /** True once the context exists and is running (usable to gate per-frame SFX). */
  isReady(): boolean {
    return this.ctx != null && this.ctx.state === 'running';
  }
  private get ready(): boolean {
    return this.isReady();
  }

  /** Preload everything (call before gameplay; safe to call repeatedly). */
  async load(base = ''): Promise<void> {
    if (this.loaded) {
      await this.ensure();
      return;
    }
    const root = base || (import.meta.env.BASE_URL as string || '');
    const dir = `${root.replace(/\/$/, '')}/audio/`;
    const urls = Object.values(FILES).map((f) => dir + f);
    urls.push(...Object.values(BGM_FILES).map((f) => dir + f));
    const AC = window.AudioContext ?? (window as unknown as {
      webkitAudioContext: typeof AudioContext;
    }).webkitAudioContext;
    const ctx = new AC();
    this.ctx = ctx;
    this.buildGraph(ctx);

    const dec = async (url: string): Promise<AudioBuffer> => {
      const res = await fetch(url);
      const ab = await res.arrayBuffer();
      return await ctx.decodeAudioData(ab);
    };
    const entries = [...Object.entries(FILES) as Array<[SfxName, string]>, ...Object.entries(BGM_FILES) as Array<[BgmMood, string]>];
    await Promise.all(entries.map(async ([k, f]) => {
      try {
        const buf = await dec(dir + f);
        if (k === 'day' || k === 'night') this.bgm[k] = buf;
        else this.buffers[k as SfxName] = buf;
      } catch (e) {
        console.warn('audio load failed', k, e);
      }
    }));
    this.loaded = true;
    await this.ensure();
  }

  private buildGraph(ctx: AudioContext): void {
    this.limiter = ctx.createDynamicsCompressor();
    this.limiter.threshold.value = -6;
    this.limiter.knee.value = 6;
    this.limiter.ratio.value = 4;
    this.limiter.attack.value = 0.002;
    this.limiter.release.value = 0.15;
    this.limiter.connect(ctx.destination);

    const master = this.mk('Master', this.limiter, this.config.master);
    this.mk('Music', master, this.config.music);
    this.mk('SFX', master, this.config.sfx);
    this.mk('UI', master, this.config.ui);
    // Ambience routes into Music's gain so ducking covers both beds.
    this.mk('Ambience', this.buses['Music']!, this.config.ambience);
  }

  private mk(name: BusName, parent: AudioNode, slider01: number): GainNode {
    const g = this.ctx!.createGain();
    g.gain.value = dbToLinear(NOMINAL + linearToDb(slider01));
    g.connect(parent);
    this.buses[name] = g;
    return g;
  }

  private bus(name: BusName): GainNode {
    return this.buses[name]!;
  }

  /** Call from a user gesture to satisfy autoplay policy and resume. */
  async ensure(): Promise<boolean> {
    if (!this.ctx) return false;
    if (this.ctx.state !== 'running') {
      try { await this.ctx.resume(); } catch { return false; }
    }
    return this.ctx.state === 'running';
  }

  setVolume(bus: BusName, v01: number): void {
    if (bus === 'Master') this.config.master = v01;
    else if (bus === 'Music') this.config.music = v01;
    else if (bus === 'SFX') this.config.sfx = v01;
    else if (bus === 'UI') this.config.ui = v01;
    else if (bus === 'Ambience') this.config.ambience = v01;
    const n = this.buses[bus];
    if (n) n.gain.setTargetAtTime(dbToLinear(NOMINAL + linearToDb(v01)), this.ctx!.currentTime, 0.02);
  }

  /** Duck the music+ambience bed under an important burst, recover slowly. */
  duck(byDb = -10, recoverMs = 750): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const g = this.buses['Music'];
    if (g) {
      g.gain.cancelScheduledValues(t);
      g.gain.setTargetAtTime(
        dbToLinear(NOMINAL + linearToDb(this.config.music) + byDb), t, 0.02);
    }
    if (this.duckRecovery) clearTimeout(this.duckRecovery);
    this.duckRecovery = setTimeout(() => this.recoverDuck(), recoverMs);
  }

  private recoverDuck(): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const g = this.buses['Music'];
    if (g) g.gain.setTargetAtTime(
      dbToLinear(NOMINAL + linearToDb(this.config.music)), t, 0.3);
  }

  /** Play an SFX on its bus with per-trigger pitch variation. */
  play(name: SfxName, bus: BusName = 'SFX', opts?: { pitchMul?: number; gainDb?: number }): void {
    if (!this.ready) return;
    const buf = this.buffers[name];
    if (!buf) return;
    const ctx = this.ctx!;
    const rate = (opts?.pitchMul ?? 1) * rand(0.94, 1.06); // SFX variation
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = rate;

    const g = ctx.createGain();
    const db = NOMINAL + (opts?.gainDb ?? 0);
    g.gain.value = dbToLinear(db);
    src.connect(g).connect(this.bus(bus));
    src.start(0);
    // Free after it ends.
    const dur = (buf.duration / rate) + 0.15;
    setTimeout(() => { try { src.disconnect(); g.disconnect(); } catch { /* ok */ } }, dur * 1000);
  }

  /** Crossfade the looping BGM to a new mood (adaptive music). */
  setBgm(mood: BgmMood): void {
    if (!this.ready || !this.bgm[mood]) return;
    if (this.activeBgm === mood) return;
    const ctx = this.ctx!;
    const newBuf = this.bgm[mood]!;
    const src = ctx.createBufferSource();
    src.buffer = newBuf;
    src.loop = true;
    const g = ctx.createGain();
    src.connect(g).connect(this.bus('Music'));
    src.start(0);
    // crossfade 1.2s
    const t = ctx.currentTime;
    g.gain.setValueAtTime(dbToLinear(-40), t);
    g.gain.setTargetAtTime(dbToLinear(NOMINAL + linearToDb(this.config.music)), t, 0.4);

    const old = this.bgmSource;
    if (old) {
      const oldG = this.bgmGain!;
      oldG.gain.setTargetAtTime(dbToLinear(-46), t, 0.4);
      setTimeout(() => { try { old.stop(); old.disconnect(); oldG.disconnect(); } catch { /* ok */ } }, 2000);
    }
    this.bgmSource = src;
    this.bgmGain = g;
    this.activeBgm = mood;
  }
}

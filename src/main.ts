/** Application entry: boots PixiJS v8, builds the atlas + renderer, wires the
 *  input controller and DOM UI, and drives the fixed-step simulation loop. */
import { Application } from 'pixi.js';
import { Game } from './systems/game';
import { Renderer } from './render/renderer';
import { GameUI } from './ui/ui';
import { InputController } from './input';
import { buildTextureAtlas } from './render/textures';
import { DEFAULT_SEED } from './core/config';
import { hasSave, loadGame, saveGame } from './systems/save';
import { AudioEngine } from './audio/audio';
import { SoundController } from './audio/sound';

(async () => {
  const app = new Application();
  await app.init({
    background: '#0b0f0d',
    resizeTo: window,
    antialias: false,
    roundPixels: true,
    resolution: 1,
    powerPreference: 'high-performance',
  });
  document.body.appendChild(app.canvas);

  const atlas = buildTextureAtlas();

  // Preferences: seed from query string for shareable worlds.
  const qs = new URLSearchParams(location.search);
  const seedStr = qs.get('seed') ?? String(DEFAULT_SEED);
  const seed = parseInt(seedStr, 10) || DEFAULT_SEED;

  const loaded = hasSave() ? loadGame(seed) : null;
  const game: Game = loaded ?? new Game(seed);

  // --- Audio: bus graph + preload files (see tools/gen_audio.py). ---
  const audio = new AudioEngine();
  const sound = new SoundController(game, audio);
  audio.load().catch((e) => console.warn('audio preload failed', e));

  const renderer = new Renderer(app, game, atlas);
  renderer.init();

  const ui = new GameUI(game, renderer, sound);

  // Wire game hooks → renderer refresh + UI refresh.
  game.hooks.onDirtyTile = () => renderer.refreshLayers('ground');
  game.hooks.onGroundChange = () => renderer.refreshLayers('nodes');
  game.hooks.onBlueprintChange = () => renderer.refreshLayers('blueprints');
  game.hooks.onStructureChange = () => renderer.refreshLayers('structures');
  // --- Wire audio hooks (event → named SFX on the right bus). ---
  // Autoplay policy: the AudioContext must be resumed by a user gesture, so
  // unlock on the first pointer/keyboard interaction, then start the BGM.
  const unlock = () => {
    audio.ensure().then((ok) => { if (ok) audio.setBgm(sound.currentMood()); });
    window.removeEventListener('pointerdown', unlock);
    window.removeEventListener('keydown', unlock);
  };
  window.addEventListener('pointerdown', unlock, { once: true });
  window.addEventListener('keydown', unlock, { once: true });
  game.hooks.onHarvestDone = (kind: 'chop' | 'mine' | 'forage') => sound.onHarvestComplete(kind);
  game.hooks.onBuilt = () => sound.onBuildComplete();
  game.hooks.onCooked = () => sound.onMealCooked();
  game.hooks.onAte = () => sound.onEating();
  game.hooks.onHauled = () => sound.onHaul();
  game.hooks.onThreat = () => sound.threat();
  // Translate sim event messages (produced in English) to Chinese for the UI.
  const zhNotify = (m: string): void => {
    const map: Record<string, string> = {
      'A meal was cooked.': '一道餐食做好了。',
      'A meal has been cooked.': '一道餐食做好了。',
      'A meal is ready.': '餐食已备好。',
    };
    ui.showToast(map[m] ?? m);
  };
  game.hooks.onNotify = zhNotify;
  game.hooks.onLog = (kind, msg) => ui.addLog(kind, msg);
  game.hooks.onColonistStates = () => ui.refresh();

  if (!loaded) {
    game.spawnColonists();
    renderer.refreshLayers('nodes');
    renderer.refreshLayers('blueprints');
    renderer.refreshLayers('units'); // rebuild colonist sprites after spawn
    ui.refresh();
  }

  // Input controller (camera pan/zoom + selection + build placement).
  const input = new InputController(game, renderer, ui, app.canvas);
  input.cancelBuildCb = () => ui.cancelBuild();

  // New random world: clear the save, set a fresh seed, hard reload. This keeps
  // re-generation deterministic and avoids juggling live object identity.
  input.onNewWorld = () => {
    try { localStorage.removeItem('colony-sim-save-v1'); } catch { /* ignore */ }
    const ns = Math.floor(Math.random() * 0xffffff);
    const sp = new URLSearchParams(location.search);
    sp.set('seed', String(ns));
    location.search = sp.toString();
  };

  // --- Game loop control: pause & speed via CustomEvents from the UI. ---
  let paused = false;
  let simSpeed = 1;

  window.addEventListener('colony-pause', () => {});
  window.addEventListener('colony-speed', (e) => {
    simSpeed = (e as CustomEvent).detail ?? 1;
  });
  window.addEventListener('colony-save', () => {
    if (saveGame(game)) ui.showToast('游戏已保存 ✓');
    else ui.showToast('保存失败（存储空间不足？）');
  });
  window.addEventListener('colony-camera', () => {
    const mode = input.toggleCameraMode();
    ui.setCameraMode(mode);
    ui.showToast(mode === 'follow' ? '相机：跟随角色/殖民地' : '相机：自由滑动');
  });
  window.addEventListener('colony-newgame', () => input.onNewWorld?.());

  // Keyboard: space = pause, Ctrl/Cmd+S = save, R = recenter.
  window.addEventListener('keydown', (e) => {
    if (e.key === ' ') {
      e.preventDefault();
      paused = !paused;
      ui.showToast(paused ? '⏸ 已暂停' : '▶ 继续');
    }
    if ((e.key.toLowerCase() === 's') && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      window.dispatchEvent(new Event('colony-save'));
    }
    if (e.key.toLowerCase() === 'r') {
      renderer.camera.snapTo(ui.colonyCentroid());
      renderer.updateCameraNow();
    }
  });

  // --- Simulation loop: fixed-step accumulation, speed-scaled, dt-scaled. ---
  let acc = 0;
  app.ticker.add((ticker) => {
    const frameDt = ticker.deltaMS / 1000;
    // Camera & input always update (even when paused).
    input.update(frameDt);

    if (!paused) {
      const step = 1 / 20;
      acc += frameDt * simSpeed;
      let steps = 0;
      while (acc >= step && steps < 8) {
        game.update(step);
        acc -= step;
        steps++;
      }
      // Drop lag to avoid spiral of death.
      if (acc > step * 8) acc = 0;
    }
    // Drive audio always (footsteps + ambience mood), even while paused so
    // ambient never freezes awkwardly.
    // Footsteps + adaptive ambience mood (kept running while paused so the
    // bed doesn't freeze awkwardly).
    sound.update(frameDt);
  });

  saveGame(game); // initial autosave
  if (typeof window !== 'undefined') {
    (window as unknown as {
      colonySim?: { game: Game; setSpeed?: (n: number) => void; renderer?: Renderer; audio: AudioEngine };
    }).colonySim = {
      game,
      setSpeed: (n: number) => { simSpeed = n; },
      renderer,
      audio,
    };
  }
})();

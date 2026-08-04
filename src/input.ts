/** Input controller: camera pan/zoom + colonist/build interaction (RimWorld-style).
 *  - Left-drag on empty ground / space+drag: pan camera
 *  - Mouse wheel: zoom toward cursor (integer snaps)
 *  - WASD/arrows: pan camera
 *  - Left-click: select a colonist (else clear); in build mode, place blueprints
 *  - Right-click with selection: issue a "prioritize here" work order (MVP command)
 */
import { Renderer } from './render/renderer';
import { Game } from './systems/game';
import { GameUI } from './ui/ui';
import { BLUEPRINTS } from './economy/buildings';

export class InputController {
  private game: Game;
  private renderer: Renderer;
  private ui: GameUI;
  private canvas: HTMLCanvasElement;

  /** Current build tool (from UI). */
  get buildKind(): ReturnType<GameUI['currentBuild']> {
    return this.ui.currentBuild();
  }

  constructor(game: Game, renderer: Renderer, ui: GameUI, canvas: HTMLCanvasElement) {
    this.game = game;
    this.renderer = renderer;
    this.ui = ui;
    this.canvas = canvas;
    this.bind();
  }

  private bind(): void {
    const c = this.canvas;
    // Pan via left-drag.
    let dragging = false;
    let lastX = 0;
    let lastY = 0;

    c.addEventListener('pointerdown', (e) => {
      // If we have a build tool armed, place a blueprint on left-click.
      if (e.button === 0) {
        const kind = this.buildKind;
        if (kind) {
          const { x, y } = this.renderer.screenToTile(e.clientX, e.clientY);
          const ok = this.game.placeBlueprint(kind, x, y);
          this.renderer.refreshLayers('blueprints');
          this.ui.refreshResources();
          if (ok) this.ui.sound.uiBuy();
          else this.ui.sound.uiError();
          if (!ok) this.ui.showToast('无法在此建造（不可通行 / 未解锁 / 材料不足）');
          return;
        }
        // Otherwise: try to select, or begin a pan.
        const col = this.pickColonist(e.clientX, e.clientY);
        if (col) {
          this.selectColonist(col);
          dragging = false;
          return;
        }
        // Empty ground with no selection: clear selection and start pan.
        if (this.ui.selectedColonistId() !== null) this.ui.clearSelection();
        dragging = true;
        lastX = e.clientX;
        lastY = e.clientY;
        c.style.cursor = 'grabbing';
        this.startFreePan();
        return;
      }
      if (e.button === 1) {
        // Middle-drag pans too.
        dragging = true;
        lastX = e.clientX;
        lastY = e.clientY;
        c.style.cursor = 'grabbing';
        e.preventDefault();
        this.startFreePan();
        return;
      }
      if (e.button === 2) {
        const kind = this.buildKind;
        if (kind) {
          // Right-click cancels build mode.
          this.cancelBuild();
          e.preventDefault();
          return;
        }
        // Right-click with a selection: issue a work order.
        const sel = this.ui.selectedColonistId();
        if (sel !== null) {
          const { x, y } = this.renderer.screenToTile(e.clientX, e.clientY);
          this.game.commandColonist(sel, x, y);
          this.renderer.refreshLayers('units');
          this.ui.sound.commandFx();
        }
      }
    });

    c.addEventListener('pointermove', (e) => {
      this.lastClient = { x: e.clientX, y: e.clientY };
      this.hasPointer = true;
      if (dragging) {
        const dx = e.clientX - lastX;
        const dy = e.clientY - lastY;
        this.renderer.camera.panByScreen(dx, dy);
        this.renderer.updateCameraNow();
        lastX = e.clientX;
        lastY = e.clientY;
        return;
      }
      this.syncBuildMode();
    });

    const stop = () => {
      if (dragging) { dragging = false; c.style.cursor = this.buildKind ? 'crosshair' : 'default'; }
    };
    c.addEventListener('pointerup', stop);
    c.addEventListener('pointercancel', stop);
    c.addEventListener('pointerleave', stop);

    // Zoom toward cursor.
    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.lastClient = { x: e.clientX, y: e.clientY };
      this.hasPointer = true;
      this.renderer.camera.zoomAt(e.deltaY < 0 ? 1 : -1, e.clientX, e.clientY);
      this.renderer.updateCameraNow();
    }, { passive: false });

    // Keyboard: pan, escape, build hotkeys.
    window.addEventListener('keydown', (e) => {
      this.keys[e.key.toLowerCase()] = true;
      const k = e.key.toLowerCase();
      if (e.key === 'Escape') {
        if (this.buildKind) this.cancelBuild();
        else if (this.ui.selectedColonistId() !== null) this.ui.clearSelection();
      }
      if (k === 'c') this.toggleCameraMode();
      if (k === 'n') this.onNewWorld?.();
    });
    window.addEventListener('keyup', (e) => { this.keys[e.key.toLowerCase()] = false; });
  }

  private cancelBuild(): void {
    this.renderer.hideGhost();
    // Best-effort: clear active build via clicking the deselect button.
    this.cancelBuildCb?.();
  }

  /** Set by main to clear the active build selection in the UI. */
  cancelBuildCb: (() => void) | null = null;

  /** Called when the player requests a brand-new random world (hotkey N). */
  onNewWorld: (() => void) | null = null;

  private lastClient = { x: 0, y: 0 };
  private lastGhostTile = `-999,-999`;
  private hasPointer = false;

  /** Track last pointer position + show/hide build-mode cursor & ghost. */
  private syncBuildMode(): void {
    const kind = this.buildKind;
    if (kind) {
      this.canvas.style.cursor = 'crosshair';
      if (this.hasPointer) {
        const { x, y } = this.renderer.screenToTile(this.lastClient.x, this.lastClient.y);
        const key = `${x},${y}`;
        if (key !== this.lastGhostTile) {
          this.lastGhostTile = key;
          const valid = this.canBuildHere(x, y);
          this.renderer.showGhostAt(x, y, kind, valid);
        }
      }
    } else {
      this.canvas.style.cursor = 'default';
      this.renderer.hideGhost();
    }
  }

  /** Can a building be placed at this tile? Checks footprint + materials.
   *  Wide buildings (workbench/bed) span the anchor and the tile right of it. */
  private canBuildHere(tx: number, ty: number): boolean {
    const kind = this.buildKind;
    if (!kind) return false;
    const def = BLUEPRINTS[kind];
    // Every tile of the footprint must be valid.
    for (let o = 0; o < (def.w ?? 1); o++) {
      if (!this.tileBuildable(tx + o, ty)) return false;
    }
    // Materials must be available (show red ghost otherwise).
    for (const [item, n] of Object.entries(def.cost ?? {})) {
      if (this.game.stockpileCount(item) < n) return false;
    }
    return true;
  }

  private tileBuildable(x: number, y: number): boolean {
    const t = this.game.terrain;
    if (x < 0 || y < 0 || x >= t.w || y >= t.h) return false;
    const id = t.tiles[y]?.[x];
    if (id === 'deepWater' || id === 'shallowWater') return false;
    if (this.game.structures.some((s) => s.x === x && s.y === y)) return false;
    if (this.game.blueprints.some((b) => b.x === x && b.y === y)) return false;
    if (this.game.colony.colonists.some((c) => c.tileX === x && c.tileY === y)) return false;
    return true;
  }

  private keys: Record<string, boolean> = {};

  /** Polled by main each frame for smooth keyboard pan + build-mode sync. */
  update(dt: number): void {
    this.syncBuildMode();
    const speed = 500 * this.renderer.camera.zoom * dt; // screen-px/sec scaled
    let dx = 0, dy = 0;
    const k = this.keys;
    if (k['a'] || k['arrowleft']) dx -= speed;
    if (k['d'] || k['arrowright']) dx += speed;
    if (k['w'] || k['arrowup']) dy -= speed;
    if (k['s'] || k['arrowdown']) dy += speed;
    if (dx !== 0 || dy !== 0) {
      this.startFreePan();
      this.renderer.camera.panByScreen(dx, dy);
      this.renderer.updateCameraNow();
    }
  }

  /** Select a colonist under the cursor (dot-product distance in px). */
  private pickColonist(clientX: number, clientY: number): number | null {
    const wp = this.renderer.screenToWorld(clientX, clientY);
    let best: number | null = null;
    let bestD = Infinity;
    for (const col of this.game.colony.colonists) {
      const pos = col.getPositionPx();
      const d = Math.hypot(pos.x - wp.x, pos.y - wp.y);
      if (d < 12 && d < bestD) {
        bestD = d;
        best = col.id;
      }
    }
    return best;
  }

  private selectColonist(id: number): void {
    this.ui.onColonistSelected(id);
    this.renderer.selectColonist(id);
    // Selecting a colonist switches the camera into follow mode targeting them.
    this.renderer.camera.setMode('follow');
    this.renderer.followColonist(id);
    this.renderer.camera.snapTo(this.colonistPos(id));
  }

  private colonistPos(id: number): { x: number; y: number } {
    const c = this.game.colony.colonists.find((cc) => cc.id === id);
    if (!c) return { x: 0, y: 0 };
    return { x: c.tileX * 16 + 8, y: c.tileY * 16 + 8 };
  }

  /** Cycle camera mode: follow a selected colonist / colony centroid ↔ free pan. */
  toggleCameraMode(): 'follow' | 'free' {
    if (this.cameraMode() === 'follow') {
      this.startFreePan();
      return 'free';
    } else {
      this.enterFollowMode();
      return 'follow';
    }
  }

  /** Current camera mode label for the UI. */
  cameraMode(): 'follow' | 'free' {
    return this.renderer.camera.mode;
  }

  /** Called the moment a pan begins: switch to free mode + hint the user. */
  private startFreePan(): void {
    if (this.renderer.camera.mode !== 'free') {
      this.renderer.camera.setMode('free');
      this.renderer.followColonist(null);
      // Sync the top-bar button + show a one-time hint.
      this.ui.setCameraMode('free');
      this.ui.showToast('已进入自由相机模式 · 点击顶部「⊕ 跟随」可恢复跟随');
    }
  }

  /** Called to re-enter follow mode explicitly (toggle/select). */
  enterFollowMode(): void {
    this.renderer.camera.setMode('follow');
    const sel = this.ui.selectedColonistId();
    if (sel != null) {
      this.renderer.followColonist(sel);
      this.renderer.camera.snapTo(this.colonistPos(sel));
    } else {
      this.renderer.followColonist(null);
    }
    this.ui.setCameraMode('follow');
  }
}

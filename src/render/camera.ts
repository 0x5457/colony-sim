/** 3A-grade world camera: smooth follow with exponential easing, manual pan,
 * integer-snap zoom, and level-bounds clamping (per camera-systems skill).
 * The camera owns the transform applied to the world container; the renderer
 * just asks it for a matrix each frame.
 */
import { TILE, MAP_W, MAP_H } from '../core/config';

export interface CameraTarget {
  x: number; // world pixels
  y: number;
}

export type CameraMode = 'follow' | 'free';

export class GameCamera {
  // World-pixel focus point (the point the view centers on).
  focusX = 0;
  focusY = 0;
  /** Zoom: integer scale (1, 2, 3, 4). */
  zoom = 2;
  /** Smoothing rate (1 - exp(-rate*dt)); higher = snappier. */
  followRate = 5;
  /** Camera behaviour: follow a target, or free panning (fully manual). */
  mode: CameraMode = 'follow';

  // Whether the player has taken manual control (dragging/keys) this frame —
  // disables smooth-follow until a recenter.
  private manualOverride = false;
  private overrideTimer = 0;

  // Screen dims (pixels) cached each frame.
  private screenW = 1920;
  private screenH = 1080;

  // Shake offset hook (written by game-feel) added on top of follow last.
  shakeOffsetX = 0;
  shakeOffsetY = 0;

  setScreenSize(w: number, h: number): void {
    this.screenW = w;
    this.screenH = h;
  }

  /** Begin a manual pan (mouse-drag or keyboard). */
  beginManual(): void {
    this.manualOverride = true;
    this.overrideTimer = 0.5;
  }

  /** Pan the focus by screen-pixel delta (current zoom). */
  panByScreen(dx: number, dy: number): void {
    this.focusX -= dx / this.zoom;
    this.focusY -= dy / this.zoom;
    this.beginManual();
    this.clampToWorld();
  }

  /** Pan by world-pixel delta directly. */
  panByWorld(dx: number, dy: number): void {
    this.focusX += dx;
    this.focusY += dy;
    this.beginManual();
    this.clampToWorld();
  }

  /** Relative scroll; zoom toward the cursor world position. */
  zoomAt(delta: number, screenX: number, screenY: number): void {
    const before = this.zoom;
    const next = Math.max(1, Math.min(4, this.zoom + Math.sign(delta)));
    if (next === before) return;
    // Anchor: keep the world point under the cursor stationary.
    const mx = (screenX - this.screenW / 2);
    const my = (screenY - this.screenH / 2);
    this.focusX = this.focusX + mx * (1 / before - 1 / next);
    this.focusY = this.focusY + my * (1 / before - 1 / next);
    this.zoom = next;
    this.beginManual();
    this.clampToWorld();
  }

  /** In free mode the camera stays put (manual control owns the focus). */
  isFollowing(): boolean {
    return this.mode === 'follow';
  }

  /** Switch between follow-on-target and fully free camera. */
  setMode(mode: CameraMode): void {
    if (this.mode === mode) return;
    this.mode = mode;
    // Leaving manual control: re-enable follow so the target is re-acquired.
    this.manualOverride = false;
    this.overrideTimer = 0;
  }

  toggleMode(): CameraMode {
    this.setMode(this.mode === 'follow' ? 'free' : 'follow');
    return this.mode;
  }

  /** Follow a target with exponential smoothing (frame-rate independent). */
  follow(target: CameraTarget, dt: number): void {
    // Free mode: the camera never auto-follows. But we still allow a short
    // re-acquisition when returning from a manual pan handled below.
    if (this.mode !== 'follow') {
      this.clampToWorld();
      return;
    }
    if (this.manualOverride) {
      this.overrideTimer -= dt;
      if (this.overrideTimer <= 0) this.manualOverride = false;
      else {
        this.clampToWorld();
        return;
      }
    }
    const t = 1 - Math.exp(-this.followRate * dt);
    this.focusX += (target.x - this.focusX) * t;
    this.focusY += (target.y - this.focusY) * t;
    this.clampToWorld();
  }

  /** Hard snap (teleport focus) to a target, resetting smoothing. */
  snapTo(target: CameraTarget): void {
    this.focusX = target.x;
    this.focusY = target.y;
    this.clampToWorld();
  }

  private clampToWorld(): void {
    const halfW = this.screenW / 2 / this.zoom;
    const halfH = this.screenH / 2 / this.zoom;
    const worldW = MAP_W * TILE;
    const worldH = MAP_H * TILE;
    // If the world is smaller than the view, center; else clamp the view rect.
    if (worldW <= this.screenW / this.zoom) {
      this.focusX = worldW / 2;
    } else {
      this.focusX = Math.max(halfW, Math.min(worldW - halfW, this.focusX));
    }
    if (worldH <= this.screenH / this.zoom) {
      this.focusY = worldH / 2;
    } else {
      this.focusY = Math.max(halfH, Math.min(worldH - halfH, this.focusY));
    }
  }

  /** Get the world transform: position + scale for the world container. */
  getTransform(): { x: number; y: number; scale: number } {
    const scale = this.zoom;
    return {
      x: this.screenW / 2 - this.focusX * scale + this.shakeOffsetX * scale,
      y: this.screenH / 2 - this.focusY * scale + this.shakeOffsetY * scale,
      scale,
    };
  }

  /** Convert client coords → world pixel coords. */
  screenToWorld(clientX: number, clientY: number, rect: { left: number; top: number }): { x: number; y: number } {
    const sx = clientX - rect.left;
    const sy = clientY - rect.top;
    const t = this.getTransform();
    return { x: (sx - t.x) / t.scale, y: (sy - t.y) / t.scale };
  }
}

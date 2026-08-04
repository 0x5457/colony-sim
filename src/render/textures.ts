/** Procedural pixel-art assets with a unified visual language:
 *  - one light direction (top-left)
 *  - consistent 1px dark outlines on entities
 *  - limited-but-rich ramps (per-sprite 6-12 colors)
 *  - soft blob shadows soldering entities to the ground
 *  - ambient decorations & glows for atmosphere
 * All at fixed resolutions (16px tiles, 32px entities) for integer scaling.
 */
import {
  hex, toCss, shade, ramp, canvas, px, addOutline, blobShadowCanvas, tsRand,
} from './palette';
import { fbm } from '../world/noise';

const TILE = 16;
const FRAME = 32;

export interface TextureAtlas {
  tiles: Record<string, HTMLCanvasElement[]>;
  nodes: Record<string, HTMLCanvasElement>;
  /** Animations for a colonist: key `c${palIdx}_${dir}_${anim}` → frames. */
  colonists: Record<string, HTMLCanvasElement[]>;
  /** Static frame map (first frame of each) for simple uses. */
  colonistStatic: Record<string, HTMLCanvasElement>;
  colonistPalettes: { skin: string; hair: string; cloth: string }[];
  /** soft blob shadows, sized 24/32. */
  shadows: Record<number, HTMLCanvasElement>;
  /** warm glow sprite (additive, for campfires/lamps). */
  glow: HTMLCanvasElement;
  /** ambient sparkle/glimmer. */
  sparkle: HTMLCanvasElement;
  /** ground decoration tile variants (grass tufts, stones, flowers). */
  deco: HTMLCanvasElement[];
}

/* ============ Ground ============ */

/** Draw a base ground tile with gentle per-pixel value-noise shading.
 *  Purpose-built for modern pixel terrain: organic rolling tones instead of
 *  hard random blocks. Every tile draws its own scaled noise field so edges
 *  between tiles stay soft, while the shared seed keeps tiles coherent. */
/** A ground tile drawn the way a pixel artist would lay one out by hand:
 *  a flat base coat, then a few sparse, deliberate texture specks (pebbles,
 *  tufts, blades) placed in readable clusters — not per-pixel noise. Warm,
 *  gently-dithered, endless variance via a seed but a *hand-made* feel. */
function drawGroundTile(baseHex: string, seed: number, opts: {
  speckle?: string;
  grass?: boolean;
}): HTMLCanvasElement {
  const [c, ctx] = canvas(TILE, TILE);
  const rnd = tsRand(seed);
  const base = hex(baseHex);

  // ---- Flat base coat ----
  ctx.fillStyle = toCss(base);
  ctx.fillRect(0, 0, TILE, TILE);

  // ---- Soft dithered tonal patches (readable, not noisy) ----
  // A small number of large, soft clusters of a slightly darker/lighter tone;
  // using ordered dithering in 2x2/4x4 cells gives a smooth hand-shaded feel.
  const patchCount = 3 + Math.floor(rnd() * 2);
  for (let p = 0; p < patchCount; p++) {
    const cx = Math.floor(rnd() * TILE);
    const cy = Math.floor(rnd() * TILE);
    const rad = 2 + Math.floor(rnd() * 2);
    const f = rnd() < 0.5 ? 0.88 : 1.12;
    const colDarker = toCss(shade(base, 0.9));
    const colLighter = toCss(shade(base, 1.1));
    for (let y = -rad; y <= rad; y++) {
      for (let x = -rad; x <= rad; x++) {
        if (x * x + y * y > rad * rad) continue;
        const tx = cx + x, ty = cy + y;
        if (tx < 0 || ty < 0 || tx >= TILE || ty >= TILE) continue;
        // 2x2 dither edge softens the patch.
        const on = (tx + ty) % 2 === 0;
        if (on) ctx.fillStyle = f < 1 ? colDarker : colLighter;
        else ctx.fillStyle = toCss(shade(base, f));
        ctx.fillRect(tx, ty, 1, 1);
      }
    }
  }

  // ---- Hand-placed texture specks ----
  // A few small readable details: dots, short lines, tiny crosses.
  const deco = Math.floor(rnd() * 4) + 3;
  for (let i = 0; i < deco; i++) {
    const x = Math.floor(rnd() * (TILE - 2)) + 1;
    const y = Math.floor(rnd() * (TILE - 2)) + 1;
    const kind = Math.floor(rnd() * 3);
    if (kind === 0) { // single darker grain
      px(ctx, x, y, shade(base, 0.82));
    } else if (kind === 1) { // little pebble (2 px)
      px(ctx, x, y, shade(base, 0.78));
      px(ctx, x + 1, y, shade(base, 0.9));
    } else { // short grass blade / stem, slightly brighter
      ctx.fillStyle = toCss(shade(base, 1.2));
      ctx.fillRect(x, y, 1, 2);
    }
  }

  // Grass tiles: a couple of clustered, forward-leaning blades for warmth.
  if (opts.grass) {
    const g = hex('#63a04a');
    const gl = hex('#7cbd5c');
    for (let i = 0; i < 2; i++) {
      const x = 2 + Math.floor(rnd() * (TILE - 4));
      const y = 5 + Math.floor(rnd() * 6);
      ctx.fillStyle = toCss(g);
      ctx.fillRect(x, y, 1, 3);
      ctx.fillRect(x + 1, y + 1, 1, 2);
      ctx.fillStyle = toCss(gl); // lit tip
      ctx.fillRect(x, y, 1, 1);
    }
  }
  return c;
}

/* ============ Water ============ */

/** Smooth, calm water: a soft top-to-bottom depth gradient overlaid with the
 *  gentle value-noise surface and a slowly travelling shimmer. Light, natural,
 *  fits a modern pixel look — not striped, not noisy. */
function drawWaterTile(baseHex: string, seed: number, frame: number): HTMLCanvasElement {
  const [c, ctx] = canvas(TILE, TILE);
  const base = hex(baseHex);
  const img = ctx.createImageData(TILE, TILE);
  const d = img.data;
  const ox = (seed * 5.7) % 71;
  const oy = (seed * 11.3) % 53;
  for (let y = 0; y < TILE; y++) {
    for (let x = 0; x < TILE; x++) {
      // Vertical depth: lighter near the top (shoreward), richer lower.
      const depth = y / (TILE - 1);
      const lift = 1 + (1 - depth) * 0.3 - depth * 0.08;
      // Gentle value-noise surface so it isn't a flat gradient.
      const n = fbm((x + ox) * 0.55, (y + oy) * 0.55, 2, 2.2, 0.5);
      // Slow travelling shimmer.
      const shimmer = Math.sin((x + frame * 1.5) * 0.8 + (y + frame) * 0.5) * 0.03;
      const g = Math.max(0.02, Math.min(0.98, lift + (n - 0.5) * 0.2 + shimmer));
      const rgb = shade(base, g);
      const i = (y * TILE + x) * 4;
      d[i] = Math.round(rgb[0] * 255);
      d[i + 1] = Math.round(rgb[1] * 255);
      d[i + 2] = Math.round(rgb[2] * 255);
      d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  // A couple of soft glints drifting per frame.
  const rnd = tsRand(seed + frame * 131);
  ctx.fillStyle = 'rgba(255,255,255,0.30)';
  for (let i = 0; i < 3; i++) {
    const gx = Math.floor(rnd() * TILE);
    const gy = 2 + Math.floor(rnd() * (TILE - 6));
    ctx.fillRect(gx, gy, 2, 1);
  }
  return c;
}

/* ============ Wall / structure surfaces ============ */

function drawWallTile(): HTMLCanvasElement {
  const [c, ctx] = canvas(TILE, TILE);
  const base = ramp('#7e8088');
  ctx.fillStyle = toCss(base.mid);
  ctx.fillRect(0, 0, TILE, TILE);
  // Stone face with directional shading: light top-left, dark bottom-right.
  const stones: Array<[number, number, number, number]> = [
    [1, 1, 5, 6], [7, 1, 6, 6], [1, 8, 5, 6], [7, 8, 6, 6],
  ];
  for (const [sx, sy, sw, sh] of stones) {
    // mortar
    ctx.fillStyle = toCss(shade(base.mid, 0.7));
    ctx.fillRect(sx, sy, sw, sh);
    // inner face
    ctx.fillStyle = toCss(shade(base.mid, 0.95));
    ctx.fillRect(sx + 1, sy + 1, sw - 2, sh - 2);
    // top-left highlight
    ctx.fillStyle = toCss(base.light);
    ctx.fillRect(sx + 1, sy + 1, sw - 2, 1);
    ctx.fillRect(sx + 1, sy + 1, 1, sh - 2);
    // bottom-right shade
    ctx.fillStyle = toCss(base.dark);
    ctx.fillRect(sx + 1, sy + sh - 1, sw - 2, 1);
    ctx.fillRect(sx + sw - 1, sy + 1, 1, sh - 2);
  }
  // top highlight
  ctx.fillStyle = toCss(base.highlight);
  ctx.fillRect(0, 0, TILE, 1);
  return c;
}

/* ============ Resource nodes ============ */

function blobAndBody(size: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  return canvas(size, size);
}

function drawTree(): HTMLCanvasElement {
  const size = 24;
  const [c, ctx] = blobAndBody(size);
  const rnd = tsRand(12);
  const cx = Math.floor(size / 2); // canopy centre aligned to trunk
  const leaf = ramp('#3d8a3a');
  const trunk = ramp('#6f4a28');

  // ---- Trunk (lower centre) dark, rooted, with a slight taper. ----
  const trunTop = 15;
  const trunW0 = 3; // top width
  const trunW1 = 4; // base width
  for (let y = trunTop; y < size; y++) {
    const t = (y - trunTop) / (size - trunTop);
    const w = Math.round(trunW0 + (trunW1 - trunW0) * t);
    const lx = cx - 1;
    for (let x = 0; x < w; x++) {
      const f = x === 0 ? 0.72 : x === w - 1 ? 1.05 : 1.0;
      px(ctx, lx + x, y, shade(trunk.mid, f));
    }
    // root flare
    if (y >= size - 3) { px(ctx, lx - 1, y, shade(trunk.dark, 1)); px(ctx, lx + w, y, shade(trunk.dark, 1)); }
  }
  // Trunk top highlight on the lit (left) side.
  px(ctx, cx - 1, trunTop, toCss(trunk.light));
  px(ctx, cx - 1, trunTop + 1, toCss(shade(trunk.mid, 1.1)));

  // ---- Canopy: one big rounded blob, light from top-left, darker bottom-right.
  const cy = 8;            // canopy centre
  const rad = 7;
  // build in two passes: back (dark) then front highlight so light reads.
  for (let pass = 0; pass < 2; pass++) {
    for (let y = -rad; y <= rad; y++) {
      for (let x = -rad; x <= rad; x++) {
        const dx = x;
        // slightly egg-shaped: taller than wide, more mass low.
        const rx = rad;
        const ry = rad + 1.2;
        if ((dx * dx) / (rx * rx) + (y * y) / (ry * ry) > 1) continue;
        const wx = cx + x;
        const wy = cy + y;
        if (wx < 0 || wy < 0 || wx >= size || wy >= size) continue;
        // directional light: lit on the top-left curve, shaded lower-right.
        const dist2 = (x * x + y * y) / (rx * rx);
        const litTop = y <= 0 && x <= 0;
        const bottom = y > 0;
        let f = 0.9;
        if (litTop) f = 1.3;
        else if (bottom) f = 0.62;
        // interior of the blob is slightly darker than the rim faces.
        f *= dist2 < 0.25 ? 0.95 : 1.0;
        if (rnd() < 0.18) f *= 0.9; // dappled shadow holes
        px(ctx, wx, wy, shade(leaf.mid, f));
      }
    }
  }
  // Bright leaf glints on the sunward upper-left rim.
  for (let i = 0; i < 6; i++) {
    const gx = cx - 3 + Math.floor(rnd() * 4);
    const gy = cy - 4 + Math.floor(rnd() * 4);
    px(ctx, gx, gy, toCss(shade(leaf.highlight, rnd() < 0.5 ? 1 : 0.85)));
  }
  // thin branch showing between canopy bottom and trunk.
  px(ctx, cx, 14, toCss(shade(trunk.mid, 1)));
  px(ctx, cx, 15, toCss(shade(trunk.mid, 1)));

  addOutline(ctx, size, size, hex('#22311f'));
  return c;
}

function drawRock(): HTMLCanvasElement {
  const size = 20;
  const [c, ctx] = blobAndBody(size);
  const r = ramp('#8d9098');
  // irregular rock polygon with facets.
  const shape: Array<[number, number]> = [
    [3, 12], [5, 6], [11, 4], [16, 7], [15, 13], [9, 16], [4, 15],
  ];
  // fill base.
  ctx.beginPath();
  shape.forEach(([x, y], i) => i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y));
  ctx.closePath();
  ctx.fillStyle = toCss(r.mid);
  ctx.fill();
  // facet highlights (top-left facets) and shades (bottom-right).
  ctx.beginPath();
  ctx.moveTo(5, 6); ctx.lineTo(11, 4); ctx.lineTo(10, 9); ctx.lineTo(5, 9);
  ctx.closePath();
  ctx.fillStyle = toCss(r.light);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(11, 4); ctx.lineTo(16, 7); ctx.lineTo(12, 11); ctx.lineTo(10, 9);
  ctx.closePath();
  ctx.fillStyle = toCss(r.mid);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(10, 9); ctx.lineTo(12, 11); ctx.lineTo(15, 13); ctx.lineTo(9, 16); ctx.lineTo(4, 15);
  ctx.closePath();
  ctx.fillStyle = toCss(r.dark);
  ctx.fill();
  addOutline(ctx, size, size, hex('#2a2b30'));
  return c;
}

function drawBerryBush(): HTMLCanvasElement {
  const size = 20;
  const [c, ctx] = blobAndBody(size);
  const rnd = tsRand(33);
  const leaf = ramp('#3e7a38');
  const berry = ramp('#d1454a');
  // bush leaves.
  for (let i = 0; i < 10; i++) {
    const x = 3 + Math.floor(rnd() * 14);
    const y = 6 + Math.floor(rnd() * 8);
    const f = 0.85 + rnd() * 0.3;
    px(ctx, x, y, shade(leaf.mid, f));
  }
  // berries clustered.
  const clusters = [[6, 10], [10, 9], [12, 12], [8, 13], [14, 8]];
  for (const [x, y] of clusters) {
    ctx.fillStyle = toCss(berry.mid);
    ctx.fillRect(x, y, 2, 2);
    px(ctx, x, y, toCss(berry.highlight)); // glossy highlight top-left
  }
  addOutline(ctx, size, size, hex('#2a3a24'));
  return c;
}

function drawAnimal(): HTMLCanvasElement {
  const size = 20;
  const [c, ctx] = blobAndBody(size);
  const fur = ramp('#b08a5c');
  const dark = shade(hex('#6a4a2a'), 1);
  // body.
  ctx.fillStyle = toCss(fur.mid);
  ctx.fillRect(4, 8, 12, 5);
  ctx.fillStyle = toCss(fur.light);
  ctx.fillRect(5, 9, 10, 2); // back highlight
  // legs.
  ctx.fillStyle = toCss(dark);
  ctx.fillRect(5, 13, 2, 3);
  ctx.fillRect(8, 13, 2, 3);
  ctx.fillRect(11, 13, 2, 3);
  ctx.fillRect(14, 13, 2, 3);
  // head (left, facing left) + ear.
  ctx.fillStyle = toCss(fur.mid);
  ctx.fillRect(3, 6, 6, 4);
  ctx.fillStyle = toCss(fur.dark);
  ctx.fillRect(2, 5, 2, 2); // ear
  // eye.
  ctx.fillStyle = '#2a2a2a';
  ctx.fillRect(4, 7, 1, 1);
  addOutline(ctx, size, size, hex('#3a2418'));
  return c;
}

/* ============ Camper-fire / lamp glow ============ */

function drawGlow(size = 48): HTMLCanvasElement {
  const [c, ctx] = canvas(size, size);
  const cx = size / 2;
  const grad = ctx.createRadialGradient(cx, cx, 0, cx, cx, size / 2);
  grad.addColorStop(0, 'rgba(255,190,90,0.85)');
  grad.addColorStop(0.3, 'rgba(255,160,60,0.35)');
  grad.addColorStop(1, 'rgba(255,160,60,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  return c;
}

function drawSparkle(size = 16): HTMLCanvasElement {
  const [c, ctx] = canvas(size, size);
  const cx = size / 2;
  ctx.fillStyle = 'rgba(255,240,200,1)';
  ctx.fillRect(cx, cx, 1, 1);
  ctx.fillStyle = 'rgba(255,240,200,0.5)';
  ctx.fillRect(cx - 1, cx, 1, 1);
  ctx.fillRect(cx + 1, cx, 1, 1);
  ctx.fillRect(cx, cx - 1, 1, 1);
  ctx.fillRect(cx, cx + 1, 1, 1);
  return c;
}

/* ============ Decorations (ground scatter) ============ */

function drawDeco(kind: 'grass' | 'flower' | 'stone' | 'shrub', seed: number): HTMLCanvasElement {
  const [c, ctx] = canvas(TILE, TILE);
  const rnd = tsRand(seed);
  if (kind === 'grass') {
    const g = ramp('#63a34a');
    for (let i = 0; i < 3; i++) {
      const x = 3 + Math.floor(rnd() * 10);
      const y = 7 + Math.floor(rnd() * 6);
      px(ctx, x, y, toCss(shade(g.mid, 0.95)));
      px(ctx, x - 1, y + 1, toCss(g.light));
      px(ctx, x + 1, y + 1, toCss(g.dark));
    }
  } else if (kind === 'flower') {
    const petals = ['#e0708a', '#e0b040', '#a0b8e8', '#e08560'];
    const col = petals[Math.floor(rnd() * petals.length)];
    const x = 7, y = 7;
    px(ctx, x, y, toCss(ramp(col).mid));
    px(ctx, x - 1, y, toCss(ramp(col).light));
    px(ctx, x + 1, y, toCss(ramp(col).light));
    px(ctx, x, y - 1, toCss(ramp(col).light));
    px(ctx, x, y + 1, toCss(ramp(col).dark));
    px(ctx, x, y + 2, '#2d6b2d');
  } else if (kind === 'stone') {
    const st = ramp('#9a9da4');
    px(ctx, 6, 9, toCss(st.mid));
    px(ctx, 7, 8, toCss(st.mid));
    px(ctx, 8, 9, toCss(st.light));
    px(ctx, 6, 10, toCss(st.dark));
    px(ctx, 7, 10, toCss(st.dark));
  } else {
    // shrub
    const g = ramp('#2f6b2f');
    const x = 7, y = 7;
    ctx.fillStyle = toCss(shade(g.mid, 0.9));
    ctx.fillRect(x - 2, y, 5, 3);
    px(ctx, x, y - 1, toCss(g.mid));
    px(ctx, x - 1, y - 1, toCss(g.light));
    px(ctx, x + 1, y - 1, toCss(g.dark));
  }
  return c;
}

/* ============ Colonist (32x32 chibi, pose-driven animation) ============ */

interface ColonistPalette {
  skin: string; hair: string; cloth: string;
}

/** A body-offset description that turns into animation frames. Offsets in px. */
interface Pose {
  /** vertical bob of the whole figure (walk/breathing). */
  bob: number;
  /** right leg fwd (+1) / back (-1); 0 = neutral. */
  legR: number;
  /** left leg fwd/back. */
  legL: number;
  /** right arm swing (+ = up/fwd, - = down/back). */
  armR: number;
  /** left arm swing. */
  armL: number;
  /** torso lean (x offset, px). */
  lean: number;
  /** head bob extra (looks / nods). */
  headLift: number;
  /** eyes closed (blink/sleep). */
  blink?: boolean;
}

function neutralPos(): Pose {
  return { bob: 0, legR: 0, legL: 0, armR: 0, armL: 0, lean: 0, headLift: 0 };
}

/** One pose, drawn with 1px body-part squares. dir = facing direction. */
function drawPose(pal: ColonistPalette, dir: string, pose: Pose): HTMLCanvasElement {
  const [c, ctx] = canvas(FRAME, FRAME);
  const skin = ramp(pal.skin);
  const hair = ramp(pal.hair);
  const cloth = ramp(pal.cloth);
  const outline = hex('#26201c');

  const bob = pose.bob;
  const shift = bob;

  // ---- Ground shadow (solders to terrain) ----
  ctx.fillStyle = 'rgba(0,0,0,0.30)';
  ctx.beginPath();
  ctx.ellipse(FRAME / 2, FRAME - 2, 8, 3, 0, 0, Math.PI * 2);
  ctx.fill();

  // ---- Legs ----
  const legParts = legPoses(dir, pose, shift, skin);
  for (const part of legParts) {
    ctx.fillStyle = part.color;
    ctx.fillRect(part.x, part.y, part.w, part.h);
  }

  // ---- Torso (with vertical bob) ----
  const tY = 17 + shift;
  const bodyX = 11;
  ctx.fillStyle = toCss(cloth.mid);
  ctx.fillRect(bodyX, tY, 10, 7);
  ctx.fillStyle = toCss(cloth.light);
  ctx.fillRect(bodyX + 1, tY + 1, 4, 4);
  ctx.fillStyle = toCss(cloth.dark);
  ctx.fillRect(bodyX + 5, tY + 3, 4, 3);
  ctx.fillStyle = toCss(shade(cloth.dark, 0.7));
  ctx.fillRect(bodyX, tY + 5, 10, 1);

  // ---- Arms (with swing) — arms sit on the body's left and right edges. ----
  drawArm(ctx, bodyX - 1, tY, pose.armL, skin, cloth);
  drawArm(ctx, bodyX + 9, tY, pose.armR, skin, cloth);

  // ---- Head (with bob; drawn last so it overlaps torso) ----
  const hY = 5 + shift + pose.headLift;
  ctx.fillStyle = toCss(skin.mid);
  ctx.fillRect(10, hY, 12, 11);
  ctx.fillStyle = toCss(skin.light);
  ctx.fillRect(10, hY, 5, 5);
  ctx.fillStyle = toCss(skin.dark);
  ctx.fillRect(18, hY + 5, 3, 3);
  // Hair top + sides.
  ctx.fillStyle = toCss(hair.mid);
  ctx.fillRect(10, hY - 1, 12, 4);
  ctx.fillRect(9, hY + 1, 2, 4);
  ctx.fillRect(21, hY + 1, 2, 4);
  ctx.fillStyle = toCss(hair.highlight);
  ctx.fillRect(10, hY - 1, 5, 2);
  ctx.fillStyle = toCss(hair.dark);
  for (let i = 0; i < 4; i++) ctx.fillRect(11 + i * 2, hY + 3, 2, 1);

  // ---- Face ----
  if (dir !== 'up') {
    if (pose.blink) {
      ctx.fillStyle = '#26201c';
      ctx.fillRect(12, hY + 4, 2, 1);
      ctx.fillRect(18, hY + 4, 2, 1);
    } else {
      ctx.fillStyle = '#26201c';
      ctx.fillRect(12, hY + 4, 2, 2);
      ctx.fillRect(18, hY + 4, 2, 2);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(12, hY + 4, 1, 1);
      ctx.fillRect(18, hY + 4, 1, 1);
    }
    ctx.fillStyle = 'rgba(230,130,130,0.55)';
    ctx.fillRect(11, hY + 7, 2, 1);
    ctx.fillRect(19, hY + 7, 2, 1);
    ctx.fillStyle = '#7a3a30';
    ctx.fillRect(15, hY + 8, 2, 1);
  } else {
    // Facing away (up): the head reads as the back of the head (all hair).
    ctx.fillStyle = toCss(hair.mid);
    ctx.fillRect(10, hY, 12, 10);
    ctx.fillStyle = toCss(hair.highlight);
    ctx.fillRect(10, hY, 4, 2);
    ctx.fillStyle = toCss(hair.dark);
    ctx.fillRect(10, hY + 7, 12, 3);
    ctx.fillRect(9, hY + 4, 2, 6);
    ctx.fillRect(21, hY + 4, 2, 6);
  }

  // 1px outline around the whole silhouette.
  addOutline(ctx, FRAME, FRAME, outline);
  return c;
}

interface Rect {
  x: number; y: number; w: number; h: number; color: string;
}

function legPoses(dir: string, pose: Pose, shift: number, skin: any): Rect[] {
  const pieces: Rect[] = [];
  const legY = 24 + shift;
  const far = toCss(skin.dark);
  const near = toCss(shade(skin.mid, 0.9));
  // forward/back leg offsets (px up-down for a walking step).
  // legL (player-left) and legR (player-right).
  const liftL = pose.legL;
  const liftR = pose.legR;
  if (dir === 'right') {
    // we see the near (right) leg & part of far leg behind
    if (liftL > 0) pieces.push({ x: 12, y: legY - 1, w: 2, h: 5, color: far });
    else pieces.push({ x: 12, y: legY, w: 2, h: 5, color: far });
    pieces.push({ x: 16, y: legY - Math.max(0, liftR), w: 2, h: 6, color: near });
  } else if (dir === 'left') {
    pieces.push({ x: 12, y: legY - Math.max(0, liftL), w: 2, h: 6, color: near });
    if (liftR > 0) pieces.push({ x: 16, y: legY - 1, w: 2, h: 5, color: far });
    else pieces.push({ x: 16, y: legY, w: 2, h: 5, color: far });
  } else {
    // down/up: both legs visible side by side
    const lift1 = Math.max(0, liftL);
    const lift2 = Math.max(0, liftR);
    pieces.push({ x: 13, y: legY - lift1, w: 3, h: 5 - (lift1 ? 1 : 0), color: near });
    pieces.push({ x: 17, y: legY - lift2, w: 3, h: 5 - (lift2 ? 1 : 0), color: far });
  }
  return pieces;
}

function drawArm(
  ctx: CanvasRenderingContext2D,
  ax: number, tY: number, swing: number,
  skin: any, cloth: any,
): void {
  // ax is the arm's x origin (left or right shoulder edge of the body).
  const armSkin = toCss(shade(skin.mid, 0.9));
  const handSkin = toCss(skin.mid);
  const armCloth = toCss(cloth.mid);
  const armClothDark = toCss(shade(cloth.mid, 0.72));
  // Sleeve: short cloth sleeve from the shoulder down.
  ctx.fillStyle = armClothDark;
  ctx.fillRect(ax, tY + 1, 2, 1);
  ctx.fillStyle = armCloth;
  ctx.fillRect(ax, tY + 2, 2, 2);
  // Forearm: skin hangs from the sleeve; swing lifts (positive) or extends reach down.
  const handLift = Math.round(clamp(swing, -1, 1.4) * 2);
  const handY = tY + 4 - handLift;
  const reach = Math.max(0, Math.round(-swing));
  ctx.fillStyle = armSkin;
  ctx.fillRect(ax, handY, 2, Math.max(1, 3 + reach) - handLift + 1);
  ctx.fillStyle = handSkin;
  // Small fist pixel + thumb hints so the hand reads, on both sides.
  const handTop = handY + Math.max(1, 3 + reach) - handLift;
  ctx.fillRect(ax, handTop, 2, 1);
  ctx.fillRect(ax - 1, handTop, 1, 1);
  ctx.fillRect(ax + 2, handTop, 1, 1);
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/** Generate animation frames for one palette/direction across states. */
function colonistAnimations(pal: ColonistPalette, dir: string): Record<string, HTMLCanvasElement[]> {
  const frames: Record<string, HTMLCanvasElement[]> = {};

  // Idle: 4 frames — breathe up / hold / breathe down / blink.
  const idleSeq: Pose[] = [
    { ...neutralPos(), bob: 0 },
    { ...neutralPos(), bob: 0.4 },
    { ...neutralPos(), bob: 0.1 },
    { ...neutralPos(), bob: 0, blink: true },
  ];
  frames['idle'] = idleSeq.map((p) => drawPose(pal, dir, p));

  // Walk: 4-frame cycle — leg swing + arm counter-swing + bob.
  const walk: Pose[] = [
    { ...neutralPos(), bob: 0.3, legL: 0, legR: 1, armL: 1, armR: 0 },
    { ...neutralPos(), bob: 0, legL: 0, legR: 0, armL: 0, armR: 0 },
    { ...neutralPos(), bob: 0.3, legL: 1, legR: 0, armL: 0, armR: 1 },
    { ...neutralPos(), bob: 0, legL: 0, legR: 0, armL: 0, armR: 0 },
  ];
  frames['walk'] = walk.map((p) => drawPose(pal, dir, p));

  // Work (chop/mine/build): wind-up → impact → lift-loop (3 frames).
  const work: Pose[] = [
    { ...neutralPos(), bob: 0.3, armL: 1.2, armR: 1.0 },
    { ...neutralPos(), bob: 0, armL: 0, armR: -0.5, lean: 1 },
    { ...neutralPos(), bob: 0.5, armL: 1.0, armR: 0.8 },
  ];
  frames['work'] = work.map((p) => drawPose(pal, dir, p));

  return frames;
}

/* ============ Atlas ============ */

export function buildTextureAtlas(): TextureAtlas {
  // Ground tiles (multiple variants each to defeat repetition).
  const tiles: Record<string, HTMLCanvasElement[]> = {};
  type GroundOpts = { grass?: boolean };
  const baseTiles: Record<string, [string, GroundOpts]> = {
    // Warm, hand-picked modern palettes (green-tinted grass, earthy dirt,
    // honey sand, cool stone) rather than primary colours.
    grass: ['#69a34f', { grass: true }],
    dirt: ['#a5754a', {}],
    sand: ['#e0c584', {}],
    stone: ['#8f949e', {}],
    shallowWater: ['#4e8ac4', {}],
    deepWater: ['#2c5c96', {}],
  };
  for (const [id, [base, opts]] of Object.entries(baseTiles)) {
    const isWater = id === 'shallowWater' || id === 'deepWater';
    if (isWater) {
      // Water is animated: expose 3 frames for the renderer's water layer.
      tiles[id] = [0, 1, 2].map((f) => drawWaterTile(base, id.length * 131 + f, f));
      continue;
    }
    const variants: HTMLCanvasElement[] = [];
    const count = id === 'grass' || id === 'dirt' ? 5 : 3;
    for (let v = 0; v < count; v++) {
      variants.push(drawGroundTile(base, (id.length * 7919 + v * 131), opts));
    }
    tiles[id] = variants;
  }
  tiles['wall'] = [drawWallTile()];

  // Nodes.
  const nodes: Record<string, HTMLCanvasElement> = {
    tree: drawTree(),
    rock: drawRock(),
    berry: drawBerryBush(),
    animal: drawAnimal(),
  };

  // Colonists.
  const skins = [
    { skin: '#e8bf96', hair: '#4a2e18', cloth: '#5a7ab0' },
    { skin: '#d9a06a', hair: '#2a2a2a', cloth: '#7a8a4a' },
    { skin: '#c98a5a', hair: '#b0482a', cloth: '#8a4a6a' },
    { skin: '#f0cba8', hair: '#d0b040', cloth: '#3a7a6a' },
  ];
  // Colonist animations: key `c{pal}_{dir}_{anim}` -> frames.
  const colonists: Record<string, HTMLCanvasElement[]> = {};
  const colonistStatic: Record<string, HTMLCanvasElement> = {};
  for (let i = 0; i < skins.length; i++) {
    for (const dir of ['down', 'left', 'right', 'up'] as const) {
      const anims = colonistAnimations(skins[i], dir);
      for (const [anim, frames] of Object.entries(anims)) {
        colonists[`c${i}_${dir}_${anim}`] = frames;
      }
      colonistStatic[`c${i}_${dir}`] = anims.idle[0];
    }
  }

  // Shadows, glow, sparkle, deco.
  const shadows: Record<number, HTMLCanvasElement> = {
    24: blobShadowCanvas(24, 0.42),
    32: blobShadowCanvas(32, 0.45),
  };
  const glow = drawGlow(48);
  const sparkle = drawSparkle(16);
  const deco = [
    drawDeco('grass', 1), drawDeco('grass', 2), drawDeco('grass', 3),
    drawDeco('flower', 4), drawDeco('flower', 5),
    drawDeco('stone', 6), drawDeco('shrub', 7),
  ];

  return { tiles, nodes, colonists, colonistStatic, colonistPalettes: skins, shadows, glow, sparkle, deco };
}

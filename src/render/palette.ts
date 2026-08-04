/** Unified pixel-art engine helpers. One color language, one light direction,
 * one outline rule — shared by every sprite generator so the whole game reads
 * as a single hand-crafted world (per pixel-art-sprites discipline).
 */
export type RGB = [number, number, number];

export const LIGHT_DIR = { x: -1, y: -1 }; // top-left directional light

/** Parse #rrggbb into an RGB tuple. */
export function hex(rgb: string): RGB {
  const n = parseInt(rgb.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

export function toCss(rgb: RGB): string {
  const r = Math.round(rgb[0] * 255);
  const g = Math.round(rgb[1] * 255);
  const b = Math.round(rgb[2] * 255);
  return `rgb(${r},${g},${b})`;
}

/** Adjust luminosity by f with hue-shifting: darker leans cool (blue-gold
 *  shadows), lighter leans warm (gold). Going through HSL keeps saturation
 *  natural instead of the flat, washed look of simple RGB scaling. */
export function shade(rgb: RGB, f: number): RGB {
  // RGB -> HSL (hue in 0..360, sat 0..1, light 0..1)
  const r = rgb[0], g = rgb[1], b = rgb[2];
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0, s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) ;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h /= 6;
  }
  // Map luminosity: multiply the source lightness by f (so f=1 is identical,
  // f<1 darkens in place, f>1 lightens in place).
  const target = Math.max(0.02, Math.min(0.98, l * Math.max(0.05, f)));
  // Hue shift: shadows toward blue (+10), highlights toward gold (-14).
  const hueShift = f < 1 ? 0.035 : f > 1.15 ? -0.04 : 0;
  h = (h + hueShift + 1) % 1;
  // Slightly boost saturation in shadows for richer colour, ease in highlights.
  const sat = f < 1 ? Math.min(1, s * 1.12) : f > 1.15 ? Math.max(0, s * 0.9) : s;
  return hslToRgb(h, sat, target);
}

function hslToRgb(h: number, s: number, l: number): RGB {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = h * 6;
  const X = c * (1 - Math.abs((hp % 2) - 1));
  let r1 = 0, g1 = 0, b1 = 0;
  if (hp < 1) { r1 = c; g1 = X; }
  else if (hp < 2) { r1 = X; g1 = c; }
  else if (hp < 3) { g1 = c; b1 = X; }
  else if (hp < 4) { g1 = X; b1 = c; }
  else if (hp < 5) { r1 = X; b1 = c; }
  else { r1 = c; b1 = X; }
  const m = l - c / 2;
  return [r1 + m, g1 + m, b1 + m];
}

/** 4-step color ramp. */
export function ramp(base: string): { dark: RGB; mid: RGB; light: RGB; highlight: RGB } {
  const c = hex(base);
  return { dark: shade(c, 0.5), mid: c, light: shade(c, 1.35), highlight: shade(c, 1.8) };
}

export function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  return [c, ctx];
}

export function px(ctx: CanvasRenderingContext2D, x: number, y: number, color: RGB | string): void {
  ctx.fillStyle = typeof color === 'string' ? color : toCss(color);
  ctx.fillRect(x, y, 1, 1);
}

/** Draw a soft radial shadow into a new canvas. Returns the canvas. */
export function blobShadowCanvas(size: number, alpha = 0.45): HTMLCanvasElement {
  const [c, ctx] = canvas(size, Math.ceil(size * 0.7));
  const cx = size / 2;
  const cy = c.height * 0.6;
  const radius = size * 0.62;
  const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
  grad.addColorStop(0, `rgba(0,0,0,${alpha})`);
  grad.addColorStop(0.6, `rgba(0,0,0,${alpha * 0.5})`);
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.fill();
  return c;
}

/** 1px dark outline around non-transparent pixels (weight-of-one, consistent). */
export function addOutline(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  outline: RGB,
): void {
  const d = ctx.getImageData(0, 0, w, h).data;
  const solid = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) solid[i] = d[i * 4 + 3] > 0 ? 1 : 0;
  const col = toCss(outline);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = y * w + x;
      if (solid[idx]) continue;
      const n = (x > 0 && solid[y * w + x - 1]) || (x < w - 1 && solid[y * w + x + 1])
        || (y > 0 && solid[(y - 1) * w + x]) || (y < h - 1 && solid[(y + 1) * w + x]);
      if (n) {
        ctx.fillStyle = col;
        ctx.fillRect(x, y, 1, 1);
      }
    }
  }
}

export function tsRand(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return (s & 0xffff) / 0xffff;
  };
}

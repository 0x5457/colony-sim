/** Seeded value-noise + fractal (fBm) used by world generation.
 * Deterministic from a seed; depends only on our own RNG — no external deps.
 */

/** Integer 2D hash → uniform uint32, then normalize to [0,1). Uses only
 * integer ops (via >>>0) so the full 32 bits are filled and well-mixed. */
export function hash2(x: number, y: number): number {
  let a = x | 0;
  let b = y | 0;
  a = (a ^ 0xdeadbeef) + (b << 5);
  a = Math.imul(a ^ (a >>> 12), 0x27d4eb2d);
  b = Math.imul(b ^ (b >>> 19), 0x165667b1);
  a = (a ^ (a >>> 7) ^ b ^ (b >>> 2)) >>> 0;
  return a / 4294967296; // [0,1)
}

/** Single octave value noise in [0,1]. */
export function valueNoise(x: number, y: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  // Smoothstep for C1 continuity.
  const sx = xf * xf * (3 - 2 * xf);
  const sy = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi);
  const b = hash2(xi + 1, yi);
  const c = hash2(xi, yi + 1);
  const d = hash2(xi + 1, yi + 1);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

/** Fractal Brownian motion: sum of octaves. Output roughly in [0,1]. */
export function fbm(
  x: number, y: number,
  octaves: number = 4,
  lacunarity: number = 2.0,
  gain: number = 0.5,
): number {
  let total = 0;
  let amp = 1;
  let freq = 1;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    total += amp * valueNoise(x * freq, y * freq);
    norm += amp;
    amp *= gain;
    freq *= lacunarity;
  }
  return total / norm;
}

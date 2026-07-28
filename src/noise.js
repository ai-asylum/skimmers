/**
 * Classic Perlin gradient noise (2D) plus the fractal helpers the terrain uses.
 *
 * The shoreline wobble in channelrender.js stays on its cheap value noise —
 * that one has to match the water shader's GLSL fbm byte for byte. This module
 * is for the ground itself, where gradient noise's smoother, less blocky
 * profile is what makes the banks read as hills instead of lumps.
 *
 * The permutation table is seeded from a fixed constant, so every player gets
 * the same hills for the same hole.
 */

const PERM = (() => {
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  let seed = 0x5eed1337;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  for (let i = 255; i > 0; i--) {
    const j = (rnd() * (i + 1)) | 0;
    const t = p[i]; p[i] = p[j]; p[j] = t;
  }
  const perm = new Uint8Array(512);
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
  return perm;
})();

// 8 unit-ish gradients; the diagonals are unnormalised on purpose (Perlin's
// own trick — the length bias is cheaper than a sqrt and reads fine)
const GX = [1, -1, 1, -1, 1, -1, 0, 0];
const GY = [1, 1, -1, -1, 0, 0, 1, -1];

const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);

/** classic Perlin noise, roughly -1..1 */
export function perlin2(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const X = xi & 255, Y = yi & 255;
  const u = fade(xf), v = fade(yf);

  const g00 = PERM[X + PERM[Y]] & 7;
  const g10 = PERM[X + 1 + PERM[Y]] & 7;
  const g01 = PERM[X + PERM[Y + 1]] & 7;
  const g11 = PERM[X + 1 + PERM[Y + 1]] & 7;

  const n00 = GX[g00] * xf + GY[g00] * yf;
  const n10 = GX[g10] * (xf - 1) + GY[g10] * yf;
  const n01 = GX[g01] * xf + GY[g01] * (yf - 1);
  const n11 = GX[g11] * (xf - 1) + GY[g11] * (yf - 1);

  const nx0 = n00 + u * (n10 - n00);
  const nx1 = n01 + u * (n11 - n01);
  return (nx0 + v * (nx1 - nx0)) * 1.4142; // spread the range back out to ~-1..1
}

/** fractal Perlin, normalised to ~-1..1 */
export function fbm2(x, y, octaves = 4, lacunarity = 2, gain = 0.5) {
  let s = 0, amp = 0.5, f = 1, norm = 0;
  for (let i = 0; i < octaves; i++) {
    s += amp * perlin2(x * f, y * f);
    norm += amp;
    f *= lacunarity;
    amp *= gain;
  }
  return s / norm;
}

/** ridged fractal Perlin, 0..1 — sharp crests, wide flat-bottomed valleys */
export function ridged2(x, y, octaves = 3) {
  let s = 0, amp = 0.5, f = 1, norm = 0;
  for (let i = 0; i < octaves; i++) {
    const n = 1 - Math.abs(perlin2(x * f, y * f));
    s += amp * n * n;
    norm += amp;
    f *= 2;
    amp *= 0.5;
  }
  return s / norm;
}

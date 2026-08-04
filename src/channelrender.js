/**
 * Shared 2D renderer for the fairway-channel lake shape.
 *
 * Used by both the admin level editor and the in-game minimap so they show the
 * same organic, noise-broken water edge with a sandy beach at the waterline —
 * matching the look of the 3D water shader (src/water.js). The shape itself is
 * channel.js's, so a hole that forks draws both its lines at their own widths;
 * everything else here is that SDF plus fractal value noise on the edge.
 */

import { holeLegs, channelAt } from "./channel.js";

// ---- shoreline-noise config (shared by the shader, editor & minimap) ---------
// Tweak these in the admin Level Editor; they persist in localStorage so the
// game and minimap pick them up on load. `freq` = base frequency of the edge
// wobble, `amp` = how far (world units) it pushes the shoreline in/out.
const NOISE_STORE = "skippidy.shoreline";
export const DEFAULT_NOISE = { freq: 0.05, amp: 7 };
export function getNoise() {
  try { const raw = localStorage.getItem(NOISE_STORE); if (raw) return { ...DEFAULT_NOISE, ...JSON.parse(raw) }; } catch { /* ignore */ }
  return { ...DEFAULT_NOISE };
}
export function setNoise(n) { try { localStorage.setItem(NOISE_STORE, JSON.stringify(n)); } catch { /* ignore */ } }

// ---- fractal value noise (mirrors the shader's hash/noise closely enough) ----
function hash(x, y) { const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return n - Math.floor(n); }
function vnoise(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash(xi, yi), b = hash(xi + 1, yi), c = hash(xi, yi + 1), d = hash(xi + 1, yi + 1);
  return a * (1 - u) * (1 - v) + b * u * (1 - v) + c * (1 - u) * v + d * u * v;
}
export function fbm(x, y) {
  let s = 0, amp = 0.5, f = 1;
  for (let i = 0; i < 4; i++) { s += amp * vnoise(x * f, y * f); f *= 2; amp *= 0.5; }
  return s;
}

/**
 * How far (world units, signed) the shoreline is pushed in or out at (x, z).
 * The water shader, the ground mesh and the lake-bed profile all add this to
 * their distance-to-centreline, so they agree on where the waterline actually
 * falls — mirror any change here in water.js's GLSL.
 */
export function shoreWobble(x, z, freq, amp) {
  return (fbm(x * freq, z * freq) - 0.5) * amp
    + (fbm(x * freq * 3.6, z * freq * 3.6) - 0.5) * amp * 0.34;
}

const COL = {
  deep: [18, 85, 127], shallow: [47, 191, 211], foam: [234, 252, 255], sand: [233, 214, 156],
  rock: [150, 158, 160],
};
function hexRgb(hex) {
  const h = hex.replace("#", "");
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}
const lerp = (a, b, t) => a + (b - a) * t;
const mix3 = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
const sstep = (e0, e1, x) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0 || 1))); return t * t * (3 - 2 * t); };

/**
 * Render the channel lake into an off-screen canvas at `res`×`res`, sampling
 * world space via pxToWorld(u,v) with u,v in [0,1]. Returns the canvas; the
 * caller draws it (scaled) wherever it wants.
 *
 * Pass `heightAt(x, z)` (terrain.js) to shade the banks by elevation, so the
 * map shows which hills are lobbable and which are walls. It's sampled onto a
 * coarse grid and interpolated — per-pixel it would cost more than the rest of
 * the bake put together. `lobClear` is the height where green turns to rock.
 */
export function makeChannelCanvas({ res = 220, pxToWorld, path, width, branches = null, grass = "#7cc45e", sandBand = 4, noiseFreq, noiseAmp, heightAt = null, lobClear = 8 }) {
  const cv = document.createElement("canvas");
  cv.width = cv.height = res;
  const ctx = cv.getContext("2d");
  const img = ctx.createImageData(res, res);
  const data = img.data;
  const grassRgb = hexRgb(grass);
  const grassDark = mix3(grassRgb, [40, 90, 50], 0.35);
  // The channel is legs, so a hole that forks draws as both lines at their own
  // widths — the map has to show the shortcut, or it isn't a choice.
  const legs = path && path.length >= 2 ? holeLegs({ path, branches }, width) : [];
  const cfg = getNoise();
  const f = noiseFreq ?? cfg.freq, a = noiseAmp ?? cfg.amp;

  // coarse elevation grid + bilinear lookup in grid space
  const HG = 72;
  let hg = null;
  if (heightAt) {
    hg = new Float32Array(HG * HG);
    for (let j = 0; j < HG; j++) {
      for (let i = 0; i < HG; i++) {
        const p = pxToWorld((i + 0.5) / HG, (j + 0.5) / HG);
        hg[j * HG + i] = heightAt(p.x, p.z);
      }
    }
  }
  const hAt = (gx, gy) => {
    const cx = Math.min(HG - 1.002, Math.max(0, gx)), cy = Math.min(HG - 1.002, Math.max(0, gy));
    const i = cx | 0, j = cy | 0, tx = cx - i, ty = cy - j;
    const h00 = hg[j * HG + i], h10 = hg[j * HG + i + 1];
    const h01 = hg[(j + 1) * HG + i], h11 = hg[(j + 1) * HG + i + 1];
    return lerp(lerp(h00, h10, tx), lerp(h01, h11, tx), ty);
  };

  for (let py = 0; py < res; py++) {
    for (let px = 0; px < res; px++) {
      const { x, z } = pxToWorld((px + 0.5) / res, (py + 0.5) / res);
      let d, W;
      if (legs.length) { const c = channelAt(legs, x, z); d = c.d; W = c.w; }
      else { d = Math.hypot(x, z); W = width; }
      // fractal edge wobble to break the machined offset
      const wob = (fbm(x * f, z * f) - 0.5) * a + (fbm(x * f * 3.6, z * f * 3.6) - 0.5) * a * 0.34;
      const dw = d + wob;

      let c;
      if (dw < W) {
        // water: deep in the middle, shallow near the bank
        const t = sstep(W * 0.35, W, dw);
        c = mix3(COL.deep, COL.shallow, t * 0.9);
        // foam ribbon just inside the edge
        const foam = sstep(W - 1.9, W - 0.2, dw);
        c = mix3(c, COL.foam, foam * 0.7);
      } else if (dw < W + sandBand) {
        // sandy beach at the transition
        const t = sstep(W, W + sandBand, dw);
        c = mix3(COL.sand, mix3(COL.sand, grassRgb, 0.35), t);
      } else {
        const g = fbm(x * 0.5, z * 0.5);
        c = mix3(grassRgb, grassDark, g * 0.5);
        if (hg) {
          const gx = (px + 0.5) / res * HG - 0.5, gy = (py + 0.5) / res * HG - 0.5;
          const h = hAt(gx, gy);
          c = mix3(c, grassDark, sstep(1, lobClear, h));
          c = mix3(c, COL.rock, sstep(lobClear, lobClear + 6, h));
          // hillshade from the north-west so ridges and passes read at a glance
          const slope = (hAt(gx + 1, gy) - hAt(gx - 1, gy)) + (hAt(gx, gy + 1) - hAt(gx, gy - 1));
          const lit = Math.max(-0.34, Math.min(0.34, -slope * 0.055));
          c = [c[0] * (1 + lit), c[1] * (1 + lit), c[2] * (1 + lit)];
        }
      }
      const o = (py * res + px) * 4;
      data[o] = c[0]; data[o + 1] = c[1]; data[o + 2] = c[2]; data[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return cv;
}

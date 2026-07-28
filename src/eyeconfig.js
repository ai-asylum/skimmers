/**
 * Where the pupils sit inside each face of rock-eyes-grid.png.
 *
 * The faces are hand-drawn at quite different heights inside their cells, so
 * every expression carries its own socket layout: the centre and radius of the
 * left/right eye white, as fractions of the cell (x of cell width, y of cell
 * height, radius of cell width). Radius 0 means that eye is shut — no pupil.
 *
 * Two ways to change these:
 *   - `node scripts/measure-eyes.mjs` re-measures the sheet from scratch and
 *     prints a fresh EYE_SOCKETS block to paste in here. Run it after re-keying
 *     or redrawing the sheet.
 *   - The Eyes Lab at /admin drags the sockets by hand on top of the 3D rock,
 *     saves them to localStorage so a running game picks them up live, and
 *     copies the same block to the clipboard when you're happy.
 */

// average of every readable face — only used for a face with no entry below
export const EYE_FALLBACK_SOCKET = { lx: 0.289, ly: 0.541, rl: 0.122, rx: 0.677, ry: 0.526, rr: 0.122 };

// measured by scripts/measure-eyes.mjs (largest circle that fits in each white)
export const EYE_SOCKETS = {
  neutral: { lx: 0.320, ly: 0.692, rl: 0.143, rx: 0.727, ry: 0.683, rr: 0.146 },
  happy: { lx: 0.318, ly: 0.633, rl: 0.117, rx: 0.674, ry: 0.633, rr: 0.115 },
  angry: { lx: 0.234, ly: 0.713, rl: 0.117, rx: 0.651, ry: 0.716, rr: 0.113 },
  sad: { lx: 0.281, ly: 0.704, rl: 0.128, rx: 0.682, ry: 0.698, rr: 0.125 },
  surprised: { lx: 0.323, ly: 0.516, rl: 0.159, rx: 0.721, ry: 0.516, rr: 0.159 },
  suspicious: { lx: 0.305, ly: 0.569, rl: 0.106, rx: 0.682, ry: 0.566, rr: 0.107 },
  sleepy: { lx: 0.263, ly: 0.487, rl: 0.094, rx: 0.664, ry: 0.490, rr: 0.091 },
  dizzy: { lx: 0.266, ly: 0.537, rl: 0.144, rx: 0.661, ry: 0.528, rr: 0.135 },
  determined: { lx: 0.310, ly: 0.393, rl: 0.109, rx: 0.716, ry: 0.390, rr: 0.112 },
  worried: { lx: 0.286, ly: 0.378, rl: 0.104, rx: 0.661, ry: 0.378, rr: 0.104 },
  wink: { lx: 0.352, ly: 0.384, rl: 0.000, rx: 0.648, ry: 0.384, rr: 0.135 },
  excited: { lx: 0.273, ly: 0.334, rl: 0.125, rx: 0.635, ry: 0.328, rr: 0.122 },
};

// one nudge applied to every face at once, for when the pupils read a touch
// low/small on the 3D stone even though they're centred on the flat sheet
export const EYE_TRIM = { dx: 0, dy: 0, scale: 1 };

export const EYE_TUNING_KEY = "skippidy.eyes.tuning";

const listeners = new Set();
let cached = null;

function readTuning() {
  const base = { trim: { ...EYE_TRIM }, sockets: {} };
  try {
    const raw = JSON.parse(localStorage.getItem(EYE_TUNING_KEY) || "null");
    if (raw?.trim) Object.assign(base.trim, raw.trim);
    if (raw?.sockets) base.sockets = raw.sockets;
  } catch { /* no tuning saved, or storage is unavailable */ }
  return base;
}

/** the live tuning overlay (lab edits on top of the baked defaults) */
export function eyeTuning() {
  if (!cached) cached = readTuning();
  return cached;
}

/** use a tuning overlay right now, without writing it to storage */
export function applyEyeTuning(t) {
  cached = { trim: { ...EYE_TRIM, ...(t?.trim || {}) }, sockets: t?.sockets || {} };
  listeners.forEach((fn) => fn());
}

/** save a tuning overlay and tell every listener (this tab and any others) */
export function saveEyeTuning(t) {
  applyEyeTuning(t);
  try { localStorage.setItem(EYE_TUNING_KEY, JSON.stringify(cached)); } catch { /* ignore */ }
}

/** drop the overlay and fall back to the values baked in above */
export function clearEyeTuning() {
  cached = null;
  try { localStorage.removeItem(EYE_TUNING_KEY); } catch { /* ignore */ }
  listeners.forEach((fn) => fn());
}

export function onEyeTuningChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

if (typeof window !== "undefined") {
  // the lab usually runs in a second tab; pick its edits up live
  window.addEventListener("storage", (e) => {
    if (e.key !== EYE_TUNING_KEY) return;
    cached = null;
    listeners.forEach((fn) => fn());
  });
}

/**
 * Final socket for an expression: its own layout (or `fallback`, normally the
 * runtime-detected average) with any lab edits and the global trim applied.
 */
export function socketFor(name, fallback = EYE_FALLBACK_SOCKET) {
  const t = eyeTuning();
  const s = t.sockets[name] || EYE_SOCKETS[name] || fallback;
  const { dx, dy, scale } = t.trim;
  return {
    lx: s.lx + dx, ly: s.ly + dy, rl: s.rl * scale,
    rx: s.rx + dx, ry: s.ry + dy, rr: s.rr * scale,
  };
}

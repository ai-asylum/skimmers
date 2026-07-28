// Measure where the pupil should sit in every cell of the eye sheet, and print
// a ready-to-paste EYE_SOCKETS block for src/eyeconfig.js.
//
//   node scripts/measure-eyes.mjs [public/rock-eyes-grid.png]
//
// The faces are drawn at noticeably different heights inside their cells, so
// one averaged socket leaves several of them (determined, excited, angry…)
// with pupils sitting well off their whites. Each face gets its own socket
// instead; the shared average survives only as the fallback for a face we
// can't read.
//
// Method: the sheet is keyed (see key-eyes.mjs), so the sclera is exactly the
// opaque near-white pixels. For each half of each cell we take the biggest
// white blob and find its largest inscribed circle — the roundest spot a pupil
// can sit in without poking through the outline. That handles bowls, crescents
// and squints, which a bounding-box centre gets wrong. A half with no enclosed
// white is a shut eye, and gets radius 0 so no pupil is drawn.
import sharp from "sharp";

const FILE = process.argv[2] || "public/rock-eyes-grid.png";
const COLS = 4;
const ROWS = 3;
const NAMES = [
  "neutral", "happy", "angry", "sad",
  "surprised", "suspicious", "sleepy", "dizzy",
  "determined", "worried", "wink", "excited",
];

const { data, info } = await sharp(FILE).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const W = info.width, H = info.height;
const cellW = Math.floor(W / COLS), cellH = Math.floor(H / ROWS);

/** opaque + near-white == sclera (the sheet is keyed, so the page is alpha 0) */
function scleraMask(col, row) {
  const m = new Uint8Array(cellW * cellH);
  for (let y = 0; y < cellH; y++) {
    for (let x = 0; x < cellW; x++) {
      const p = ((row * cellH + y) * W + (col * cellW + x)) * info.channels;
      const a = data[p + 3];
      const lum = 0.299 * data[p] + 0.587 * data[p + 1] + 0.114 * data[p + 2];
      m[y * cellW + x] = a > 100 && lum > 200 ? 1 : 0;
    }
  }
  return m;
}

/** flood-label 4-connected blobs, biggest first */
function blobs(mask) {
  const labels = new Int32Array(cellW * cellH);
  const out = [];
  const stack = [];
  let id = 0;
  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || labels[start]) continue;
    id++;
    stack.length = 0;
    stack.push(start);
    labels[start] = id;
    const px = [];
    let sumX = 0, sumY = 0;
    while (stack.length) {
      const p = stack.pop();
      const x = p % cellW, y = (p / cellW) | 0;
      px.push(p);
      sumX += x; sumY += y;
      if (x > 0 && mask[p - 1] && !labels[p - 1]) { labels[p - 1] = id; stack.push(p - 1); }
      if (x < cellW - 1 && mask[p + 1] && !labels[p + 1]) { labels[p + 1] = id; stack.push(p + 1); }
      if (y > 0 && mask[p - cellW] && !labels[p - cellW]) { labels[p - cellW] = id; stack.push(p - cellW); }
      if (y < cellH - 1 && mask[p + cellW] && !labels[p + cellW]) { labels[p + cellW] = id; stack.push(p + cellW); }
    }
    out.push({ px, cx: sumX / px.length, cy: sumY / px.length, count: px.length });
  }
  return out.sort((a, b) => b.count - a.count);
}

/**
 * Largest inscribed circle of a blob, via a two-pass chamfer distance transform
 * over that blob only. Returns the centre and radius in pixels.
 */
function inscribed(blob) {
  const inside = new Uint8Array(cellW * cellH);
  for (const p of blob.px) inside[p] = 1;
  const D = new Float32Array(cellW * cellH).fill(1e9);
  const at = (x, y) => (x < 0 || y < 0 || x >= cellW || y >= cellH ? 0 : D[y * cellW + x]);
  for (let y = 0; y < cellH; y++) {
    for (let x = 0; x < cellW; x++) {
      const i = y * cellW + x;
      if (!inside[i]) { D[i] = 0; continue; }
      D[i] = Math.min(D[i], at(x - 1, y) + 1, at(x, y - 1) + 1, at(x - 1, y - 1) + 1.414, at(x + 1, y - 1) + 1.414);
    }
  }
  let best = -1, bx = blob.cx, by = blob.cy;
  for (let y = cellH - 1; y >= 0; y--) {
    for (let x = cellW - 1; x >= 0; x--) {
      const i = y * cellW + x;
      if (!inside[i]) continue;
      D[i] = Math.min(D[i], at(x + 1, y) + 1, at(x, y + 1) + 1, at(x + 1, y + 1) + 1.414, at(x - 1, y + 1) + 1.414);
      if (D[i] > best) { best = D[i]; bx = x; by = y; }
    }
  }
  return { x: bx, y: by, r: best };
}

const measured = [];
for (let i = 0; i < NAMES.length; i++) {
  const mask = scleraMask(i % COLS, Math.floor(i / COLS));
  const all = blobs(mask).filter((b) => b.count > cellW * cellH * 0.004);
  const left = all.filter((b) => b.cx < cellW / 2)[0];
  const right = all.filter((b) => b.cx >= cellW / 2)[0];
  const L = left && inscribed(left);
  const R = right && inscribed(right);
  measured.push({
    name: NAMES[i],
    // a shut eye keeps a plausible position but radius 0, so no pupil is drawn
    lx: L ? L.x / cellW : null, ly: L ? L.y / cellH : null, rl: L ? L.r / cellW : 0,
    rx: R ? R.x / cellW : null, ry: R ? R.y / cellH : null, rr: R ? R.r / cellW : 0,
    shutL: !L, shutR: !R,
  });
}

// the average of every readable face — only used for faces we can't read
const seen = { lx: [], ly: [], rx: [], ry: [], rl: [], rr: [] };
for (const m of measured) {
  if (!m.shutL) { seen.lx.push(m.lx); seen.ly.push(m.ly); seen.rl.push(m.rl); }
  if (!m.shutR) { seen.rx.push(m.rx); seen.ry.push(m.ry); seen.rr.push(m.rr); }
}
const avg = (a) => a.reduce((s, v) => s + v, 0) / a.length;
const shared = {
  lx: avg(seen.lx), ly: avg(seen.ly), rl: avg(seen.rl),
  rx: avg(seen.rx), ry: avg(seen.ry), rr: avg(seen.rr),
};
// mirror the readable eye onto a shut one so the socket stays plausible
for (const m of measured) {
  if (m.shutL) { m.lx = m.rx != null ? 1 - m.rx : shared.lx; m.ly = m.ry ?? shared.ly; }
  if (m.shutR) { m.rx = m.lx != null ? 1 - m.lx : shared.rx; m.ry = m.ly ?? shared.ry; }
}

const f3 = (v) => (Math.round(v * 1000) / 1000).toFixed(3);
console.log(`sheet ${W}x${H}, cell ${cellW}x${cellH}\n`);
console.log("fallback socket (average of every readable face):");
console.log(`  left  x ${f3(shared.lx)}  y ${f3(shared.ly)}  r ${f3(shared.rl)}`);
console.log(`  right x ${f3(shared.rx)}  y ${f3(shared.ry)}  r ${f3(shared.rr)}\n`);

console.log("how far each face sits off that average (dy < 0 = drawn high in its cell):");
for (const m of measured) {
  const dy = ((m.ly - shared.ly) + (m.ry - shared.ry)) / 2;
  const dx = ((m.lx - shared.lx) + (m.rx - shared.rx)) / 2;
  const shut = m.shutL ? "  left eye shut" : m.shutR ? "  right eye shut" : "";
  const flag = Math.abs(dy) > 0.05 || Math.abs(dx) > 0.05 ? "  <-- would miss badly on one shared socket" : "";
  console.log(`  ${m.name.padEnd(11)} dx ${f3(dx).padStart(7)}  dy ${f3(dy).padStart(7)}${shut}${flag}`);
}

console.log("\n// paste into src/eyeconfig.js");
console.log("export const EYE_SOCKETS = {");
for (const m of measured) {
  const note = m.shutL ? " // left eye shut" : m.shutR ? " // right eye shut" : "";
  console.log(
    `  ${m.name}: { lx: ${f3(m.lx)}, ly: ${f3(m.ly)}, rl: ${f3(m.rl)}, ` +
    `rx: ${f3(m.rx)}, ry: ${f3(m.ry)}, rr: ${f3(m.rr)} },${note}`
  );
}
console.log("};");

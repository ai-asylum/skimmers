// Sanity check for src/marchingcubes.js: table well-formedness, watertightness,
// winding and enclosed volume. Run with `node scripts/mc-selftest.mjs`.
import { marchCubes } from "../src/marchingcubes.js";

let fails = 0;
const check = (ok, msg) => {
  if (!ok) { fails++; console.log("FAIL:", msg); }
  else console.log("ok  :", msg);
};

// ---- mesh an ellipsoid with a tunnel bored through it -------------------
const nx = 34, ny = 22, nz = 34;
const hx = 1.3, hy = 0.85;
const dx = (2 * hx) / (nx - 1), dy = (2 * hy) / (ny - 1), dz = dx;
const field = new Float32Array(nx * ny * nz);
const THICK = 0.5;
let i = 0;
for (let iy = 0; iy < ny; iy++) {
  const y = -hy + iy * dy;
  for (let iz = 0; iz < nz; iz++) {
    const z = -hx + iz * dz;
    for (let ix = 0; ix < nx; ix++, i++) {
      const x = -hx + ix * dx;
      const len = Math.hypot(x, y, z);
      let v;
      if (len < 1e-5) v = THICK;
      else {
        const uy = y / len;
        const q = (x * x + z * z) / (len * len) + (uy * uy) / (THICK * THICK);
        v = 1 / Math.sqrt(q) - len;
      }
      // bore a vertical tunnel so we exercise a genuine hole, not just a blob
      const rad = Math.hypot(x - 0.3, z);
      v = Math.min(v, rad - 0.22);
      if (ix === 0 || ix === nx - 1 || iy === 0 || iy === ny - 1 || iz === 0 || iz === nz - 1) {
        v = Math.min(v, -0.01);
      }
      field[i] = v;
    }
  }
}

const out = { positions: new Float32Array(1024) };
const t0 = process.hrtime.bigint();
const count = marchCubes(field, nx, ny, nz, -hx, -hy, -hx, dx, dy, dz, 0, out);
const t1 = process.hrtime.bigint();
const p = out.positions;

check(count > 0 && count % 3 === 0, `produced ${count / 3} triangles`);
console.log(`      meshing ${(nx - 1) * (ny - 1) * (nz - 1)} cells took ${Number(t1 - t0) / 1e6}ms`);

// ---- watertight: every directed edge must have exactly one twin ----------
const key = (j) => `${Math.round(p[j * 3] * 1e5)},${Math.round(p[j * 3 + 1] * 1e5)},${Math.round(p[j * 3 + 2] * 1e5)}`;
const edges = new Map();
for (let t = 0; t < count; t += 3) {
  const k = [key(t), key(t + 1), key(t + 2)];
  for (let e = 0; e < 3; e++) {
    const a = k[e], b = k[(e + 1) % 3];
    if (a === b) continue; // degenerate sliver, has no opposite
    edges.set(`${a}|${b}`, (edges.get(`${a}|${b}`) ?? 0) + 1);
  }
}
let unmatched = 0, doubled = 0;
for (const [k, n] of edges) {
  const [a, b] = k.split("|");
  const back = edges.get(`${b}|${a}`) ?? 0;
  if (back !== n) unmatched++;
  if (n > 1) doubled++;
}
check(unmatched === 0, `all ${edges.size} directed edges have a matching twin (${unmatched} unmatched)`);
check(doubled === 0, `no directed edge is used twice (${doubled} doubled)`);

// ---- winding + volume: divergence theorem over the closed surface --------
let vol = 0, outward = 0, inward = 0;
for (let t = 0; t < count; t += 3) {
  const ax = p[t * 3], ay = p[t * 3 + 1], az = p[t * 3 + 2];
  const bx = p[t * 3 + 3], by = p[t * 3 + 4], bz = p[t * 3 + 5];
  const cx = p[t * 3 + 6], cy = p[t * 3 + 7], cz = p[t * 3 + 8];
  const ux = bx - ax, uy = by - ay, uz = bz - az;
  const vx = cx - ax, vy = cy - ay, vz = cz - az;
  const nxx = uy * vz - uz * vy, nyy = uz * vx - ux * vz, nzz = ux * vy - uy * vx;
  vol += (ax * nxx + ay * nyy + az * nzz) / 6;
  // sample well away from the tunnel so "outward" means "away from the core"
  if (Math.hypot(ax - 0.3, az) > 0.5) {
    (ax * nxx + ay * nyy + az * nzz > 0 ? () => outward++ : () => inward++)();
  }
}
check(vol > 0, `enclosed volume is positive (${vol.toFixed(4)}) — triangles wind outward`);
check(outward > inward * 20, `${outward} outward-facing vs ${inward} inward-facing shell triangles`);

// ellipsoid 4/3 pi a b c minus the bored cylinder, roughly
const ideal = (4 / 3) * Math.PI * 1 * THICK * 1 - Math.PI * 0.22 * 0.22 * 2 * THICK * 0.9;
check(Math.abs(vol - ideal) / ideal < 0.06, `volume ${vol.toFixed(3)} within 6% of expected ~${ideal.toFixed(3)}`);

process.exit(fails ? 1 : 0);

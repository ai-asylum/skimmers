/**
 * Smoke-test the throw envelope and the widened playfield without a browser.
 *
 *   • the drag maps onto a launch angle that runs from the flat skipper all the
 *     way up to a mortar, and the steep end comes down perpendicular enough to
 *     skip nothing and go straight under
 *   • every hole's tee, flag and centreline are still water at bed depth, i.e.
 *     the mountain ring gave way to the corridor instead of burying it
 *   • the furnished holes build their props without a renderer, and a stone
 *     thrown down each of them gets somewhere instead of dying on the tee
 *
 * Run with: node scripts/checkthrow.mjs
 */
import * as THREE from "three";
import { simulateThrow, SKIP_ELEV, MAX_ELEV, PERP_ANGLE } from "../src/physics.js";
import { setTerrainPath, terrainHeightAt } from "../src/terrain.js";
import {
  setWaterPath, setWaterFalls, setWaterFlow, setWaterZones,
  waterLevelAt, isWaterAt, currentAt, iceAt, pathTangentAt,
} from "../src/water.js";
import { HoleProps } from "../src/props.js";
import { HOLES, holeFalls, holeZones } from "../src/holes.js";

const clamp01 = (v) => Math.min(1, Math.max(0, v));
const FLAT_ELEV = SKIP_ELEV + 0.10;
const LOFT_SPAN = 0.7;

/** mirror of main.js updateDragAim: vertical drag -> power + launch angle */
function aimFromPull(pull) {
  const power = Math.abs(pull);
  const loft = clamp01(-pull / LOFT_SPAN);
  const elev = pull >= 0
    ? SKIP_ELEV + 0.10 * (1 - power)
    : FLAT_ELEV + (MAX_ELEV - FLAT_ELEV) * loft;
  return { power, elev };
}

const rock = { flat: 0.7, heft: 0.5 };
const water = { heightAt: () => 0 };

// hole 1 runs down the middle of the map, so a throw along -Z stays in water
setTerrainPath(HOLES[0].path, HOLES[0].width);
setWaterPath(HOLES[0].path, HOLES[0].width);
const from = new THREE.Vector3(0, 0.5, 60);
const dir = new THREE.Vector3(0, 0, -1);

console.log("pull    power  elev(deg)  skips  carry  ends");
for (const pull of [1, 0.7, 0.4, 0.15, -0.2, -0.4, -0.7, -1]) {
  const { power, elev } = aimFromPull(pull);
  const sim = simulateThrow(from, dir, power, "skip", rock, water, 0, 8, [], [], elev);
  const last = sim.points.at(-1);
  const carry = Math.hypot(last.x - from.x, last.z - from.z);
  console.log(
    `${pull.toFixed(2).padStart(5)}   ${power.toFixed(2)}   ${((elev * 180) / Math.PI).toFixed(1).padStart(5)}` +
    `      ${String(sim.skips.length).padStart(2)}   ${carry.toFixed(1).padStart(5)}u  ${sim.end}`
  );
}

const mortar = aimFromPull(-1);
const skipper = aimFromPull(1);
const mSim = simulateThrow(from, dir, mortar.power, "skip", rock, water, 0, 8, [], [], mortar.elev);
const sSim = simulateThrow(from, dir, skipper.power, "skip", rock, water, 0, 8, [], [], skipper.elev);
let fail = 0;
const expect = (ok, msg) => { if (!ok) { console.log(`   !! ${msg}`); fail++; } };
expect(mortar.elev > PERP_ANGLE, "a full forward push comes down flatter than PERP_ANGLE");
expect(mSim.skips.length === 0, `a full forward push skipped ${mSim.skips.length} times`);
expect(mSim.end === "sink", `a full forward push ended '${mSim.end}', not a sink`);
expect(sSim.skips.length >= 4, `a full back pull only chained ${sSim.skips.length} hops`);

// every hole has to be actual water end to end, not a trench through a mountain
console.log("\nchannel check (tee / mid / flag ground height, negative = lake bed)");
HOLES.forEach((h, i) => {
  loadHole(h);
  let dry = 0, high = 0, worst = -99;
  for (let s = 0; s < h.path.length - 1; s++) {
    for (let k = 0; k <= 10; k++) {
      const t = k / 10;
      const x = h.path[s].x + (h.path[s + 1].x - h.path[s].x) * t;
      const z = h.path[s].z + (h.path[s + 1].z - h.path[s].z) * t;
      if (!isWaterAt(x, z)) dry++;
      // depth is measured against this stretch of river's own surface, which on
      // a terraced hole is several metres above zero
      const y = terrainHeightAt(x, z) - waterLevelAt(x, z);
      if (y > -1) high++;
      worst = Math.max(worst, y);
    }
  }
  console.log(`hole ${i + 1}: ${dry} dry samples, ${high} shallow samples, shallowest bed ${worst.toFixed(1)}`);
  expect(dry === 0, `hole ${i + 1} centreline leaves the water at ${dry} spots`);
  expect(high === 0, `hole ${i + 1} centreline runs aground at ${high} spots`);
});

// ------------------------------------------------------------------ furniture
/**
 * Stand each furnished hole up for real — props and all — and throw down it.
 * This is the cheapest way to catch a prop that only blows up once something
 * asks it for its collision shape, and to see that the hazards leave a line
 * through rather than bricking the fairway on the first hop.
 */
console.log("\nfurnished holes (props built headless, then a flat throw off the tee)");
const scene = new THREE.Scene();
const props = new HoleProps(scene);
const UP = new THREE.Vector3(0, 1, 0);
HOLES.forEach((h, i) => {
  const furniture = ["falls", "wheels", "bridges", "caves", "logs", "dams", "weeds"]
    .filter((k) => h[k]?.length);
  if (!furniture.length) return;
  loadHole(h);
  props.setHole(h, h.width);
  props.update(1 / 60, 1, null);

  const lvl = waterLevelAt(h.path[0].x, h.path[0].z);
  const teeAt = new THREE.Vector3(h.path[0].x, lvl + 0.5, h.path[0].z);
  const down = new THREE.Vector3(h.path[1].x - h.path[0].x, 0, h.path[1].z - h.path[0].z).normalize();
  // the same static set main.js bakes: spires plus anything the props planted
  const solids = [
    ...h.rocks.map((r) => ({ ...r, h: r.h + waterLevelAt(r.x, r.z) })), // as main.bakeHoleGeometry
    ...props.solids,
  ];
  // Fan the aim across the channel rather than firing straight down the middle.
  // A central pier or a mill wheel is *supposed* to eat the lazy throw; what
  // matters is that some line off the tee still gets a stone down the river.
  // Fine enough to find a notch in a beaver dam, which is the tightest gap any
  // hole asks for: a 3u opening 20u away is about 0.07rad of aim.
  let best = 0, bestEnd = "none";
  for (let yaw = -0.3; yaw <= 0.3001; yaw += 0.05) {
    const aim = down.clone().applyAxisAngle(UP, yaw);
    const sim = simulateThrow(teeAt, aim, 0.9, "skip", rock, water, 0, 12, [], solids, null, undefined, props.ceilings);
    const last = sim.points.at(-1);
    const carry = Math.hypot(last.x - teeAt.x, last.z - teeAt.z);
    if (carry > best) { best = carry; bestEnd = `${sim.skips.length} hops, ends '${sim.end}'`; }
  }
  console.log(
    `hole ${i + 1}: ${furniture.join("+")} — ${props.solids.length} pillars, ` +
    `${props.ceilings.length} roofs, ${props.falls.length} lips  ->  best line ${best.toFixed(1)}u (${bestEnd})`
  );
  expect(best > 25, `hole ${i + 1} has no line off the tee (best ${best.toFixed(1)}u)`);
  for (const c of props.ceilings) {
    expect(c.y > waterLevelAt(c.x, c.z) + 1.2, `hole ${i + 1} has a roof too low to skip under (${c.kind} at ${c.y.toFixed(1)})`);
  }
  for (const s of props.solids) {
    expect(s.h > waterLevelAt(s.x, s.z), `hole ${i + 1} has a ${s.kind ?? "pillar"} submerged in its own channel`);
  }
});

// ------------------------------------------------------------------ moving water
/**
 * The current, checked as a field rather than through a stone: it is consulted
 * once per racer per frame and everything downstream of it (drift, washing up,
 * being tipped over a lip) is only as sane as the vectors are.
 */
console.log("\nmoving water (the flow field, sampled on the holes that have one)");
for (const h of HOLES.filter((x) => x.flow)) {
  loadHole(h);
  const i = HOLES.indexOf(h);
  const at = (x, z) => { const v = currentAt(x, z); return { v, sp: Math.hypot(v[0], v[1]) }; };
  // Down the middle of the opening leg, and hard against the bank beside it —
  // but off the ice, which is *supposed* to have no current under it, so
  // measuring there would only prove the lid works.
  const a = h.path[0], b = h.path[1];
  let t = 0.5;
  while (t < 0.95 && iceAt(a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t) >= 0.5) t += 0.05;
  const mx = a.x + (b.x - a.x) * t, mz = a.z + (b.z - a.z) * t;
  const ux = (b.x - a.x), uz = (b.z - a.z);
  const l = Math.hypot(ux, uz);
  const nx = -uz / l, nz = ux / l;
  const spine = at(mx, mz);
  const bank = at(mx + nx * (h.width - 0.5), mz + nz * (h.width - 0.5));
  const dot = (spine.v[0] * ux + spine.v[1] * uz) / (l * (spine.sp || 1));
  expect(spine.sp > 0.5, `hole ${i + 1}: no current on the spine`);
  expect(dot > 0.9, `hole ${i + 1}: the current is not running downstream (dot ${dot.toFixed(2)})`);
  expect(bank.sp < spine.sp * 0.35, `hole ${i + 1}: the bank is as quick as the spine`);
  expect(at(mx + nx * (h.width + 8), mz + nz * (h.width + 8)).sp === 0,
    `hole ${i + 1}: dry land has a current on it`);

  // in the lee of a spire the river should turn round and run back up — each
  // one measured along the flow where *it* stands, not the opening leg's
  let eddy = 0;
  for (const o of h.rocks) {
    const [tx, tz] = pathTangentAt(o.x, o.z);
    const p = at(o.x + tx * o.r * 1.4, o.z + tz * o.r * 1.4);
    if ((p.v[0] * tx + p.v[1] * tz) < 0) eddy++;
  }
  // ...and a stone left floating on it should walk itself downstream
  const start = { x: mx, z: mz };
  let px = mx, pz = mz;
  for (let t = 0; t < 4; t += 1 / 60) {
    const v = currentAt(px, pz);
    px += v[0] / 60; pz += v[1] / 60;
  }
  const flag = h.path.at(-1);
  const gained = Math.hypot(flag.x - start.x, flag.z - start.z) - Math.hypot(flag.x - px, flag.z - pz);
  console.log(
    `hole ${i + 1}: flow ${h.flow} — spine ${spine.sp.toFixed(1)}u/s, bank ${bank.sp.toFixed(1)}u/s, ` +
    `${eddy}/${h.rocks.length} spires shed a back-eddy, a parked stone gains ${gained.toFixed(1)}u in 4s`
  );
  expect(gained > 2, `hole ${i + 1}: a stone left on the current goes nowhere`);
  expect(eddy >= Math.ceil(h.rocks.length / 2),
    `hole ${i + 1}: only ${eddy} of ${h.rocks.length} spires give any shelter`);
}

// and the frozen holes: the sheet has to be somewhere a stone can reach, and
// wide enough that arriving on it is not a coin flip
for (const h of HOLES.filter((x) => x.ice?.length)) {
  loadHole(h);
  const i = HOLES.indexOf(h);
  let covered = 0, samples = 0;
  for (let s = 0; s < h.path.length - 1; s++) {
    for (let k = 0; k < 10; k++) {
      const t = k / 10;
      const x = h.path[s].x + (h.path[s + 1].x - h.path[s].x) * t;
      const z = h.path[s].z + (h.path[s + 1].z - h.path[s].z) * t;
      samples++;
      if (iceAt(x, z) >= 0.5) covered++;
    }
  }
  const pct = (covered / samples) * 100;
  console.log(`hole ${i + 1}: ${h.ice.length} sheets covering ${pct.toFixed(0)}% of the centreline`);
  expect(pct > 12, `hole ${i + 1}: the ice barely touches the fairway (${pct.toFixed(0)}%)`);
  expect(pct < 70, `hole ${i + 1}: the hole is more curling rink than river (${pct.toFixed(0)}%)`);
}

function loadHole(h) {
  setTerrainPath(h.path, h.width);
  setWaterPath(h.path, h.width);
  setWaterFalls(holeFalls(h)); // dams are lips too
  setWaterFlow(h.flow, [...(h.rocks ?? []), ...(h.islands ?? [])]);
  setWaterZones(holeZones(h));
  setTerrainPath(h.path, h.width); // the terrace lift only exists once the falls do
}

console.log(fail ? `\n${fail} FAILED` : "\nall good");
process.exit(fail ? 1 : 0);

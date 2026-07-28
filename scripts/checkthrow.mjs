/**
 * Smoke-test the throw envelope and the widened playfield without a browser.
 *
 *   • the drag maps onto a launch angle that runs from the flat skipper all the
 *     way up to a mortar, and the steep end comes down perpendicular enough to
 *     skip nothing and go straight under
 *   • every hole's tee, flag and centreline are still water at bed depth, i.e.
 *     the mountain ring gave way to the corridor instead of burying it
 *
 * Run with: node scripts/checkthrow.mjs
 */
import * as THREE from "three";
import { simulateThrow, SKIP_ELEV, MAX_ELEV, PERP_ANGLE } from "../src/physics.js";
import { setTerrainPath, terrainHeightAt } from "../src/terrain.js";
import { setWaterPath, isWaterAt } from "../src/water.js";
import { HOLES } from "../src/holes.js";

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
  setTerrainPath(h.path, h.width);
  setWaterPath(h.path, h.width);
  let dry = 0, high = 0, worst = -99;
  for (let s = 0; s < h.path.length - 1; s++) {
    for (let k = 0; k <= 10; k++) {
      const t = k / 10;
      const x = h.path[s].x + (h.path[s + 1].x - h.path[s].x) * t;
      const z = h.path[s].z + (h.path[s + 1].z - h.path[s].z) * t;
      if (!isWaterAt(x, z)) dry++;
      const y = terrainHeightAt(x, z);
      if (y > -1) high++;
      worst = Math.max(worst, y);
    }
  }
  console.log(`hole ${i + 1}: ${dry} dry samples, ${high} shallow samples, shallowest bed ${worst.toFixed(1)}`);
  expect(dry === 0, `hole ${i + 1} centreline leaves the water at ${dry} spots`);
  expect(high === 0, `hole ${i + 1} centreline runs aground at ${high} spots`);
});

console.log(fail ? `\n${fail} FAILED` : "\nall good");
process.exit(fail ? 1 : 0);

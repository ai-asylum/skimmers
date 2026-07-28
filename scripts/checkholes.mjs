/**
 * Sanity-check the authored fairways in src/holes.js.
 *
 * A hole should read as one long river: it marches from tee to flag and gets
 * its interest from kinks and doglegs, never by curling back on itself. This
 * checks that (straightness), that it stays inside the terrain's mountain ring
 * (maxR), that its legs are long enough for a bend to read as a bend, and that
 * every authored island / spire actually sits in the water it is meant to be in.
 *
 * Run with: node scripts/checkholes.mjs
 */
import { HOLES } from "../src/holes.js";

const PLAY_R = 88; // keep every waypoint inside this, see terrain.js MOUNT_INSET
const MIN_STRAIGHTNESS = 0.72; // chord / walked length — below this it loops
const MIN_LEG = 26; // shorter than this and a "bend" is just a wobble
const MAX_TURN = 80; // degrees; past this the elbow folds back on itself

function distToPath(x, z, path) {
  let d = Infinity;
  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i], b = path[i + 1];
    const bax = b.x - a.x, baz = b.z - a.z;
    const pax = x - a.x, paz = z - a.z;
    const h = Math.min(1, Math.max(0, (pax * bax + paz * baz) / (bax * bax + baz * baz || 1)));
    d = Math.min(d, Math.hypot(pax - bax * h, paz - baz * h));
  }
  return d;
}

let bad = 0;
HOLES.forEach((h, hi) => {
  const p = h.path;
  const warn = [];
  let total = 0, maxR = 0, minLeg = Infinity, maxTurn = 0;

  for (let i = 1; i < p.length; i++) {
    const l = Math.hypot(p[i].x - p[i - 1].x, p[i].z - p[i - 1].z);
    total += l;
    minLeg = Math.min(minLeg, l);
  }
  for (const pt of p) maxR = Math.max(maxR, Math.hypot(pt.x, pt.z));
  for (let i = 1; i < p.length - 1; i++) {
    const ax = p[i].x - p[i - 1].x, az = p[i].z - p[i - 1].z;
    const bx = p[i + 1].x - p[i].x, bz = p[i + 1].z - p[i].z;
    const ang = Math.abs(Math.atan2(ax * bz - az * bx, ax * bx + az * bz));
    maxTurn = Math.max(maxTurn, (ang * 180) / Math.PI);
  }
  const chord = Math.hypot(p.at(-1).x - p[0].x, p.at(-1).z - p[0].z);
  const straight = chord / total;

  if (maxR > PLAY_R) warn.push(`maxR ${maxR.toFixed(1)} > ${PLAY_R}`);
  if (straight < MIN_STRAIGHTNESS) warn.push(`straightness ${straight.toFixed(2)} — loops back`);
  if (minLeg < MIN_LEG) warn.push(`leg ${minLeg.toFixed(0)}u too short`);
  if (maxTurn > MAX_TURN) warn.push(`turn ${maxTurn.toFixed(0)}deg folds back`);
  if (p.length > 32) warn.push(`${p.length} pts > shader cap 32`);

  // islands are rest stops: they must sit on the centreline. spires are
  // hazards in the channel: in the water, but not plugging the whole width.
  for (const isl of h.islands) {
    const d = distToPath(isl.x, isl.z, p);
    if (d > 3) warn.push(`island (${isl.x},${isl.z}) is ${d.toFixed(1)}u off the line`);
  }
  for (const o of h.rocks) {
    const d = distToPath(o.x, o.z, p);
    if (d - o.r > h.width - 1) warn.push(`spire (${o.x},${o.z}) is beached (${d.toFixed(1)}u out)`);
    if (d + o.r > h.width && d - o.r < -h.width) warn.push(`spire (${o.x},${o.z}) plugs the channel`);
    for (const isl of h.islands) {
      if (Math.hypot(o.x - isl.x, o.z - isl.z) < o.r + isl.r) warn.push(`spire (${o.x},${o.z}) sits on an island`);
    }
  }

  if (warn.length) bad++;
  console.log(
    `hole ${hi + 1}: ${p.length} pts  len ${total.toFixed(0)}u  straightness ${straight.toFixed(2)}  ` +
    `maxR ${maxR.toFixed(0)}  leg ${minLeg.toFixed(0)}u  turn ${maxTurn.toFixed(0)}deg  ` +
    `${h.islands.length} isl  ${h.rocks.length} spires  time ${h.time}s`
  );
  for (const w of warn) console.log(`   !! ${w}`);
});
process.exit(bad ? 1 : 0);

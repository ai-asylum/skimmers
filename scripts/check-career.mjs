/**
 * Smoke-test the career data without a browser:
 *
 *   • all 30 upgrades are real — each one moves the mods object, none is a
 *     duplicate of another, and two fitted at once stack instead of clobbering
 *   • every cosmetic is buyable and uniquely named
 *   • all 16 cup×class courses are still swimmable after the mirror/reverse/
 *     narrow transforms: centreline in water, bed deep, obstacles off the line
 *   • the payout curve rewards finishing higher and racing a harder class
 *   • the save round-trips, and refuses to hand out what you can't afford
 *
 * Run with: node scripts/check-career.mjs
 */
import { existsSync } from "node:fs";
import * as THREE from "three";
import { DEFAULT_MODS, UPGRADES, resolveMods } from "../src/upgrades.js";
import { simulateThrow } from "../src/physics.js";
import { HOLES } from "../src/holes.js";
import { HATS, FLOATERS, TRAILS } from "../src/cosmetics.js";
import { CUPS, TIERS, buildCourse, payoutFor } from "../src/cups.js";
import { setTerrainPath, terrainHeightAt } from "../src/terrain.js";
import { setWaterPath, isWaterAt } from "../src/water.js";

let fail = 0;
const expect = (cond, msg) => {
  console.log(`${cond ? "ok  " : "FAIL"}: ${msg}`);
  if (!cond) fail++;
};
const note = (msg) => console.log(`      ${msg}`);

const diff = (mods) => Object.keys(mods)
  .filter((k) => JSON.stringify(mods[k]) !== JSON.stringify(DEFAULT_MODS[k]))
  .sort();

// ------------------------------------------------------------------ upgrades
console.log("\n-- upgrades --");
expect(UPGRADES.length === 30, `there are 30 of them (${UPGRADES.length})`);

const ids = new Set(UPGRADES.map((u) => u.id));
expect(ids.size === UPGRADES.length, "every id is unique");

const shapes = new Map();
let inert = [];
for (const u of UPGRADES) {
  const mods = resolveMods([u.id]);
  const touched = diff(mods);
  if (!touched.length) inert.push(u.id);
  const key = touched.map((k) => `${k}=${JSON.stringify(mods[k])}`).join("|");
  if (shapes.has(key)) note(`!! ${u.id} does exactly what ${shapes.get(key)} does`);
  shapes.set(key, u.id);
}
expect(inert.length === 0, `every upgrade actually changes something${inert.length ? ` (dead: ${inert})` : ""}`);
expect(shapes.size === UPGRADES.length, `no two upgrades are the same part (${shapes.size} distinct effects)`);

const badText = UPGRADES.filter((u) => !u.name || !u.icon || !u.blurb || !(u.cost > 0) || !u.tag);
expect(badText.length === 0, `all 30 have a name, icon, blurb, price and category${badText.length ? ` (${badText.map((u) => u.id)})` : ""}`);

const costs = UPGRADES.map((u) => u.cost);
note(`prices run ${Math.min(...costs)} – ${Math.max(...costs)} shells`);

// two in the sockets must both land, not fight over the object
const pair = resolveMods(["heavyhand", "cannonball"]);
const solo = [diff(resolveMods(["heavyhand"])), diff(resolveMods(["cannonball"]))];
const union = [...new Set([...solo[0], ...solo[1]])].sort();
expect(JSON.stringify(diff(pair)) === JSON.stringify(union),
  `a full pair of sockets stacks (${diff(pair).join(", ")})`);

// a bogus id must not poison the run
expect(diff(resolveMods(["heavyhand", "nonsense"])).length === solo[0].length,
  "an upgrade id that no longer exists is simply ignored");

const byTag = new Map();
for (const u of UPGRADES) byTag.set(u.tag, (byTag.get(u.tag) ?? 0) + 1);
note("categories: " + [...byTag].map(([t, n]) => `${t}×${n}`).join(", "));

// ------------------------------------------------------------------ cosmetics
console.log("\n-- cosmetics --");
for (const [kind, set] of [["hats", HATS], ["floaters", FLOATERS], ["trails", TRAILS]]) {
  const uniq = new Set(set.map((c) => c.id));
  const free = set.filter((c) => c.cost === 0);
  expect(uniq.size === set.length && set.every((c) => c.name && c.icon && c.blurb),
    `${set.length} ${kind}, each with a unique id and a shop card`);
  expect(free.length === 1, `exactly one ${kind.slice(0, -1)} is free to start on (${free.map((f) => f.id)})`);
}

// ------------------------------------------------------------------ courses
console.log("\n-- courses --");
/**
 * How far `p` sits to the side of the centreline, and how far along it is.
 * `width` is the channel's half-width, so a gap is what's left of `width ± off`
 * once the obstacle's radius is taken out of it.
 */
function offsetFromPath(path, p) {
  let best = Infinity, off = 0;
  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i], b = path[i + 1];
    const dx = b.x - a.x, dz = b.z - a.z;
    const len2 = dx * dx + dz * dz || 1;
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / len2));
    const cx = a.x + dx * t, cz = a.z + dz * t;
    const d = Math.hypot(p.x - cx, p.z - cz);
    if (d < best) { best = d; off = ((p.x - cx) * -dz + (p.z - cz) * dx) / Math.sqrt(len2); }
  }
  return off;
}

const ROCK_LANE = 2.5; // a stone plus a little air: the narrowest gap worth calling a gap
let courses = 0, dryTotal = 0, agroundTotal = 0, blocked = 0, tightest = Infinity;
for (const cup of CUPS) {
  for (const tier of TIERS) {
    const course = buildCourse(cup, tier);
    if (course.length !== 3) { expect(false, `${cup.id}/${tier.id} built ${course.length} holes`); continue; }
    for (const h of course) {
      courses++;
      setTerrainPath(h.path, h.width);
      setWaterPath(h.path, h.width);
      let dry = 0, aground = 0;
      for (let s = 0; s < h.path.length - 1; s++) {
        for (let k = 0; k <= 12; k++) {
          const t = k / 12;
          const x = h.path[s].x + (h.path[s + 1].x - h.path[s].x) * t;
          const z = h.path[s].z + (h.path[s + 1].z - h.path[s].z) * t;
          if (!isWaterAt(x, z)) dry++;
          if (terrainHeightAt(x, z) > -1) aground++;
        }
      }
      dryTotal += dry; agroundTotal += aground;
      // narrowing must never wall the river off: something has to be able to
      // get past every island and spire, on one side or the other
      for (const o of [...(h.islands ?? []), ...(h.rocks ?? [])]) {
        if (!isWaterAt(o.x, o.z)) continue; // beached props are scenery, fine
        const off = offsetFromPath(h.path, o);
        const gap = Math.max(h.width + off, h.width - off) - (o.r ?? 1.2);
        tightest = Math.min(tightest, gap);
        if (gap < ROCK_LANE) blocked++;
      }
    }
  }
}
expect(courses === CUPS.length * TIERS.length * 3, `${courses} courses generated across every cup and class`);
expect(dryTotal === 0, `every centreline stays in the water (${dryTotal} dry samples)`);
expect(agroundTotal === 0, `no course runs aground after narrowing (${agroundTotal} shallow samples)`);
expect(blocked === 0, `every obstacle can still be got round (${blocked} walled off)`);
note(`tightest gap anywhere in the career: ${tightest.toFixed(1)}u`);

const names = CUPS.flatMap((c) => c.tracks.map((t) => t.name));
expect(new Set(names).size === names.length, `all ${names.length} tracks are named differently`);

// the picker card is nothing but its art, so a missing file is a blank card
const artless = CUPS.filter((c) => !c.art || !existsSync(new URL(`../public/${c.art}`, import.meta.url)));
expect(artless.length === 0, `every cup has its backdrop on disk (${artless.map((c) => c.id).join(", ") || "all four"})`);

// mirroring twice comes back round: the top class un-mirrors an already
// mirrored cup, which is the whole trick
const wp = buildCourse(CUPS[3], TIERS[0])[0].path[1].x;
const wpTop = buildCourse(CUPS[3], TIERS[3])[0].path[1].x;
expect(Math.sign(wp) === -Math.sign(wpTop), "the top class flips a mirrored cup back the other way");

const clock = [TIERS[0], TIERS[3]].map((t) => buildCourse(CUPS[0], t)[0].time);
expect(clock[0] > clock[1], `the clock tightens as you climb (${clock[0]}s → ${clock[1]}s)`);

// ------------------------------------------------------------------ in flight
// the mods object is only worth anything if the flight maths reads it, so fly a
// stone down hole 1 with each part fitted and see the numbers move
console.log("\n-- in flight --");
setTerrainPath(HOLES[0].path, HOLES[0].width);
setWaterPath(HOLES[0].path, HOLES[0].width);
const stone = { flat: 0.62, heft: 0.5 };
const flatWater = { heightAt: () => 0 };
const tee = new THREE.Vector3(0, 0.5, 78);
const downstream = new THREE.Vector3(0, 0, -1);

function fly(ids, power = 0.72) {
  const sim = simulateThrow(tee, downstream, power, "skip", stone, flatWater, 0, 9, [], [], null, resolveMods(ids));
  const last = sim.points.at(-1);
  return { skips: sim.skips.length, carry: Math.hypot(last.x - tee.x, last.z - tee.z) };
}

const stock = fly([]);
note(`a stock throw at 72% power: ${stock.skips} hops, ${stock.carry.toFixed(1)}u`);

const flightChecks = [
  ["hotarm", "carry", "leaves the hand faster"],
  ["cannonball", "carry", "hits harder off the tee"],
  ["longskip", "carry", "holds speed through the chain"],
  ["chainreaction", "carry", "kicks every third hop"],
  ["everburn", "carry", "burns along once it's going"],
  ["polished", "skips", "skips off entries that used to sink"],
];
for (const [id, field, why] of flightChecks) {
  const got = fly([id]);
  const better = got[field] > stock[field];
  expect(better, `${id} ${why}: ${field} ${stock[field].toFixed?.(1) ?? stock[field]} → ${got[field].toFixed?.(1) ?? got[field]}`);
}

// a weak flick is exactly what Heavy Hand is for, so judge it on one
const weakStock = fly([], 0.18), weakHeavy = fly(["heavyhand"], 0.18);
expect(weakHeavy.carry > weakStock.carry * 1.15,
  `heavyhand rescues a limp flick: ${weakStock.carry.toFixed(1)}u → ${weakHeavy.carry.toFixed(1)}u`);

// and the preview has to lie about none of it, or the dotted line is a fiction
const both = fly(["hotarm", "longskip"]);
expect(both.carry > fly(["hotarm"]).carry && both.carry > fly(["longskip"]).carry,
  `two fitted parts beat either alone (${both.carry.toFixed(1)}u)`);

// ------------------------------------------------------------------ payout
console.log("\n-- payout --");
const purse = (place, tier, extra = {}) => payoutFor({
  place, racers: 8, points: 30 - place * 3, holesWon: place === 1 ? 3 : 1, tier, ...extra,
}).total;
const first = purse(1, TIERS[0]), last = purse(8, TIERS[0]);
expect(first > last, `winning pays better than trailing (${first} vs ${last})`);
let climbs = true;
for (let i = 1; i < TIERS.length; i++) if (purse(1, TIERS[i]) <= purse(1, TIERS[i - 1])) climbs = false;
expect(climbs, "each class up pays more for the same result: " + TIERS.map((t) => purse(1, t)).join(" → "));
expect(purse(1, TIERS[0], { firstClear: true }) > first, "the first clear of a cup pays a one-off bonus");
expect(purse(8, TIERS[0]) > 0, `even last place goes home with something (${last})`);

// ------------------------------------------------------------------ the save
console.log("\n-- the save --");
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};
const meta = await import("../src/meta.js");

meta.addShells(500);
expect(meta.shells() === 500, "shells bank");
expect(meta.unlockUpgrade("heavyhand", 200) && meta.shells() === 300, "buying an upgrade takes the price out");
expect(!meta.unlockUpgrade("cannonball", 9999) && meta.shells() === 300, "and a purchase you can't afford is refused whole");
expect(meta.hasUpgrade("heavyhand"), "the unlock sticks");

meta.toggleUpgrade(0, "heavyhand");
meta.equipCosmetic(0, "hat", "crown");
expect(meta.loadoutFor(0).up[0] === "heavyhand" && meta.loadoutFor(0).hat === "crown", "slot 0 remembers its kit");
expect(meta.loadoutFor(1).up[0] === null, "and slot 1 is untouched by it");

meta.unlockUpgrade("gyro", 0);
meta.toggleUpgrade(0, "gyro");
meta.unlockUpgrade("farsight", 0);
meta.toggleUpgrade(0, "farsight");
expect(meta.loadoutFor(0).up.filter(Boolean).length === 2, "a third part can't be forced into two sockets");

meta.recordCup("pebble", "calm", 2, false);
meta.recordCup("pebble", "calm", 1, true);
expect(meta.cupRecord("pebble", "calm") === 1, "the book keeps your best finish, not your last");
meta.recordCup("pebble", "calm", 5, false);
expect(meta.cupRecord("pebble", "calm") === 1, "and a bad day later doesn't erase it");

// reload from the raw json the way a fresh page would
const raw = store.get("skippidy.meta.v1");
expect(!!raw && JSON.parse(raw).shells === 300, "it all went to disk");
meta.resetMeta();
expect(meta.shells() === 0 && !meta.hasUpgrade("heavyhand"), "and a wipe really wipes");

console.log(fail ? `\n${fail} FAILED` : "\nall good");
process.exit(fail ? 1 : 0);

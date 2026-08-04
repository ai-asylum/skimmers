/**
 * Smoke-test the career data without a browser:
 *
 *   • all 30 upgrades are real — each one moves the mods object, none is a
 *     duplicate of another, two fitted at once stack instead of clobbering, and
 *     each has its garage illustration on disk
 *   • every cosmetic is buyable and uniquely named
 *   • all 16 cup×class courses are still swimmable after the mirror/reverse/
 *     narrow transforms: centreline in water, bed deep, obstacles off the line
 *   • every cup dresses its holes in a complete, distinct biome (biomes.js)
 *   • the payout curve rewards finishing higher and racing a harder class
 *   • the save round-trips, and refuses to hand out what you can't afford
 *
 * Run with: node scripts/check-career.mjs
 */
import { existsSync } from "node:fs";
import * as THREE from "three";
import { DEFAULT_MODS, UPGRADES, resolveMods } from "../src/upgrades.js";
import { simulateThrow } from "../src/physics.js";
import { HOLES, holeFalls } from "../src/holes.js";
import { HATS, FLOATERS, TRAILS } from "../src/cosmetics.js";
import { CUPS, TIERS, buildCourse, payoutFor } from "../src/cups.js";
import { holeWarnings } from "../src/holerules.js";
import { BIOMES, BIOME_IDS, DEFAULT_BIOME, biomeFor } from "../src/biomes.js";
import { setTerrainPath, terrainHeightAt } from "../src/terrain.js";
import { setWaterPath, setWaterFalls, waterLevelAt, isWaterAt } from "../src/water.js";

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

const badText = UPGRADES.filter((u) => !u.name || !u.blurb || !(u.cost > 0) || !u.tag);
expect(badText.length === 0, `all 30 have a name, blurb, price and category${badText.length ? ` (${badText.map((u) => u.id)})` : ""}`);

const costs = UPGRADES.map((u) => u.cost);
note(`prices run ${Math.min(...costs)} – ${Math.max(...costs)} shells`);

// the garage card leads with its illustration and has no emoji to fall back on,
// so a missing file is an empty box (scripts/gen-upgrade-art.mjs draws them)
const undrawn = UPGRADES.filter((u) => !existsSync(new URL(`../public/upgrades/${u.id}.png`, import.meta.url)));
expect(undrawn.length === 0, `every upgrade has its art on disk (${undrawn.map((u) => u.id).join(", ") || `all ${UPGRADES.length}`})`);

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
  expect(uniq.size === set.length && set.every((c) => c.name && c.blurb),
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
let branches = 0, branchTightest = Infinity;
for (const cup of CUPS) {
  for (const tier of TIERS) {
    const course = buildCourse(cup, tier);
    if (course.length !== 3) { expect(false, `${cup.id}/${tier.id} built ${course.length} holes`); continue; }
    for (const h of course) {
      courses++;
      setTerrainPath(h.path, h.width, h.branches);
      setWaterPath(h.path, h.width, h.branches);
      // the falls have to go on before anything is measured: they are what
      // makes the bed and the surface step, and a terraced hole checked flat
      // would look a dozen metres aground on its own top shelf
      setWaterFalls(holeFalls(h));
      let dry = 0, aground = 0;
      for (let s = 0; s < h.path.length - 1; s++) {
        for (let k = 0; k <= 12; k++) {
          const t = k / 12;
          const x = h.path[s].x + (h.path[s + 1].x - h.path[s].x) * t;
          const z = h.path[s].z + (h.path[s + 1].z - h.path[s].z) * t;
          if (!isWaterAt(x, z)) dry++;
          if (terrainHeightAt(x, z) - waterLevelAt(x, z) > -1) aground++;
        }
      }
      // a shortcut is water too: it gets narrowed by the class along with the
      // river, and a class that narrows it into the mud has taken the choice
      // away rather than made it harder
      for (const b of h.branches ?? []) {
        for (let s = 0; s < b.path.length - 1; s++) {
          for (let k = 0; k <= 12; k++) {
            const t = k / 12;
            const x = b.path[s].x + (b.path[s + 1].x - b.path[s].x) * t;
            const z = b.path[s].z + (b.path[s + 1].z - b.path[s].z) * t;
            if (!isWaterAt(x, z)) dry++;
            if (terrainHeightAt(x, z) - waterLevelAt(x, z) > -1) aground++;
          }
        }
        branchTightest = Math.min(branchTightest, b.width);
        branches++;
      }
      dryTotal += dry; agroundTotal += aground;
      // narrowing must never wall the river off: something has to be able to
      // get past every island, spire and mill wheel, on one side or the other
      const inTheWay = [
        ...(h.islands ?? []), ...(h.rocks ?? []),
        ...(h.wheels ?? []).map((w) => ({ x: w.x, z: w.z, r: 1.6 })),
      ];
      for (const o of inTheWay) {
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
expect(branches > 0, `the career has shortcuts in it (${branches} across every cup and class)`);
expect(branchTightest >= 4, `the tightest shortcut is still throwable (${branchTightest.toFixed(1)}u half-width)`);

const names = CUPS.flatMap((c) => c.tracks.map((t) => t.name));
expect(new Set(names).size === names.length, `all ${names.length} tracks are named differently`);

// the picker card is nothing but its art, so a missing file is a blank card
const artless = CUPS.filter((c) => !c.art || !existsSync(new URL(`../public/${c.art}`, import.meta.url)));
expect(artless.length === 0, `every cup has its backdrop on disk (${artless.map((c) => c.id).join(", ") || `all ${CUPS.length}`})`);

// and the same for the class thumbs (scripts/gen-class-art.mjs)
const tierArtless = TIERS.filter((t) => !t.art || !existsSync(new URL(`../public/${t.art}`, import.meta.url)));
expect(tierArtless.length === 0, `every class has its water on disk (${tierArtless.map((t) => t.id).join(", ") || `all ${TIERS.length}`})`);

// Every hole in the lake steps down at least once, and a lip takes its heading
// from the fairway that crosses it (cups.transformHole), so a mirrored or
// reversed hole has to come out still running downhill from its new tee. That
// is the fall pass in holerules.js, which is also the gate on the authored
// holes — so put all sixteen transformed courses through the whole thing.
const crooked = [];
for (const cup of CUPS) {
  for (const tier of TIERS) {
    for (const h of buildCourse(cup, tier)) {
      for (const w of holeWarnings(h)) crooked.push(`${h.name} in ${tier.name}: ${w}`);
    }
  }
}
expect(crooked.length === 0,
  `every transformed hole still obeys the hole rules${crooked.length ? `\n      ${[...new Set(crooked)].slice(0, 8).join("\n      ")}` : ""}`);
const flat = CUPS.flatMap((c) => c.tracks.filter((t) => !holeFalls(HOLES[t.base]).length).map((t) => t.name));
expect(flat.length === 0, `every track in the career has a drop in it${flat.length ? ` (${flat})` : ""}`);

// and the furniture has to survive the transforms intact, or a mirrored cup
// quietly loses its bridges
const furnished = HOLES.findIndex((h) => h.wheels?.length && h.bridges?.length);
const mirrored = buildCourse({ tracks: [{ base: furnished, name: "x", mirror: true }] }, TIERS[0])[0];
expect(mirrored.wheels?.length === HOLES[furnished].wheels.length
  && mirrored.bridges?.length === HOLES[furnished].bridges.length
  && mirrored.wheels[0].bank === -HOLES[furnished].wheels[0].bank,
  "mirroring a furnished hole keeps its props and flips the mills to the other bank");

// the water's own character travels too, and the things with a side to them
// (a fallen tree's low end, a dam's notch) have to swap sides with the map
const river = HOLES.findIndex((h) => h.flow && h.dams?.length && h.logs?.length);
const flipped = buildCourse({ tracks: [{ base: river, name: "x", mirror: true }] }, TIERS[0])[0];
expect(flipped.flow === HOLES[river].flow, "a mirrored hole keeps its current");
expect(flipped.weeds?.length === HOLES[river].weeds.length
  && flipped.weeds[0].x === -HOLES[river].weeds[0].x, "and its weed beds, on the other side");
expect(flipped.logs[0].bank === -HOLES[river].logs[0].bank,
  "a mirrored fallen tree drops its low end on the other bank");
expect(flipped.dams[0].notch === -HOLES[river].dams[0].notch,
  "and a mirrored dam chews its notch on the other side");

// mirroring twice comes back round: the top class un-mirrors an already
// mirrored cup, which is the whole trick
const wp = buildCourse(CUPS[3], TIERS[0])[0].path[1].x;
const wpTop = buildCourse(CUPS[3], TIERS[3])[0].path[1].x;
expect(Math.sign(wp) === -Math.sign(wpTop), "the top class flips a mirrored cup back the other way");

const clock = [TIERS[0], TIERS[3]].map((t) => buildCourse(CUPS[0], t)[0].time);
expect(clock[0] > clock[1], `the clock tightens as you climb (${clock[0]}s → ${clock[1]}s)`);

// ------------------------------------------------------------------ biomes
// A biome is nine layers of colour that have to arrive together (biomes.js).
// Nothing here can look at pixels, so it checks the contract instead: that the
// bundles are complete, that they are actually different from one another, and
// that every hole the career can serve up knows which one it is wearing.
console.log("\n-- biomes --");
const HEX = /^#[0-9a-f]{6}$/i;
const ref = BIOMES[DEFAULT_BIOME];
expect(!!ref, `there is a default biome ("${DEFAULT_BIOME}")`);

const hexes = (b) => [
  ...b.sky.map((s) => s.hex), ...b.land.map((s) => s.hex),
  b.fog.color, b.clouds, b.rock, b.grass.color, b.trees.bark, b.trees.leaf,
  ...Object.values(b.shore), ...Object.values(b.water),
  ...(b.under.tint ? [b.under.tint] : []),
];
const gradOk = (stops) => stops.length >= 2 && stops.every((s) => s.t >= 0 && s.t <= 1 && HEX.test(s.hex));

for (const id of BIOME_IDS) {
  const b = BIOMES[id];
  const missing = Object.keys(ref).filter((k) => !(k in b));
  const bad = hexes(b).filter((h) => !HEX.test(h));
  expect(!missing.length && !bad.length,
    `${b.name} is a complete palette${missing.length ? ` (missing ${missing})` : ""}${bad.length ? ` (not a colour: ${bad})` : ""}`);
  expect(gradOk(b.sky) && gradOk(b.land), `${b.name}'s sky and hillside gradients run 0..1`);
  expect(b.sun.length === 3 && Math.hypot(...b.sun) > 0.1 && b.sun[1] > 0,
    `${b.name}'s sun is above the horizon`);
}

const looks = new Set(BIOME_IDS.map((id) => hexes(BIOMES[id]).join()));
expect(looks.size === BIOME_IDS.length, `all ${BIOME_IDS.length} biomes are actually different places`);

const cupBiomes = CUPS.filter((c) => !BIOMES[c.biome]);
expect(!cupBiomes.length, `every cup names a real biome${cupBiomes.length ? ` (${cupBiomes.map((c) => c.id)})` : ""}`);
const holeBiomes = HOLES.filter((h) => h.biome && !BIOMES[h.biome]);
expect(!holeBiomes.length, "every hole that insists on a biome names a real one");

// the early cups are where the transformed re-reads bite hardest, because you
// met the original only a cup ago: if they shared a biome too, the back half of
// each of them would feel like somewhere you had just been
const early = new Set(CUPS.slice(0, 4).map((c) => c.biome));
expect(early.size === 4, `the first four cups are four different places (${[...early].join(", ")})`);

for (const cup of CUPS) {
  const dressed = buildCourse(cup, TIERS[0]).every((h) => BIOMES[biomeFor(h)]);
  expect(dressed, `${cup.name} hands every hole a biome`);
}
const icy = HOLES.findIndex((h) => h.ice?.length && h.biome);
const inSummer = buildCourse({ biome: "meadow", tracks: [{ base: icy, name: "x" }] }, TIERS[0])[0];
expect(biomeFor(inSummer) === HOLES[icy].biome,
  "a hole that insists on its own weather keeps it in a cup that wants otherwise");

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

/**
 * Sanity-check the authored fairways in src/holes.js and src/playable-levels.js.
 *
 * The rules themselves live in src/holerules.js, because the admin level editor
 * runs the same ones live while you drag things about; this script is the build
 * gate on top of them. If a hole here has anything to say for itself, it says it
 * and the exit code is 1.
 *
 * The playable's levels run against a shorter minimum leg: they're deliberately
 * a third the size of a real hole, so a leg that would be a wobble on a 400m
 * fairway is a whole hole there.
 *
 * Run with: node scripts/checkholes.mjs
 */
import { HOLES, holeFalls } from "../src/holes.js";
import { PLAYABLE_HOLES } from "../src/playable-levels.js";
import { holeWarnings, holeStats, MIN_LEG } from "../src/holerules.js";
import { buildRoute } from "../src/route.js";

const PROP_KINDS = [
  ["falls", "falls"], ["wheels", "wheels"], ["bridges", "bridges"], ["caves", "caves"],
  ["logs", "logs"], ["dams", "dams"],
  ["rapids", "rapids"], ["ice", "ice"], ["weeds", "weed beds"],
];

let bad = 0;
function check(holes, label, minLeg = MIN_LEG) {
  console.log(`\n${label}`);
  holes.forEach((h, hi) => {
    const warn = holeWarnings(h, { minLeg });
    const s = holeStats(h);
    if (warn.length) bad++;
    const extra = PROP_KINDS.map(([k, tag]) => (h[k]?.length ? `  ${h[k].length} ${tag}` : "")).join("");
    // a forked hole is two numbers, not one: what the long way costs and what
    // the gamble is worth (src/route.js)
    let fork = "";
    if (h.branches?.length) {
      const r = buildRoute(h);
      fork = `  ${r.forks().length} fork  best ${r.best.toFixed(0)}u (-${((1 - r.best / r.length) * 100).toFixed(0)}%)`;
    }
    console.log(
      `hole ${hi + 1}: ${h.path.length} pts  len ${s.total.toFixed(0)}u  straightness ${s.straight.toFixed(2)}  ` +
      `maxR ${s.maxR.toFixed(0)}  leg ${s.minLeg.toFixed(0)}u  turn ${s.maxTurn.toFixed(0)}deg  ` +
      `${h.islands.length} isl  ${h.rocks.length} spires${extra}${fork}  time ${h.time}s`
    );
    for (const w of warn) console.log(`   !! ${w}`);
  });
}

/**
 * The ladder. src/holes.js is ordered so that each hole introduces exactly one
 * element no hole before it had, and so that between them they introduce every
 * element the game owns. A hole that brings two new things at once teaches
 * neither, and a hole that brings none is a hole you have already played — so
 * both are build failures rather than opinions.
 *
 * Two things are not on this list because they are not rungs: the terrace and
 * the fork. Every hole in the lake steps down at least once and offers at least
 * two ways down (see the header of src/holes.js), hole 1 teaches both along
 * with the river, and they are checked below as properties every hole must
 * have. Three holes are therefore built out of a drop or a choice rather than
 * out of anything new, and they are named here so that a hole going quiet by
 * accident still fails the build.
 */
const ELEMENTS = [
  "bridges", "wheels", "caves",
  "flow", "rapids", "weeds", "logs", "dams", "ice",
];
const QUIET = new Map([ // 1-based: holes allowed to introduce nothing, and why
  [2, "the drop, and only the drop"],
  [4, "the drop, and only the drop"],
  [13, "the choice, and only the choice"],
]);
const carries = (h, k) => (k === "flow" ? !!h.flow : !!h[k]?.length);

function checkLadder(holes) {
  console.log("\nthe ladder — one new element per hole");
  const taught = new Set();
  holes.forEach((h, i) => {
    // a dam holds water back, so it is a lip too — either counts as the hole's
    // own drop (src/holes.js holeFalls)
    if (!holeFalls(h).length) {
      bad++;
      console.log(`hole ${i + 1}: !! no drop anywhere on it — every hole steps down at least once`);
    }
    if (!h.branches?.length) {
      bad++;
      console.log(`hole ${i + 1}: !! one way down — every hole offers a second`);
    }
    const fresh = ELEMENTS.filter((k) => carries(h, k) && !taught.has(k));
    for (const k of fresh) taught.add(k);
    const quiet = QUIET.get(i + 1);
    const said = i === 0 ? "the river itself" : fresh.join(" + ") || quiet || "nothing new";
    console.log(`hole ${i + 1}: ${said}`);
    const want = i === 0 || quiet ? 0 : 1;
    if (fresh.length !== want) {
      bad++;
      console.log(`   !! introduces ${fresh.length}, wanted ${want}${fresh.length ? ` (${fresh.join(", ")})` : ""}`);
    }
  });
  const missed = ELEMENTS.filter((k) => !taught.has(k));
  if (missed.length) {
    bad++;
    console.log(`   !! never taught anywhere: ${missed.join(", ")}`);
  }
}

check(HOLES, "src/holes.js — the authored course");
checkLadder(HOLES);
check(PLAYABLE_HOLES, "src/playable-levels.js — the skip playable", 24);
process.exit(bad ? 1 : 0);

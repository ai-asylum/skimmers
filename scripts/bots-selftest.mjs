/**
 * Race the CPU rivals against a scripted human, without a browser, to check
 * that the rubber band in src/bots.js does what it claims:
 *
 *   • course progress is measured along the buoy line, so a stone that hasn't
 *     turned a dogleg yet never reads as ahead of one that has
 *   • a rival that runs away from the human eases off; one that gets dropped
 *     hustles — and the band saturates instead of running away with itself
 *   • the band bunches the field: at the moment the hole is decided, more
 *     stones are still in touch than there would have been unbanded
 *   • it does NOT quietly make the game harder — the band is lopsided, so a
 *     player off the pace finishes no worse than they did unbanded
 *   • the class dial still reaches both ends (Calm holds tightest, Maelstrom
 *     nearly lets go)
 *
 * The rivals are the real BotBrains, aiming and flying through the real
 * simulateThrow and taking the real auto-fishing break when they glug one. Only
 * the stones are stubs, and the human is a metronome walking the fairway at a
 * fixed pace so that two runs of the same seed are comparable.
 *
 * Pace reference (unbanded, hole 1, measured over 8 seeds): the course is 190u,
 * the leading rival gets home in ~37s and the last in ~95s, so the field wins at
 * about 5 u/s. The human's pace has to straddle that. Race him faster than the
 * whole field and every rival reads as dropped, the brake never engages, and the
 * bunching checks below measure nothing but noise.
 *
 * Run with: node scripts/bots-selftest.mjs
 */
import * as THREE from "three";
import { BotBrain, BOT_PERSONAS } from "../src/bots.js";
import { simulateThrow } from "../src/physics.js";
import { HOLES } from "../src/holes.js";
import { TIERS } from "../src/cups.js";
import { setTerrainPath } from "../src/terrain.js";
import { setWaterPath } from "../src/water.js";
import { buildRoute } from "../src/route.js";

let fail = 0;
const expect = (cond, msg) => {
  console.log(`${cond ? "ok  " : "FAIL"}: ${msg}`);
  if (!cond) fail++;
};
const note = (msg) => console.log(`      ${msg}`);

const HOLE = HOLES[0];
const PATH = HOLE.path;
setTerrainPath(PATH, HOLE.width);
setWaterPath(PATH, HOLE.width);

// ------------------------------------------------------------------ measuring stick
// The test measures progress its own way rather than borrowing the module's
// helper, so a bug in that helper can't hide by agreeing with itself.
const SEGS = PATH.slice(0, -1).map((a, i) => {
  const b = PATH[i + 1];
  return { a, b, dx: b.x - a.x, dz: b.z - a.z, len: Math.hypot(b.x - a.x, b.z - a.z) };
});
const TOTAL = SEGS.reduce((s, g) => s + g.len, 0);
const HOME = TOTAL * 0.97; // close enough to the flag to call it in

/** distance from the tee along the fairway, 0..TOTAL */
function arcAt(x, z) {
  let run = 0, best = 0, bestD = Infinity;
  for (const g of SEGS) {
    const t = Math.min(1, Math.max(0, ((x - g.a.x) * g.dx + (z - g.a.z) * g.dz) / (g.len * g.len || 1)));
    const d = Math.hypot(x - (g.a.x + g.dx * t), z - (g.a.z + g.dz * t));
    if (d < bestD) { bestD = d; best = run + g.len * t; }
    run += g.len;
  }
  return best;
}

/** point on the fairway that far along it — how the scripted human walks */
function pointAtArc(arc) {
  let run = 0;
  for (const g of SEGS) {
    if (arc <= run + g.len) {
      const t = (arc - run) / (g.len || 1);
      return { x: g.a.x + g.dx * t, z: g.a.z + g.dz * t };
    }
    run += g.len;
  }
  return PATH[PATH.length - 1];
}

// ------------------------------------------------------------------ the fake lake
const WATER = { heightAt: () => 0 };
const FLAG = new THREE.Vector3(PATH.at(-1).x, 0, PATH.at(-1).z);

/** deterministic Math.random so band-on and band-off see the same dice */
function seedRandom(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function makeStone(name, { isPlayer = false } = {}) {
  const tee = pointAtArc(0);
  return {
    name,
    isPlayer,
    isRemote: false,
    finished: false,
    state: "resting",
    pos: new THREE.Vector3(tee.x, 0.4, tee.z),
    sinkT: 0,
    sinkDelay: 0.6,
    rock: { flat: 0.6, heft: 0.5 },
    throws: 0,
    distToFlag(f) { return Math.hypot(this.pos.x - f.x, this.pos.z - f.z); },
    placeAt(x, z) { this.pos.set(x, 0.4, z); this.state = "resting"; this.sinkT = 0; },
    // the real flight sim decides where the stone ends up and how it got there,
    // so a bot that aims badly really does lose ground — and a glug really does
    // cost it the auto-fishing break
    throwRock(dir, power, mode) {
      this.throws++;
      const sim = simulateThrow(this.pos, dir, power, mode, this.rock, WATER, 0, 60, HOLE.islands, HOLE.rocks);
      const end = sim.points?.at(-1);
      if (end) this.pos.set(end.x, 0.4, end.z);
      if (sim.end === "sink") { this.state = "sinking"; this.sinkT = 0; }
      else this.state = sim.end === "beach" ? "beached" : "resting";
      return true;
    },
  };
}

/**
 * One hole. `humanSpeed` is fairway units per second — the pace the person is
 * setting, which is the thing the band is supposed to bend toward.
 *
 * Snapshots the field at the moment the *first* stone gets home, because that
 * is when the hole is decided and the only moment where "was it close?" means
 * anything. Then keeps going so we can see where the human placed.
 */
function race({ bandMul, humanSpeed, seed = 7, tier = null, untilFieldHome = false }) {
  const realRandom = Math.random;
  Math.random = seedRandom(seed);
  try {
    const human = makeStone("You", { isPlayer: true });
    let humanArc = 0;

    const stones = [human];
    const brains = [];
    for (const persona of BOT_PERSONAS) {
      const s = makeStone(persona.name);
      stones.push(s);
      brains.push(new BotBrain(s, persona, { ...(tier ?? {}), bandMul }));
    }

    const ctx = {
      dt: 1 / 30,
      elapsed: 0,
      water: WATER,
      others: stones,
      flagPos: FLAG,
      path: PATH,
      islands: HOLE.islands,
      rocks: HOLE.rocks,
      captureR: 4,
    };

    let bandMin = Infinity, bandMax = -Infinity, maxWait = 0;
    let snapshot = null; // field arcs when the first stone got home
    let humanPlace = null;
    let humanT = null;
    let lastT = 0;
    let placed = 0;
    let t = 0;
    const LIMIT = 400;

    const arcsNow = () => stones.map((s) => (s.finished ? TOTAL : arcAt(s.pos.x, s.pos.z)));
    const done = () => (untilFieldHome ? stones.every((s) => s.finished) : human.finished && snapshot);

    while (t < LIMIT && !done()) {
      t += ctx.dt;
      ctx.elapsed = t;

      humanArc = Math.min(TOTAL, humanArc + humanSpeed * ctx.dt);
      const hp = pointAtArc(humanArc);
      human.pos.set(hp.x, 0.4, hp.z);

      for (const b of brains) {
        if (b.s.finished) continue;
        if (b.s.state === "sinking") b.s.sinkT += ctx.dt;
        b.update(ctx);
        bandMin = Math.min(bandMin, b.band);
        bandMax = Math.max(bandMax, b.band);
        maxWait = Math.max(maxWait, b.cooldown); // peaks the frame it's set, then decays
      }

      // call anyone who has reached the flag this frame
      for (const s of stones) {
        if (s.finished) continue;
        const done = s === human ? humanArc >= HOME : arcAt(s.pos.x, s.pos.z) >= HOME;
        if (!done) continue;
        if (!snapshot) snapshot = arcsNow(); // the field, the instant the hole was decided
        s.finished = true;
        placed++;
        lastT = t;
        if (s === human) { humanPlace = placed; humanT = t; }
      }
    }

    if (!snapshot) snapshot = arcsNow();
    const spread = (Math.max(...snapshot) - Math.min(...snapshot)) / TOTAL;
    const inTouch = snapshot.filter((a) => a >= TOTAL * 0.85).length;
    return {
      spread,
      inTouch,
      humanPlace: humanPlace ?? stones.length,
      // how long the player sits watching after they're in — capped at the clock
      tail: Math.max(0, (stones.every((s) => s.finished) ? lastT : LIMIT) - (humanT ?? 0)),
      maxWait,
      bandMin: bandMin === Infinity ? 0 : bandMin,
      bandMax: bandMax === -Infinity ? 0 : bandMax,
      t,
    };
  } finally {
    Math.random = realRandom;
  }
}

// Enough seeds that the spread comparisons below are reading the band rather
// than the dice: band-on and band-off diverge in how many rolls they consume, so
// a single race says nothing and five say little.
const SEEDS = Array.from({ length: 12 }, (_, i) => 3 + i * 7);
// slow / on the pace / quick, either side of the field's own ~5 u/s
const PACES = [1.5, 3, 5];

// ------------------------------------------------------------------ progress metric
console.log("\n-- progress is measured along the fairway --");
{
  const late = PATH[1]; // round the first bend
  const early = { x: 0, z: 80 }; // barely off the tee
  expect(arcAt(late.x, late.z) > arcAt(early.x, early.z), "a stone round the bend is further along than one off the tee");

  const mid = pointAtArc(TOTAL * 0.5);
  const frac = arcAt(mid.x, mid.z) / TOTAL;
  expect(Math.abs(frac - 0.5) < 0.02, `the halfway point reads as halfway (${frac.toFixed(3)})`);
}

// ------------------------------------------------------------------ the band itself
console.log("\n-- the band winds up, and stops --");
{
  const slow = race({ bandMul: 1, humanSpeed: 1.5 }); // rivals will get ahead
  const fast = race({ bandMul: 1, humanSpeed: 8 }); // rivals will fall behind
  note(`vs a slow human: band ran ${slow.bandMin.toFixed(2)} .. ${slow.bandMax.toFixed(2)}`);
  note(`vs a fast human: band ran ${fast.bandMin.toFixed(2)} .. ${fast.bandMax.toFixed(2)}`);

  expect(slow.bandMax > 0.9, "rivals ahead of a slow human wind the band positive (they ease off)");
  expect(fast.bandMin < -0.9, "rivals behind a fast human wind it negative (they hustle)");
  expect(slow.bandMax <= 1.0001 && fast.bandMin >= -1.0001, "and it saturates at ±1 instead of running away");

  const off = race({ bandMul: 0, humanSpeed: 1.5 });
  expect(off.bandMin === 0 && off.bandMax === 0, "bandMul 0 switches it off entirely");

  // Worst case in the whole game: Calm stretches Plunkett's patience to 7.8s of
  // its own accord and winds the band hardest, so that is where a braked leader
  // sits still longest. The cap has to hold there, not just in the middle class.
  const calm = TIERS.find((t) => t.id === "calm");
  const natural = Math.max(...BOT_PERSONAS.map((p) => p.patience[1])) * calm.patienceMul;
  let worst = 0;
  for (const seed of SEEDS) worst = Math.max(worst, race({ bandMul: calm.bandMul, humanSpeed: 1.5, seed, tier: calm }).maxWait);
  note(`Calm's most patient rival waits ${natural.toFixed(1)}s naturally; braked it sat ${worst.toFixed(1)}s`);
  expect(worst <= natural + 3.01, "a fully braked leader eases off rather than looking asleep");
}

// ------------------------------------------------------------------ does it bunch?
console.log("\n-- it holds the field together --");
{
  let tighter = 0, runs = 0, spOn = 0, spOff = 0;
  for (const seed of SEEDS) {
    for (const humanSpeed of PACES) {
      const on = race({ bandMul: 1, humanSpeed, seed });
      const off = race({ bandMul: 0, humanSpeed, seed });
      if (on.spread < off.spread) tighter++;
      else if (on.spread === off.spread) tighter += 0.5; // the band had nothing to bite on
      runs++;
      spOn += on.spread; spOff += off.spread;
    }
  }
  note(`field spread when the hole is decided: ${(spOff / runs).toFixed(3)} unbanded -> ${(spOn / runs).toFixed(3)} banded`);
  note(`(braking only — a dropped rival is left dropped while the race is live)`);
  expect(spOn <= spOff, `the band never strings the field out further (${tighter}/${runs} races tighter or level)`);
}

// ------------------------------------------------------------------ is it harder?
console.log("\n-- and it cannot make the game harder --");
{
  // The whole point of braking-only: closing the field up must come from reeling
  // the leaders in, never from shoving stragglers past the player. That has to
  // hold at every pace, and especially against a player having a blinder.
  for (const humanSpeed of PACES) {
    let on = 0, off = 0;
    for (const seed of SEEDS) {
      on += race({ bandMul: 1, humanSpeed, seed }).humanPlace;
      off += race({ bandMul: 0, humanSpeed, seed }).humanPlace;
    }
    const n = SEEDS.length;
    note(`at ${String(humanSpeed).padStart(2)} u/s the player places ${(off / n).toFixed(2)} -> ${(on / n).toFixed(2)}`);
    expect(on / n <= off / n + 0.01, `a player at ${humanSpeed} u/s places no worse than unbanded`);
  }
}

// ------------------------------------------------------------------ the final stretch
console.log("\n-- and once you're home, the stragglers get on with it --");
{
  // The one place the band is allowed to push instead of brake, because by then
  // nobody can lose a place to it — and it is buying back the worst dead time in
  // the game, spent watching stones you have already beaten.
  const tailOff = [], tailOn = [];
  for (const seed of SEEDS) {
    tailOff.push(race({ bandMul: 0, humanSpeed: 6, seed, untilFieldHome: true }).tail);
    tailOn.push(race({ bandMul: 1, humanSpeed: 6, seed, untilFieldHome: true }).tail);
  }
  const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
  note(`spectating after a quick player gets home: ${mean(tailOff).toFixed(1)}s -> ${mean(tailOn).toFixed(1)}s`);
  expect(mean(tailOn) < mean(tailOff), "the wait for the rest of the field to come in gets shorter");
}

// ------------------------------------------------------------------ the class dial
console.log("\n-- the class dial reaches both ends --");
{
  const byTier = TIERS.map((t) => {
    let spread = 0, n = 0;
    for (const seed of SEEDS) for (const humanSpeed of PACES) {
      spread += race({ bandMul: t.bandMul, humanSpeed, seed, tier: t }).spread; n++;
    }
    return { id: t.id, bandMul: t.bandMul, spread: spread / n };
  });
  for (const r of byTier) note(`${r.id.padEnd(10)} bandMul ${r.bandMul.toFixed(2)}  spread ${r.spread.toFixed(3)}`);

  expect(TIERS.every((t) => typeof t.bandMul === "number"), "every class carries a bandMul");
  const calm = byTier.find((r) => r.id === "calm");
  const mael = byTier.find((r) => r.id === "maelstrom");
  expect(calm.spread < mael.spread, "Calm holds the field tighter than Maelstrom");
}

// ------------------------------------------------------------------ two ways down
// A hole with a shortcut in it breaks the one assumption everything above was
// written on: that "how far along" is a single arc length. These check the
// replacement (src/route.js) says sensible things about a fork — and that a
// bot's nerve is what decides which way it goes.
console.log("\n-- a hole with two ways down it --");
{
  const forked = HOLES.find((h) => h.branches?.length);
  expect(!!forked, "the course has a hole that forks");
  const r = buildRoute(forked);
  expect(r.forks().length === 1, `it forks once (${r.forks().length})`);
  expect(r.best < r.length, `the shortcut is shorter than the river (${r.best.toFixed(0)}u vs ${r.length.toFixed(0)}u)`);

  const cut = forked.branches[0].path;
  const fork = cut[0], mid = cut[Math.floor(cut.length / 2)], rejoin = cut.at(-1);
  const home = (p) => r.remainingAt(p.x, p.z);
  expect(home(fork) > home(mid) && home(mid) > home(rejoin),
    "down the shortcut, there is less and less water left");

  // the same measure has to be honest across the two lines: a stone halfway
  // down the gut is genuinely ahead of one that has only just left the fork
  const mainMid = forked.path[2];
  expect(home(mid) < home(mainMid),
    `a stone in the gut reads ahead of one round the long way (${home(mid).toFixed(0)}u vs ${home(mainMid).toFixed(0)}u left)`);

  const bold = r.waypointAhead(fork.x, fork.z, 40, 1);
  const timid = r.waypointAhead(fork.x, fork.z, 40, -1);
  expect(bold.fork && timid.fork, "both rivals can see the fork from the fork");
  expect(bold.branch && !timid.branch, "nerve takes the gut; caution stays on the river");

  // and once you are committed there is no arguing about it
  const inside = r.waypointAhead(mid.x, mid.z, 40, -1);
  expect(inside.branch, "a timid stone already in the gut plays the gut");
}

console.log(fail ? `\n${fail} check(s) FAILED\n` : "\nall good\n");
process.exit(fail ? 1 : 0);

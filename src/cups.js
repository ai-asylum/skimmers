/**
 * Cups and difficulty, the Mario Kart way: pick a cup of three courses, pick a
 * class to run it in, and both choices change what the lake pays you.
 *
 * The cup order walks the ladder in holes.js two rungs at a time. Every cup but
 * the last opens with the two holes that introduce the next two elements in the
 * game, and closes with a third track that is an earlier hole put through a
 * transform — reversed tee-for-flag, mirrored, narrowed, or some of each. That
 * third slot is doing two jobs: it is a genuinely different read (the elbows
 * arrive in the other order and the spires that used to guard the flag now
 * guard the tee), and it is the only place in the cup where you are asked to
 * play something you already know. Twenty-one tracks, thirteen of which teach.
 *
 * The last cup teaches nothing on purpose. It is the three meanest holes in the
 * lake, mirrored and on the tightest water, and it is meant to be the exam.
 *
 * Every hole can take every transform, terraces included: see transformHole on
 * how a reversed hole re-cuts its own waterfalls.
 *
 * Difficulty is one struct: how good the rivals are, how many turn up, how long
 * the clock runs, and the multiplier on your shells. The top class mirrors every
 * course on top of whatever the cup already does, so a veteran has to unlearn
 * all twenty-one.
 */
import { HOLES } from "./holes.js";
import { cupRecord } from "./meta.js";

/** @typedef {{ base:number, name:string, reverse?:boolean, mirror?:boolean, widthMul?:number }} TrackSpec */

/**
 * `biome` is the cup's weather (biomes.js). Arriving at the lake in October
 * rather than July is most of what stops the third slot in each cup — an
 * earlier hole, turned round — from feeling like a hole you have played.
 *
 * An `id` is a save key (meta.cupRecord) and outlives any renaming, so a cup's
 * id and its name are allowed to drift apart. Change a name freely; changing an
 * id throws away everyone's record.
 * @type {{id:string,name:string,art:string,blurb:string,biome:string,tracks:TrackSpec[]}[]}
 */
export const CUPS = [
  {
    id: "pebble", name: "Pebble Cup", art: "cups/pebble.jpg",
    blurb: "Three things to learn: the stone, the steps it comes down, the timber over them.",
    biome: "meadow",
    tracks: [
      { base: 0, name: "Long Water" },
      { base: 1, name: "Stepwater" },
      { base: 2, name: "Bridgeworks" },
    ],
  },
  {
    id: "millrace", name: "Millrace Cup", art: "cups/millrace.jpg",
    blurb: "The lake stops being flat, and then it starts turning machinery.",
    biome: "autumn",
    tracks: [
      { base: 3, name: "Cataract Run" },
      { base: 4, name: "Millrace" },
      { base: 1, name: "Stepwater Reverse", reverse: true },
    ],
  },
  {
    id: "boulder", name: "Boulder Cup", art: "cups/boulder.jpg",
    blurb: "Straight through the headland, and the first water that pushes back.",
    biome: "highland",
    tracks: [
      { base: 5, name: "The Undertow" },
      { base: 6, name: "The Race" },
      { base: 0, name: "Narrow Water", mirror: true, widthMul: 0.86 },
    ],
  },
  {
    id: "current", name: "Current Cup", art: "cups/current.jpg",
    blurb: "Fast lane and slack. Where you park matters as much as where you land.",
    biome: "dusk",
    tracks: [
      { base: 7, name: "The Chute" },
      { base: 8, name: "The Slack" },
      { base: 2, name: "Bridgeworks Reverse", mirror: true, reverse: true, widthMul: 0.86 },
    ],
  },
  {
    id: "cataract", name: "Cataract Cup", art: "cups/cataract.jpg",
    blurb: "Timber down and timber built. Every wall in this river is also a drop.",
    biome: "highland",
    tracks: [
      { base: 9, name: "Deadfall" },
      { base: 10, name: "The Lodge" },
      { base: 3, name: "Cataract Mirror", mirror: true, widthMul: 0.9 },
    ],
  },
  {
    // id "ripple" is a save key from an older running order — see above
    id: "ripple", name: "Coldwater Cup", art: "cups/ripple.jpg",
    blurb: "The last two tricks: water that will not let you skip, and water that offers you a choice.",
    biome: "pinewood",
    tracks: [
      { base: 11, name: "Cold Snap" },
      { base: 12, name: "The Split" },
      { base: 6, name: "Upstream", mirror: true, reverse: true, widthMul: 0.84 },
    ],
  },
  {
    id: "whirlpool", name: "Whirlpool Cup", art: "cups/whirlpool.jpg",
    blurb: "Nothing new. The three meanest holes in the lake, mirrored, on the tightest water.",
    biome: "dusk",
    tracks: [
      { base: 4, name: "Left-Hand Mill", mirror: true, widthMul: 0.88 },
      { base: 10, name: "Lodge Mirror", mirror: true, widthMul: 0.84 },
      { base: 12, name: "The Wrong Gut", mirror: true, widthMul: 0.86 },
    ],
  },
];

export const CUP_BY_ID = new Map(CUPS.map((c) => [c.id, c]));

/**
 * `bandMul` scales the rivals' rubber band (bots.js): how hard their pace bends
 * back toward yours. High up the ladder it slackens off, so Maelstrom is a
 * straight race against stones that are simply better than you, while Calm keeps
 * the whole field within sight of a first-timer whichever way the hole is going.
 * `musicRate` spins the race track faster the further up the ladder you go, so
 * the class is audible before the first stone leaves your hand. It runs a
 * little ahead of `timeMul` — the clock at Maelstrom is 30% shorter but the
 * music only 16% quicker, because past that the mix starts sounding comic
 * rather than urgent.
 * `art` is the water the class puts you on (scripts/gen-class-art.mjs). A class
 * is a mood before it is a table of numbers, and four cards reading 50cc to
 * 200cc down a column said none of that.
 * @type {{id:string,name:string,cc:string,blurb:string,color:string,art:string,botSkill:number,botCount:number,aggroMul:number,timeMul:number,bandMul:number,musicRate:number,payout:number,mirror?:boolean}[]}
 */
export const TIERS = [
  {
    // not "Ripple": that's a cup's name, and two ladders sharing a word is one
    // ladder nobody can read
    id: "calm", name: "Calm", cc: "50cc", color: "#6fe07a", art: "classes/calm.jpg",
    blurb: "Five easy-going rivals and a long clock.",
    botSkill: -0.2, botCount: 5, aggroMul: 0.55, patienceMul: 1.3, timeMul: 1.3, bandMul: 1.15, musicRate: 1, payout: 1,
  },
  {
    id: "swell", name: "Swell", cc: "100cc", color: "#37c8e0", art: "classes/swell.jpg",
    blurb: "The full field, playing it straight.",
    botSkill: 0, botCount: 7, aggroMul: 1, patienceMul: 1, timeMul: 1, bandMul: 1, musicRate: 1.05, payout: 1.7,
  },
  {
    id: "breaker", name: "Breaker", cc: "150cc", color: "#ff8a3d", art: "classes/breaker.jpg",
    blurb: "Sharper rivals, meaner splashes, less time.",
    botSkill: 0.09, botCount: 7, aggroMul: 1.4, patienceMul: 0.82, timeMul: 0.85, bandMul: 0.8, musicRate: 1.1, payout: 2.6,
  },
  {
    id: "maelstrom", name: "Maelstrom", cc: "200cc", color: "#ff5470", art: "classes/maelstrom.jpg",
    blurb: "Every course mirrored again, and they do not miss.",
    botSkill: 0.14, botCount: 7, aggroMul: 1.8, patienceMul: 0.68, timeMul: 0.7, bandMul: 0.55, musicRate: 1.16, payout: 4, mirror: true,
  },
];

export const TIER_BY_ID = new Map(TIERS.map((t) => [t.id, t]));

// ------------------------------------------------------------------ building courses
function transformHole(base, { mirror = false, reverse = false, widthMul = 1, timeMul = 1 }) {
  const mx = mirror ? -1 : 1;
  const path = base.path.map((p) => ({ x: p.x * mx, z: p.z }));
  if (reverse) path.reverse();
  const flip = (list) => (list ?? []).map((o) => ({ ...o, x: o.x * mx }));
  // A shortcut is a second line of the same river, so it mirrors, reverses and
  // narrows with the first one — otherwise a tight class would leave the branch
  // wider than the water it leaves, and the gamble would be backwards.
  const branches = (base.branches ?? []).map((b) => {
    const bp = b.path.map((p) => ({ x: p.x * mx, z: p.z }));
    if (reverse) bp.reverse();
    return { ...b, path: bp, width: +((b.width ?? (base.width ?? 13) * 0.62) * widthMul).toFixed(2) };
  });
  const out = {
    time: Math.max(45, Math.round(base.time * timeMul)),
    width: +((base.width ?? 13) * widthMul).toFixed(2),
    path,
    branches,
    islands: flip(base.islands),
    rocks: flip(base.rocks),
    // Furniture mirrors like everything else. A mill wheel's `bank` is a side
    // of the channel, so it has to flip with the map or the mill ends up in
    // the water on the far shore from its own wheel — and a fallen tree's low
    // end is the same kind of number.
    wheels: flip(base.wheels).map((w) => (w.bank ? { ...w, bank: w.bank * mx } : w)),
    bridges: flip(base.bridges),
    caves: flip(base.caves),
    logs: flip(base.logs).map((l) => ({ ...l, bank: (l.bank ?? 1) * mx })),
    // The water's own character. Speed is a scalar and survives anything; the
    // patches are places, so they move with the map like the rest of it.
    flow: base.flow ?? 0,
    rapids: flip(base.rapids),
    ice: flip(base.ice),
    weeds: flip(base.weeds),
    // A lip is a place, not a direction. Which shelf rides higher is worked out
    // from the fairway's own heading where it crosses (water.setFalls asks
    // pathTangentAt), so a reversed hole re-terraces itself and still runs
    // downhill from its new tee — the old rule that a hole with a waterfall
    // could never be turned round would now bench every hole in the lake.
    // A beaver dam is a waterfall with a fence on it (holes.js holeFalls) and
    // travels the same way; its notch is an offset across the channel, so
    // mirroring the map swaps the bank it is chewed into.
    falls: flip(base.falls),
    dams: flip(base.dams).map((d) => ({ ...d, notch: (d.notch ?? 0) * mx })),
  };
  return out;
}

/**
 * The three playable holes for a cup at a difficulty. Class mirroring XORs with
 * the cup's own, so the Whirlpool Cup in Maelstrom comes back round to
 * un-mirrored — reversed and tight, but readable again.
 */
export function buildCourse(cup, tier) {
  return cup.tracks.map((t) => {
    const hole = transformHole(HOLES[t.base] ?? HOLES[0], {
      mirror: !!t.mirror !== !!tier.mirror,
      reverse: !!t.reverse,
      widthMul: t.widthMul ?? 1,
      timeMul: tier.timeMul,
    });
    hole.name = t.name;
    // The cup dresses the hole, unless the hole insists: a frozen fairway is
    // not a thing you can hold a summer meeting on (biomes.js).
    hole.biome = HOLES[t.base]?.biome ?? cup.biome;
    return hole;
  });
}

// ------------------------------------------------------------------ progression
/** a cup opens once you've stood on the podium in the one before it */
export function cupUnlocked(idx) {
  if (idx <= 0) return true;
  const prev = CUPS[idx - 1];
  return TIERS.some((t) => {
    const r = cupRecord(prev.id, t.id);
    return r > 0 && r <= 3;
  });
}

/** a class opens once you've actually won something in the class below */
export function tierUnlocked(idx) {
  if (idx <= 0) return true;
  const prev = TIERS[idx - 1];
  return CUPS.some((c) => cupRecord(c.id, prev.id) === 1);
}

export function cupLockHint(idx) {
  if (idx <= 0) return "";
  return `Top 3 in the ${CUPS[idx - 1].name} to open this`;
}

export function tierLockHint(idx) {
  if (idx <= 0) return "";
  return `Win any cup in ${TIERS[idx - 1].name} to open this`;
}

// ------------------------------------------------------------------ payout
/**
 * What a finished cup is worth, itemised so the results screen can count it up
 * one line at a time. Everything scales with the class, so the reason to move
 * up is the same reason it hurts.
 */
export function payoutFor({ place, racers, points, holesWon, tier, firstClear = false, cleanSweep = false }) {
  const lines = [];
  const add = (label, amount) => { if (amount > 0) lines.push({ label, amount: Math.round(amount) }); };

  add("Finished the cup", 25);
  add(`${place === 1 ? "1st" : place === 2 ? "2nd" : place === 3 ? "3rd" : place + "th"} place`, Math.max(0, racers - place + 1) * 9);
  add("Race points", points * 2);
  add(`Holes won ×${holesWon}`, holesWon * 18);
  if (place === 1) add("Cup winner", 70);
  if (cleanSweep) add("Clean sweep — every hole", 120);

  const subtotal = lines.reduce((n, l) => n + l.amount, 0);
  const scaled = Math.round(subtotal * tier.payout);
  if (tier.payout !== 1) lines.push({ label: `${tier.cc} class ×${tier.payout}`, amount: scaled - subtotal, mult: true });
  let total = scaled;
  if (firstClear) {
    const bonus = 150;
    lines.push({ label: "First time on this podium", amount: bonus });
    total += bonus;
  }
  return { lines, total };
}

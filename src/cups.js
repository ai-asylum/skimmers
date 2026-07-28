/**
 * Cups and difficulty, the Mario Kart way: pick a cup of three courses, pick a
 * class to run it in, and both choices change what the lake pays you.
 *
 * There are only three hand-authored holes (holes.js), so the twelve courses
 * come from running them through four transforms — as-is, reversed tee-for-flag,
 * mirrored, and both at once. A reversed switchback is a genuinely different
 * read: the elbows arrive in the other order and the spires that used to guard
 * the flag now guard the tee. Narrower channels on the later cups do the rest.
 *
 * Difficulty is one struct: how good the rivals are, how many turn up, how long
 * the clock runs, and the multiplier on your shells. The top class mirrors every
 * course on top of whatever the cup already does, so a veteran has to unlearn
 * all twelve.
 */
import { HOLES } from "./holes.js";
import { cupRecord } from "./meta.js";

/** @typedef {{ base:number, name:string, reverse?:boolean, mirror?:boolean, widthMul?:number }} TrackSpec */

/** @type {{id:string,name:string,art:string,blurb:string,tracks:TrackSpec[]}[]} */
export const CUPS = [
  {
    id: "pebble", name: "Pebble Cup", art: "cups/pebble.jpg",
    blurb: "The three rivers as they were drawn. Wide water, gentle elbows.",
    tracks: [
      { base: 0, name: "Long Lazy River" },
      { base: 1, name: "The Diagonal" },
      { base: 2, name: "Switchback" },
    ],
  },
  {
    id: "ripple", name: "Ripple Cup", art: "cups/ripple.jpg",
    blurb: "The same three run backwards. The spires guard the tee now.",
    tracks: [
      { base: 2, name: "Switchback Reverse", reverse: true },
      { base: 0, name: "Upriver", reverse: true },
      { base: 1, name: "Diagonal Reverse", reverse: true },
    ],
  },
  {
    id: "boulder", name: "Boulder Cup", art: "cups/boulder.jpg",
    blurb: "Mirrored, and the channel narrows. Every dogleg leans the wrong way.",
    tracks: [
      { base: 1, name: "Left-Hand Diagonal", mirror: true, widthMul: 0.86 },
      { base: 2, name: "Wrong-Way Switchback", mirror: true, widthMul: 0.86 },
      { base: 0, name: "Narrow River", mirror: true, widthMul: 0.8 },
    ],
  },
  {
    id: "whirlpool", name: "Whirlpool Cup", art: "cups/whirlpool.jpg",
    blurb: "Mirrored and reversed, on the tightest water in the lake.",
    tracks: [
      { base: 0, name: "Cold Run", mirror: true, reverse: true, widthMul: 0.78 },
      { base: 1, name: "Knife Edge", mirror: true, reverse: true, widthMul: 0.76 },
      { base: 2, name: "The Maelstrom", mirror: true, reverse: true, widthMul: 0.72 },
    ],
  },
];

export const CUP_BY_ID = new Map(CUPS.map((c) => [c.id, c]));

/** @type {{id:string,name:string,cc:string,blurb:string,color:string,botSkill:number,botCount:number,aggroMul:number,timeMul:number,payout:number,mirror?:boolean}[]} */
export const TIERS = [
  {
    // not "Ripple": that's a cup's name, and two ladders sharing a word is one
    // ladder nobody can read
    id: "calm", name: "Calm", cc: "50cc", color: "#6fe07a",
    blurb: "Five easy-going rivals and a long clock.",
    botSkill: -0.2, botCount: 5, aggroMul: 0.55, patienceMul: 1.3, timeMul: 1.3, payout: 1,
  },
  {
    id: "swell", name: "Swell", cc: "100cc", color: "#37c8e0",
    blurb: "The full field, playing it straight.",
    botSkill: 0, botCount: 7, aggroMul: 1, patienceMul: 1, timeMul: 1, payout: 1.7,
  },
  {
    id: "breaker", name: "Breaker", cc: "150cc", color: "#ff8a3d",
    blurb: "Sharper rivals, meaner splashes, less time.",
    botSkill: 0.09, botCount: 7, aggroMul: 1.4, patienceMul: 0.82, timeMul: 0.85, payout: 2.6,
  },
  {
    id: "maelstrom", name: "Maelstrom", cc: "200cc", color: "#ff5470",
    blurb: "Every course mirrored again, and they do not miss.",
    botSkill: 0.14, botCount: 7, aggroMul: 1.8, patienceMul: 0.68, timeMul: 0.7, payout: 4, mirror: true,
  },
];

export const TIER_BY_ID = new Map(TIERS.map((t) => [t.id, t]));

// ------------------------------------------------------------------ building courses
function transformHole(base, { mirror = false, reverse = false, widthMul = 1, timeMul = 1 }) {
  const mx = mirror ? -1 : 1;
  const path = base.path.map((p) => ({ x: p.x * mx, z: p.z }));
  if (reverse) path.reverse();
  return {
    time: Math.max(45, Math.round(base.time * timeMul)),
    width: +((base.width ?? 13) * widthMul).toFixed(2),
    path,
    islands: (base.islands ?? []).map((i) => ({ ...i, x: i.x * mx })),
    rocks: (base.rocks ?? []).map((r) => ({ ...r, x: r.x * mx })),
  };
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

/**
 * What makes an authored hole a legal hole.
 *
 * A hole should read as one long river: it marches from tee to flag and gets
 * its interest from kinks and doglegs, never by curling back on itself. These
 * rules check that (straightness), that it stays inside the terrain's mountain
 * ring (maxR), that its legs are long enough for a bend to read as a bend, and
 * that every authored island, spire and piece of furniture actually sits in the
 * water it is meant to be in.
 *
 * It is all pure arithmetic on the hole object — no three.js, no renderer — so
 * both `scripts/checkholes.mjs` (which fails the build) and the admin level
 * editor (which shows the same complaints as you drag) run exactly these.
 */
import { holeFalls } from "./holes.js";
import { FALL_RUN, FALL_MIN_DROP, ZONE_MAX, CHANNEL_MAX_PTS, CHANNEL_MAX_SEGS } from "./limits.js";
import { holeLegs } from "./channel.js";
import { buildRoute } from "./route.js";

export const PLAY_R = 88; // keep every waypoint inside this, see terrain.js MOUNT_INSET
export const MIN_STRAIGHTNESS = 0.72; // chord / walked length — below this it loops
export const MIN_LEG = 26; // shorter than this and a "bend" is just a wobble
const MAX_TURN = 80; // degrees; past this the elbow folds back on itself
const ON_LINE = 2.5; // furniture that spans the channel has to be this centred
const MAX_DROP = 9; // taller than this and the curtain outgrows the terrain ramp
const MIN_CLEAR = 1.6; // headroom under a deck or a cave roof, in stone heights
const END_ROOM = 14; // keep furniture off the tee apron and out of the cup
// A shortcut is a bargain: less water to cover, down a tighter line. These are
// the bounds on that bargain. Too small a saving and nobody would risk it; too
// large and nobody would ever run the main line. It also has to be a *separate*
// river for long enough to commit to, not a bulge in the side of this one.
const CUT_MIN_SAVE = 0.08, CUT_MAX_SAVE = 0.4;
const CUT_MIN_W = 5.5; // narrower than this and the stone cannot be aimed down it
const CUT_ISLE = 7; // dry ground that has to stand between the two channels
const CUT_MIN_RUN = 30; // a fork and a rejoin closer than this is not a choice
const JUNCTION = 3; // how far off the main line a branch may start or end

/** every complaint about a hole, worst first is not attempted — it is a list */
export function holeWarnings(h, { minLeg = MIN_LEG } = {}) {
  const warn = [];
  checkShape(h, warn, minLeg);
  checkBranches(h, warn);
  checkProps(h, warn);
  return warn;
}

/** the one-line summary checkholes.mjs prints next to each hole */
export function holeStats(h) {
  const p = h.path;
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
  return { total, maxR, minLeg, maxTurn, straight: chord / total };
}

function checkShape(h, warn, minLegAllowed) {
  const p = h.path;
  const { total, maxR, minLeg, maxTurn, straight } = holeStats(h);

  if (maxR > PLAY_R) warn.push(`maxR ${maxR.toFixed(1)} > ${PLAY_R}`);
  // Straightness is measured against the best line, not the main one. A hole
  // with a shortcut in it bulges on purpose — that bulge is what the shortcut
  // is short of — and it is only curling back on itself if it does so by every
  // route available.
  const walked = h.branches?.length ? Math.min(total, buildRoute(h).best) : total;
  const bestStraight = walked ? Math.hypot(p.at(-1).x - p[0].x, p.at(-1).z - p[0].z) / walked : straight;
  if (bestStraight < MIN_STRAIGHTNESS) warn.push(`straightness ${bestStraight.toFixed(2)} — loops back`);
  if (minLeg < minLegAllowed) warn.push(`leg ${minLeg.toFixed(0)}u too short`);
  if (maxTurn > MAX_TURN) warn.push(`turn ${maxTurn.toFixed(0)}deg folds back`);
  if (p.length > CHANNEL_MAX_PTS) warn.push(`${p.length} pts > shader cap ${CHANNEL_MAX_PTS}`);
  if (!total) warn.push("the tee is on the flag");

  // islands are rest stops: they must sit on the centreline. spires are
  // hazards in the channel: in the water, but not plugging the whole width.
  for (const isl of h.islands ?? []) {
    const line = ownerLine(h, isl.x, isl.z);
    if (line.n.d > 3) warn.push(`island (${isl.x},${isl.z}) is ${line.n.d.toFixed(1)}u off the ${line.tag}`);
  }
  for (const o of h.rocks ?? []) {
    const line = ownerLine(h, o.x, o.z);
    const d = line.n.d, w = line.width;
    if (d - o.r > w - 1) warn.push(`spire (${o.x},${o.z}) is beached (${d.toFixed(1)}u out)`);
    if (d + o.r > w && d - o.r < -w) warn.push(`spire (${o.x},${o.z}) plugs the channel`);
    for (const isl of h.islands ?? []) {
      if (Math.hypot(o.x - isl.x, o.z - isl.z) < o.r + isl.r) warn.push(`spire (${o.x},${o.z}) sits on an island`);
    }
  }
}

/**
 * Shortcuts. A branch is only worth having if choosing it is a decision, and it
 * is only a decision if the two lines are really apart, really different in
 * length, and really different to play. So: it must leave and rejoin the main
 * line (or it is a lagoon), it must run long enough to commit to, there has to
 * be dry ground standing between it and the river it left, and the water it
 * saves has to be paid for in width. A branch that fails these still renders —
 * the geometry doesn't care — it just isn't a shortcut, it's scenery.
 */
function checkBranches(h, warn) {
  const list = h.branches ?? [];
  if (!list.length) return;
  const p = h.path;
  const legs = holeLegs(h);
  if (legs.length > CHANNEL_MAX_SEGS) {
    warn.push(`${legs.length} channel legs > shader cap ${CHANNEL_MAX_SEGS}`);
  }
  const route = buildRoute(h);

  list.forEach((b, bi) => {
    const at = `branch ${bi + 1}`;
    const bp = b.path ?? [];
    if (bp.length < 2) { warn.push(`${at} needs at least two points`); return; }
    const w = b.width ?? +(h.width * 0.62).toFixed(2);
    if (w < CUT_MIN_W) warn.push(`${at} is ${w}u wide — too tight to aim down`);
    if (w > h.width - 1.5) warn.push(`${at} is ${w}u, no tighter than the river it leaves`);
    for (const q of bp) {
      if (Math.hypot(q.x, q.z) > PLAY_R) warn.push(`${at} point (${q.x},${q.z}) is outside the playable ring`);
    }

    // both ends have to be on the main line, in the right order, far enough
    // apart that taking the branch is a leg of the hole rather than a wobble
    const a = nearest(bp[0].x, bp[0].z, p);
    const z = nearest(bp.at(-1).x, bp.at(-1).z, p);
    if (a.d > JUNCTION) warn.push(`${at} leaves the river ${a.d.toFixed(1)}u off it — it starts nowhere`);
    if (z.d > JUNCTION) warn.push(`${at} rejoins ${z.d.toFixed(1)}u off the river — it ends nowhere`);
    const run = z.s - a.s;
    if (run <= 0) warn.push(`${at} rejoins upstream of where it forks`);
    else if (run < CUT_MIN_RUN) warn.push(`${at} forks and rejoins ${run.toFixed(0)}u apart — not a choice`);

    // the gamble itself: how much less water, and is there land in between
    const cut = pathLength(bp);
    const save = run > 0 ? (run - cut) / run : 0;
    if (run > 0 && save < CUT_MIN_SAVE) {
      warn.push(`${at} saves ${(save * 100).toFixed(0)}% — the long way round is not a shortcut`);
    }
    if (save > CUT_MAX_SAVE) warn.push(`${at} saves ${(save * 100).toFixed(0)}% — nobody would run the main line`);
    let apart = 0;
    for (const q of bp.slice(1, -1)) apart = Math.max(apart, nearest(q.x, q.z, p).d);
    if (apart < h.width + w + CUT_ISLE) {
      warn.push(`${at} runs ${apart.toFixed(0)}u off the river — no bank between them, it is one wide pool`);
    }

    // and it is a river too: no folding back on itself
    for (let i = 1; i < bp.length - 1; i++) {
      const ax = bp[i].x - bp[i - 1].x, az = bp[i].z - bp[i - 1].z;
      const cx = bp[i + 1].x - bp[i].x, cz = bp[i + 1].z - bp[i].z;
      const ang = Math.abs(Math.atan2(ax * cz - az * cx, ax * cx + az * cz)) * 180 / Math.PI;
      if (ang > MAX_TURN) warn.push(`${at} turn ${ang.toFixed(0)}deg folds back`);
    }
  });

  if (!route.forks().length) warn.push("branches are authored but the route never forks");
}

/**
 * The furniture pass. Three families of rule:
 *
 *  - anything that spans the water (a lip, a deck, a tunnel) has to be centred
 *    on the line and sit wholly inside one straight leg, because props.js
 *    builds it along a single flow direction and would otherwise poke out of
 *    the bank on the outside of the bend;
 *  - nothing may overlap anything else, including itself, along the fairway;
 *  - a waterfall has to divide the map cleanly, tee on one side and flag on the
 *    other, with the path crossing it exactly once going downstream.
 */
function checkProps(h, warn) {
  const p = h.path;
  const spans = []; // stretches of river the furniture owns, for the overlap sweep

  // `across` is how much of the channel the thing occupies either side of its
  // own centre — a number, or "span" for the things that reach bank to bank (a
  // lip, a deck, a tunnel). A mill wheel is only as wide as its paddles, which
  // is the whole point of it. Everything is measured against the line it is
  // actually standing in, so a log laid across a shortcut is judged by the
  // shortcut's width and has to fit the shortcut's legs.
  const place = (list, tag, halfLen, across) => {
    for (const o of list ?? []) {
      const line = ownerLine(h, o.x, o.z);
      const n = line.n;
      const half = halfLen(o);
      const wide = across === "span" ? line.width : across;
      const at = `${tag} (${o.x},${o.z})`;
      if (across === "span" && n.d > ON_LINE) warn.push(`${at} is ${n.d.toFixed(1)}u off the ${line.tag}`);
      if (n.before < half || n.after < half) {
        warn.push(`${at} needs ${half.toFixed(0)}u of straight leg either side, has ${Math.min(n.before, n.after).toFixed(0)}u`);
      }
      if (line.main && (n.s < END_ROOM || line.len - n.s < END_ROOM)) {
        warn.push(`${at} is on top of the tee or the cup`);
      }
      spans.push({ at, line: line.i, a: n.s - half, b: n.s + half, off: n.off, across: wide });
    }
  };

  // a lip owns the strip the lake shader stops rendering, plus its churn — and
  // a dam is a lip, so it is checked as the fall it becomes (holes.js holeFalls)
  place(holeFalls(h), "fall", () => FALL_RUN + 3, "span");
  // a wheel is as long as it is tall and needs room for the mill on the bank
  place(h.wheels, "wheel", (w) => (w.r ?? 4) + 2, 1.6);
  place(h.bridges, "bridge", () => 4, "span");
  place(h.caves, "cave", (c) => (c.len ?? 20) / 2 + 3, "span");
  place(h.logs, "log", () => 3, "span");

  for (const w of h.wheels ?? []) {
    const line = ownerLine(h, w.x, w.z);
    const d = line.n.d;
    const r = w.r ?? 4;
    if (d + 1.5 > line.width - 1) warn.push(`wheel (${w.x},${w.z}) is grinding the bank`);
    if (line.width - (d + 1.5) < 3 && d - 1.5 < 3) warn.push(`wheel (${w.x},${w.z}) leaves no gap to either side`);
    if (r < 3 || r > 6) warn.push(`wheel (${w.x},${w.z}) radius ${r} outside 3..6`);
    if (w.bank !== 1 && w.bank !== -1) warn.push(`wheel (${w.x},${w.z}) needs bank: 1 or -1 for its mill`);
  }
  for (const b of h.bridges ?? []) {
    if ((b.clear ?? 0) < MIN_CLEAR) warn.push(`bridge (${b.x},${b.z}) clearance ${b.clear} is unskippable`);
    if ((b.piers ?? 0) > 3) warn.push(`bridge (${b.x},${b.z}) has ${b.piers} piers — a wall, not a bridge`);
  }
  for (const c of h.caves ?? []) {
    if ((c.clear ?? 0) < MIN_CLEAR + 1) warn.push(`cave (${c.x},${c.z}) roof at ${c.clear} is too low to enter`);
    if ((c.len ?? 0) < 10) warn.push(`cave (${c.x},${c.z}) is a doorway, not a tunnel`);
  }
  for (const l of h.logs ?? []) {
    const at = `log (${l.x},${l.z})`;
    // the low end is the whole point of a fallen tree, so it has to be low
    // enough to matter and the high end high enough to be the way through
    if ((l.clear ?? 0) < MIN_CLEAR - 0.4) warn.push(`${at} low end ${l.clear} is on the water`);
    if ((l.tilt ?? 0) < 1.2) warn.push(`${at} tilt ${l.tilt} — that is a bridge, not a fallen tree`);
    if ((l.clear ?? 0) + (l.tilt ?? 0) > 7) warn.push(`${at} high end clears everything — no hazard`);
    if (l.bank !== 1 && l.bank !== -1) warn.push(`${at} needs bank: 1 or -1 for its low end`);
  }
  for (const d of h.dams ?? []) {
    const at = `dam (${d.x},${d.z})`;
    const width = ownerLine(h, d.x, d.z).width;
    const gap = d.gap ?? 2.4;
    const notch = d.notch ?? 0;
    // a gap you cannot thread is a wall, and one you cannot miss is not a dam
    if (gap < 1.8) warn.push(`${at} notch ${gap}u is narrower than the stone deserves`);
    if (gap > width) warn.push(`${at} notch ${gap}u is most of the river`);
    if (Math.abs(notch) + gap / 2 > width - 0.8) warn.push(`${at} notch is up against the bank`);
  }

  // spires and islands go under the same "not inside the furniture" sweep, so a
  // pillar can't grow through a bridge deck or a cave roof
  for (const o of [...(h.rocks ?? []), ...(h.islands ?? [])]) {
    const line = ownerLine(h, o.x, o.z);
    const n = line.n;
    for (const s of spans) {
      if (s.line !== line.i) continue; // different river; arc lengths aren't comparable
      if (n.s > s.a && n.s < s.b && Math.abs(n.off - s.off) - (o.r ?? 0) < s.across) {
        warn.push(`(${o.x},${o.z}) is inside the ${s.at}`);
      }
    }
  }
  // the overlap sweep runs per line: two things at the same arc length down
  // different channels are nowhere near each other
  spans.sort((a, b) => (a.line - b.line) || (a.a - b.a));
  for (let i = 1; i < spans.length; i++) {
    const prev = spans[i - 1], cur = spans[i];
    if (cur.line !== prev.line || cur.a >= prev.b) continue;
    if (Math.abs(cur.off - prev.off) < cur.across + prev.across) warn.push(`${prev.at} and ${cur.at} overlap`);
  }

  checkFalls(h, warn);
  checkWater(h, warn);
}

/**
 * The water's own character. Zones are laid along the flow and painted by the
 * lake shader from a fixed-size uniform array, so there is a hard cap on how
 * many a hole may have; past that they would silently stop existing. The rest
 * is playability: a current you cannot see is a current that feels like a bug,
 * and a hazard patch has to leave the fairway passable.
 */
function checkWater(h, warn) {
  const zones = [...(h.rapids ?? []), ...(h.ice ?? []), ...(h.weeds ?? [])];
  if (zones.length > ZONE_MAX) warn.push(`${zones.length} water patches > shader cap ${ZONE_MAX}`);
  const flow = h.flow ?? 0;
  if (flow < 0) warn.push(`flow ${flow} runs backwards — reverse the path instead`);
  if (flow > 9) warn.push(`flow ${flow} is faster than a stone can be thrown`);
  if (!flow && (h.rapids?.length)) warn.push("rapids on a still hole — set `flow` or drop them");
  for (const [list, tag, span] of [[h.rapids, "rapids", true], [h.ice, "ice", true], [h.weeds, "weed", false]]) {
    for (const z of list ?? []) {
      const line = ownerLine(h, z.x, z.z);
      const n = line.n;
      const at = `${tag} (${z.x},${z.z})`;
      if (span) {
        if (n.d > ON_LINE) warn.push(`${at} spans the channel but is ${n.d.toFixed(1)}u off the ${line.tag}`);
        if ((z.len ?? 0) < 10) warn.push(`${at} is ${z.len ?? 0}u long — too short to read as anything`);
      } else {
        if (n.d - (z.r ?? 0) > line.width) warn.push(`${at} is on dry land`);
        // a bed right across the river is a wall of treacle with no way past
        if ((z.r ?? 0) > line.width * 0.75) warn.push(`${at} radius ${z.r} leaves no clean water beside it`);
      }
    }
  }
}

/**
 * Each lip is a half-plane cut across the whole map: props.js and water.js ask
 * only "is this point upstream of it", never "how far along the path". So the
 * fairway must cross a lip exactly once, downhill, and no two lips may put the
 * same stretch of river on different shelves.
 */
function checkFalls(h, warn) {
  const p = h.path;
  for (const f of holeFalls(h)) {
    const at = `fall (${f.x},${f.z})`;
    const drop = f.drop ?? 0;
    if (drop < FALL_MIN_DROP || drop > MAX_DROP) warn.push(`${at} drop ${drop} outside ${FALL_MIN_DROP}..${MAX_DROP}`);
    const n = nearest(f.x, f.z, p);
    const side = (q) => (q.x - f.x) * n.ux + (q.z - f.z) * n.uz;
    let flips = 0;
    for (let i = 1; i < p.length; i++) if (side(p[i]) >= 0 !== side(p[i - 1]) >= 0) flips++;
    if (flips !== 1) warn.push(`${at} is crossed ${flips}x — the river runs back over its own lip`);
    if (side(p[0]) >= 0) warn.push(`${at} puts the tee below the drop`);
    if (side(p.at(-1)) < 0) warn.push(`${at} puts the flag above the drop`);
    // A lip is a half-plane across the whole map, so a shortcut has to agree
    // with it: cross once going down, or stay wholly on one shelf. Twice and
    // the branch climbs back up its own waterfall.
    (h.branches ?? []).forEach((b, bi) => {
      const bp = b.path ?? [];
      let f = 0;
      for (let i = 1; i < bp.length; i++) if (side(bp[i]) >= 0 !== side(bp[i - 1]) >= 0) f++;
      if (f > 1) warn.push(`${at} is crossed ${f}x by branch ${bi + 1} — the shortcut runs back uphill`);
    });
  }
}

// -------------------------------------------------------------------- geometry
export function distToPath(x, z, path) {
  return nearest(x, z, path).d;
}

/** the main line and every branch, as things furniture can be standing in */
export function holeLines(h) {
  const lines = [{ i: 0, tag: "line", main: true, path: h.path, width: h.width }];
  (h.branches ?? []).forEach((b, i) => {
    if (b?.path?.length >= 2) {
      lines.push({
        i: i + 1, tag: `branch ${i + 1}`, main: false,
        path: b.path, width: b.width ?? +(h.width * 0.62).toFixed(2),
      });
    }
  });
  for (const l of lines) l.len = pathLength(l.path);
  return lines;
}

/**
 * Which channel a prop belongs to. Nearest by *edge*, matching channel.js, so
 * something dropped in a shortcut is judged against the shortcut — its width,
 * its legs, its arc length — and not against the river fifty metres away.
 */
export function ownerLine(h, x, z) {
  let best = null, bestEdge = Infinity;
  for (const l of holeLines(h)) {
    const n = nearest(x, z, l.path);
    const edge = n.d - l.width;
    if (edge < bestEdge) { bestEdge = edge; best = { ...l, n }; }
  }
  return best;
}

/**
 * Closest point on the fairway, with everything the furniture checks need:
 * which leg it landed on, how far along the whole path it is, how much of that
 * leg is left either side of it, and the unit flow direction there. This is a
 * copy of water.js's distToPath/pathTangentAt without the renderer — they have
 * to agree, so if you change the projection in one, change it in the other.
 */
export function nearest(x, z, path) {
  let best = { d: Infinity, s: 0, leg: 0, before: 0, after: 0, ux: 0, uz: -1, off: 0 };
  let walked = 0;
  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i], b = path[i + 1];
    const bax = b.x - a.x, baz = b.z - a.z;
    const pax = x - a.x, paz = z - a.z;
    const len2 = bax * bax + baz * baz || 1;
    const len = Math.sqrt(len2);
    const h = Math.min(1, Math.max(0, (pax * bax + paz * baz) / len2));
    const d = Math.hypot(pax - bax * h, paz - baz * h);
    if (d < best.d) {
      const ux = bax / len, uz = baz / len;
      best = {
        d, s: walked + h * len, leg: i,
        before: h * len, after: (1 - h) * len,
        ux, uz,
        // signed distance across the channel, so two things on the same stretch
        // of river can be told apart by which bank they lean toward
        off: (pax - bax * h) * -uz + (paz - baz * h) * ux,
      };
    }
    walked += len;
  }
  return best;
}

export function pathLength(path) {
  let n = 0;
  for (let i = 1; i < path.length; i++) n += Math.hypot(path[i].x - path[i - 1].x, path[i].z - path[i - 1].z);
  return n;
}

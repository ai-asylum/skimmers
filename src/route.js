/**
 * Which way is forward, when there is more than one way.
 *
 * As long as a hole was a single polyline, "how far along are you" was just the
 * arc length of your projection onto it, and everything — the rubber band, the
 * standings, the bots' next waypoint — could be written against that one
 * number. A hole with a shortcut in it breaks that: two stones the same arc
 * length down two different lines are not level, and a stone that has taken the
 * branch is not behind just because the branch's own arc length restarts.
 *
 * So progress is turned around and measured from the other end. The route is a
 * little directed graph — the main line, plus each branch spliced into it at the
 * point it leaves and the point it comes back — and every node knows the
 * shortest distance still to swim to the flag. A stone's standing is the
 * distance it has left by the best line available to it, which is one number
 * again, is honest across branches, and drops the moment a gamble pays.
 *
 *   const route = buildRoute(hole);
 *   route.remainingAt(x, z);        // metres of water still to cover
 *   route.progressAt(x, z);         // the same, as 0..1 off the main line
 *   route.aheadOf(x, z, 40, nerve); // somewhere to aim, forks decided by nerve
 *
 * The graph is built once per hole and is tiny — a dozen nodes — so none of this
 * is worth caching beyond the Route object itself.
 */
import { CHANNEL_W } from "./limits.js";
import { channelAt, BRANCH_W } from "./channel.js";

/** how close two authored points have to be to count as the same junction */
const WELD = 0.75;

const key = (x, z) => `${Math.round(x * 100)},${Math.round(z * 100)}`;

/**
 * The route through a hole. `hole` needs `path`; `branches` are optional side
 * channels whose ends are expected to sit on the main line (holerules.js checks
 * that they do — this will weld them to the nearest point regardless, so a
 * slightly-off authored branch degrades into a slightly-off junction instead of
 * an island).
 */
export function buildRoute(hole, halfWidth = hole?.width ?? CHANNEL_W) {
  const main = hole?.path ?? [];
  const branches = hole?.branches ?? [];
  const nodes = []; // { x, z, dist, out: [edgeIdx] }
  const byKey = new Map();
  const edges = []; // { a, b, len, w, branch }

  const node = (x, z) => {
    const k = key(x, z);
    let i = byKey.get(k);
    if (i === undefined) {
      i = nodes.length;
      nodes.push({ x, z, dist: Infinity, out: [] });
      byKey.set(k, i);
    }
    return i;
  };

  // The main line first, so every branch has something to weld onto. Junction
  // points get spliced in as we go: a branch may leave from the middle of a leg
  // and there is no reason to make the author land on a waypoint.
  const spine = main.map((p) => node(p.x, p.z)); // in order, tee -> flag
  const cuts = new Map(); // leg index -> [{ t, n }] extra nodes along that leg

  const weld = (p) => {
    const hit = nearestOnPath(main, p.x, p.z);
    if (!hit) return node(p.x, p.z);
    // close enough to an end of the leg: reuse that waypoint rather than
    // planting a second node a few centimetres away from it
    const a = main[hit.i], b = main[hit.i + 1];
    if (Math.hypot(p.x - a.x, p.z - a.z) < WELD) return spine[hit.i];
    if (Math.hypot(p.x - b.x, p.z - b.z) < WELD) return spine[hit.i + 1];
    const n = node(hit.x, hit.z);
    if (!cuts.has(hit.i)) cuts.set(hit.i, []);
    cuts.get(hit.i).push({ t: hit.t, n });
    return n;
  };

  const branchRuns = branches
    .filter((b) => b?.path?.length >= 2)
    .map((b) => ({
      w: b.width ?? +(halfWidth * BRANCH_W).toFixed(2),
      from: weld(b.path[0]),
      to: weld(b.path[b.path.length - 1]),
      mid: b.path.slice(1, -1).map((p) => node(p.x, p.z)),
    }));

  const edge = (a, b, w, branch) => {
    if (a === b) return;
    const A = nodes[a], B = nodes[b];
    A.out.push(edges.length);
    edges.push({ a, b, len: Math.hypot(B.x - A.x, B.z - A.z), w, branch });
  };

  for (let i = 0; i < spine.length - 1; i++) {
    const extra = (cuts.get(i) ?? []).sort((p, q) => p.t - q.t);
    let prev = spine[i];
    for (const c of extra) { edge(prev, c.n, halfWidth, false); prev = c.n; }
    edge(prev, spine[i + 1], halfWidth, false);
  }
  for (const b of branchRuns) {
    let prev = b.from;
    for (const m of b.mid) { edge(prev, m, b.w, true); prev = m; }
    edge(prev, b.to, b.w, true);
  }

  // Distance from every node to the flag, following the water downstream. The
  // graph runs one way and is a handful of nodes, so relaxing it |V| times is
  // both simpler and faster than any queue would be.
  const flag = spine.length ? spine[spine.length - 1] : 0;
  if (nodes[flag]) nodes[flag].dist = 0;
  for (let pass = 0; pass < nodes.length; pass++) {
    let moved = false;
    for (const e of edges) {
      const via = nodes[e.b].dist + e.len;
      if (via < nodes[e.a].dist - 1e-6) { nodes[e.a].dist = via; moved = true; }
    }
    if (!moved) break;
  }

  const legs = edges.map((e) => {
    const A = nodes[e.a], B = nodes[e.b];
    const dx = B.x - A.x, dz = B.z - A.z;
    const len = e.len || 1;
    return { ax: A.x, az: A.z, bx: B.x, bz: B.z, w: e.w, ux: dx / len, uz: dz / len, len, branch: e.branch };
  });

  const teeDist = nodes[spine[0]]?.dist ?? 0;
  // The yardstick is the main line even when a branch is shorter, so a hole's
  // progress bar means the same thing whichever way it is played and a shortcut
  // shows up as the jump forward it is.
  const mainLen = mainLength(main);

  return {
    hole, nodes, edges, legs, flag, tee: spine[0] ?? 0,
    /** length of the main line, tee to flag */
    length: mainLen,
    /** the shortest way home from the tee — less than `length` if a branch pays */
    best: teeDist,
    branches: branchRuns.length,
    remainingAt: (x, z) => remainingAt(nodes, legs, edges, x, z),
    progressAt(x, z) {
      if (!mainLen) return 0;
      return Math.min(1, Math.max(0, 1 - remainingAt(nodes, legs, edges, x, z) / mainLen));
    },
    aheadOf: (x, z, reach = 40, nerve = 0) => aheadOf(nodes, legs, edges, x, z, reach, nerve),
    waypointAhead: (x, z, reach = 40, nerve = 0) => waypointAhead(nodes, legs, edges, x, z, reach, nerve),
    /** the closest point on any of the hole's water — the shortest way back in */
    nearestPoint(x, z) {
      const p = project(legs, x, z);
      if (!p) return { x, z, d: 0 };
      const l = legs[p.i];
      return { x: l.ax + l.ux * p.along, z: l.az + l.uz * p.along, d: p.d, branch: p.branch };
    },
    forkAt: (x, z) => forkAt(nodes, legs, edges, x, z),
    forks: () => forks(nodes, edges),
  };
}

/** the route of a hole with no branches: the plain polyline, same interface */
export const pathRoute = (path, halfWidth) => buildRoute({ path }, halfWidth);

function mainLength(path) {
  let s = 0;
  for (let i = 1; i < path.length; i++) s += Math.hypot(path[i].x - path[i - 1].x, path[i].z - path[i - 1].z);
  return s;
}

/** nearest point on a polyline: { x, z, i, t, d } with t the fraction along leg i */
function nearestOnPath(path, x, z) {
  if (!path || path.length < 2) return null;
  let best = null;
  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i], b = path[i + 1];
    const bax = b.x - a.x, baz = b.z - a.z;
    const len2 = bax * bax + baz * baz || 1;
    const t = Math.min(1, Math.max(0, ((x - a.x) * bax + (z - a.z) * baz) / len2));
    const cx = a.x + bax * t, cz = a.z + baz * t;
    const d = Math.hypot(x - cx, z - cz);
    if (!best || d < best.d) best = { x: cx, z: cz, i, t, d };
  }
  return best;
}

/** where on the route a world point sits: which leg owns it and how far along */
function project(legs, x, z) {
  const c = channelAt(legs, x, z);
  if (c.i < 0) return null;
  return { i: c.i, along: c.along, d: c.d, w: c.w, branch: c.branch };
}

function remainingAt(nodes, legs, edges, x, z) {
  const p = project(legs, x, z);
  if (!p) return 0;
  const e = edges[p.i];
  return (e.len - p.along) + nodes[e.b].dist;
}

/**
 * Somewhere to aim: a point about `reach` further down the route. `nerve` is
 * -1..1 and only matters at a fork — at 1 the walk takes whichever line gets
 * home in the least water, at -1 it stays on the main line, and in between it
 * wants the shortcut but not at any price. Returns `{ x, z, branch, fork }`:
 * `fork` is true when the choice was live, which is what the bots weigh.
 */
function aheadOf(nodes, legs, edges, x, z, reach, nerve) {
  const p = project(legs, x, z);
  if (!p) return { x, z, branch: false, fork: false };
  let ei = p.i;
  let left = reach - (edges[ei].len - p.along);
  let branch = edges[ei].branch, sawFork = false;
  // still short of the end of this leg: the aim point is on it
  if (left <= 0) {
    const l = legs[ei], s = p.along + reach;
    return { x: l.ax + l.ux * s, z: l.az + l.uz * s, branch, fork: false };
  }
  for (let hops = 0; hops < nodes.length + 2; hops++) {
    const outs = nodes[edges[ei].b].out;
    if (!outs.length) return { x: legs[ei].bx, z: legs[ei].bz, branch, fork: sawFork };
    if (outs.length > 1) sawFork = true;
    ei = outs.length > 1 ? chooseFork(nodes, edges, outs, nerve) : outs[0];
    branch = edges[ei].branch;
    if (left <= edges[ei].len) {
      const l = legs[ei];
      return { x: l.ax + l.ux * left, z: l.az + l.uz * left, branch, fork: sawFork };
    }
    left -= edges[ei].len;
  }
  return { x: legs[ei].bx, z: legs[ei].bz, branch, fork: sawFork };
}

/**
 * The furthest junction downstream that is still within `reach` — the bend a
 * thrower should be aiming at rather than a point in open water. This is the
 * old buoy-line rule (walk the waypoints, take the last one you could reach,
 * and if you are already sitting on it aim at the next) with a fork in it: past
 * a split only the nodes down the chosen line are candidates.
 *
 * Aiming at shared junctions rather than at "40 metres that way" matters more
 * than it looks: it is what keeps a field of rivals converging on the same
 * corners, and with it the rubber band has something to bite on.
 */
function waypointAhead(nodes, legs, edges, x, z, reach, nerve) {
  const p = project(legs, x, z);
  if (!p) return { x, z, branch: false, fork: false };
  // the junctions ahead, in the order they would be swum, one line at a fork
  const ahead = [];
  let ei = p.i, sawFork = false;
  for (let hops = 0; hops < nodes.length + 2; hops++) {
    const n = nodes[edges[ei].b];
    ahead.push({ x: n.x, z: n.z, branch: edges[ei].branch, fork: sawFork });
    if (!n.out.length) break;
    if (n.out.length > 1) sawFork = true;
    ei = n.out.length > 1 ? chooseFork(nodes, edges, n.out, nerve) : n.out[0];
  }
  if (!ahead.length) return { x, z, branch: false, fork: false };
  let pick = -1;
  for (let i = 0; i < ahead.length; i++) {
    if (Math.hypot(ahead[i].x - x, ahead[i].z - z) < reach) pick = i;
    else if (pick >= 0) break; // out of range again: the last one in it is the aim
  }
  if (pick < 0) return ahead[0]; // nothing in reach: head for the next bend anyway
  // standing on it already, so aim at the bend after it
  const at = ahead[pick];
  if (Math.hypot(at.x - x, at.z - z) < 7 && pick + 1 < ahead.length) return ahead[pick + 1];
  return at;
}

/**
 * Which way to go at a fork. The cheap line is the one with the least water
 * left after it; nerve buys the willingness to take it, and the tighter it is
 * the more nerve it costs — a shortcut you can barely fit down should not be
 * the obvious play for a timid bot.
 */
function chooseFork(nodes, edges, outs, nerve) {
  let bestMain = null, bestAlt = null;
  for (const i of outs) {
    const e = edges[i];
    const cost = e.len + nodes[e.b].dist;
    const slot = e.branch ? "alt" : "main";
    if (slot === "main" && (!bestMain || cost < bestMain.cost)) bestMain = { i, cost, e };
    if (slot === "alt" && (!bestAlt || cost < bestAlt.cost)) bestAlt = { i, cost, e };
  }
  if (!bestAlt) return bestMain?.i ?? outs[0];
  if (!bestMain) return bestAlt.i;
  // What the gamble is worth: the fraction of the remaining hole it saves.
  // What it costs: how much tighter the water is than the line being left. A
  // bold bot will take a narrow line for very little, a timid one wants the
  // shortcut to be both roomy and a real saving — and nobody swims down a
  // squeeze that saves nothing, which is the case that used to slip through.
  const saving = (bestMain.cost - bestAlt.cost) / Math.max(1, bestMain.cost);
  const squeeze = Math.max(0, 1 - bestAlt.e.w / Math.max(1, bestMain.e.w));
  return saving > squeeze * (0.35 - 0.3 * Math.min(1, Math.max(-1, nerve))) ? bestAlt.i : bestMain.i;
}

/** the fork this point is approaching, if one is close enough to matter */
function forkAt(nodes, legs, edges, x, z, within = 55) {
  const p = project(legs, x, z);
  if (!p) return null;
  let ei = p.i, run = edges[ei].len - p.along;
  for (let hops = 0; hops < nodes.length + 2 && run < within; hops++) {
    const outs = nodes[edges[ei].b].out;
    if (outs.length > 1) {
      const n = nodes[edges[ei].b];
      return {
        x: n.x, z: n.z, at: run,
        options: outs.map((i) => ({
          branch: edges[i].branch, w: edges[i].w,
          home: edges[i].len + nodes[edges[i].b].dist,
        })),
      };
    }
    if (!outs.length) break;
    ei = outs[0];
    run += edges[ei].len;
  }
  return null;
}

/** every place the route splits, for signage and for the rules */
function forks(nodes, edges) {
  const out = [];
  nodes.forEach((n, i) => {
    if (n.out.length < 2) return;
    out.push({
      i, x: n.x, z: n.z,
      options: n.out.map((e) => ({
        branch: edges[e].branch, w: edges[e].w, home: edges[e].len + nodes[edges[e].b].dist,
      })),
    });
  });
  return out;
}

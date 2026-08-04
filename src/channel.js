/**
 * The shape of a hole's water, as a list of legs.
 *
 * A hole used to be one polyline and one half-width, and the lake was every
 * point within that width of it. Now a hole may also carry `branches` — side
 * channels that leave the main line and rejoin it further down, usually
 * narrower and always shorter, which is the whole reason to gamble on one. So
 * the water is no longer "distance to a polyline": it is the union of a set of
 * capsules, each with its own width.
 *
 *   legs   [{ ax, az, bx, bz, w, ux, uz, len, branch }]
 *
 * `channelAt` picks the leg whose *edge* is nearest — smallest `d - w` — not
 * the leg whose centre is nearest. That one choice does a lot of work: it makes
 * the water the union of the channels rather than the wider one swallowing the
 * narrower, and it means that once you are down inside a narrow branch, the
 * branch is the leg that answers for the current, the flow ribbons, the bed and
 * which way is downstream. Standing between two lines it picks the one you are
 * closer to getting wet in, which is also the right answer.
 *
 * Everything that needs to know where the water is builds its legs from here:
 * the lake (water.js), the ground it is carved into (terrain.js), the 2D raster
 * the minimap and the level editor draw (channelrender.js) and the rules
 * (holerules.js). The lake shader has its own copy of `channelAt` in GLSL and
 * the two have to agree, so change them together.
 */
import { CHANNEL_W } from "./limits.js";

/** the width of a side channel when it doesn't name one: a good deal tighter */
export const BRANCH_W = 0.62;

/**
 * A hole's water as legs. `hole` needs `path` and may have `width` (half-width
 * of the main channel) and `branches: [{ path, width }]`.
 */
export function holeLegs(hole, halfWidth = hole?.width ?? CHANNEL_W) {
  const legs = [];
  pushLegs(legs, hole?.path, halfWidth, false);
  for (const b of hole?.branches ?? []) {
    pushLegs(legs, b.path, b.width ?? +(halfWidth * BRANCH_W).toFixed(2), true);
  }
  return legs;
}

/** legs for a bare polyline, for callers that have no hole object */
export function pathLegs(path, halfWidth = CHANNEL_W) {
  const legs = [];
  pushLegs(legs, path, halfWidth, false);
  return legs;
}

function pushLegs(legs, path, w, branch) {
  if (!path || path.length < 2) return;
  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i], b = path[i + 1];
    const dx = b.x - a.x, dz = b.z - a.z;
    const len = Math.hypot(dx, dz) || 1;
    legs.push({ ax: a.x, az: a.z, bx: b.x, bz: b.z, w, ux: dx / len, uz: dz / len, len, branch });
  }
}

const _hit = { d: 0, w: CHANNEL_W, ux: 0, uz: -1, i: -1, branch: false, along: 0 };

/**
 * The leg that owns this point: how far off its centreline you are, how wide it
 * is there, and which way it runs. Returns a shared object — read it, don't
 * keep it. `d` is Infinity-ish and `w` the default when there are no legs.
 */
export function channelAt(legs, x, z, out = _hit) {
  out.d = Infinity; out.w = CHANNEL_W; out.ux = 0; out.uz = -1; out.i = -1;
  out.branch = false; out.along = 0;
  let bestEdge = Infinity;
  for (let i = 0; i < legs.length; i++) {
    const l = legs[i];
    const bax = l.bx - l.ax, baz = l.bz - l.az;
    const pax = x - l.ax, paz = z - l.az;
    const len2 = bax * bax + baz * baz || 1;
    const h = Math.min(1, Math.max(0, (pax * bax + paz * baz) / len2));
    const dx = pax - bax * h, dz = paz - baz * h;
    const d = Math.sqrt(dx * dx + dz * dz);
    const edge = d - l.w;
    if (edge < bestEdge) {
      bestEdge = edge;
      out.d = d; out.w = l.w; out.ux = l.ux; out.uz = l.uz;
      out.i = i; out.branch = l.branch; out.along = h * l.len;
    }
  }
  return out;
}

/** how many points a leg list costs against the shader's segment budget */
export function legCount(hole) {
  return holeLegs(hole).length;
}

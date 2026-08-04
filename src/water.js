/**
 * Wind-Waker-flavoured lake water: one big plane driven by one custom shader.
 *
 * Everything here is deliberately hard-edged instead of smooth — flat quantised
 * depth bands with wobbling boundaries, scrolling contour streaks that read as
 * painted wave crests, cel-stepped sun banding with cross-shaped sparkles, and a
 * thick foam collar that laps in and out along the shore. A gentle vertex swell
 * gives the toon highlights something to catch; the same swell is recomputed
 * per-pixel for the normal so the banding stays crisp regardless of tessellation.
 */
import * as THREE from "three";
import { DEFAULT_NOISE, getNoise, shoreWobble } from "./channelrender.js";
import {
  LAKE_R, CHANNEL_MAX_PTS, CHANNEL_MAX_SEGS, CHANNEL_W,
  FALL_MAX, FALL_LIP, FALL_RUN, FALL_MIN_DROP, ZONE_MAX,
} from "./limits.js";
import { holeLegs, channelAt } from "./channel.js";

export const WATER_Y = 0;
// The shape of the lake — its radius, the half-width of the fairway channel it
// is carved into, and what a waterfall costs — is stated in limits.js so the
// admin editor can read it without three.js. This is still the door everything
// with a renderer comes in by.
export {
  LAKE_R, CHANNEL_MAX_PTS, CHANNEL_MAX_SEGS, CHANNEL_W,
  FALL_MAX, FALL_LIP, FALL_RUN, FALL_MIN_DROP, ZONE_MAX,
};

// Lake-bed shape. The bed is the same surface as the beach — it just carries on
// below the waterline — so terrain.js builds its mesh from the profile below and
// everything that needs a depth reads it back through lakeDepthAt.
export const BED_MAX = 13.5; // deepest point, on the channel centreline
/** the bed has to be at least this deep for a fishing dive to have a column */
export const DIVE_MIN = 3;

// Swell shape. The same numbers drive the vertex displacement, the per-pixel
// normal, and Water.heightAt (prop bobbing + skip contact in physics.js), so
// they live in one GLSL snippet plus one JS mirror and cannot drift apart.
export const WAVE_AMP = 0.18; // world units per unit of `swell().x`
const WAVE_PEAK = 1.37; // |swell().x| at its maximum, for normalising to -1..1
const NRM_EXAG = 2.1; // the true slope is far too shallow to catch a highlight

export const SWELL_GLSL = /* glsl */ `
  // Three crossing long-period sines plus one short chop wave.
  // Returns (height, dHeight/dx, dHeight/dz), all pre-WAVE_AMP.
  vec3 swell(vec2 p, float t) {
    float a1 = p.x * 0.28 + t * 1.10;
    float a2 = p.y * 0.22 - t * 0.80;
    float a3 = (p.x + p.y) * 0.16 + t * 0.60;
    float a4 = p.x * 0.90 - p.y * 0.70 + t * 2.20;
    float h  = sin(a1) * 0.50 + sin(a2) * 0.40 + sin(a3) * 0.35 + sin(a4) * 0.12;
    float dx = cos(a1) * 0.140 + cos(a3) * 0.056 + cos(a4) * 0.108;
    float dz = cos(a2) * 0.088 + cos(a3) * 0.056 - cos(a4) * 0.084;
    return vec3(h, dx, dz);
  }
`;

// ------------------------------------------------------------------ vortex hole
// The hole at the end of a fairway is a whirlpool: a dished bowl of water
// spiralling down into a dark throat, with the flagpole planted bare in the
// middle. Its rim is exactly the capture radius, so the swirl you can see is the
// target you have to put a stone *into* — the visuals (world.js WhirlpoolHole),
// the capture test and the suck-in animation (physics.js) all read this one
// profile, so what's drawn can't drift from what's scored.
export const VORTEX_R = 4.2; // rim radius == capture radius
export const VORTEX_THROAT_R = 1.6; // where the dish rolls over into the funnel
export const VORTEX_DIP = 1.1; // how far the dish has sunk by the throat
export const VORTEX_DEPTH = 3.6; // bottom of the funnel, below the waterline

/**
 * The vortex is real geometry — a surface of revolution running from the rim
 * down through a dished bowl and on into a funnel throat. This is its profile:
 * radius in, height in.
 *
 * The lake it sits in is a transparent plane that writes no depth, so a hole
 * modelled below it would be drawn *over* the water in front of it and hang out
 * below the surface like a spike. So the lake shader cuts an actual hole at
 * VORTEX_R (see Water.setVortex) and the vortex is drawn opaque, in the opaque
 * pass, ahead of the water: the near water is then simply nearer, wins the depth
 * test, and closes over everything that plunges behind it.
 */
export function vortexSurfaceY(r) {
  if (r >= VORTEX_R) return 0;
  if (r > VORTEX_THROAT_R) {
    // the dish: flush at the rim, steepening as it turns down into the throat
    const t = (VORTEX_R - r) / (VORTEX_R - VORTEX_THROAT_R);
    return -VORTEX_DIP * Math.pow(t, 2.2);
  }
  // the funnel: drops away fast off the lip, then tapers to the point
  const t = 1 - Math.max(0, r) / VORTEX_THROAT_R;
  return -VORTEX_DIP - (VORTEX_DEPTH - VORTEX_DIP) * Math.pow(t, 0.75);
}

// This shader writes gl_FragColor without a colour-space transform (same as the
// sky dome in world.js), so bypass THREE's sRGB->linear conversion and let the
// palette land on screen as the exact bytes picked here.
const paint = (hex) => new THREE.Color().setHex(hex, THREE.LinearSRGBColorSpace);

// the surface tone bands the tweak menu can repaint (deep spine -> shore -> whites)
export const WATER_COLOR_KEYS = ["uDeep", "uMid", "uShallow", "uShelf", "uSheen", "uFoam"];

// the four flat depth bands, deep spine -> shore, that the depth gradient feeds
const WATER_DEPTH_KEYS = ["uDeep", "uMid", "uShallow", "uShelf"];
// default editable depth gradient (deep spine -> shore)
const DEFAULT_DEPTH_STOPS = [
  { t: 0, hex: "#3f82ab" },
  { t: 0.3333333333333333, hex: "#378ba9" },
  { t: 0.7607377283105022, hex: "#1b8793" },
  { t: 1, hex: "#29a3b3" },
];

function sampleStops(stops, t) {
  const s = [...stops].sort((a, b) => a.t - b.t);
  if (t <= s[0].t) return s[0].hex;
  if (t >= s[s.length - 1].t) return s[s.length - 1].hex;
  for (let i = 0; i < s.length - 1; i++) {
    if (t >= s[i].t && t <= s[i + 1].t) {
      const f = (t - s[i].t) / ((s[i + 1].t - s[i].t) || 1);
      const a = parseInt(s[i].hex.slice(1), 16), b = parseInt(s[i + 1].hex.slice(1), 16);
      const ch = (sh) => Math.round(((a >> sh) & 255) + (((b >> sh) & 255) - ((a >> sh) & 255)) * f);
      return "#" + ((1 << 24) + (ch(16) << 16) + (ch(8) << 8) + ch(0)).toString(16).slice(1);
    }
  }
  return s[s.length - 1].hex;
}

// toggleable surface effects: { label -> uniform } exposed to the tweak menu
export const WATER_FX = {
  "Cel banding": "uFxCel",
  "Crest streaks": "uFxStreaks",
  "Whitecaps": "uFxCaps",
  "Sun glitter": "uFxGlitter",
  "Horizon sheen": "uFxSheen",
  "Cloud shadows": "uFxClouds",
  "Foam collar": "uFxCollar",
  "Flow lines": "uFxFlowLines",
};

// ------------------------------------------------------------------ waterfalls
// A hole can run downhill. Each entry in a hole's `falls` array is a lip laid
// across the channel: everything upstream of it sits `drop` metres higher, and
// the lake steps down over the lip in one hard edge rather than sloping, so a
// stone that skips over it simply runs out of water under itself and falls.
//
// The step is a half-plane test against the lip's own normal (pointing
// downstream), which is why checkholes.mjs insists the fairway crosses each lip
// exactly once — the level of a point is decided by which side of the line it
// is on, not by how far along the path it got.
// (FALL_MAX / FALL_LIP / FALL_RUN / FALL_MIN_DROP live in limits.js)

// ------------------------------------------------------------------ current
// A hole can run. `flow` is the speed of the water down the middle of the
// channel in units/second, and everything else about the current is derived
// from the shape the hole already has:
//
//   - it is quickest on the spine and dead at the bank, so the margins are
//     somewhere to park and the middle lane is not;
//   - it hurries as it approaches a lip, because the pool above a fall is being
//     emptied over it — settle too close and the river takes you over;
//   - it turns and runs back upstream in the wake of a spire or an island,
//     which is the one place on a fast hole a stone will sit still.
//
// Nothing in the air feels any of this. The current acts on a stone that has
// already stopped, which is the whole point of it: a throw that settles is no
// longer the end of the story, and where you park is a decision.
export const FLOW_BRINK = 9; // how far above a lip the water starts to hurry
const FLOW_BRINK_MUL = 1.7; // ...and how much quicker it is right on the edge
const EDDY_LEN = 3.2; // wake length behind an obstacle, in its own radii
const EDDY_WIDTH = 1.25; // ...and how far across, likewise
const EDDY_BACK = 0.5; // how hard the back-eddy runs against the river

// ------------------------------------------------------------------ zones
// Patches of lake that behave differently from the rest of it. All three kinds
// are the same shape — an ellipse laid along the flow — so one lookup and one
// block of shader serve the lot:
//
//   rapids — the water is `mul` times quicker through here, and white with it
//   ice    — a lid. Stones slide instead of skipping and the current loses grip
//   weed   — soft going. It swallows speed without swallowing the stone
// (ZONE_MAX, the shader's capacity for them, lives in limits.js)
export const ZONE_KINDS = { rapids: 1, ice: 2, weed: 3 };
/** the zone's edge is feathered over this fraction of it, in both worlds */
const ZONE_FEATHER = 0.22;

// module-level mirror of the shader's channel so JS helpers match the visuals
let _path = null; // Array<{x,z}> | null (null => full radial disc, e.g. title)
let _legs = []; // channel.js legs: the main line plus any branches, with widths
let _halfW = CHANNEL_W; // the main line's width; a branch's own is on its legs
let _nfreq = DEFAULT_NOISE.freq, _namp = DEFAULT_NOISE.amp; // cached per hole
let _falls = []; // [{ x, z, ux, uz, drop }] — ux/uz is the downstream normal
let _flow = 0; // units/second on the spine, 0 for a still hole
let _eddies = []; // [{ x, z, r, ux, uz }] obstacles shedding a wake
let _zones = []; // [{ kind, x, z, ux, uz, a, b, mul }] (see ZONE_KINDS)

/**
 * Point the JS-side helpers (distToPath, isWaterAt, the bed) at a hole's
 * channel. Water.setPath calls this as it uploads the same legs to the shader;
 * it is separate so headless callers can shape the lake without a renderer.
 * Null/short path => the full radial disc (title screen).
 *
 * `branches` are side channels (channel.js): the water becomes the union of the
 * main line and each of them, so a shortcut is genuinely water you can be on
 * rather than a line drawn over the same river.
 */
export function setWaterPath(path, halfWidth = CHANNEL_W, branches = null) {
  _halfW = halfWidth;
  const noise = getNoise();
  _nfreq = noise.freq;
  _namp = noise.amp;
  _path = path && path.length >= 2 ? path.map((p) => ({ x: p.x, z: p.z })) : null;
  _legs = _path ? holeLegs({ path: _path, branches }, halfWidth) : [];
  // terraces, current and zones all belong to a channel: a new one starts flat,
  // still and clear until the hole says otherwise
  _falls = [];
  _flow = 0;
  _eddies = [];
  _zones = [];
  return _path;
}

/** the legs of the current hole's water (main line + branches) */
export function waterLegs() { return _legs; }

/**
 * The channel at a point: distance off the centreline of the leg that owns it,
 * that leg's half-width, and its heading. On a hole with a shortcut in it the
 * answer inside the shortcut is the shortcut's, which is what makes the narrow
 * water behave narrow.
 */
export function channelHere(x, z, out) { return channelAt(_legs, x, z, out); }

/** shortest distance from (x,z) to the centreline of the water that owns it */
export function distToPath(x, z) {
  if (!_legs.length) return Math.hypot(x, z); // radial fallback
  return channelAt(_legs, x, z).d;
}

/** the half-width of the water at (x,z) — a branch is tighter than the main line */
export function channelWidthAt(x, z) {
  if (!_legs.length) return LAKE_R;
  return channelAt(_legs, x, z).w;
}

/** true when (x,z) sits over open water (inside the channel) */
export function isWaterAt(x, z) {
  if (!_legs.length) return Math.hypot(x, z) < LAKE_R;
  const c = channelAt(_legs, x, z);
  return c.d < c.w;
}

/**
 * How far inside the *drawn* waterline a point lies, in metres, negative on
 * land. The shader ends the lake where the wobbled distance runs out (see the
 * fragment shader's `dw`), which is metres in or out of the clean channel edge
 * isWaterAt measures against — so anything sizing itself to a piece of visible
 * water has to ask this one instead.
 */
export function wetMarginAt(x, z) {
  const c = _legs.length ? channelAt(_legs, x, z) : null;
  const d = c ? c.d : Math.hypot(x, z);
  return (c ? c.w : LAKE_R) - (d + shoreWobble(x, z, _nfreq, _namp));
}

/** true where the lake is actually drawn (see wetMarginAt) */
export function isWetAt(x, z) { return wetMarginAt(x, z) > 0; }

/**
 * Give the terraces their lips. Each `{ x, z, drop }` is resolved against the
 * current path (setWaterPath first) so the lip lies square across the flow, and
 * the whole thing degrades to a flat lake when a hole has no falls in it.
 */
export function setWaterFalls(falls) {
  _falls = [];
  if (!falls || !_path || _path.length < 2) return _falls;
  for (const f of falls.slice(0, FALL_MAX)) {
    const [ux, uz] = pathTangentAt(f.x, f.z);
    _falls.push({ x: f.x, z: f.z, ux, uz, drop: f.drop ?? 6 });
  }
  return _falls;
}

export function getWaterFalls() { return _falls; }

// how the lip is measured: far enough out to leave the map, fine enough that a
// bank of a metre or two still reads as a bank
const LIP_SCAN = 200, LIP_STEP = 0.5;
// ...and how many slices through the gap each of those steps asks about. The
// gap is FALL_LIP + FALL_RUN metres deep, and the water in it is not the same
// width at both ends of that.
const GAP_SLICES = 4;

/**
 * Every stretch of water a lip cuts through, as `{ x, z, ux, uz, drop, halfW }`
 * — one curtain each (props.js hangs them).
 *
 * A fall is a half-plane across the whole valley, not a thing standing in the
 * river: `waterLevelAt` steps down everywhere past it, and the lake shader cuts
 * the same gap in itself everywhere past it. On a hole that forks, that makes
 * one authored fall into two drops — the river goes over it and so does the
 * gut, a little further along the same edge — and both of them have to have
 * water falling down them, or the shortcut steps down through a hole in the
 * lake with nothing in it.
 *
 * Rather than work out where each channel crosses, walk the lip and note where
 * it is wet: that gets a slanted crossing (which is longer than the channel is
 * wide) right for free, and joins the two up into one broad weir where the fork
 * is close enough that there is no dry bank between them.
 */
export function fallSites(f) {
  if (!f) return _falls.flatMap((one) => fallSites(one));
  const sx = f.uz, sz = -f.ux; // along the lip
  // Two questions at each step, and they are not the same question. `wet` is
  // how far the gap in the lake reaches, and that is what a curtain has to
  // cover. `pour` is whether there is enough water there to fall — sampled a
  // stride back in the pond, because on the lip itself the ramped bed is still
  // up on the shelf. A shoal between two channels is wet and does not pour, and
  // that is the difference between one weir and two.
  //
  // The gap is a band, not a line, and its edge is the drawn (wobbled)
  // waterline: ask the whole depth of it, or the sheet comes out narrower than
  // the hole it is hung in and the dry bed shows down one side of the fall.
  const S = [];
  for (let a = -LIP_SCAN; a <= LIP_SCAN; a += LIP_STEP) {
    const x = f.x + sx * a, z = f.z + sz * a;
    let wet = false;
    for (let k = 0; k <= GAP_SLICES && !wet; k++) {
      const s = -FALL_LIP + (k / GAP_SLICES) * (FALL_LIP + FALL_RUN);
      wet = isWetAt(x + f.ux * s, z + f.uz * s);
    }
    const pour = wet && lakeDepthAt(x - f.ux * (FALL_LIP + 1), z - f.uz * (FALL_LIP + 1)) > 0.5;
    S.push({ a, wet, pour });
  }

  // one sheet per stretch of pouring water, widened out to the dry bank either
  // side of it so the whole gap is covered...
  const sites = [];
  for (let i = 0; i < S.length; i++) {
    if (!S[i].pour) continue;
    let j = i;
    while (j + 1 < S.length && S[j + 1].pour) j++;
    let lo = i, hi = j;
    while (lo > 0 && S[lo - 1].wet) lo--;
    while (hi < S.length - 1 && S[hi + 1].wet) hi++;
    sites.push({ lo, hi, i, j });
    i = j;
  }
  // ...except where two of them are pouring into the same stretch of water, in
  // which case they meet halfway across the shoal between them
  for (let k = 1; k < sites.length; k++) {
    const a = sites[k - 1], b = sites[k];
    if (a.hi < b.lo) continue;
    const mid = (a.j + b.i) >> 1;
    a.hi = mid;
    b.lo = mid + 1;
  }
  return sites.map((s) => {
    const a0 = S[s.lo].a, a1 = S[s.hi].a, mid = (a0 + a1) / 2;
    // ...and inside that, the stretch that is actually going over. The sheet has
    // to reach the far corners of the gap, but the churn and the shoulder rocks
    // belong to the water, not to the dry margin the sheet has to span.
    const p0 = S[s.i].a, p1 = S[s.j].a, pmid = (p0 + p1) / 2;
    return {
      ...f,
      x: f.x + sx * mid, z: f.z + sz * mid, halfW: (a1 - a0) / 2,
      pourX: f.x + sx * pmid, pourZ: f.z + sz * pmid, pourW: (p1 - p0) / 2,
    };
  }).filter((s) => s.halfW > 1);
}

/** unit vector pointing downstream (tee -> flag) in the water nearest (x,z) */
export function pathTangentAt(x, z) {
  if (!_legs.length) return [0, -1];
  const c = channelAt(_legs, x, z);
  return [c.ux, c.uz];
}

/** how far downstream of a lip a point lies (negative = still up on the shelf) */
export function fallSide(f, x, z) { return (x - f.x) * f.ux + (z - f.z) * f.uz; }

/**
 * Height of the water surface at (x,z) before the swell: 0 on the bottom
 * terrace, the sum of every lip still ahead of you on the ones above it.
 */
export function waterLevelAt(x, z) {
  let y = 0;
  for (const f of _falls) if (fallSide(f, x, z) < 0) y += f.drop;
  return y;
}

/**
 * The ground's version of the same step, smeared over the length of the fall so
 * the cliff behind the curtain is a steep rock chute rather than a one-quad
 * wall the terrain grid would only ever render as a staircase.
 */
export function terraceLiftAt(x, z) {
  let y = 0;
  for (const f of _falls) {
    const s = fallSide(f, x, z);
    if (s <= 0) { y += f.drop; continue; }
    if (s >= FALL_RUN) continue;
    const t = s / FALL_RUN;
    y += f.drop * (1 - t * t * (3 - 2 * t));
  }
  return y;
}

/** true inside the strip of lake the falling curtain (props.js) stands in for */
export function inFallAt(x, z) {
  for (const f of _falls) {
    const s = fallSide(f, x, z);
    if (s > -FALL_LIP && s < FALL_RUN) return true;
  }
  return false;
}

/**
 * Set the hole running. `strength` is units/second down the spine (0 for the
 * still lake most holes are), and `obstacles` are the things standing in it —
 * spires and islands — each of which sheds a back-eddy downstream of itself.
 * Call after setWaterPath and setWaterFalls: the flow takes its direction from
 * the one and hurries into the other.
 */
export function setWaterFlow(strength = 0, obstacles = []) {
  _flow = strength || 0;
  _eddies = [];
  if (!_flow || !_path) return _flow;
  for (const o of obstacles) {
    const r = o.r ?? 2;
    if (r < 1.5) continue; // too small to shelter anything
    const [ux, uz] = pathTangentAt(o.x, o.z);
    _eddies.push({ x: o.x, z: o.z, r, ux, uz });
  }
  return _flow;
}

export const getWaterFlow = () => _flow;

/**
 * Lay the odd patches down. Each entry is `{ kind, x, z, len?, r?, mul? }`:
 * `len` gives a stretch that runs bank to bank across the channel (rapids,
 * ice), `r` gives a round patch that can hug one side of it (weed).
 */
export function setWaterZones(zones) {
  _zones = [];
  if (!zones || !_path) return _zones;
  for (const z of zones.slice(0, ZONE_MAX)) {
    const kind = ZONE_KINDS[z.kind];
    if (!kind) continue;
    const [ux, uz] = pathTangentAt(z.x, z.z);
    _zones.push({
      kind: z.kind, x: z.x, z: z.z, ux, uz,
      a: z.r ?? (z.len ?? 16) / 2, // half-length, along the flow
      b: z.r ?? _halfW + 1.5, // half-width, across it — bank to bank by default
      mul: z.mul ?? (z.kind === "rapids" ? 2.4 : 1),
    });
  }
  return _zones;
}

export function getWaterZones() { return _zones; }

/**
 * How deep inside a zone a point is, 0 outside and 1 in the thick of it. An
 * ellipse laid along the flow, feathered at the rim — the shader runs the same
 * two lines, so what looks like ice is exactly what behaves like ice.
 */
function zoneStrength(zn, x, z) {
  const dx = x - zn.x, dz = z - zn.z;
  const along = (dx * zn.ux + dz * zn.uz) / zn.a;
  const across = (dx * -zn.uz + dz * zn.ux) / zn.b;
  const t = Math.hypot(along, across);
  return Math.min(1, Math.max(0, (1 - t) / ZONE_FEATHER));
}

/** strongest cover of one kind of zone over this point, 0..1 */
export function zoneAt(kind, x, z) {
  let s = 0;
  for (const zn of _zones) if (zn.kind === kind) s = Math.max(s, zoneStrength(zn, x, z));
  return s;
}

export const iceAt = (x, z) => zoneAt("ice", x, z);
export const weedAt = (x, z) => zoneAt("weed", x, z);

/**
 * The push the water is giving a floating stone at (x,z), in units/second.
 * Writes into `out` and returns it, because this is called every frame for
 * every racer and it is not worth an allocation.
 */
export function currentAt(x, z, out = [0, 0]) {
  out[0] = 0; out[1] = 0;
  if (!_flow || !_legs.length) return out;
  // channelAt hands back a shared object, so take what is needed off it now
  const { d, w, ux, uz } = channelAt(_legs, x, z);
  if (d >= w) return out; // aground: the river is somebody else's problem
  // The open-channel profile: quickest down the spine, nothing at all against
  // the bank. This is the whole reason the margins are worth anything. A narrow
  // branch is measured against its own banks, so a shortcut has less parking.
  let s = _flow * (1 - (d / w) ** 2);
  for (const f of _falls) {
    const ahead = -fallSide(f, x, z);
    if (ahead > 0 && ahead < FLOW_BRINK) s *= 1 + FLOW_BRINK_MUL * (1 - ahead / FLOW_BRINK);
  }
  for (const zn of _zones) {
    if (zn.kind === "rapids") s *= 1 + (zn.mul - 1) * zoneStrength(zn, x, z);
  }
  out[0] = ux * s; out[1] = uz * s;
  // ...except in the lee of something, where it turns and runs back up. Right
  // behind the rock that is the whole flow; by the end of the wake it is none
  // of it. This is the one place on a fast hole a stone will sit still.
  for (const e of _eddies) {
    const dx = x - e.x, dz = z - e.z;
    const along = dx * e.ux + dz * e.uz;
    const across = dx * -e.uz + dz * e.ux;
    const la = e.r * EDDY_LEN, ac = e.r * EDDY_WIDTH;
    if (along <= 0 || along >= la || Math.abs(across) >= ac) continue;
    const w = Math.min(1, (1 - along / la) * 1.35) * (1 - Math.abs(across) / ac);
    out[0] += (-e.ux * _flow * EDDY_BACK - out[0]) * w;
    out[1] += (-e.uz * _flow * EDDY_BACK - out[1]) * w;
  }
  // A lid has nothing to push with and reeds hold on to what they have got —
  // and neither of them cares which way the water underneath was going, so
  // this lands on the finished vector, eddies and all.
  const damp = (1 - iceAt(x, z)) * (1 - 0.85 * weedAt(x, z));
  out[0] *= damp; out[1] *= damp;
  return out;
}

/**
 * Bed height for a point already reduced to its wobbled distance from the
 * centreline. A smoothstep bowl: level along the spine, steepest halfway out,
 * then flattening again so it arrives at WATER_Y with no kink at the waterline.
 * The floor of the lake and the sand of the beach are one unbroken surface.
 */
export function bedProfile(dw, edgeW) {
  const t = Math.min(1, Math.max(0, dw / edgeW));
  return -BED_MAX * (1 - t * t * (3 - 2 * t));
}

/**
 * Lake-bed height at a world point: its own terrace's waterline at the shore,
 * BED_MAX below that at the spine. The lift is the ramped one, so the bed dives
 * away downstream of a lip instead of leaving a shelf across the plunge pool.
 */
export function bedHeightAt(x, z) {
  const c = _legs.length ? channelAt(_legs, x, z) : null;
  const edgeW = c ? c.w : LAKE_R;
  const d = c ? c.d : Math.hypot(x, z);
  return bedProfile(d + shoreWobble(x, z, _nfreq, _namp), edgeW) + terraceLiftAt(x, z);
}

/**
 * Depth of water over the bed, measured down from this point's own surface.
 * Clamped at zero: in the few metres below a lip the ramped bed can still be
 * standing above the pool it is falling into, and that is dry rock, not
 * negative water.
 */
export function lakeDepthAt(x, z) {
  return Math.max(0, waterLevelAt(x, z) - bedHeightAt(x, z));
}

/** where a sunk stone settles: on the bed, but never so shallow it pokes out */
export function sunkRestY(x, z) {
  return Math.min(waterLevelAt(x, z) - 0.45, bedHeightAt(x, z) + 0.4);
}

export class Water {
  constructor(scene) {
    // wide enough to carry a fairway that runs corner to corner past LAKE_R,
    // not just a lake-sized disc (see terrain.js MOUNT_INSET)
    const geo = new THREE.PlaneGeometry(LAKE_R * 3.4, LAKE_R * 3.4, 120, 120);
    geo.rotateX(-Math.PI / 2);

    // The channel goes up as segments rather than as a point list: a hole with
    // a shortcut in it is two lines that touch, not one that doubles back, and
    // each of them carries its own width (channel.js).
    const segArr = [], segWArr = [], segSArr = [];
    for (let i = 0; i < CHANNEL_MAX_SEGS; i++) {
      segArr.push(new THREE.Vector4(0, 0, 0, 0));
      segWArr.push(CHANNEL_W);
      segSArr.push(0);
    }
    const fallP = [], fallN = [], fallH = [];
    for (let i = 0; i < FALL_MAX; i++) {
      fallP.push(new THREE.Vector2(0, 0));
      fallN.push(new THREE.Vector2(0, 1));
      fallH.push(0);
    }
    const zoneA = [], zoneB = [];
    for (let i = 0; i < ZONE_MAX; i++) {
      zoneA.push(new THREE.Vector4(0, 0, 1, 0));
      zoneB.push(new THREE.Vector4(0, 1, 1, 1));
    }

    this.uniforms = {
      uTime: { value: 0 },
      uSunDir: { value: new THREE.Vector3(0.5, 0.7, 0.3).normalize() },
      // four flat tones, spine outwards, then the whites
      uDeep: { value: paint(0x3f82ab) },
      uMid: { value: paint(0x378ba9) },
      uShallow: { value: paint(0x1b8793) },
      uShelf: { value: paint(0x29a3b3) },
      uSheen: { value: paint(0xd6f4ff) },
      uFoam: { value: paint(0xffffff) },
      uLakeR: { value: LAKE_R },
      // fairway-channel shape: one vec4 (ax, az, bx, bz) per leg, plus its width
      uSeg: { value: segArr },
      uSegW: { value: segWArr },
      // distance down the channel at each leg's start, so the flow lines can
      // run on arc length and keep going round a bend
      uSegS: { value: segSArr },
      uSegCount: { value: 0 }, // 0 => radial disc fallback (title screen)
      // shoreline noise (tweakable in the admin editor, persisted to localStorage)
      uNoiseFreq: { value: getNoise().freq },
      uNoiseAmp: { value: getNoise().amp },
      // the hole punched for the whirlpool: centre, and radius (0 => no hole)
      uVortex: { value: new THREE.Vector2(0, 0) },
      uVortexR: { value: 0 },
      // terraces: a lip point, its downstream normal, and the drop over it
      uFallP: { value: fallP },
      uFallN: { value: fallN },
      uFallH: { value: fallH },
      uFallCount: { value: 0 },
      // the current, and the odd patches (rapids / ice / weed) laid in it
      uFlow: { value: 0 },
      uZoneA: { value: zoneA }, // xy centre · z half-length along · w kind
      uZoneB: { value: zoneB }, // xy downstream dir · z half-width across · w mul
      uZoneCount: { value: 0 },
      uIce: { value: paint(0xbcdcee) },
      uWeed: { value: paint(0x2f5d4a) },
      // per-effect strength 0..1 for the debug tweak menu (multiplier)
      uFxCel: { value: 0 },
      uFxStreaks: { value: 0 },
      uFxCaps: { value: 0 },
      uFxGlitter: { value: 0.3 },
      uFxSheen: { value: 0.6 },
      uFxClouds: { value: 0.3 },
      uFxCollar: { value: 0.65 },
      uFxFlowLines: { value: 0.9 },
    };

    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: /* glsl */ `
        uniform float uTime;
        uniform vec2 uFallP[${FALL_MAX}];
        uniform vec2 uFallN[${FALL_MAX}];
        uniform float uFallH[${FALL_MAX}];
        uniform int uFallCount;
        varying vec3 vWorld;

        ${SWELL_GLSL}

        void main() {
          vec4 wp = modelMatrix * vec4(position, 1.0);
          // stand this vertex on its terrace before the swell rides on top
          for (int i = 0; i < ${FALL_MAX}; i++) {
            if (i >= uFallCount) break;
            if (dot(wp.xz - uFallP[i], uFallN[i]) < 0.0) wp.y += uFallH[i];
          }
          wp.y += swell(wp.xz, uTime).x * ${WAVE_AMP};
          vWorld = wp.xyz;
          gl_Position = projectionMatrix * viewMatrix * wp;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        uniform vec3 uSunDir;
        uniform vec3 uDeep;
        uniform vec3 uMid;
        uniform vec3 uShallow;
        uniform vec3 uShelf;
        uniform vec3 uSheen;
        uniform vec3 uFoam;
        uniform float uLakeR;
        uniform vec4 uSeg[${CHANNEL_MAX_SEGS}];
        uniform float uSegW[${CHANNEL_MAX_SEGS}];
        uniform float uSegS[${CHANNEL_MAX_SEGS}];
        uniform int uSegCount;
        uniform float uNoiseFreq;
        uniform float uNoiseAmp;
        uniform vec2 uVortex;
        uniform float uVortexR;
        uniform vec2 uFallP[${FALL_MAX}];
        uniform vec2 uFallN[${FALL_MAX}];
        uniform int uFallCount;
        uniform float uFlow;
        uniform vec4 uZoneA[${ZONE_MAX}];
        uniform vec4 uZoneB[${ZONE_MAX}];
        uniform int uZoneCount;
        uniform vec3 uIce;
        uniform vec3 uWeed;
        uniform float uFxCel;
        uniform float uFxStreaks;
        uniform float uFxCaps;
        uniform float uFxGlitter;
        uniform float uFxSheen;
        uniform float uFxClouds;
        uniform float uFxCollar;
        uniform float uFxFlowLines;
        varying vec3 vWorld;

        ${SWELL_GLSL}

        // cheap value noise
        float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float noise(vec2 p) {
          vec2 i = floor(p), f = fract(p);
          vec2 u = f * f * (3.0 - 2.0 * f);
          return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x),
                     mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
        }

        // fractal value noise — a few octaves to break the edge geometry
        float fbm(vec2 p) {
          float s = 0.0, a = 0.5;
          for (int i = 0; i < 4; i++) { s += a * noise(p); p *= 2.0; a *= 0.5; }
          return s;
        }

        // Two-octave sibling, normalised to 0..1. The stylisation wants smooth
        // curvy fields, not fractal grit, and this runs on phones.
        float fbm2(vec2 p) { return noise(p) * 0.66 + noise(p * 2.03) * 0.34; }

        // A hard-looking edge that still antialiases — bare step() stair-steps
        // badly at these scales. w is the feather half-width, in x's own units.
        float hardEdge(float e, float w, float x) { return smoothstep(e - w, e + w, x); }

        // The same edge, but never feathered narrower than the one pixel taking
        // the sample. A fixed feather is a fixed number of *metres*, and a pixel
        // of lake seen at a grazing angle is many metres long — so the edge ends
        // up thinner than the thing sampling it, lands on whichever side of the
        // threshold it happens to hit, and the whole surface prints as moiré
        // stripes. Reads a screen-space derivative, so only call it from uniform
        // control flow (i.e. not inside one of the zone branches below).
        float pixelEdge(float e, float w, float x) {
          float px = fwidth(x) * 0.5;
          return smoothstep(e - max(w, px), e + max(w, px), x);
        }

        // How much of a field whose features are "s" metres across is still
        // worth drawing, given a pixel covers "fp" metres here. Widening an edge
        // only helps while there is still an edge to widen: once a pixel
        // straddles several features the samples land at random and the field is
        // grit, not detail. Past that, fade it into whatever it was sitting on.
        float resolves(float s, float fp) { return smoothstep(s * 0.5, s * 0.16, fp); }

        // p against a segment a-b: (distance to it, how far along it, 0..1)
        vec2 segHit(vec2 p, vec2 a, vec2 b) {
          vec2 pa = p - a, ba = b - a;
          float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-4), 0.0, 1.0);
          return vec2(length(pa - ba * h), h);
        }

        // The leg of the channel that owns p, as (distance off its centreline,
        // its half-width, heading.x, heading.y), and out of "along", how far
        // down the channel it sits. Picked by nearest *edge*, so the union of a
        // wide river and a narrow shortcut is both of them and the answer
        // inside the shortcut is the shortcut's. Mirrors channelAt() in
        // channel.js — change the two together.
        vec4 channelAt(vec2 p, out float along) {
          float bestEdge = 1e9;
          vec4 hit = vec4(1e9, uSegW[0], 0.0, -1.0);
          along = 0.0;
          for (int i = 0; i < ${CHANNEL_MAX_SEGS}; i++) {
            if (i >= uSegCount) break;
            vec2 a = uSeg[i].xy, b = uSeg[i].zw;
            vec2 s = segHit(p, a, b);
            float edge = s.x - uSegW[i];
            if (edge < bestEdge) {
              bestEdge = edge;
              hit = vec4(s.x, uSegW[i], normalize(b - a));
              along = uSegS[i] + s.y * length(b - a);
            }
          }
          return hit;
        }

        // How deep into one of the odd patches this fragment is. Same ellipse,
        // same feather as zoneStrength() in JS, so ice looks exactly as far as
        // it acts. kind: 1 rapids, 2 ice, 3 weed.
        float zoneAt(float kind, vec2 p) {
          float s = 0.0;
          for (int i = 0; i < ${ZONE_MAX}; i++) {
            if (i >= uZoneCount) break;
            if (abs(uZoneA[i].w - kind) > 0.5) continue;
            vec2 d = p - uZoneA[i].xy;
            vec2 dir = uZoneB[i].xy;
            float along = dot(d, dir) / uZoneA[i].z;
            float across = dot(d, vec2(-dir.y, dir.x)) / uZoneB[i].z;
            s = max(s, clamp((1.0 - length(vec2(along, across))) / ${ZONE_FEATHER}, 0.0, 1.0));
          }
          return s;
        }

        // Long streaks drawn *out* along the flow. Taking the minimum of four
        // copies of one field, each shifted a little further downstream, leaves
        // only where all four are high at once — which is a ribbon lying along
        // dir. The shifts have to be *shorter* than the noise's own features or
        // the copies stop being related to each other and it all falls apart
        // into confetti. No rotation, so no seam where the fairway turns.
        float flowField(vec2 p, vec2 dir) {
          float m = fbm2(p);
          m = min(m, fbm2(p + dir * 0.30));
          m = min(m, fbm2(p + dir * 0.60));
          m = min(m, fbm2(p + dir * 0.92));
          return m;
        }

        // ...and set moving. The sample offset restarts every cycle and two
        // half-cycle-apart copies are cross-faded, so the ribbons travel for
        // ever without the domain being dragged to infinity with them.
        float flowRibbon(vec2 p, vec2 dir, float t, float scale) {
          float p0 = fract(t), p1 = fract(t + 0.5);
          float a = flowField((p - dir * (p0 * 7.0)) * scale, dir);
          float b = flowField((p - dir * (p1 * 7.0)) * scale, dir);
          return mix(b, a, abs(1.0 - 2.0 * p0));
        }

        // The direction of the current, spelled out: white strokes running down
        // the channel in lanes, each a wedge that is thin at the tail and cut
        // square at the head, so a glance at one says which way the water goes.
        //
        // They live in the channel's own coordinates — one axis is arc length
        // down the fairway, the other the offset off its centreline — so
        // the lanes bend with the river and a stroke carries on through a
        // corner instead of jumping when the leg under it changes.
        float flowDash(vec2 p, float along, float across, float travel) {
          // the lane's line wanders instead of being ruled down the river
          across += (noise(p * 0.32) - 0.5) * 0.8;
          float lane = across / 2.6;
          float lat = abs(fract(lane) - 0.5) * 2.6; // metres off the lane's line
          // stagger the lanes so the strokes never line up into a bar across
          // the river, and vary their length a little for the same reason
          float h = hash(vec2(floor(lane), 3.0));
          float span = 32.0;
          float len = (14.0 + 6.0 * h) / span;
          float f = fract((along - travel) / span + h);
          if (f > len) return 0.0;
          float g = f / len; // 0 at the tail, 1 at the head
          // A wedge, and a thin one: kept to a hard-ish edge of its own so it
          // reads as a drawn stroke over the water rather than another slick in
          // it. Blunt at the head, drawn out to nothing behind.
          float hw = 0.05 + 0.21 * g;
          float stroke = (1.0 - smoothstep(hw - 0.07, hw + 0.07, lat)) * (0.45 + 0.55 * g);
          // ...and bitten into, so a long one comes apart into a dotted trail
          // rather than a painted stripe. Sampled in the water's own moving
          // frame — arc length less how far it has travelled — so the gaps go
          // downstream with the stroke instead of it flickering through them.
          float br = fbm2(vec2((along - travel) * 0.17, across * 0.40) + h * 23.0);
          return stroke * smoothstep(0.30, 0.52, br);
        }

        // A thin contour slice through domain-warped noise. Thresholding a warped
        // field twice and subtracting leaves long curved ribbons rather than
        // blobs — the painted wave-crest lines that sell the cartoon ocean.
        float crestRibbon(vec2 p, float warp, float lo, float hi) {
          p += warp * vec2(noise(p * 1.7) - 0.5, noise(p * 1.7 + 5.2) - 0.5);
          float f = fbm2(p * 1.5);
          return hardEdge(lo, 0.005, f) - hardEdge(hi, 0.005, f);
        }

        // Hard-edged diamonds stamped on a jittered grid, each blinking on its own
        // phase, so the sunlit water glitters in discrete cartoon cells. Diamonds
        // rather than four-point stars: at this scale arms read as pasted-on plus
        // signs, a plain bright chip reads as a glint.
        float sparkle(vec2 p, float t) {
          vec2 g = p * 2.0;
          vec2 id = floor(g);
          float h = hash(id);
          if (h < 0.66) return 0.0;
          float ph = fract(h * 9.71 + t * 0.42);
          float life = smoothstep(0.0, 0.12, ph) * (1.0 - smoothstep(0.20, 0.42, ph));
          if (life <= 0.001) return 0.0;
          vec2 f = fract(g) - 0.5
                 + vec2(hash(id + 3.7) - 0.5, hash(id + 8.1) - 0.5) * 0.5;
          return step(abs(f.x) + abs(f.y), 0.22 * life);
        }

        void main() {
          vec2 P = vWorld.xz;
          float t = uTime;

          // The whirlpool hole is a genuine gap in the lake: drop these fragments
          // entirely and let the vortex mesh (world.js WhirlpoolHole) be the water
          // in here. Cut a hair inside the mesh's rim so the two overlap rather
          // than race for the same pixels.
          if (uVortexR > 0.0 && length(P - uVortex) < uVortexR) discard;

          // Same deal at a waterfall: the strip either side of the lip belongs
          // to the curtain mesh (props.js). Cutting it a little way back up onto
          // the shelf also hides the one row of quads that has to straddle the
          // step and would otherwise sag over the edge.
          for (int i = 0; i < ${FALL_MAX}; i++) {
            if (i >= uFallCount) break;
            float s = dot(P - uFallP[i], uFallN[i]);
            if (s > ${(-FALL_LIP).toFixed(2)} && s < ${FALL_RUN.toFixed(2)}) discard;
          }

          vec3 sw = swell(P, t);
          float crest = sw.x / ${WAVE_PEAK}; // -1..1
          vec3 N = normalize(vec3(-sw.y * ${NRM_EXAG}, 1.0, -sw.z * ${NRM_EXAG}));
          vec3 V = normalize(cameraPosition - vWorld);
          vec3 L = normalize(uSunDir);
          // the finest detail is only drawn close up, where it resolves; further
          // out its cells fall below a pixel and just shimmer
          float near = 1.0 - smoothstep(30.0, 80.0, length(cameraPosition - vWorld));

          // --- lake footprint -------------------------------------------------
          // "d" = distance to the water's edge measure; "edgeW" = that edge radius.
          // Radial disc when no path is set (title), winding channel otherwise.
          float d, edgeW, along = 0.0;
          vec2 chanDir = vec2(0.0, -1.0);
          if (uSegCount >= 1) {
            vec4 ch = channelAt(P, along);
            d = ch.x;
            edgeW = ch.y;
            chanDir = ch.zw;
          } else {
            d = length(P);
            edgeW = uLakeR - 1.2;
          }
          // fractal wobble so the shoreline is organic, not a machined offset
          float wob = (fbm(P * uNoiseFreq) - 0.5) * uNoiseAmp
                    + (fbm(P * uNoiseFreq * 3.6) - 0.5) * uNoiseAmp * 0.34;
          float dw = d + wob;

          // --- flat depth bands ------------------------------------------------
          // No smooth deep->shallow ramp: snap to four flat tones and let slow
          // noise wobble the boundaries so they read as brush strokes. Measured
          // off the clean distance, not the wobbled one — the shoreline noise is
          // metres wide and would drag the inner bands into big random lobes.
          float shelf = smoothstep(edgeW * 0.10, edgeW * 1.02, d);
          float bandWob = (fbm2(P * 0.075 + vec2(t * 0.021, -t * 0.014)) - 0.5) * 0.10;
          float bt = clamp(shelf + bandWob + crest * 0.06, 0.0, 1.0);
          vec3 water = uDeep;
          water = mix(water, uMid,     hardEdge(0.30, 0.012, bt));
          water = mix(water, uShallow, hardEdge(0.58, 0.012, bt));
          water = mix(water, uShelf,   hardEdge(0.82, 0.012, bt));

          // --- cel bands across the swell faces --------------------------------
          float lam = dot(N, L);
          water *= 1.0 + uFxCel * (0.13 * hardEdge(0.82, 0.02, lam)
                       - 0.15 * (1.0 - hardEdge(0.66, 0.02, lam)));

          // --- painted crest streaks -------------------------------------------
          // Each domain is squashed across z so the ribbons come out as long crest
          // lines rather than scribbles, and the contour slice is kept narrow so
          // they stay sparse. Three scales, because one reads as either giant
          // smears up close or mush at range, never both.
          float streak = crestRibbon(
            vec2(P.x * 0.055, P.y * 0.260) + vec2(t * 0.030, -t * 0.020), 0.60, 0.496, 0.554);
          streak = max(streak, 0.80 * crestRibbon(
            vec2(P.x * 0.130, P.y * 0.520) - vec2(t * 0.016, t * 0.040), 0.50, 0.535, 0.575));
          streak = max(streak, 0.28 * near * crestRibbon(
            vec2(P.x * 0.300, P.y * 1.050) + vec2(t * 0.055, t * 0.030), 0.45, 0.508, 0.552));
          // Weighted hard onto the crests — spread evenly they read as pencil
          // hatching, bunched on the swell they read as travelling wave tops. They
          // also bow out short of the shore so they do not fight the foam collar.
          streak *= (0.15 + 1.05 * smoothstep(-0.05, 0.55, crest))
                  * (1.0 - smoothstep(edgeW - 5.0, edgeW - 2.0, dw));
          water = mix(water, uFoam, clamp(streak, 0.0, 1.0) * 0.72 * uFxStreaks);

          // --- whitecaps on the highest crests ---------------------------------
          float capN = noise(P * 0.55 + vec2(t * 0.18, -t * 0.12));
          float cap = hardEdge(0.90, 0.012, crest * 0.55 + 0.5 + capN * 0.22);
          water = mix(water, uFoam, cap * 0.55 * uFxCaps);

          // --- toon sun glitter -------------------------------------------------
          // One tight highlight band, hard-stepped, plus blinking stars. Anything
          // broader than this turns the lake into white continents. Both fade with
          // distance, where the cell detail would only alias into shimmer.
          float sun = smoothstep(0.05, 0.28, pow(max(dot(N, normalize(L + V)), 0.0), 30.0));
          float sunBand = hardEdge(0.5, 0.06, sun);
          water = mix(water, uSheen, sunBand * 0.50 * uFxGlitter);
          // Confined to that band so every star lands at full white: a half-lit
          // sparkle on flat water reads as a dirt speck, not a glint.
          water = mix(water, uFoam, sparkle(P, t) * sunBand * near * uFxGlitter);

          // --- quantised horizon sheen -----------------------------------------
          // Kept faint on purpose: any more and the near-white sheen milks the
          // flat bands into grey patches, which is the opposite of the look.
          float fres = clamp(pow(1.0 - max(dot(N, V), 0.0), 3.0), 0.0, 1.0);
          water = mix(water, uSheen, floor(fres * 3.0) / 3.0 * 0.10 * uFxSheen);

          // --- drifting cloud shadows, hard-stepped ----------------------------
          float cloud = hardEdge(0.60, 0.02, noise(P * 0.016 + vec2(t * 0.013, t * 0.007)));
          water *= 1.0 - 0.07 * cloud * uFxClouds;

          // --- foam collar at the shoreline ------------------------------------
          // Thick, hard-edged, and it laps: the inner edge breathes in and out
          // along the shore and leaves a thin trailing line behind it.
          float lap = 0.5 + 0.5 * sin(fbm2(P * 0.045) * 12.0 + t * 1.5);
          float scallop = noise(P * 0.34 + vec2(t * 0.05, -t * 0.04));
          float frill = noise(P * 0.95 - vec2(t * 0.10, t * 0.07));
          float inner = edgeW
                      - (1.05 + 1.75 * lap * (0.5 + 0.5 * scallop) + 0.55 * frill * near);
          float collar = hardEdge(inner, 0.10, dw);
          float trail = hardEdge(inner - 1.7 - 0.9 * lap, 0.10, dw)
                      - hardEdge(inner - 0.55, 0.10, dw);
          float speck = hardEdge(0.45, 0.02, noise(P * 1.1 + vec2(t * 0.30, t * 0.11)));
          water = mix(water, uFoam,
            clamp(collar * (0.78 + 0.22 * speck) + trail * 0.50, 0.0, 1.0) * uFxCollar);

          // --- the current, and the patches laid in it -------------------------
          // Only costs anything on a hole that actually has one: a still lake
          // takes the same branch it always did and never samples any of this.
          float weed = 0.0, ice = 0.0;
          if (uFlow > 0.0 || uZoneCount > 0) {
            vec2 dir = chanDir;
            float rapid = zoneAt(1.0, P);
            weed = zoneAt(3.0, P);
            ice = zoneAt(2.0, P);
            // dead at the bank, quickest down the middle — the same profile the
            // stones are pushed by (currentAt), so what you can see is the read
            float lane = 1.0 - smoothstep(0.25, 1.0, d / edgeW);
            float speed = uFlow * lane * (1.0 + 1.6 * rapid);

            if (speed > 0.05) {
              // two scales of ribbon: broad slicks, and a finer thread over
              // them. One cycle carries a streak 7 units, so the rate is tied
              // to the speed the stones are being pushed at and the water is
              // seen to be doing what it is doing.
              float rib = flowRibbon(P, dir, t * speed * 0.13, 0.17);
              rib = max(rib, flowRibbon(P, dir, t * speed * 0.19 + 0.37, 0.36) * 0.85 * near);
              float lines = smoothstep(0.49, 0.60, rib) * (0.45 + 0.55 * rapid);
              water = mix(water, uFoam, clamp(lines, 0.0, 1.0) * 0.6);

              // ...and the strokes that say which way. The ribbons above are
              // slicks — they show that the water is moving without ever
              // saying where to, and on a still-looking stretch that is the
              // one thing the player has to read off the surface. A slow
              // meander across the lanes keeps them off the drawing board.
              float across = d + (fbm2(P * 0.06) - 0.5) * 1.8;
              float dash = flowDash(P, along, across, t * speed);
              water = mix(water, uFoam,
                dash * lane * (0.95 + 0.05 * rapid) * uFxFlowLines);
            }
            // White water: the rapids boil rather than stream, so they get a
            // second, choppier layer that breaks up instead of running. Kept
            // tight and sparse on purpose — spread wide it stops reading as
            // broken water and starts reading as spilt milk.
            if (rapid > 0.0) {
              float chop = noise(P * 2.1 + vec2(t * 1.5, -t * 1.05) * (0.5 + uFlow * 0.08));
              float boil = hardEdge(0.74, 0.035, chop * 0.62 + fbm2(P * 0.9 - vec2(t * 0.6, 0.0)) * 0.55);
              // and a few standing waves, which is what a rapid looks like from
              // any distance at all: bright crescents that stay put
              float stand = hardEdge(0.80, 0.02, fbm2(P * 0.42) + crest * 0.18);
              water = mix(water, uFoam, clamp(boil + stand * 0.7, 0.0, 1.0) * rapid * 0.9);
            }
            // weed: the water goes green and thick, with clumps showing through
            if (weed > 0.0) {
              float mat = fbm2(P * 0.85 + vec2(t * 0.02, -t * 0.015));
              water = mix(water, uWeed, weed * (0.35 + 0.45 * smoothstep(0.35, 0.72, mat)));
              water = mix(water, uWeed * 0.7, weed * hardEdge(0.74, 0.03, mat) * 0.8);
            }
            // ice: a lid, so it goes on over everything else that was drawn.
            // Cracks are a contour slice through the same noise the shoreline
            // uses, which gives long branching lines rather than a crazed mess.
            if (ice > 0.0) {
              float cr = fbm(P * 0.32);
              float crack = 1.0 - smoothstep(0.0, 0.035, abs(fract(cr * 5.0) - 0.5) * 0.4);
              float frost = fbm2(P * 0.55);
              vec3 sheet = mix(uIce, uFoam, smoothstep(0.4, 0.8, frost) * 0.6);
              sheet = mix(sheet, uIce * 0.82, crack * 0.9);
              // a bright rim where the sheet has frozen out from the bank
              sheet = mix(sheet, uFoam, smoothstep(0.75, 1.0, 1.0 - ice) * 0.55);
              water = mix(water, sheet, ice * 0.94);
            }
          }

          // The sand + grass banks are a real displaced mesh now (src/terrain.js).
          // Keep the waterline crisp (cartoon water ends, it does not dissolve)
          // and discard over land so the ground shows through.
          float alpha = 1.0 - smoothstep(edgeW - 0.22, edgeW + 0.30, dw);
          if (alpha <= 0.01) discard;
          gl_FragColor = vec4(water, alpha);
        }
      `,
      transparent: true,
      depthWrite: false,
    });

    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.position.y = WATER_Y;
    this.mesh.renderOrder = 1;
    scene.add(this.mesh);

    this._speed = 0.6; // default animation speed (tweak menu overrides)
    this.setDepthGradient(DEFAULT_DEPTH_STOPS);
  }

  update(dt, elapsed) {
    // accumulate scaled time so the speed knob doesn't jump the phase when it
    // changes; falls back to raw elapsed the first frame / if dt is missing
    if (this._speed == null) this._speed = 1;
    if (this._t == null) this._t = elapsed;
    this._t += (dt || 0) * this._speed;
    this.uniforms.uTime.value = this._t;
  }

  getSpeed() { return this._speed == null ? 1 : this._speed; }
  setSpeed(v) { this._speed = v; }

  /**
   * The lake's flat tone bands, exposed for the debug tweak menu. The shader
   * writes gl_FragColor raw (see `paint`), so these round-trip through the
   * linear space the bytes were picked in rather than sRGB.
   */
  getColors() {
    const out = {};
    for (const k of WATER_COLOR_KEYS) {
      out[k] = "#" + this.uniforms[k].value.getHexString(THREE.LinearSRGBColorSpace);
    }
    return out;
  }
  setColor(key, hex) {
    if (!this.uniforms[key]) return;
    this.uniforms[key].value.setHex(parseInt(hex.slice(1), 16), THREE.LinearSRGBColorSpace);
  }

  /** where the lake looks for the sun; World.setSunDir keeps it and the sky agreed */
  setSunDir(x, y, z) { this.uniforms.uSunDir.value.set(x, y, z).normalize(); }

  /** set a surface effect's strength 0..1 (the uFx* uniform is a multiplier) */
  setFx(key, v) {
    if (this.uniforms[key]) this.uniforms[key].value = Number(v) || 0;
  }
  getFx(key) {
    return this.uniforms[key] ? this.uniforms[key].value : 1;
  }

  /**
   * The four flat depth bands as one editable gradient (deep spine -> shore).
   * The bands stay hard-edged; the gradient just supplies their four colours,
   * sampled evenly, so any number of stops still resolves to the four tones.
   */
  getDepthGradient() {
    if (!this._depthStops) {
      this._depthStops = WATER_DEPTH_KEYS.map((k, i) => ({
        t: i / (WATER_DEPTH_KEYS.length - 1),
        hex: "#" + this.uniforms[k].value.getHexString(THREE.LinearSRGBColorSpace),
      }));
    }
    return this._depthStops.map((s) => ({ t: s.t, hex: s.hex }));
  }
  setDepthGradient(stops) {
    this._depthStops = stops.map((s) => ({ t: s.t, hex: s.hex }));
    WATER_DEPTH_KEYS.forEach((k, i) => this.setColor(k, sampleStops(stops, i / (WATER_DEPTH_KEYS.length - 1))));
  }

  /**
   * Shape the lake to a fairway channel that follows `path` (Array<{x,z}>),
   * with `halfWidth` of open water either side of the centreline, plus any
   * `branches` — side channels with widths of their own (channel.js). Pass a
   * null/short path to fall back to the full radial disc (title screen).
   */
  setPath(path, halfWidth = CHANNEL_W, branches = null) {
    const shaped = setWaterPath(path, halfWidth, branches);
    // terraces, current and patches all belong to a channel; a new one starts
    // flat, still and clear (setWaterPath has already said so on the JS side)
    this.setFalls(null);
    this.uniforms.uFlow.value = 0;
    this.uniforms.uZoneCount.value = 0;
    this.uniforms.uNoiseFreq.value = _nfreq;
    this.uniforms.uNoiseAmp.value = _namp;
    const seg = this.uniforms.uSeg.value, segW = this.uniforms.uSegW.value;
    const segS = this.uniforms.uSegS.value;
    if (!shaped) {
      this.uniforms.uSegCount.value = 0;
      return;
    }
    const legs = waterLegs();
    const n = Math.min(legs.length, CHANNEL_MAX_SEGS);
    // Running distance down the channel, so the flow lines have an arc length
    // to travel along. A branch just carries on the count: what matters is
    // that a stroke is continuous within its own line, not where zero is.
    let s = 0;
    for (let i = 0; i < n; i++) {
      seg[i].set(legs[i].ax, legs[i].az, legs[i].bx, legs[i].bz);
      segW[i] = legs[i].w;
      segS[i] = s;
      s += legs[i].len;
    }
    this.uniforms.uSegCount.value = n;
  }

  /**
   * Step the lake into terraces for a hole's waterfalls. Call after setPath —
   * each lip takes its heading from the fairway it crosses. Pass nothing for a
   * flat lake.
   */
  setFalls(falls) {
    const list = setWaterFalls(falls);
    const P = this.uniforms.uFallP.value;
    const N = this.uniforms.uFallN.value;
    const H = this.uniforms.uFallH.value;
    for (let i = 0; i < list.length; i++) {
      P[i].set(list[i].x, list[i].z);
      N[i].set(list[i].ux, list[i].uz);
      H[i] = list[i].drop;
    }
    this.uniforms.uFallCount.value = list.length;
  }

  /**
   * Set the hole running at `strength` units/second, with `obstacles` (the
   * spires and islands) shedding the back-eddies. Call after setFalls — the
   * current hurries into a lip and has to know where the lips are.
   */
  setFlow(strength, obstacles) {
    this.uniforms.uFlow.value = setWaterFlow(strength, obstacles);
  }

  /** lay down the rapids / ice / weed patches (see setWaterZones) */
  setZones(zones) {
    const list = setWaterZones(zones);
    const A = this.uniforms.uZoneA.value;
    const B = this.uniforms.uZoneB.value;
    for (let i = 0; i < list.length; i++) {
      A[i].set(list[i].x, list[i].z, list[i].a, ZONE_KINDS[list[i].kind]);
      B[i].set(list[i].ux, list[i].uz, list[i].b, list[i].mul);
    }
    this.uniforms.uZoneCount.value = list.length;
  }

  /**
   * Punch the whirlpool's hole in the lake at (x, z), or pass no arguments to
   * heal it over (the title lake has no hole in it). Cut slightly inside
   * VORTEX_R so the vortex mesh laps over the edge instead of the two fighting
   * for the same pixels along it.
   */
  setVortex(x, z) {
    if (x === undefined) { this.uniforms.uVortexR.value = 0; return; }
    this.uniforms.uVortex.value.set(x, z);
    this.uniforms.uVortexR.value = VORTEX_R - 0.07;
  }

  /** analytic swell height matching the shader, for bobbing objects */
  heightAt(x, z, t) {
    return (
      (Math.sin(x * 0.28 + t * 1.1) * 0.5 +
        Math.sin(z * 0.22 - t * 0.8) * 0.4 +
        Math.sin((x + z) * 0.16 + t * 0.6) * 0.35 +
        Math.sin(x * 0.9 - z * 0.7 + t * 2.2) * 0.12) * WAVE_AMP
    );
  }
}

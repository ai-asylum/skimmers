/**
 * Procedural skipping stones: a flattened, lumpy blob carved out of a little
 * voxel field, wearing a canvas-painted skin (colors + patterns) and
 * spring-jiggled googly eyes (Spring scrap from juice.js) that give every rock
 * a soul. The same generator makes the player's rock and all bot rocks.
 *
 * The stone is a signed field on a grid — positive inside, negative outside —
 * and the mesh is the isosurface marching cubes pulls out of it. Carving is
 * plain subtraction from that field, so a dig is a real hollow with real walls:
 * the drill bites deeper on its own as the pit floor recedes, meets the far
 * side, and opens a tunnel you can see daylight through — all without the
 * surface ever tearing, because a marching-cubes shell is closed by
 * construction.
 */
import * as THREE from "three";
import { Spring } from "./juice.js";
import { FlatEyes } from "./flateyes.js";
import { marchCubes } from "./marchingcubes.js";

export const ROCK_COLORS = [
  "#8f9aa3", // river grey
  "#ff8a3d", // tangerine
  "#37c8e0", // lagoon
  "#ffd24a", // gold
  "#ff5470", // coral
  "#9d7cf4", // amethyst
  "#6fe07a", // moss
  "#f4f0e6", // chalk
];

export const ROCK_PATTERNS = ["plain", "stripes", "dots", "zigzag", "flame", "star"];

// the paint booth gets one extra pot the rock generator never rolls: black, for
// outlining and for dunking a stone into full obsidian
export const PAINT_COLORS = [...ROCK_COLORS, "#14161c"];

// brush dab radius, in texels of the 256px skin
export const BRUSH_MIN = 4;
export const BRUSH_MAX = 42;
export const BRUSH_DEF = 13;

// ---- voxel body, in unit-radius units (the stone is 1 wide before `size`) ----
const GRID_XZ = 36;       // field samples across the stone's width
const GRID_PAD = 1.14;    // grid box vs. the stone's own reach, so the surface
                          // always has air to close against at the rim
const FIELD_FLOOR = -1.5; // how far past the surface a sample may be eaten out
const DAB_MAX = 0.5;      // deepest single bite one carve-log entry can hold
const DAB_MERGE = 0.05;   // bites this close together fold into one log entry
const FLAT_SCALE = 0.16;  // surface wobble across the belly that reads as rough
const HOLLOW_FULL = 0.4;  // volume you must remove for a stone to read as gutted
const MIN_VOLUME = 0.35;  // the drill stops here: bore all the holes you like,
                          // but you can't grind the stone out of existence

const clamp01 = (v) => Math.max(0, Math.min(1, v));

// Default gaze: the camera (main feeds it every frame). A rock can override it
// with `lookAt()` to eye up a rival stone instead; the face still billboards to
// the camera either way.
const EYE_TARGET = new THREE.Vector3(0, 40, 120);
const EYE_QUAT = new THREE.Quaternion();
export function setEyeTarget(worldPos, worldQuat) {
  EYE_TARGET.copy(worldPos);
  if (worldQuat) EYE_QUAT.copy(worldQuat);
}

// mulberry32 — tiny seeded PRNG
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// cheap 3D value-ish noise from summed sines (good enough for lumps)
function lumpNoise(x, y, z, s1, s2, s3) {
  return (
    Math.sin(x * 3.1 + s1) * 0.45 +
    Math.sin(y * 4.7 + s2) * 0.3 +
    Math.sin((z + x) * 3.9 + s3) * 0.25
  );
}

const INV_TAU = 1 / (Math.PI * 2);

/** atan2 to within about a thousandth of a radian — a third of a texel at 256px,
 *  and it runs three times per triangle on every single remesh */
function fastAtan2(y, x) {
  const ax = Math.abs(x), ay = Math.abs(y);
  const a = Math.min(ax, ay) / (Math.max(ax, ay) + 1e-20);
  const s = a * a;
  let r = ((-0.0464964749 * s + 0.15931422) * s - 0.327622764) * s * a + a;
  if (ay > ax) r = 1.5707963 - r;
  if (x < 0) r = 3.1415927 - r;
  return y < 0 ? -r : r;
}

// Carve-log entries ride the wire as one byte per field, and they are snapped
// to that same byte lattice the moment they're recorded — so a peer replaying
// the log lands on the identical stone rather than a near-enough one.
const DAB_RANGE = 1.7; // comfortably past the widest grid box a rock can have
const q8 = (v) => Math.max(0, Math.min(255, Math.round(((v / DAB_RANGE) * 0.5 + 0.5) * 255)));
const u8q = (b) => ((b / 255) * 2 - 1) * DAB_RANGE;
const snapPos = (v) => u8q(q8(v));
const snapRadius = (r) => Math.round(clamp01(r / 2) * 255) * (2 / 255);
const snapDepth = (a) => Math.round(clamp01(a / DAB_MAX) * 255) * (DAB_MAX / 255);

function toB64(bytes) {
  let s = "";
  for (let i = 0; i < bytes.length; i += 4096) {
    s += String.fromCharCode.apply(null, bytes.subarray(i, i + 4096));
  }
  return btoa(s);
}

// scratch shared by every rock — carving and remeshing allocate nothing
const _inv = new THREE.Matrix4();
const _localRay = new THREE.Ray();
const _span = [0, 0];
const _us = new Float32Array(3);
const _vs = new Float32Array(3);
const _carved = { at: new THREE.Vector3(), hit: false, moved: 0, punched: false };

/** clip a ray to an axis-aligned box, into `_span`; false if it misses */
function raySpan(o, d, hx, hy) {
  let t0 = 0, t1 = Infinity;
  for (let a = 0; a < 3; a++) {
    const oa = a === 0 ? o.x : a === 1 ? o.y : o.z;
    const da = a === 0 ? d.x : a === 1 ? d.y : d.z;
    const h = a === 1 ? hy : hx;
    if (Math.abs(da) < 1e-9) {
      if (oa < -h || oa > h) return false;
      continue;
    }
    const inv = 1 / da;
    let ta = (-h - oa) * inv, tb = (h - oa) * inv;
    if (ta > tb) { const s = ta; ta = tb; tb = s; }
    if (ta > t0) t0 = ta;
    if (tb < t1) t1 = tb;
    if (t0 > t1) return false;
  }
  _span[0] = t0;
  _span[1] = t1;
  return true;
}

// ------------------------------------------------------------------ paint skin
const TEX_S = 256;

const PATTERN_ACCENT = "#16324a";

/** stony speckle, baked once and shared by every rock: it is pure noise, so one
 *  sheet reads the same as a fresh roll and keeps the per-dab recomposite cheap
 *  (and stops the grain from crawling while you paint) */
let speckleSheet = null;
function speckle() {
  if (speckleSheet) return speckleSheet;
  const S = TEX_S;
  speckleSheet = document.createElement("canvas");
  speckleSheet.width = speckleSheet.height = S;
  const ctx = speckleSheet.getContext("2d");
  ctx.globalAlpha = 0.12;
  for (let i = 0; i < 200; i++) {
    ctx.fillStyle = Math.random() < 0.5 ? "#000" : "#fff";
    const r = 1 + Math.random() * 2.5;
    ctx.beginPath();
    ctx.arc(Math.random() * S, Math.random() * S, r, 0, Math.PI * 2);
    ctx.fill();
  }
  return speckleSheet;
}

// the premade decorations are deterministic, so each one is drawn once onto a
// transparent sheet and reused by every rock wearing it
const patternSheets = new Map();
function patternSheet(pattern, accent = PATTERN_ACCENT) {
  const key = `${pattern}|${accent}`;
  if (patternSheets.has(key)) return patternSheets.get(key);
  const S = TEX_S;
  const cv = document.createElement("canvas");
  cv.width = cv.height = S;
  const ctx = cv.getContext("2d");
  ctx.fillStyle = accent;
  ctx.strokeStyle = accent;
  switch (pattern) {
    case "stripes":
      ctx.lineWidth = 16;
      for (let i = -1; i < 8; i++) {
        ctx.beginPath();
        ctx.moveTo(i * 46 - 20, -10);
        ctx.lineTo(i * 46 + 40, S + 10);
        ctx.stroke();
      }
      break;
    case "dots":
      for (let y = 0; y < 5; y++)
        for (let x = 0; x < 6; x++) {
          ctx.beginPath();
          ctx.arc(x * 48 + (y % 2 ? 24 : 0) + 12, y * 52 + 26, 11, 0, Math.PI * 2);
          ctx.fill();
        }
      break;
    case "zigzag":
      ctx.lineWidth = 12;
      for (let row = 0; row < 4; row++) {
        ctx.beginPath();
        for (let x = 0; x <= S; x += 32) {
          const y = row * 64 + 24 + (x / 32 % 2 ? 22 : 0);
          x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
      break;
    case "flame": {
      const g = ctx.createLinearGradient(0, S, 0, 0);
      g.addColorStop(0, accent);
      g.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = g;
      for (let i = 0; i < 7; i++) {
        ctx.beginPath();
        const bx = i * 38 + 10;
        ctx.moveTo(bx, S);
        ctx.quadraticCurveTo(bx + 26, S - 60 - (i % 3) * 30, bx + 8, S - 110 - (i % 2) * 40);
        ctx.quadraticCurveTo(bx - 8, S - 60, bx - 18, S);
        ctx.fill();
      }
      break;
    }
    case "star":
      for (let i = 0; i < 9; i++) {
        const cx = (i % 3) * 85 + 42, cy = Math.floor(i / 3) * 85 + 42;
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(i * 0.7);
        ctx.beginPath();
        for (let p = 0; p < 10; p++) {
          const r = p % 2 ? 8 : 20;
          const a = (p / 10) * Math.PI * 2;
          p === 0 ? ctx.moveTo(Math.cos(a) * r, Math.sin(a) * r) : ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
        }
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }
      break;
  }

  patternSheets.set(key, cv);
  return cv;
}

/** base coat: flat color + stony speckle. The decoration is NOT part of this —
 *  it goes on last (see drawRockPattern) so brush strokes land underneath it. */
export function drawRockFill(ctx, color) {
  ctx.clearRect(0, 0, TEX_S, TEX_S);
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, TEX_S, TEX_S);
  ctx.drawImage(speckle(), 0, 0);
}

/** premade decoration, multiplied over whatever is already there: a stripe
 *  crossing a brush stroke darkens that stroke's own color instead of hiding
 *  it, so the pattern reads as printed on top of the paint job */
export function drawRockPattern(ctx, pattern, strength = 0.88) {
  if (!pattern || pattern === "plain") return;
  ctx.save();
  ctx.globalCompositeOperation = "multiply";
  ctx.globalAlpha = strength;
  ctx.drawImage(patternSheet(pattern), 0, 0);
  ctx.restore();
}

// ------------------------------------------------------------------ the rock
export class Rock {
  constructor({ seed = 1, lumpAmp = 0.22, thickness = 0.5, size = 0.55, color = ROCK_COLORS[0], pattern = "plain", expression = "neutral" } = {}) {
    this.seed = seed;
    const rand = rng(seed * 7919 + 13);
    this.size = size;
    this.baseThickness = thickness;
    this.color = color;
    this.pattern = pattern;
    this.grit = rand(); // mojo — luck stat rolled at birth

    // reactive face: a base expression + a transient "mood" that decays back
    this.baseExpr = expression;
    this._mood = expression;
    this._moodT = 0;
    this._playback = null; // killcam override; the live mood is frozen while set
    this._gaze = null;     // world point to stare at, or null for the camera

    const s1 = rand() * 10, s2 = rand() * 10, s3 = rand() * 10;
    this._noiseSeeds = [s1, s2, s3];

    // The grid box has to hold the stone at its most swollen — the ellipsoid
    // plus a full-strength lump — with a rind of air left over for the surface
    // to close against, or the mesh would come out cut off at the rim.
    this.lumpAmp = lumpAmp;
    this._rMax = 1 + lumpAmp;
    this._yMax = thickness + lumpAmp;
    const hx = this._rMax * GRID_PAD;
    const hy = this._yMax * GRID_PAD;
    const nx = GRID_XZ;
    const ny = Math.max(9, Math.round(nx * (hy / hx))); // near-cubic cells
    this.grid = {
      nx, ny, nz: nx, hx, hy,
      dx: (2 * hx) / (nx - 1), dy: (2 * hy) / (ny - 1), dz: (2 * hx) / (nx - 1),
    };
    this.field = new Float32Array(nx * ny * nx);
    this.dabs = []; // the carve history: all a peer needs to rebuild this stone
    this._holed = false;
    this._tops = new Float32Array(nx * nx);
    this._bots = new Float32Array(nx * nx);
    this._colSolid = new Uint8Array(nx * nx);
    this._fillPristine();

    // The isosurface is rebuilt into these buffers in place; draw range is what
    // moves, so carving never reallocates and never touches the GPU layout.
    const geo = new THREE.BufferGeometry();
    this.geo = geo;
    this._mc = { positions: new Float32Array(3 * 3 * 3072) };
    // the field box bounds the mesh for good, so bounds are set once and left
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), this._rMax * 1.02);
    geo.boundingBox = new THREE.Box3(
      new THREE.Vector3(-this._rMax, -this._yMax, -this._rMax),
      new THREE.Vector3(this._rMax, this._yMax, this._rMax),
    );

    // layered skin: base coat canvas + brush-stroke canvas composited into one
    // texture (adapted from Frankentoys' PaintLayer soft-dab splat — 2D UV
    // canvas instead of a 3D voxel volume since our mesh has real UVs)
    this.texCanvas = document.createElement("canvas");
    this.texCanvas.width = this.texCanvas.height = 256;
    this.texCtx = this.texCanvas.getContext("2d");
    this.strokeCanvas = document.createElement("canvas");
    this.strokeCanvas.width = this.strokeCanvas.height = 256;
    this.strokeCtx = this.strokeCanvas.getContext("2d");
    this.tex = new THREE.CanvasTexture(this.texCanvas);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.tex.wrapS = THREE.RepeatWrapping; // seam faces sample u > 1
    this._composite();

    this.mat = new THREE.MeshStandardMaterial({
      map: this.tex,
      flatShading: true,
      roughness: 0.8,
      side: THREE.DoubleSide, // you can see the far wall through a tunnel
    });
    this.mesh = new THREE.Mesh(geo, this.mat);
    this.mesh.scale.setScalar(size); // the field is unit-sized; the mesh isn't
    this.group = new THREE.Group();
    this.group.add(this.mesh);

    // squash & stretch on impacts — kicked below 1, springs back with overshoot
    this.squash = new Spring(1, 240, 11);

    this._buildEyes();
    this.rebuild();
  }

  // ---- the field ----------------------------------------------------------

  /** the stone as it washed ashore: a flattened ellipsoid wearing birth lumps */
  _fillPristine() {
    const { nx, ny, nz, hx, hy, dx, dy, dz } = this.grid;
    const [s1, s2, s3] = this._noiseSeeds;
    const thick = this.baseThickness;
    const amp = this.lumpAmp;
    const f = this.field;
    let i = 0, solid = 0;
    for (let iy = 0; iy < ny; iy++) {
      const y = -hy + iy * dy;
      const rimY = iy === 0 || iy === ny - 1;
      for (let iz = 0; iz < nz; iz++) {
        const z = -hx + iz * dz;
        const rimZ = rimY || iz === 0 || iz === nz - 1;
        for (let ix = 0; ix < nx; ix++, i++) {
          const x = -hx + ix * dx;
          const len = Math.sqrt(x * x + y * y + z * z);
          let bump = 0, v;
          if (len < 1e-4) v = thick; // dead centre, as deep inside as it gets
          else {
            const ux = x / len, uy = y / len, uz = z / len;
            bump = Math.max(0, lumpNoise(ux, uy, uz, s1, s2, s3)) * amp;
            const q = ux * ux + uz * uz + (uy * uy) / (thick * thick);
            v = 1 / Math.sqrt(Math.max(1e-5, q)) + bump - len;
          }
          // How far out the surface sits along a ray from the centre, which is
          // a fine reading near the skin but hugely overstates the depth in the
          // core of a squashed stone: the middle of a pebble is half a
          // thickness from daylight, not a whole radius. Take whichever of the
          // two readings is smaller so the drill eats real distance and a bore
          // across the width costs what it looks like it should.
          const rho2 = x * x + z * z;
          const cap = rho2 < 1 ? thick * Math.sqrt(1 - rho2) : 0;
          v = Math.min(v, cap + bump - Math.abs(y));
          if (rimZ || ix === 0 || ix === nx - 1) v = Math.min(v, -0.01);
          f[i] = v;
          if (v > 0) solid++;
        }
      }
    }
    this._solid0 = solid || 1;
    this._holed = false;
  }

  /** trilinear read of the field at a local point; anything off-grid is air */
  sampleAt(x, y, z) {
    const { nx, ny, nz, hx, hy, dx, dy, dz } = this.grid;
    const fx = (x + hx) / dx, fy = (y + hy) / dy, fz = (z + hx) / dz;
    if (fx < 0 || fy < 0 || fz < 0 || fx > nx - 1 || fy > ny - 1 || fz > nz - 1) return FIELD_FLOOR;
    const ix = Math.min(nx - 2, fx | 0), iy = Math.min(ny - 2, fy | 0), iz = Math.min(nz - 2, fz | 0);
    const tx = fx - ix, ty = fy - iy, tz = fz - iz;
    const f = this.field, sz = nx, sy = nx * nz;
    const b = ix + iz * sz + iy * sy;
    const x00 = f[b] + (f[b + 1] - f[b]) * tx;
    const x01 = f[b + sz] + (f[b + sz + 1] - f[b + sz]) * tx;
    const x10 = f[b + sy] + (f[b + sy + 1] - f[b + sy]) * tx;
    const x11 = f[b + sy + sz] + (f[b + sy + sz + 1] - f[b + sy + sz]) * tx;
    const z0 = x00 + (x01 - x00) * tz;
    const z1 = x10 + (x11 - x10) * tz;
    return z0 + (z1 - z0) * ty;
  }

  /** walk the field along a local ray; returns where it first turns to stone,
   *  or -1 if the whole run is air (which is what looking down a tunnel gives) */
  _firstStone(o, d, t0, t1, step) {
    let prevT = t0, prev = this.sampleAt(o.x + d.x * t0, o.y + d.y * t0, o.z + d.z * t0);
    if (prev > 0) return t0;
    for (let t = t0 + step; t <= t1; t += step) {
      const v = this.sampleAt(o.x + d.x * t, o.y + d.y * t, o.z + d.z * t);
      if (v > 0) return prevT + (t - prevT) * (-prev / (v - prev));
      prevT = t;
      prev = v;
    }
    return -1;
  }

  /** bite a soft-edged sphere out of the field; returns the volume it took */
  _dab(cx, cy, cz, radius, amount) {
    const { nx, ny, nz, hx, hy, dx, dy, dz } = this.grid;
    const f = this.field;
    const ix0 = Math.max(0, Math.ceil((cx - radius + hx) / dx));
    const ix1 = Math.min(nx - 1, Math.floor((cx + radius + hx) / dx));
    const iy0 = Math.max(0, Math.ceil((cy - radius + hy) / dy));
    const iy1 = Math.min(ny - 1, Math.floor((cy + radius + hy) / dy));
    const iz0 = Math.max(0, Math.ceil((cz - radius + hx) / dz));
    const iz1 = Math.min(nz - 1, Math.floor((cz + radius + hx) / dz));
    const r2 = radius * radius;
    let took = 0;
    for (let iy = iy0; iy <= iy1; iy++) {
      const oy = -hy + iy * dy - cy;
      for (let iz = iz0; iz <= iz1; iz++) {
        const oz = -hx + iz * dz - cz;
        const row = iz * nx + iy * nx * nz;
        const offRow = oy * oy + oz * oz;
        if (offRow >= r2) continue;
        for (let ix = ix0; ix <= ix1; ix++) {
          const ox = -hx + ix * dx - cx;
          const d2 = offRow + ox * ox;
          if (d2 >= r2) continue;
          // near-flat across the bit, feathered at the rim, so the drill cuts a
          // clean bore instead of a needle prick
          const cut = amount * (1 - d2 / r2);
          const j = row + ix;
          const v = f[j];
          if (v > 0) took += Math.min(v, cut);
          f[j] = Math.max(FIELD_FLOOR, v - cut);
        }
      }
    }
    return took * dx * dy * dz;
  }

  /** Take a bite and log it. The field is only ever subtracted from, so bites
   *  commute — which lets the log fold a whole held-down drag at one spot into
   *  a single deepening entry. Only what survives the log's rounding is
   *  actually eaten, so the stone on screen never drifts from the stone the
   *  log describes; `deep` keeps the unrounded running total so a slow trickle
   *  of tiny frames still adds up instead of rounding away to nothing. */
  _carveDab(cx, cy, cz, radius, amount) {
    const r = snapRadius(radius);
    const x = snapPos(cx), y = snapPos(cy), z = snapPos(cz);
    const d = this.dabs;
    let entry = null;
    for (let i = d.length - 1; i >= 0; i--) {
      const p = d[i];
      if (p.r !== r || p.a >= DAB_MAX) continue;
      if (Math.abs(p.x - x) + Math.abs(p.y - y) + Math.abs(p.z - z) > DAB_MERGE) continue;
      entry = p;
      break;
    }
    if (!entry) {
      entry = { x, y, z, r, a: 0, deep: 0 };
      d.push(entry);
    }
    entry.deep = Math.min(DAB_MAX, entry.deep + amount);
    const was = entry.a;
    entry.a = snapDepth(entry.deep);
    const bite = entry.a - was;
    return bite > 0 ? this._dab(entry.x, entry.y, entry.z, entry.r, bite) : 0;
  }

  /**
   * Drill along a world-space ray for one frame's worth of grinding.
   *
   * The bit is aimed at wherever the ray first meets stone — which is the floor
   * of the pit you are already digging — so holding still walks the drill
   * deeper under its own steam until it breaks out the far side. Once a tunnel
   * is open the ray finds nothing to bite and the bit reams the tunnel wider
   * instead.
   *
   * Returns the world point worked (`hit` false if the ray missed the stone),
   * the volume of stone taken, and whether this bite was the breakthrough.
   */
  carve(ray, radius = 0.36, amount = 0.3) {
    const g = this.grid;
    _carved.hit = false;
    _carved.moved = 0;
    _carved.punched = false;
    if (this._volFrac <= MIN_VOLUME) return _carved;

    this.mesh.updateWorldMatrix(true, false);
    _inv.copy(this.mesh.matrixWorld).invert();
    _localRay.copy(ray).applyMatrix4(_inv);
    const o = _localRay.origin, d = _localRay.direction;
    if (!raySpan(o, d, g.hx, g.hy)) return _carved;

    const t0 = _span[0], t1 = _span[1];
    const step = Math.min(g.dx, g.dy, g.dz) * 0.6;
    const enter = this._firstStone(o, d, t0, t1, step);

    let cx, cy, cz;
    if (enter >= 0) {
      cx = o.x + d.x * enter;
      cy = o.y + d.y * enter;
      cz = o.z + d.z * enter;
      _carved.moved = this._carveDab(cx, cy, cz, radius, amount);
    } else if (this._holed) {
      // Nothing but air along a line that runs through the middle of the stone:
      // you are looking down a tunnel you already made. Ream it end to end so
      // holding the drill on an open hole widens it instead of doing nothing.
      const closest = -(o.x * d.x + o.y * d.y + o.z * d.z);
      const px = o.x + d.x * closest, py = o.y + d.y * closest, pz = o.z + d.z * closest;
      if (px * px + py * py + pz * pz > (this._rMax * 0.5) ** 2) return _carved;
      const passes = 5;
      for (let i = 0; i < passes; i++) {
        const t = t0 + (t1 - t0) * ((i + 0.5) / passes);
        _carved.moved += this._carveDab(
          o.x + d.x * t, o.y + d.y * t, o.z + d.z * t, radius, amount * 0.5,
        );
      }
      cx = o.x + d.x * (t0 + t1) * 0.5;
      cy = o.y + d.y * (t0 + t1) * 0.5;
      cz = o.z + d.z * (t0 + t1) * 0.5;
    } else {
      return _carved;
    }

    this.rebuild();
    // daylight: the line that met stone a moment ago is clear all the way now
    if (enter >= 0 && this._firstStone(o, d, t0, t1, step) < 0) {
      _carved.punched = true;
      this._holed = true;
    }
    _carved.hit = true;
    _carved.at.set(cx, cy, cz).applyMatrix4(this.mesh.matrixWorld);
    return _carved;
  }

  /** back to the stone you picked up off the beach */
  resetShape() {
    this.dabs.length = 0;
    this._fillPristine();
    this.rebuild();
  }

  /** compact sculpt payload for the wire. The pristine stone is reproducible
   *  from the seed, so all a peer needs is the list of bites taken out of it —
   *  five bytes each, and only one entry per spot no matter how long you leaned
   *  on it. */
  sculptData() {
    const d = this.dabs;
    const b = new Uint8Array(d.length * 5);
    for (let i = 0; i < d.length; i++) {
      const p = d[i], o = i * 5;
      b[o] = q8(p.x);
      b[o + 1] = q8(p.y);
      b[o + 2] = q8(p.z);
      b[o + 3] = Math.round((p.r / 2) * 255);
      b[o + 4] = Math.round((p.a / DAB_MAX) * 255);
    }
    return toB64(b);
  }

  /** replay a remote player's carve log onto a fresh copy of their stone */
  applySculptData(b64) {
    this.dabs.length = 0;
    this._fillPristine();
    if (b64) {
      const bin = atob(b64);
      for (let o = 0; o + 4 < bin.length; o += 5) {
        const a = bin.charCodeAt(o + 4) * (DAB_MAX / 255);
        const p = {
          x: u8q(bin.charCodeAt(o)),
          y: u8q(bin.charCodeAt(o + 1)),
          z: u8q(bin.charCodeAt(o + 2)),
          r: bin.charCodeAt(o + 3) * (2 / 255),
          a, deep: a,
        };
        this.dabs.push(p);
        this._dab(p.x, p.y, p.z, p.r, p.a);
      }
      this._holed = this.dabs.length > 0;
    }
    this.rebuild();
  }

  // ---- the mesh -----------------------------------------------------------

  /** pull the surface back out of the field and hand it to the GPU */
  rebuild() {
    const g = this.grid;
    const before = this._mc.positions;
    const n = marchCubes(
      this.field, g.nx, g.ny, g.nz, -g.hx, -g.hy, -g.hx, g.dx, g.dy, g.dz, 0, this._mc,
    );
    const pos = this._mc.positions;
    if (pos !== before || !this.geo.attributes.position) {
      // the surface outgrew its buffer (or this is the first build)
      this._uvs = new Float32Array((pos.length / 3) * 2);
      this._norms = new Float32Array(pos.length);
      this.geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
      this.geo.setAttribute("uv", new THREE.BufferAttribute(this._uvs, 2));
      this.geo.setAttribute("normal", new THREE.BufferAttribute(this._norms, 3));
    }
    this._skinUVs(n);
    this._faceNormals(n);
    this.geo.setDrawRange(0, n);
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.uv.needsUpdate = true;
    this.geo.attributes.normal.needsUpdate = true;
    this._measure();
    this._placeEyes();
  }

  /** Spherical UVs for the painted skin, laid down per triangle (the buffer is
   *  non-indexed, so a face owns its three slots outright). Faces straddling
   *  the atan2 seam get their low-side u pushed past 1 — otherwise u runs from
   *  ~1.0 back through 0 and smears the whole texture across a vertical stripe.
   *  Faces at the poles borrow their neighbours' u so the caps don't pinwheel.
   *  (wrapS is Repeat, so u > 1 is fine.) */
  _skinUVs(n) {
    const p = this._mc.positions, uv = this._uvs;
    for (let t = 0; t < n; t += 3) {
      let lo = 2, hi = -1;
      for (let k = 0; k < 3; k++) {
        const j = (t + k) * 3;
        const x = p[j], y = p[j + 1], z = p[j + 2];
        const len = Math.sqrt(x * x + y * y + z * z) || 1e-6;
        const u = fastAtan2(z, x) * INV_TAU + 0.5;
        _us[k] = u;
        _vs[k] = (y / len) * 0.5 + 0.5;
        if (u < lo) lo = u;
        if (u > hi) hi = u;
      }
      if (hi - lo > 0.5) {
        for (let k = 0; k < 3; k++) if (_us[k] < 0.5) _us[k] += 1;
      }
      for (let k = 0; k < 3; k++) {
        if (_vs[k] > 0.99 || _vs[k] < 0.01) _us[k] = (_us[(k + 1) % 3] + _us[(k + 2) % 3]) / 2;
      }
      for (let k = 0; k < 3; k++) {
        uv[(t + k) * 2] = _us[k];
        uv[(t + k) * 2 + 1] = _vs[k];
      }
    }
  }

  _faceNormals(n) {
    const p = this._mc.positions, nr = this._norms;
    for (let t = 0; t < n; t += 3) {
      const a = t * 3, b = a + 3, c = a + 6;
      const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2];
      const vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2];
      let x = uy * vz - uz * vy, y = uz * vx - ux * vz, z = ux * vy - uy * vx;
      const l = Math.sqrt(x * x + y * y + z * z) || 1;
      x /= l; y /= l; z /= l;
      nr[a] = x; nr[a + 1] = y; nr[a + 2] = z;
      nr[b] = x; nr[b + 1] = y; nr[b + 2] = z;
      nr[c] = x; nr[c + 1] = y; nr[c + 2] = z;
    }
  }

  /** Read the shape back out of the field for the skip physics: how much stone
   *  is left, how thick the belly is, and how far its two faces wander from
   *  flat. Grinding the top down makes it flatter; gouging a crater into it
   *  does not. */
  _measure() {
    const { nx, ny, nz, hx, hy, dx, dy, dz } = this.grid;
    const f = this.field;
    const belly2 = (this._rMax * 0.55) ** 2;
    const tops = this._tops, bots = this._bots, has = this._colSolid;
    const sy = nx * nz;
    let solid = 0, bellyCols = 0, standing = 0, sumTop = 0, sumBot = 0;

    for (let iz = 0; iz < nz; iz++) {
      const z = -hx + iz * dz;
      for (let ix = 0; ix < nx; ix++) {
        const x = -hx + ix * dx;
        const col = ix + iz * nx;
        let first = -1, last = -1;
        for (let iy = 0; iy < ny; iy++) {
          if (f[col + iy * sy] > 0) {
            solid++;
            if (first < 0) first = iy;
            last = iy;
          }
        }
        const inBelly = x * x + z * z < belly2;
        if (inBelly) bellyCols++;
        has[col] = first >= 0 ? 1 : 0;
        if (first < 0) continue;
        // slide the surface off the grid onto the real zero crossing
        const vb = f[col + first * sy], vbPrev = first > 0 ? f[col + (first - 1) * sy] : -1;
        const vt = f[col + last * sy], vtNext = last < ny - 1 ? f[col + (last + 1) * sy] : -1;
        bots[col] = -hy + (first - 1 + -vbPrev / (vb - vbPrev)) * dy;
        tops[col] = -hy + (last + vt / (vt - vtNext)) * dy;
        if (inBelly) {
          standing++;
          sumTop += tops[col];
          sumBot += bots[col];
        }
      }
    }

    this._volFrac = solid / this._solid0;
    if (!standing) {
      this._halfThick = 0;
      this._rough = 1;
      return;
    }
    const meanTop = sumTop / standing, meanBot = sumBot / standing;
    this._halfThick = (meanTop - meanBot) / 2;
    let dev = 0;
    for (let iz = 0; iz < nz; iz++) {
      const z = -hx + iz * dz;
      for (let ix = 0; ix < nx; ix++) {
        const x = -hx + ix * dx;
        const col = ix + iz * nx;
        if (!has[col] || x * x + z * z >= belly2) continue;
        dev += Math.abs(tops[col] - meanTop) + Math.abs(bots[col] - meanBot);
      }
    }
    // columns bored clean away count as maximally rough — a gutted belly is not
    // a flat one, whatever the stone that's left is doing
    this._rough = (dev + (bellyCols - standing) * FLAT_SCALE) / bellyCols;
  }

  /** redraw the skin: base coat, then hand-painted strokes, then the premade
   *  decoration multiplied over both so it tints/darkens the paint underneath */
  _composite() {
    drawRockFill(this.texCtx, this.color);
    this.texCtx.drawImage(this.strokeCanvas, 0, 0);
    drawRockPattern(this.texCtx, this.pattern);
    this.tex.needsUpdate = true;
  }

  /** change base coat or decoration — brush strokes survive in between (the
   *  same texture object is shared with any cel-shader twin, so no material
   *  juggling needed) */
  repaint(color, pattern) {
    this.color = color ?? this.color;
    this.pattern = pattern ?? this.pattern;
    this._composite();
  }

  /** soft feathered brush dab at a UV hit point (Frankentoys splat, 2D).
   *  Wraps horizontally so strokes cross the spherical-UV seam cleanly. */
  paintDab(uv, color, radius = BRUSH_DEF) {
    const S = TEX_S;
    const x = uv.x * S;
    const y = (1 - uv.y) * S;
    const ctx = this.strokeCtx;
    for (const ox of [x - S, x, x + S]) {
      const g = ctx.createRadialGradient(ox, y, 0, ox, y, radius);
      g.addColorStop(0, color);
      g.addColorStop(0.55, color);
      g.addColorStop(1, color + "00");
      ctx.fillStyle = g;
      ctx.globalAlpha = 0.85;
      ctx.beginPath();
      ctx.arc(ox, y, radius, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    this._composite();
  }

  /** wash all brush strokes off */
  clearStrokes() {
    this.strokeCtx.clearRect(0, 0, 256, 256);
    this._composite();
  }

  /** serialize brush strokes for the wire (multiplayer rock skins) */
  strokesDataURL() {
    return this.strokeCanvas.toDataURL("image/png");
  }

  /** apply a remote player's strokes */
  applyStrokesDataURL(url) {
    if (!url) return;
    const img = new Image();
    img.onload = () => {
      this.strokeCtx.drawImage(img, 0, 0);
      this._composite();
    };
    img.src = url;
  }

  // ---- stats driving the skip physics ----
  /** half-thickness of the belly as it stands, the way `baseThickness` set it
   *  before anyone took a drill to it */
  get thickness() {
    return this._halfThick;
  }
  /** 0..1: how flat/smooth — raises skip angle tolerance + restitution.
   *  Craters count against you exactly like leftover bumps do. */
  get flat() {
    const smooth = clamp01(1 - this._rough / FLAT_SCALE);
    const thin = 1 - (this._halfThick - 0.28) / 0.45;
    return clamp01(smooth * 0.55 + thin * 0.45);
  }
  /** 0..1: how much of the stone has been hollowed out */
  get holeFrac() {
    return clamp01((1 - this._volFrac) / HOLLOW_FULL);
  }
  /** 0..1: mass-ish — raises carry (speed retention) but sinks harder. Drilling
   *  a hole through the middle genuinely lightens the stone. */
  get heft() {
    return clamp01(((this._halfThick * this.size) / 0.35) * (1 - 0.55 * this.holeFrac));
  }

  // ---- flat-outline eyes with shader pupils (see flateyes.js) ----
  _buildEyes() {
    this.flatEyes = new FlatEyes(this.baseExpr);
    this.eyes = this.flatEyes.object; // a single billboard plane carrying both eyes
    this.group.add(this.eyes);
  }

  _placeEyes() {
    // the face is a camera-facing billboard (orientation handled per-frame in
    // FlatEyes.update); here we just size it and sit it on the upper-front of
    // the stone. +x is the travel direction, so nudging +x keeps the face on
    // the leading edge where it reads best. It rides the stone's birth height
    // rather than its carved one, so grinding the top doesn't drag the eyes down.
    const up = this.baseThickness * this.size;
    const plane = this.eyes;
    plane.scale.setScalar(this.size * 1.45);
    plane.position.set(0.12 * this.size, up * 0.32, 0);
  }

  /** the face currently on screen */
  get expression() {
    return this.flatEyes.expression;
  }

  /** temporary reaction face that eases back to the base expression */
  react(expr, dur = 1.1) {
    this._mood = expr;
    this._moodT = dur;
    if (!this._playback) this.flatEyes.setExpression(expr);
  }

  /**
   * Drive the face from recorded frames (killcam). The live mood is held where
   * it was and restored when playback ends with `setPlaybackExpression(null)`.
   */
  setPlaybackExpression(expr) {
    if (expr === this._playback) return;
    this._playback = expr;
    this.flatEyes.setExpression(expr ?? this._mood);
  }

  /** jolt the pupils (impacts, throws) */
  kickEyes(v = 1) {
    this.flatEyes.kick(v);
  }

  /** 0..1 face opacity — used to peek past the eyes while sculpting */
  fadeEyes(v) {
    this.flatEyes.setFade(v);
  }

  /** stare at a world point (a rival stone, the flag); null goes back to the camera */
  lookAt(worldPoint) {
    if (!worldPoint) { this._gaze = null; return; }
    this._gaze = (this._gaze || new THREE.Vector3()).copy(worldPoint);
  }

  /** squash the whole stone (skip contacts, landings) */
  squashKick(v = 1) {
    this.squash.kick(-6 * v);
  }

  update(dt) {
    // decay any transient mood back to the base expression
    if (this._moodT > 0 && !this._playback) {
      this._moodT -= dt;
      if (this._moodT <= 0 && this._mood !== this.baseExpr) {
        this._mood = this.baseExpr;
        this.flatEyes.setExpression(this.baseExpr);
      }
    }
    this.flatEyes.update(dt, this._gaze || EYE_TARGET, EYE_QUAT);

    const sq = Math.max(0.45, Math.min(1.45, this.squash.update(dt)));
    const w = 1 + (1 - sq) * 0.55; // conserve apparent volume
    this.group.scale.set(w, sq, w);
  }
}

// ------------------------------------------------------------------ names
const NAME_A = ["Sir", "Old", "Lil", "Big", "Wet", "Fast", "Lady", "Cap'n", "Slick", "Mad"];
const NAME_B = ["Skips", "Pebble", "Flint", "Chip", "Gravel", "Slate", "Boulder", "Shale", "Dimple", "Plunk"];
const NAME_C = ["alot", "worth", "ington", "sby", "erino", "s III", "face", "y", "zilla", " Jr."];

export function rockName(seed) {
  const r = rng(seed * 31 + 7);
  return `${NAME_A[(r() * NAME_A.length) | 0]} ${NAME_B[(r() * NAME_B.length) | 0]}${NAME_C[(r() * NAME_C.length) | 0]}`;
}

/** random bot rock, visually distinct */
export function randomBotRock(seed) {
  const r = rng(seed * 101 + 3);
  return new Rock({
    seed,
    lumpAmp: 0.1 + r() * 0.18,
    thickness: 0.4 + r() * 0.2,
    size: 0.5 + r() * 0.12,
    color: ROCK_COLORS[(r() * ROCK_COLORS.length) | 0],
    pattern: ROCK_PATTERNS[(r() * ROCK_PATTERNS.length) | 0],
  });
}

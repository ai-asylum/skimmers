/**
 * Procedural skipping stones: a deformed, flattened icosahedron with a lump
 * field you can grind away, a canvas-painted skin (colors + patterns), and
 * spring-jiggled googly eyes (Spring scrap from juice.js) that give every
 * rock a soul. The same generator makes the player's rock and all bot rocks.
 *
 * Sculpting is free-form: on top of the birth lumps every facet carries a
 * signed displacement, so you can grind bumps flat, dig dents well past the
 * base body, push stone back out, and — if you keep digging one spot — punch a
 * hole clean through the stone.
 */
import * as THREE from "three";
import { Spring } from "./juice.js";
import { FlatEyes } from "./flateyes.js";

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

// ---- free-form sculpt limits, in unit-radius units (before `size` scaling) ----
const MAX_BULGE = 0.4; // how far out stone can be pushed
const CORE_FLOOR = 0.18; // carving bottoms out at this fraction of the body radius
const PUNCH_AT = 0.8; // dug this deep (fraction of body radius) and it breaks through
const MAX_OPEN = 0.2; // share of the shell that may be holed — past this the
                      // stone just takes a deeper pit, so it stays a stone

const clamp01 = (v) => Math.max(0, Math.min(1, v));

// quantized direction key; symmetric in each axis so a facet and its mirror
// across the flat face always agree (that mirror is what lets a deep dig open
// into a hole rather than a bottomless pit)
const dirKey = (x, y, z) => {
  const q = (v) => Math.sign(v) * Math.round(Math.abs(v) * 500);
  return `${q(x)},${q(y)},${q(z)}`;
};

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
function lumpNoise(d, s1, s2, s3) {
  return (
    Math.sin(d.x * 3.1 + s1) * 0.45 +
    Math.sin(d.y * 4.7 + s2) * 0.3 +
    Math.sin((d.z + d.x) * 3.9 + s3) * 0.25
  );
}

// ------------------------------------------------------------------ paint skin
const TEX_S = 256;

/** draw the base coat (color + procedural pattern) into a 2d context */
export function drawRockBase(ctx, color, pattern, accent = "#16324a") {
  const S = TEX_S;
  ctx.clearRect(0, 0, S, S);
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, S, S);

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

  // speckle for stony texture
  ctx.globalAlpha = 0.12;
  for (let i = 0; i < 200; i++) {
    ctx.fillStyle = Math.random() < 0.5 ? "#000" : "#fff";
    const r = 1 + Math.random() * 2.5;
    ctx.beginPath();
    ctx.arc(Math.random() * S, Math.random() * S, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

// ------------------------------------------------------------------ the rock
export class Rock {
  constructor({ seed = 1, lumpAmp = 0.22, thickness = 0.5, size = 0.55, color = ROCK_COLORS[0], pattern = "plain", expression = "neutral" } = {}) {
    this.seed = seed;
    const rand = rng(seed * 7919 + 13);
    this.size = size;
    this.baseThickness = thickness;
    this.grindFrac = 0; // 0..1 how much has been ground away
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

    // icosahedron, welded so sculpting moves coincident face-verts together
    const geo = new THREE.IcosahedronGeometry(1, 3);
    this.geo = geo;
    const pos = geo.attributes.position;
    const groups = new Map(); // key -> facet { dir, verts[], lump, lump0, disp, cut }
    const d = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      d.fromBufferAttribute(pos, i).normalize();
      const key = dirKey(d.x, d.y, d.z);
      let g = groups.get(key);
      if (!g) {
        const lump = Math.max(0, lumpNoise(d, s1, s2, s3));
        g = { dir: d.clone(), verts: [], lump, lump0: lump, disp: 0, cut: false, mirror: -1 };
        groups.set(key, g);
      }
      g.verts.push(i);
    }
    this.groups = [...groups.values()];
    this.initialLumpSum = this.groups.reduce((s, g) => s + g.lump, 0) || 1;
    this.lumpAmp = lumpAmp;

    // each facet's twin on the opposite flat face — a dig that reaches the core
    // opens both at once, so light gets through
    const idxByKey = new Map();
    this.groups.forEach((g, i) => idxByKey.set(dirKey(g.dir.x, g.dir.y, g.dir.z), i));
    this.groups.forEach((g) => {
      const mi = idxByKey.get(dirKey(g.dir.x, -g.dir.y, g.dir.z));
      g.mirror = mi === undefined ? -1 : mi;
    });

    // per-vertex "this facet is open" flags; faces touching one get collapsed
    this._vcut = new Uint8Array(pos.count);
    this.cutCount = 0;

    // Spherical UVs for the painted skin, assigned PER FACE (the icosahedron
    // buffer is non-indexed, so faces don't share attribute slots). Faces that
    // straddle the atan2 seam get their low-side u shifted +1 — otherwise u
    // interpolates from ~1.0 back through 0 and smears the whole texture
    // across a vertical stripe. Pole vertices take the face-average u so the
    // caps don't pinwheel. (Texture wrapS is Repeat, so u > 1 is fine.)
    const uvs = new Float32Array(pos.count * 2);
    const fd = new THREE.Vector3();
    for (let f = 0; f < pos.count; f += 3) {
      const us = [], vs = [];
      for (let k = 0; k < 3; k++) {
        fd.fromBufferAttribute(pos, f + k).normalize();
        us.push(Math.atan2(fd.z, fd.x) / (Math.PI * 2) + 0.5);
        vs.push(fd.y * 0.5 + 0.5);
      }
      if (Math.max(...us) - Math.min(...us) > 0.5) {
        for (let k = 0; k < 3; k++) if (us[k] < 0.5) us[k] += 1;
      }
      for (let k = 0; k < 3; k++) {
        if (vs[k] > 0.99 || vs[k] < 0.01) {
          const o = [0, 1, 2].filter((i) => i !== k);
          us[k] = (us[o[0]] + us[o[1]]) / 2;
        }
      }
      for (let k = 0; k < 3; k++) {
        uvs[(f + k) * 2] = us[k];
        uvs[(f + k) * 2 + 1] = vs[k];
      }
    }
    geo.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));

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
    drawRockBase(this.texCtx, color, pattern);

    this.mat = new THREE.MeshStandardMaterial({
      map: this.tex,
      flatShading: true,
      roughness: 0.8,
      side: THREE.DoubleSide, // punched holes show the shell's inner wall
    });
    this.mesh = new THREE.Mesh(geo, this.mat);
    this.group = new THREE.Group();
    this.group.add(this.mesh);

    // squash & stretch on impacts — kicked below 1, springs back with overshoot
    this.squash = new Spring(1, 240, 11);

    this._buildEyes();
    this.rebuild();
  }

  // radius along direction `dir` for the flattened ellipsoid body
  _bodyRadius(dir, thick) {
    const q = dir.x * dir.x + dir.z * dir.z + (dir.y * dir.y) / (thick * thick);
    return 1 / Math.sqrt(Math.max(1e-5, q));
  }

  get thickness() {
    return this.baseThickness * (1 - 0.4 * this.grindFrac);
  }

  /** how deep a dig at `dir` can go before the stone gives way */
  _floorAt(dir, thick) {
    return -this._bodyRadius(dir, thick) * (1 - CORE_FLOOR);
  }

  rebuild() {
    const pos = this.geo.attributes.position;
    const thick = this.thickness;
    for (const g of this.groups) {
      const base = this._bodyRadius(g.dir, thick);
      const r = Math.max(base * CORE_FLOOR, base + g.lump * this.lumpAmp + g.disp) * this.size;
      for (const vi of g.verts) {
        pos.setXYZ(vi, g.dir.x * r, g.dir.y * r, g.dir.z * r);
      }
    }
    // open facets have no surface: collapse every face touching one to a point,
    // which the rasterizer drops (the buffer is non-indexed, so a face owns its
    // three slots outright and neighbours keep their own copies)
    if (this.cutCount > 0) {
      const vc = this._vcut;
      for (let f = 0; f < pos.count; f += 3) {
        if (vc[f] || vc[f + 1] || vc[f + 2]) {
          const x = pos.getX(f), y = pos.getY(f), z = pos.getZ(f);
          pos.setXYZ(f + 1, x, y, z);
          pos.setXYZ(f + 2, x, y, z);
        }
      }
    }
    pos.needsUpdate = true;
    this.geo.computeVertexNormals();
    this.geo.computeBoundingSphere();
    this._placeEyes();
  }

  _setCut(g, on) {
    if (g.cut === on) return false;
    g.cut = on;
    this.cutCount += on ? 1 : -1;
    for (const vi of g.verts) this._vcut[vi] = on ? 1 : 0;
    return true;
  }

  /** open (or heal) a facet together with its twin on the far face */
  _punch(g, on = true) {
    if (on && this.cutCount >= this.groups.length * MAX_OPEN) return false;
    const thick = this.thickness;
    let changed = this._setCut(g, on);
    const m = g.mirror >= 0 ? this.groups[g.mirror] : null;
    for (const f of m && m !== g ? [g, m] : [g]) {
      // an opened facet sits at the floor, so healing it later grows the stone
      // back out of the pit — and so a networked copy lands in the same place
      if (on) {
        f.lump = 0;
        f.disp = Math.min(f.disp, this._floorAt(f.dir, thick));
      }
      changed = this._setCut(f, on) || changed;
    }
    return changed;
  }

  /**
   * Sculpt near a world-space point.
   *  - "smooth" grinds the birth lumps off, thinning the whole stone as it goes
   *  - "carve"  digs inward past the base body; reach the core and it punches
   *             through into a hole
   *  - "bulge"  pushes stone back out, filling dents and healing holes
   * Returns how far the surface moved plus how many facets opened or closed.
   */
  sculptAt(worldPoint, tool = "smooth", radius = 0.5, amount = 0.3) {
    const local = this.mesh.worldToLocal(worldPoint.clone()).normalize();
    const thick = this.thickness;
    let moved = 0, ground = 0, punched = 0, healed = 0;
    for (const g of this.groups) {
      const dist = g.dir.distanceTo(local);
      if (dist >= radius) continue;
      // a grinder feathers off linearly; a dig bites nearly flat across the
      // brush, so breaking through opens a hole rather than a needle prick
      const t = dist / radius;
      const k = (tool === "carve" ? 1 - t * t : 1 - t) * amount;

      if (tool === "smooth") {
        if (g.lump <= 0) continue;
        const take = Math.min(g.lump, k);
        g.lump -= take;
        ground += take;
      } else if (tool === "carve") {
        if (g.cut) continue;
        let dig = k;
        if (g.lump > 0) {
          // shave any leftover bump first, then bite into the body itself
          const take = Math.min(g.lump, dig / this.lumpAmp);
          g.lump -= take;
          ground += take;
          dig -= take * this.lumpAmp;
        }
        if (dig <= 0) continue;
        const floor = this._floorAt(g.dir, thick);
        const next = Math.max(floor, g.disp - dig);
        moved += g.disp - next;
        g.disp = next;
        if (g.disp <= -this._bodyRadius(g.dir, thick) * PUNCH_AT && this._punch(g)) punched++;
      } else if (tool === "bulge") {
        if (g.cut) {
          // stone grows back from the bottom of the pit it was carved out of
          this._punch(g, false);
          g.disp = this._floorAt(g.dir, thick);
          healed++;
        }
        const next = Math.min(MAX_BULGE, g.disp + k);
        moved += next - g.disp;
        g.disp = next;
      }
    }
    if (ground > 0) this.grindFrac = Math.min(1, this.grindFrac + ground / this.initialLumpSum);
    if (moved > 0 || ground > 0 || punched || healed) this.rebuild();
    return { moved: moved + ground * this.lumpAmp, punched, healed };
  }

  /** back to the stone you picked up off the beach */
  resetShape() {
    for (const g of this.groups) {
      g.lump = g.lump0;
      g.disp = 0;
      this._setCut(g, false);
    }
    this.grindFrac = 0;
    this.rebuild();
  }

  /** compact sculpt payload for the wire: one signed byte per facet */
  sculptData() {
    const bytes = new Int8Array(this.groups.length);
    for (let i = 0; i < bytes.length; i++) {
      const g = this.groups[i];
      const off = g.lump * this.lumpAmp + g.disp;
      bytes[i] = g.cut ? -128 : Math.round(Math.max(-1, Math.min(1, off)) * 127);
    }
    return btoa(String.fromCharCode(...new Uint8Array(bytes.buffer)));
  }

  /** rebuild a remote player's sculpt (set `grindFrac` first — it sets thickness) */
  applySculptData(b64) {
    if (!b64) return;
    const bin = atob(b64);
    const n = Math.min(this.groups.length, bin.length);
    const thick = this.thickness;
    for (let i = 0; i < n; i++) {
      const g = this.groups[i];
      const v = (bin.charCodeAt(i) << 24) >> 24; // back to signed
      g.lump = 0;
      if (v === -128) {
        g.disp = this._floorAt(g.dir, thick);
        this._setCut(g, true);
      } else {
        g.disp = v / 127;
        this._setCut(g, false);
      }
    }
    this.rebuild();
  }

  /** redraw base coat + stroke layer into the live texture */
  _composite() {
    drawRockBase(this.texCtx, this.color, this.pattern);
    this.texCtx.drawImage(this.strokeCanvas, 0, 0);
    this.tex.needsUpdate = true;
  }

  /** change base coat — brush strokes survive on top (same texture object is
   *  shared with any cel-shader twin, so no material juggling needed) */
  repaint(color, pattern) {
    this.color = color ?? this.color;
    this.pattern = pattern ?? this.pattern;
    this._composite();
  }

  /** soft feathered brush dab at a UV hit point (Frankentoys splat, 2D).
   *  Wraps horizontally so strokes cross the spherical-UV seam cleanly. */
  paintDab(uv, color, radius = 13) {
    const S = 256;
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
  /** 0..1: how flat/smooth — raises skip angle tolerance + restitution.
   *  Dents count against you exactly like leftover bumps do; open facets are
   *  gone rather than rough, so a clean hole doesn't spoil the belly. */
  get flat() {
    let dev = 0;
    for (const g of this.groups) {
      if (!g.cut) dev += Math.abs(g.lump * this.lumpAmp + g.disp);
    }
    const smooth = clamp01(1 - dev / (this.initialLumpSum * this.lumpAmp || 1));
    const thin = 1 - (this.thickness - 0.28) / 0.45;
    return clamp01(smooth * 0.55 + thin * 0.45);
  }
  /** 0..1: how much of the stone has been hollowed out by holes */
  get holeFrac() {
    return clamp01(this.cutCount / (this.groups.length * MAX_OPEN));
  }
  /** 0..1: mass-ish — raises carry (speed retention) but sinks harder. Drilling
   *  a hole through the middle genuinely lightens the stone. */
  get heft() {
    return clamp01(((this.thickness * this.size) / 0.35) * (1 - 0.55 * this.holeFrac));
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
    // the leading edge where it reads best.
    const thick = this.thickness;
    const up = this._bodyRadius(new THREE.Vector3(0, 1, 0).normalize(), thick) * this.size;
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

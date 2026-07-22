/**
 * Procedural skipping stones: a deformed, flattened icosahedron with a lump
 * field you can grind away, a canvas-painted skin (colors + patterns), and
 * spring-jiggled googly eyes (Spring scrap from juice.js) that give every
 * rock a soul. The same generator makes the player's rock and all bot rocks.
 */
import * as THREE from "three";
import { Spring } from "./juice.js";

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

// googly pupils track this world position (main feeds it the camera each frame)
const EYE_TARGET = new THREE.Vector3(0, 40, 120);
const _eyeTmp = new THREE.Vector3();
export function setEyeTarget(worldPos) {
  EYE_TARGET.copy(worldPos);
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
  constructor({ seed = 1, lumpAmp = 0.22, thickness = 0.5, size = 0.55, color = ROCK_COLORS[0], pattern = "plain" } = {}) {
    this.seed = seed;
    const rand = rng(seed * 7919 + 13);
    this.size = size;
    this.baseThickness = thickness;
    this.grindFrac = 0; // 0..1 how much has been ground away
    this.color = color;
    this.pattern = pattern;
    this.grit = rand(); // mojo — luck stat rolled at birth

    const s1 = rand() * 10, s2 = rand() * 10, s3 = rand() * 10;
    this._noiseSeeds = [s1, s2, s3];

    // icosahedron, welded so grinding moves coincident face-verts together
    const geo = new THREE.IcosahedronGeometry(1, 3);
    this.geo = geo;
    const pos = geo.attributes.position;
    const groups = new Map(); // key -> { dir, verts[], lump, u, v }
    const d = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      d.fromBufferAttribute(pos, i).normalize();
      const key = `${Math.round(d.x * 500)},${Math.round(d.y * 500)},${Math.round(d.z * 500)}`;
      let g = groups.get(key);
      if (!g) {
        g = { dir: d.clone(), verts: [], lump: Math.max(0, lumpNoise(d, s1, s2, s3)) };
        groups.set(key, g);
      }
      g.verts.push(i);
    }
    this.groups = [...groups.values()];
    this.initialLumpSum = this.groups.reduce((s, g) => s + g.lump, 0) || 1;
    this.lumpAmp = lumpAmp;

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

  rebuild() {
    const pos = this.geo.attributes.position;
    const thick = this.thickness;
    for (const g of this.groups) {
      const r = (this._bodyRadius(g.dir, thick) + g.lump * this.lumpAmp) * this.size;
      for (const vi of g.verts) {
        pos.setXYZ(vi, g.dir.x * r, g.dir.y * r, g.dir.z * r);
      }
    }
    pos.needsUpdate = true;
    this.geo.computeVertexNormals();
    this.geo.computeBoundingSphere();
    this._placeEyes();
  }

  /** grind lumps near a world-space point; returns amount actually removed */
  grindAt(worldPoint, radius = 0.5, amount = 0.3) {
    const local = this.mesh.worldToLocal(worldPoint.clone()).normalize();
    let removed = 0;
    for (const g of this.groups) {
      const dist = g.dir.distanceTo(local);
      if (dist < radius && g.lump > 0) {
        const k = (1 - dist / radius) * amount;
        const take = Math.min(g.lump, k);
        g.lump -= take;
        removed += take;
      }
    }
    if (removed > 0) {
      this.grindFrac = Math.min(1, this.grindFrac + removed / this.initialLumpSum);
      this.rebuild();
    }
    return removed;
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
  /** 0..1: how flat/smooth — raises skip angle tolerance + restitution */
  get flat() {
    const lumpLeft = this.groups.reduce((s, g) => s + g.lump, 0) / this.initialLumpSum;
    const smooth = 1 - lumpLeft;
    const thin = 1 - (this.thickness - 0.28) / 0.45;
    return Math.max(0, Math.min(1, smooth * 0.55 + thin * 0.45));
  }
  /** 0..1: mass-ish — raises carry (speed retention) but sinks harder */
  get heft() {
    return Math.max(0, Math.min(1, (this.thickness * this.size) / 0.35));
  }

  // ---- googly eyes ----
  _buildEyes() {
    this.eyes = new THREE.Group();
    this.pupilSprings = [];
    const whiteMat = new THREE.MeshStandardMaterial({ color: 0xffffff });
    const pupilMat = new THREE.MeshBasicMaterial({ color: 0x111111 });
    for (let i = 0; i < 2; i++) {
      const eye = new THREE.Group();
      const white = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 8), whiteMat);
      white.scale.z = 0.55;
      eye.add(white);
      const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.085, 8, 6), pupilMat);
      pupil.position.z = 0.09;
      eye.add(pupil);
      eye.userData.pupil = pupil;
      this.eyes.add(eye);
      this.pupilSprings.push({ x: new Spring(0, 260, 9), y: new Spring(0, 260, 9) });
    }
    this.group.add(this.eyes);
  }

  _placeEyes() {
    // eyes sit on the top-front of the stone, looking forward (+x is travel dir)
    const thick = this.thickness;
    const up = this._bodyRadius(new THREE.Vector3(0, 1, 0).normalize(), thick) * this.size;
    const sep = 0.24 * this.size * 2.2;
    this.eyes.children.forEach((eye, i) => {
      const side = i === 0 ? -1 : 1;
      eye.position.set(0.32 * this.size * 1.6, up * 0.82, side * sep * 0.5);
      eye.rotation.set(0, side * 0.28, -0.5);
      eye.rotation.y += Math.PI / 2 * 0; // face +x via lookAt below
      eye.lookAt(
        eye.position.x + 1,
        eye.position.y + 0.55,
        eye.position.z + side * 0.35
      );
      const s = this.size * 2.0;
      eye.scale.setScalar(s);
    });
  }

  /** jolt the googly pupils (impacts, throws) */
  kickEyes(v = 1) {
    for (const s of this.pupilSprings) {
      s.x.kick((Math.random() - 0.5) * 2.4 * v);
      s.y.kick((Math.random() - 0.5) * 2.4 * v);
    }
  }

  /** squash the whole stone (skip contacts, landings) */
  squashKick(v = 1) {
    this.squash.kick(-6 * v);
  }

  update(dt) {
    this.eyes.children.forEach((eye, i) => {
      const s = this.pupilSprings[i];
      const px = Math.max(-0.07, Math.min(0.07, s.x.update(dt)));
      const py = Math.max(-0.07, Math.min(0.07, s.y.update(dt)));
      // pupil slides on the eyeball toward the camera (clamped to the front
      // face), with the spring jiggle layered on top
      const d = eye.worldToLocal(_eyeTmp.copy(EYE_TARGET)).normalize();
      if (d.z < 0.35) {
        d.z = 0.35;
        d.normalize();
      }
      eye.userData.pupil.position.set(
        d.x * 0.09 + px * 0.7,
        d.y * 0.09 + py * 0.7,
        Math.max(0.055, d.z * 0.09)
      );
    });
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

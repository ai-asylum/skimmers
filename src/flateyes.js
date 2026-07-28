/**
 * Flat-outline eyes with shader-drawn pupils, for the in-game rocks.
 *
 * The expression is one flat cell of rock-eyes-grid.png (outline + white only);
 * the two pupils are drawn entirely in the fragment shader so they can be
 * styled (cartoon iris + gloss) and slid around to gaze at a target. Both
 * pupils share one look vector so they stay parallel (never cross-eyed).
 *
 * A single plane carries both eyes. It is attached to the rock at a fixed local
 * pose, so it tumbles/spins with the stone (per design choice).
 *
 * Where the pupils sit per expression lives in eyeconfig.js — the faces are
 * drawn at different heights in their cells, so each one needs its own socket.
 */
import * as THREE from "three";
import { socketFor, onEyeTuningChange } from "./eyeconfig.js";

// ?v bump busts stale browser caches when the sheet asset is re-keyed
const SHEET_URL = "rock-eyes-grid.png?v=2";
const COLS = 4;
const ROWS = 3;

export const EYE_EXPRESSIONS = [
  "neutral", "happy", "angry", "sad",
  "surprised", "suspicious", "sleepy", "dizzy",
  "determined", "worried", "wink", "excited",
];
export const EYE_INDEX = Object.fromEntries(EYE_EXPRESSIONS.map((n, i) => [n, i]));

// default socket layout, used until detection finishes / as a fallback
const DEFAULT_SOCK = { lx: 0.34, ly: 0.46, rx: 0.66, ry: 0.46, rl: 0.135, rr: 0.135 };

// ---- shared, lazily-loaded assets ------------------------------------------
const assets = {
  ready: false,
  tex: null,
  aspect: 1, // cellH / cellW
  // fallback only: the average of the per-cell eye-white detection done once at
  // load, for any expression eyeconfig.js has no measured socket for.
  socket: { ...DEFAULT_SOCK },
  pending: new Set(), // FlatEyes instances waiting for the sheet
};
let loadStarted = false;
const live = new Set(); // every FlatEyes alive, so lab edits can re-apply

// re-seat the pupils whenever the Eyes Lab pushes a new tuning
onEyeTuningChange(() => live.forEach((fe) => fe.setExpression(fe._expr, true)));

function placeholderTex() {
  const t = new THREE.DataTexture(new Uint8Array([0, 0, 0, 0]), 1, 1, THREE.RGBAFormat);
  t.needsUpdate = true;
  return t;
}

function ensureLoaded() {
  if (loadStarted) return;
  loadStarted = true;
  const img = new Image();
  img.onload = () => {
    const cellW = img.width / COLS;
    const cellH = img.height / ROWS;
    assets.aspect = cellH / cellW;

    const tex = new THREE.Texture(img);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.generateMipmaps = false;
    tex.needsUpdate = true;
    assets.tex = tex;

    detectAllSockets(img, cellW, cellH);
    assets.ready = true;
    assets.pending.forEach((fe) => fe._applyAssets());
    assets.pending.clear();
  };
  img.onerror = () => console.error("[flateyes] failed to load", SHEET_URL);
  img.src = SHEET_URL;
}

// ---- socket auto-detection (biggest ink blob per half of each cell) --------
function detectAllSockets(img, cellW, cellH) {
  const c = document.createElement("canvas");
  c.width = cellW; c.height = cellH;
  const g = c.getContext("2d", { willReadFrequently: true });
  // average every well-detected face into ONE shared socket layout
  const acc = { lx: 0, ly: 0, rx: 0, ry: 0, rl: 0, rr: 0 };
  let n = 0;
  for (let i = 0; i < EYE_EXPRESSIONS.length; i++) {
    const col = i % COLS, row = Math.floor(i / COLS);
    g.clearRect(0, 0, cellW, cellH);
    g.drawImage(img, col * cellW, row * cellH, cellW, cellH, 0, 0, cellW, cellH);
    const s = { ...DEFAULT_SOCK };
    if (detectCell(g, cellW, cellH, s)) {
      acc.lx += s.lx; acc.ly += s.ly; acc.rx += s.rx; acc.ry += s.ry;
      acc.rl += s.rl; acc.rr += s.rr; n++;
    }
  }
  if (n > 0) {
    assets.socket = {
      lx: acc.lx / n, ly: acc.ly / n, rx: acc.rx / n, ry: acc.ry / n,
      rl: acc.rl / n, rr: acc.rr / n,
    };
  }
}

function detectCell(g, w, h, out) {
  const data = g.getImageData(0, 0, w, h).data;
  const ink = new Uint8Array(w * h);
  for (let p = 0; p < w * h; p++) {
    const a = data[p * 4 + 3];
    const lum = 0.299 * data[p * 4] + 0.587 * data[p * 4 + 1] + 0.114 * data[p * 4 + 2];
    ink[p] = a > 100 && lum < 115 ? 1 : 0;
  }
  const comps = [];
  const labels = new Int32Array(w * h);
  const stack = [];
  let id = 0;
  for (let start = 0; start < w * h; start++) {
    if (!ink[start] || labels[start]) continue;
    id++;
    stack.length = 0; stack.push(start); labels[start] = id;
    let count = 0, minX = w, maxX = 0, minY = h, maxY = 0;
    while (stack.length) {
      const p = stack.pop();
      const x = p % w, y = (p / w) | 0;
      count++;
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
      if (x > 0 && ink[p - 1] && !labels[p - 1]) { labels[p - 1] = id; stack.push(p - 1); }
      if (x < w - 1 && ink[p + 1] && !labels[p + 1]) { labels[p + 1] = id; stack.push(p + 1); }
      if (y > 0 && ink[p - w] && !labels[p - w]) { labels[p - w] = id; stack.push(p - w); }
      if (y < h - 1 && ink[p + w] && !labels[p + w]) { labels[p + w] = id; stack.push(p + w); }
    }
    comps.push({ count, cx: (minX + maxX) / 2, cy: (minY + maxY) / 2, minX, maxX, minY, maxY });
  }
  const minArea = w * h * 0.0015;
  const big = comps.filter((c2) => c2.count > minArea);
  if (big.length < 2) return false;
  const mid = w / 2;
  const left = big.filter((b) => b.cx < mid).sort((a, b) => b.count - a.count)[0];
  const right = big.filter((b) => b.cx >= mid).sort((a, b) => b.count - a.count)[0];
  if (!left || !right) return false;
  const rad = (b) => (Math.max(b.maxX - b.minX, b.maxY - b.minY) / 2) * 0.9 / w;
  out.lx = (left.minX + left.maxX) / 2 / w;  out.ly = (left.minY + left.maxY) / 2 / h;  out.rl = rad(left);
  out.rx = (right.minX + right.maxX) / 2 / w; out.ry = (right.minY + right.maxY) / 2 / h; out.rr = rad(right);
  return true;
}

// ---- shader ----------------------------------------------------------------
const VERT = /* glsl */`
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const FRAG = /* glsl */`
  precision highp float;
  uniform sampler2D uSheet;
  uniform vec2 uCell;        // col,row
  uniform vec2 uGrid;        // COLS,ROWS
  uniform vec2 uSockL, uSockR;
  uniform float uRadL, uRadR;
  uniform float uAspect;     // cellH/cellW
  uniform vec2 uLook;        // [-1,1] shared gaze
  uniform float uPupilFrac, uFollow, uGloss;
  uniform float uFade;       // whole-face opacity (ducks out while you sculpt)
  uniform vec3 uIris, uTint;
  varying vec2 vUv;

  vec4 pupilAt(vec2 R, vec2 S, float rad) {
    float pupilR = rad * uPupilFrac;
    if (pupilR < 0.0005) return vec4(0.0);
    float travel = max(rad - pupilR, 0.0);
    vec2 lk = uLook;
    float l = length(lk);
    if (l > 1.0) lk /= l;
    vec2 pc = S + lk * travel * uFollow;

    float d = distance(R, pc) / pupilR;
    float disc = smoothstep(1.0, 0.92, d);
    if (disc <= 0.0) return vec4(0.0);

    vec3 col = uTint;                                      // iris ring
    col = mix(col, uIris, smoothstep(0.60, 0.52, d));       // solid pupil
    col = mix(col, uIris * 0.35, smoothstep(0.84, 0.94, d)); // rim stroke

    vec2 hp = pc + vec2(-0.30, -0.34) * pupilR;             // big shine
    col = mix(col, vec3(1.0), smoothstep(1.0, 0.82, distance(R, hp) / (pupilR * 0.40)) * uGloss);
    vec2 hp2 = pc + vec2(0.28, 0.30) * pupilR;              // sparkle
    col = mix(col, vec3(1.0), smoothstep(1.0, 0.7, distance(R, hp2) / (pupilR * 0.16)) * uGloss * 0.85);

    return vec4(col, disc);
  }

  void main() {
    vec2 cx = vec2(vUv.x, 1.0 - vUv.y);                    // top-origin cell coords
    vec2 sheetUV = (vec2(cx.x, 1.0 - cx.y) + uCell) / uGrid;
    vec4 t = texture2D(uSheet, sheetUV);
    float lum = dot(t.rgb, vec3(0.299, 0.587, 0.114));
    float ink = t.a * (1.0 - smoothstep(0.25, 0.55, lum));
    float white = t.a * smoothstep(0.55, 0.8, lum);

    vec2 R = vec2(cx.x, cx.y * uAspect);
    vec2 SL = vec2(uSockL.x, uSockL.y * uAspect);
    vec2 SR = vec2(uSockR.x, uSockR.y * uAspect);
    vec4 pl = pupilAt(R, SL, uRadL);
    vec4 pr = pupilAt(R, SR, uRadR);
    vec4 pup = pl.a >= pr.a ? pl : pr;

    vec3 col = vec3(1.0);          // white sclera
    float a = white;
    col = mix(col, pup.rgb, pup.a); // pupil over sclera
    a = max(a, pup.a);
    col = mix(col, t.rgb, ink);     // ink outline on top
    a = max(a, ink);

    a *= uFade;
    if (a < 0.01) discard;
    gl_FragColor = vec4(col, a);
  }
`;

function makeMaterial() {
  return new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    transparent: true,
    depthWrite: false,
    depthTest: false,     // billboard sticker face: always drawn over the stone
    side: THREE.DoubleSide,
    uniforms: {
      uSheet: { value: assets.tex || placeholderTex() },
      uCell: { value: new THREE.Vector2(0, 0) },
      uGrid: { value: new THREE.Vector2(COLS, ROWS) },
      uSockL: { value: new THREE.Vector2(DEFAULT_SOCK.lx, DEFAULT_SOCK.ly) },
      uSockR: { value: new THREE.Vector2(DEFAULT_SOCK.rx, DEFAULT_SOCK.ry) },
      uRadL: { value: DEFAULT_SOCK.rl },
      uRadR: { value: DEFAULT_SOCK.rr },
      uAspect: { value: assets.aspect },
      uLook: { value: new THREE.Vector2(0, 0) },
      uPupilFrac: { value: 0.46 },
      uFollow: { value: 1.0 },
      uFade: { value: 1.0 },
      uGloss: { value: 0.75 },
      uIris: { value: new THREE.Color(0x22222a) },
      uTint: { value: new THREE.Color(0x2f6f4a) },
    },
  });
}

// small spring for pupil jiggle on impacts
class Jig {
  constructor() { this.v = 0; this.x = 0; }
  kick(a) { this.v += a; }
  update(dt, k = 220, d = 12) {
    this.v += (-k * this.x - d * this.v) * dt;
    this.x += this.v * dt;
    return this.x;
  }
}

const _local = new THREE.Vector3();
const _pq = new THREE.Quaternion();
const _UP = new THREE.Vector3(0, 1, 0);

export class FlatEyes {
  constructor(expression = "neutral", tint) {
    ensureLoaded();
    this.mat = makeMaterial();
    if (tint) this.mat.uniforms.uTint.value.set(tint);
    this.plane = new THREE.Mesh(new THREE.PlaneGeometry(1, 1 / (assets.aspect || 1)), this.mat);
    this.plane.userData.noCel = true;      // keep our raw shader out of the cel pass
    this.plane.userData._outline = true;   // and out of the inverted-hull outline pass
    this.plane.renderOrder = 20;
    this.jigX = new Jig();
    this.jigY = new Jig();
    this.gaze = new THREE.Vector2(0, 0); // smoothed, so the pupils slide between targets
    this.setExpression(expression);
    live.add(this);
    if (assets.ready) this._applyAssets();
    else assets.pending.add(this);
  }

  get object() { return this.plane; }

  get expression() { return this._expr; }

  _applyAssets() {
    const u = this.mat.uniforms;
    u.uSheet.value = assets.tex;
    u.uAspect.value = assets.aspect;
    // rebuild geometry to the real cell aspect
    this.plane.geometry.dispose();
    this.plane.geometry = new THREE.PlaneGeometry(1, 1 / assets.aspect);
    this.setExpression(this._expr, true);
  }

  setExpression(name, force = false) {
    const idx = EYE_INDEX[name] ?? 0;
    if (!force && EYE_EXPRESSIONS[idx] === this._expr) return;
    this._expr = EYE_EXPRESSIONS[idx];
    const u = this.mat.uniforms;
    // three uploads the sheet flipped, so v = 0 is its bottom row: count rows
    // up from there or every face lands two rows off (neutral drew as wink…)
    u.uCell.value.set(idx % COLS, ROWS - 1 - Math.floor(idx / COLS));
    // each face is drawn at its own height in the cell, so it brings its own
    // socket; radius 0 (a shut eye, e.g. wink) draws no pupil at all
    const s = socketFor(this._expr, assets.socket);
    u.uSockL.value.set(s.lx, s.ly);
    u.uSockR.value.set(s.rx, s.ry);
    u.uRadL.value = s.rl;
    u.uRadR.value = s.rr;
  }

  /** 0..1 whole-face opacity — the sticker sits over the middle of the stone,
   *  so it steps aside while the player is working that spot */
  setFade(v) {
    this.mat.uniforms.uFade.value = v;
  }

  /** jolt the pupils (impacts / throws) */
  kick(v = 1) {
    this.jigX.kick((Math.random() - 0.5) * 3.2 * v);
    this.jigY.kick((Math.random() - 0.5) * 3.2 * v);
  }

  /**
   * Billboard the face toward the camera and slide the pupils onto the target.
   * @param targetWorld what the pupils look at (a rival stone, the camera, …)
   * @param camQuat camera world quaternion (for the billboard orientation)
   */
  update(dt, targetWorld, camQuat) {
    const plane = this.plane;

    // --- billboard: match the camera's orientation so the flat face always
    // reads square-on, regardless of how the rock is turned or spinning ---
    if (camQuat && plane.parent) {
      plane.parent.getWorldQuaternion(_pq);
      plane.quaternion.copy(_pq.invert()).multiply(camQuat);
    }

    // --- pupils gaze at the target; with a billboard the parallax between the
    // eye position and the camera still gives a little life ---
    const jx = this.jigX.update(dt);
    const jy = this.jigY.update(dt);
    let gx = 0, gy = 0;
    if (targetWorld) {
      plane.updateWorldMatrix(true, false);
      _local.copy(targetWorld);
      plane.worldToLocal(_local);
      const depth = Math.max(Math.abs(_local.z), 0.05);
      gx = THREE.MathUtils.clamp((_local.x / depth) * 2.2, -1, 1);
      gy = THREE.MathUtils.clamp((_local.y / depth) * 2.2, -1, 1);
    }
    // ease onto a new target (rocks glance between each other) but let the
    // impact jiggle through raw, so hits still snap
    const k = 1 - Math.exp(-11 * dt);
    this.gaze.x += (gx - this.gaze.x) * k;
    this.gaze.y += (gy - this.gaze.y) * k;
    const lk = this.mat.uniforms.uLook.value;
    lk.x = THREE.MathUtils.clamp(this.gaze.x + jx * 0.5, -1, 1);
    lk.y = THREE.MathUtils.clamp(this.gaze.y + jy * 0.5, -1, 1);
  }

  dispose() {
    this.plane.geometry.dispose();
    this.mat.dispose();
    assets.pending.delete(this);
    live.delete(this);
  }
}

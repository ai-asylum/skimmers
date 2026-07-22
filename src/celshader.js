import * as THREE from "three";

// Global cel / toon shading — copied from Train Slop's core/CelShader.js
// (team scrap: cel-shader-swap), config dependency removed.
//
// Transparently swaps any lit material for an equivalent MeshToonMaterial
// sampling a hard-stepped gradient ramp, so the lit side of every object snaps
// into flat tone bands. Pairs with the inverted-hull outlines in outline.js.

function makeToonRamp(steps, floor) {
  const n = Math.max(2, steps | 0);
  const data = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    data[i] = Math.round(THREE.MathUtils.clamp(floor + (1 - floor) * t, 0, 1) * 255);
  }
  const tex = new THREE.DataTexture(data, n, 1, THREE.RedFormat);
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}

function isLit(mat) {
  return !!(
    mat &&
    (mat.isMeshStandardMaterial || mat.isMeshPhongMaterial || mat.isMeshLambertMaterial)
  );
}

const CEL_TWINS = new WeakMap();

function toToon(src, gradientMap) {
  const m = new THREE.MeshToonMaterial({
    color: src.color ? src.color.clone() : new THREE.Color(0xffffff),
    map: src.map || null,
    gradientMap,
    transparent: src.transparent,
    opacity: src.opacity,
    alphaTest: src.alphaTest,
    alphaMap: src.alphaMap || null,
    side: src.side,
    vertexColors: src.vertexColors,
    emissive: src.emissive ? src.emissive.clone() : new THREE.Color(0x000000),
    emissiveMap: src.emissiveMap || null,
    emissiveIntensity: src.emissiveIntensity ?? 1,
    normalMap: src.normalMap || null,
    fog: src.fog,
    toneMapped: src.toneMapped,
  });
  if (src.flatShading) m.flatShading = true;
  m.depthTest = src.depthTest;
  m.depthWrite = src.depthWrite;
  m.polygonOffset = src.polygonOffset;
  m.polygonOffsetFactor = src.polygonOffsetFactor;
  m.polygonOffsetUnits = src.polygonOffsetUnits;
  m.userData = src.userData;
  return m;
}

/** The material actually being rendered for `mat` (its toon twin if converted). */
export function celMat(mat) {
  return (mat && CEL_TWINS.get(mat)) || mat;
}

export class CelShader {
  constructor(scene, opts = {}) {
    this.scene = scene;
    this.gradientMap = makeToonRamp(opts.steps ?? 4, opts.floor ?? 0.35);
    this.rescanSec = opts.rescanSec ?? 1.0;
    this._twins = new Map();
    this._mine = new Set();
    this._accum = 0;
    this.convert(scene);
  }

  _twinFor(src) {
    let t = this._twins.get(src.uuid);
    if (!t) {
      t = toToon(src, this.gradientMap);
      CEL_TWINS.set(src, t);
      CEL_TWINS.set(t, t);
      this._twins.set(src.uuid, t);
      this._mine.add(t);
    }
    return t;
  }

  _convertMaterial(mat) {
    if (!mat || this._mine.has(mat) || mat.userData?.noCel || !isLit(mat)) return mat;
    return this._twinFor(mat);
  }

  convert(root, visibleOnly = false) {
    if (!root) return;
    const each = (o) => {
      if (!o.isMesh && !o.isInstancedMesh && !o.isSkinnedMesh) return;
      const mat = o.material;
      if (Array.isArray(mat)) {
        let changed = false;
        const next = mat.map((m) => {
          const c = this._convertMaterial(m);
          if (c !== m) changed = true;
          return c;
        });
        if (changed) o.material = next;
      } else {
        const c = this._convertMaterial(mat);
        if (c !== mat) o.material = c;
      }
    };
    if (visibleOnly) root.traverseVisible(each);
    else root.traverse(each);
  }

  update(dt) {
    this._accum += dt;
    if (this._accum < this.rescanSec) return;
    this._accum = 0;
    this.convert(this.scene, true);
  }
}

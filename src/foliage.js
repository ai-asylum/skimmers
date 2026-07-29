/**
 * Everything that grows on the banks: the forest and the undergrowth scattered
 * between it (bushes, ferns, flowers, mossy boulders, fallen logs).
 *
 * Geometry comes from Quaternius' Ultimate Nature Pack (CC0), baked out of OBJ
 * into plain arrays by scripts/bake-nature.mjs so nothing is fetched at runtime.
 * Each model rebuilds into one flat-shaded, vertex-coloured BufferGeometry and
 * renders as a single InstancedMesh, so the whole forest and its undergrowth is
 * one draw call per model.
 *
 * Both scatters are rebuilt per hole (Grass does the same) because each hole
 * carves its channel somewhere else: a trunk planted for the previous ground
 * would be left hanging over open water, or buried inside a new bank.
 *
 * Wind is a vertex-shader sway shared by every plant, gated by height in the
 * model so trunks and stems stay rooted while the canopy stirs (team scrap:
 * vertex-sway-shader-patch). Rocks, stumps and logs opt out of it.
 */
import * as THREE from "three";
import { NATURE_MODELS, POS_SCALE } from "./naturedata.js";
import { LAKE_R } from "./water.js";
import { terrainSampleAt } from "./terrain.js";

const swayTime = { value: 0 };

/** drive the wind clock — World.update calls this once a frame */
export function updateWind(elapsed) { swayTime.value = elapsed; }

/**
 * `y0`..`y1` is the local height band over which the sway winds up, in model
 * space, which after the bake means fractions of the prop's own height: a tree
 * can hold its trunk still and only stir from the canopy up. `amp` is in the
 * same units, so it scales with the instance and a sapling doesn't whip as far
 * as the pine next to it.
 */
function patchSway(mat, amp, y0, y1) {
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uSwayTime = swayTime;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nuniform float uSwayTime;")
      .replace(
        "#include <begin_vertex>",
        /* glsl */ `
        #include <begin_vertex>
        {
          #ifdef USE_INSTANCING
            vec4 swayW = modelMatrix * instanceMatrix * vec4(position, 1.0);
          #else
            vec4 swayW = modelMatrix * vec4(position, 1.0);
          #endif
          float swayK = smoothstep(${y0.toFixed(2)}, ${y1.toFixed(2)}, position.y);
          transformed.x += sin(uSwayTime * 1.7 + swayW.x * 0.35 + swayW.z * 0.31) * ${amp.toFixed(4)} * swayK;
          transformed.z += cos(uSwayTime * 1.3 + swayW.z * 0.29) * ${(amp * 0.7).toFixed(4)} * swayK;
        }`
      );
  };
  mat.customProgramCacheKey = () => `sway${amp}_${y0}_${y1}`;
}

function decode(b64, Type) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Type(bytes.buffer);
}

/**
 * Undo the bake's zigzagged delta coding (see scripts/bake-nature.mjs): each
 * value is stored as the signed step from the one `stride` slots back, folded
 * into an unsigned number.
 */
function undelta(b64, Type, stride) {
  const src = decode(b64, Uint16Array);
  const out = new Type(src.length);
  for (let i = 0; i < src.length; i++) {
    const step = (src[i] >>> 1) ^ -(src[i] & 1);
    out[i] = i < stride ? step : out[i - stride] + step;
  }
  return out;
}

const GEO_CACHE = new Map();

/**
 * Rebuild a baked model: dequantise the vertex stream and expand each vertex's
 * palette slot into a vertex colour. The result stands one unit tall with its
 * base on y = 0, so an instance's scale IS the height it wants in world units.
 */
function natureGeometry(name) {
  let geo = GEO_CACHE.get(name);
  if (geo) return geo;
  const model = NATURE_MODELS[name];
  if (!model) throw new Error(`no baked nature model "${name}"`);

  const quant = undelta(model.pos, Int32Array, 3);
  const pos = new Float32Array(quant.length);
  for (let i = 0; i < quant.length; i++) pos[i] = quant[i] / POS_SCALE;

  const vmat = decode(model.vmat, Uint8Array);
  const palette = model.palette.map((h) => new THREE.Color().setHex(h));
  const col = new Float32Array(vmat.length * 3);
  for (let i = 0; i < vmat.length; i++) {
    const c = palette[vmat[i]];
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
  }

  geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
  geo.setIndex(new THREE.BufferAttribute(undelta(model.idx, Uint16Array, 1), 1));
  // The props are flat-shaded off screen-space derivatives, so these are only a
  // fallback for anything that ever renders them smooth — the welded models
  // carry no authored normals.
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  GEO_CACHE.set(name, geo);
  return geo;
}

/**
 * One InstancedMesh per model, drawing its material from `materialFor` so that
 * models wanting the same one share a compiled program. `place` writes
 * instances; `commit` publishes the counts.
 */
class Scatter {
  constructor(scene, kinds, cap, materialFor) {
    this.meshes = kinds.map((k) => {
      const mesh = new THREE.InstancedMesh(natureGeometry(k.model), materialFor(k), cap);
      mesh.count = 0;
      mesh.frustumCulled = false; // one mesh spans the whole map; its sphere is useless
      scene.add(mesh);
      return mesh;
    });
    this.cap = cap;
    this._o = new THREE.Object3D();
  }

  /** `tilt` is how far off upright it may lean. @returns false when full */
  place(kindIndex, x, y, z, height, tilt = 0) {
    const mesh = this.meshes[kindIndex];
    if (mesh.count >= this.cap) return false;
    const lean = () => (Math.random() - 0.5) * tilt;
    const o = this._o;
    o.position.set(x, y, z);
    o.rotation.set(lean(), Math.random() * Math.PI * 2, lean());
    o.scale.setScalar(height);
    o.updateMatrix();
    mesh.setMatrixAt(mesh.count++, o.matrix);
    return true;
  }

  clear() { for (const m of this.meshes) m.count = 0; }
  commit() { for (const m of this.meshes) m.instanceMatrix.needsUpdate = true; }
}

/** weighted pick over entries carrying a `weight`, restricted to `eligible` */
function pickWeighted(entries, eligible) {
  let total = 0;
  for (const i of eligible) total += entries[i].weight;
  let r = Math.random() * total;
  for (const i of eligible) {
    r -= entries[i].weight;
    if (r <= 0) return i;
  }
  return eligible[eligible.length - 1];
}

// ------------------------------------------------------------------ trees
// Species are banded by how far up the bank they are, which is what makes the
// treeline read as a landscape rather than a mix: willows and broadleaf crowd
// the water's edge, birch takes the middle slopes, and pine climbs highest and
// alone up the bare crests. `h` is the world height range in metres. The two
// densest models (CommonTree_1, PineTree_3) are weighted down to keep the
// forest's triangle count near the lighter variants' — they read as the
// occasional big old tree rather than the bulk of the canopy.
const TREE_SPECIES = [
  { model: "Willow_3", h: [5, 8], y: [0.4, 4], weight: 1.1 },
  { model: "CommonTree_1", h: [8, 12], y: [0.4, 12], weight: 0.6 },
  { model: "CommonTree_4", h: [6, 9.5], y: [0.4, 14], weight: 1.6 },
  { model: "BirchTree_3", h: [7, 11], y: [2, 22], weight: 0.9 },
  { model: "PineTree_5", h: [7, 11], y: [4, 34], weight: 1.7 },
  { model: "PineTree_3", h: [10, 15], y: [6, 34], weight: 0.7 },
];

// Per-tree-geometry snapshot: a bark/leaf mask plus each vertex's baked
// brightness (normalised around its group's mean). A vertex reads as "leaf"
// when green clearly leads the other channels. The brightness lets an absolute
// bark/leaf colour keep the original light/dark shading instead of going flat.
const TREE_META = new WeakMap();
function treeMeta(geo) {
  let meta = TREE_META.get(geo);
  if (!meta) {
    const orig = geo.attributes.color.array;
    const n = orig.length / 3;
    const isLeaf = new Uint8Array(n);
    const lum = new Float32Array(n);
    let leafSum = 0, leafCount = 0, barkSum = 0, barkCount = 0;
    for (let i = 0; i < n; i++) {
      const r = orig[i * 3], g = orig[i * 3 + 1], b = orig[i * 3 + 2];
      const l = 0.299 * r + 0.587 * g + 0.114 * b;
      lum[i] = l;
      if (g - Math.max(r, b) > 0.02) { isLeaf[i] = 1; leafSum += l; leafCount++; }
      else { barkSum += l; barkCount++; }
    }
    meta = { isLeaf, lum, leafMean: leafSum / (leafCount || 1), barkMean: barkSum / (barkCount || 1) };
    TREE_META.set(geo, meta);
  }
  return meta;
}
const _clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

export class Trees {
  constructor(scene) {
    this.total = 110;
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true });
    // Dead below a fifth of the tree's height so the trunk stays rooted, full by
    // the top: the trunk holds still and the canopy stirs.
    patchSway(mat, 0.022, 0.2, 1.0);
    this.mat = mat;
    this.scatter = new Scatter(scene, TREE_SPECIES, 56, () => mat);
    this.geos = TREE_SPECIES.map((s) => natureGeometry(s.model));
    // default tree hues (the tweak menu can override them)
    this.bark = "#a06b40";
    this.leaf = "#659334";
    this.setColors(this.bark, this.leaf);
  }

  getColors() { return { bark: this.bark, leaf: this.leaf }; }

  /**
   * Paint bark and canopy with two chosen colours. This replaces the baked
   * palette hue outright — each vertex becomes its group's picked colour,
   * scaled by the vertex's original brightness (normalised around the group
   * mean) so the trees keep their light/dark shading instead of reading flat.
   * The colour attribute is shared with the cel twin, so this repaints both
   * the lit and toon passes.
   */
  setColors(barkHex, leafHex) {
    this.bark = barkHex; this.leaf = leafHex;
    const bark = new THREE.Color(barkHex), leaf = new THREE.Color(leafHex);
    for (const geo of this.geos) {
      const { isLeaf, lum, leafMean, barkMean } = treeMeta(geo);
      const arr = geo.attributes.color.array;
      for (let i = 0; i < isLeaf.length; i++) {
        const leafy = isLeaf[i];
        const t = leafy ? leaf : bark;
        const s = lum[i] / (leafy ? leafMean : barkMean); // brightness around 1.0
        arr[i * 3] = _clamp01(t.r * s);
        arr[i * 3 + 1] = _clamp01(t.g * s);
        arr[i * 3 + 2] = _clamp01(t.b * s);
      }
      geo.attributes.color.needsUpdate = true;
    }
  }

  /** re-plant the forest on the grassy banks of the current hole */
  setHole() {
    this.scatter.clear();
    const maxR = LAKE_R * 1.9; // out to the far ends of a corner-to-corner hole
    let placed = 0, guard = 0;
    const eligible = [];
    while (placed < this.total && guard++ < 8000) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.sqrt(Math.random()) * maxR;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      const { y, kind } = terrainSampleAt(x, z);
      if (kind !== "grass") continue; // never on the bed or the beach shelf
      eligible.length = 0;
      for (let i = 0; i < TREE_SPECIES.length; i++) {
        const band = TREE_SPECIES[i].y;
        if (y >= band[0] && y <= band[1]) eligible.push(i);
      }
      if (!eligible.length) continue; // below the shoreline or up on the peaks
      const i = pickWeighted(TREE_SPECIES, eligible);
      const [lo, hi] = TREE_SPECIES[i].h;
      if (this.scatter.place(i, x, y, z, lo + Math.random() * (hi - lo), 0.09)) placed++;
    }
    this.scatter.commit();
  }
}

// ------------------------------------------------------------------ undergrowth
// The layer between the grass blades and the treeline. `beach` props also take
// the sand shelf, which is how driftwood and boulders end up at the waterline.
const PROPS = [
  { model: "Bush_1", h: [1.1, 2.0], y: [0.15, 18], weight: 2.2, sway: true },
  { model: "Bush_2", h: [0.9, 1.7], y: [0.15, 18], weight: 2.0, sway: true },
  { model: "BushBerries_1", h: [1.0, 1.5], y: [0.15, 10], weight: 0.8, sway: true },
  { model: "Plant_3", h: [0.7, 1.2], y: [0.15, 14], weight: 1.6, sway: true },
  { model: "Plant_5", h: [0.6, 1.0], y: [0.15, 8], weight: 0.9, sway: true },
  { model: "Flowers", h: [0.5, 0.8], y: [0.15, 9], weight: 1.4, sway: true },
  { model: "Rock_Moss_1", h: [0.8, 2.0], y: [0, 26], weight: 1.1, beach: true },
  { model: "Rock_Moss_3", h: [0.6, 1.6], y: [0, 26], weight: 1.2, beach: true },
  { model: "TreeStump_Moss", h: [0.7, 1.1], y: [0.4, 16], weight: 0.5 },
  { model: "WoodLog_Moss", h: [0.6, 1.0], y: [0, 12], weight: 0.6, beach: true },
];

export class Foliage {
  constructor(scene) {
    this.total = 460;
    const leafy = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true });
    // Undergrowth is short and springy: it stirs from near the ground and moves
    // further, relative to its size, than a tree does.
    patchSway(leafy, 0.06, 0.05, 1.0);
    const solid = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true });
    this.scatter = new Scatter(scene, PROPS, 120, (p) => (p.sway ? leafy : solid));
  }

  /** re-scatter the undergrowth over the banks of the current hole */
  setHole() {
    this.scatter.clear();
    const maxR = LAKE_R * 1.8;
    let placed = 0, guard = 0;
    const eligible = [];
    while (placed < this.total && guard++ < this.total * 12) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.sqrt(Math.random()) * maxR;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      const { y, kind } = terrainSampleAt(x, z);
      if (kind === "bed") continue;
      eligible.length = 0;
      for (let i = 0; i < PROPS.length; i++) {
        const p = PROPS[i];
        if (kind === "sand" && !p.beach) continue;
        if (y >= p.y[0] && y <= p.y[1]) eligible.push(i);
      }
      if (!eligible.length) continue;
      const i = pickWeighted(PROPS, eligible);
      const p = PROPS[i];
      const h = p.h[0] + Math.random() * (p.h[1] - p.h[0]);
      // Boulders and logs sit at any angle and sink a little into the ground;
      // plants stand up straight out of it.
      const tilt = p.sway ? 0.1 : 0.5;
      const sink = p.sway ? 0 : -h * 0.12;
      if (this.scatter.place(i, x, y + sink, z, h, tilt)) placed++;
    }
    this.scatter.commit();
  }
}

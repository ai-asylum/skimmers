/**
 * The school of fish that guards a sunken rock (see fishing.js).
 *
 * Geometry comes from three sculpted models, baked out of FBX into plain arrays
 * by scripts/bake-fish.mjs so nothing has to be fetched at runtime. Each rebuilds
 * into one flat-shaded, vertex-coloured BufferGeometry — a single draw call per
 * fish, no textures, no material array.
 *
 * They swim without any skeleton: a vertex shader displaces the body with
 * scrolling Perlin noise, weighted head-to-tail so the nose holds steady and the
 * tail whips. The noise field is anchored to the fish's world position, which
 * both puts every fish on its own phase for free and keeps the wobble drifting
 * as it patrols. Displacement depends only on the vertex position, so shared
 * corners always move together and the mesh never cracks open.
 */
import * as THREE from "three";
import { FISH_MODELS, POS_SCALE } from "./fishdata.js";

export const FISH_VARIANTS = FISH_MODELS.length;

/** wave tuning, shared by every fish (see the vertex patch below) */
export const wave = {
  uTime: { value: 0 },
  uWaveAmp: { value: 0.17 }, // tail sway, in body lengths
  uWaveFreq: { value: 1.5 }, // noise cells along the body — about one wave
  uWaveSpeed: { value: 1.9 }, // tail beats per second
  uFinFlutter: { value: 0.03 }, // shiver on the fins' shorter wavelength
};

function decode(b64, Type) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Type(bytes.buffer);
}

/**
 * Rebuild a baked model: dequantise the vertex stream, expand the per-triangle
 * palette index into vertex colours, and mark up the fins for the flutter term.
 */
function buildGeometry(model) {
  const quant = decode(model.pos, Int16Array);
  const tri = decode(model.tri, Uint8Array);
  const count = quant.length / 3;

  const pos = new Float32Array(quant.length);
  for (let i = 0; i < quant.length; i++) pos[i] = quant[i] / POS_SCALE;

  const palette = model.palette.map((hex) => new THREE.Color().setHex(hex));
  const col = new Float32Array(quant.length);
  for (let t = 0; t < tri.length; t++) {
    const c = palette[tri[t]];
    for (let k = 0; k < 3; k++) {
      const i = (t * 3 + k) * 3;
      col[i] = c.r;
      col[i + 1] = c.g;
      col[i + 2] = c.b;
    }
  }

  // How far out on a fin (or the tail blade) each vertex sits, normalised
  // per model because a fantail carries far more silhouette than a minnow.
  // Kept purely position-derived so it can't split shared corners apart.
  let halfH = 1e-4;
  for (let i = 1; i < pos.length; i += 3) halfH = Math.max(halfH, Math.abs(pos[i]));
  const fin = new Uint8Array(count);
  for (let i = 0; i < count; i++) {
    const t = THREE.MathUtils.smoothstep(Math.abs(pos[i * 3 + 1]) / halfH, 0.45, 1);
    fin[i] = Math.round(t * 255);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
  geo.setAttribute("aFin", new THREE.BufferAttribute(fin, 1, true));
  // non-indexed, so this hands every triangle its own face normal — the flat
  // look the rest of the game uses, and a sane fallback if the cel pass ever
  // drops flatShading (the shading itself is derivative-based, see below)
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  return geo;
}

// Classic Perlin 3D noise, Stefan Gustavson's GLSL implementation (MIT) as
// shipped with three's examples. Cheap enough here: a few thousand vertices.
const PERLIN_GLSL = /* glsl */ `
  vec4 fishPermute(vec4 x) { return mod(((x * 34.0) + 1.0) * x, 289.0); }
  vec4 fishFalloff(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }
  vec3 fishFade(vec3 t) { return t * t * t * (t * (t * 6.0 - 15.0) + 10.0); }

  float fishNoise(vec3 P) {
    vec3 Pi0 = mod(floor(P), 289.0);
    vec3 Pi1 = mod(Pi0 + 1.0, 289.0);
    vec3 Pf0 = fract(P);
    vec3 Pf1 = Pf0 - 1.0;
    vec4 ix = vec4(Pi0.x, Pi1.x, Pi0.x, Pi1.x);
    vec4 iy = vec4(Pi0.yy, Pi1.yy);
    vec4 ixy = fishPermute(fishPermute(ix) + iy);
    vec4 ixy0 = fishPermute(ixy + Pi0.zzzz);
    vec4 ixy1 = fishPermute(ixy + Pi1.zzzz);

    vec4 gx0 = ixy0 / 7.0;
    vec4 gy0 = fract(floor(gx0) / 7.0) - 0.5;
    gx0 = fract(gx0);
    vec4 gz0 = vec4(0.5) - abs(gx0) - abs(gy0);
    vec4 sz0 = step(gz0, vec4(0.0));
    gx0 -= sz0 * (step(0.0, gx0) - 0.5);
    gy0 -= sz0 * (step(0.0, gy0) - 0.5);

    vec4 gx1 = ixy1 / 7.0;
    vec4 gy1 = fract(floor(gx1) / 7.0) - 0.5;
    gx1 = fract(gx1);
    vec4 gz1 = vec4(0.5) - abs(gx1) - abs(gy1);
    vec4 sz1 = step(gz1, vec4(0.0));
    gx1 -= sz1 * (step(0.0, gx1) - 0.5);
    gy1 -= sz1 * (step(0.0, gy1) - 0.5);

    vec3 g000 = vec3(gx0.x, gy0.x, gz0.x), g100 = vec3(gx0.y, gy0.y, gz0.y);
    vec3 g010 = vec3(gx0.z, gy0.z, gz0.z), g110 = vec3(gx0.w, gy0.w, gz0.w);
    vec3 g001 = vec3(gx1.x, gy1.x, gz1.x), g101 = vec3(gx1.y, gy1.y, gz1.y);
    vec3 g011 = vec3(gx1.z, gy1.z, gz1.z), g111 = vec3(gx1.w, gy1.w, gz1.w);

    vec4 n0 = fishFalloff(vec4(dot(g000, g000), dot(g010, g010), dot(g100, g100), dot(g110, g110)));
    g000 *= n0.x; g010 *= n0.y; g100 *= n0.z; g110 *= n0.w;
    vec4 n1 = fishFalloff(vec4(dot(g001, g001), dot(g011, g011), dot(g101, g101), dot(g111, g111)));
    g001 *= n1.x; g011 *= n1.y; g101 *= n1.z; g111 *= n1.w;

    vec4 nz = mix(
      vec4(dot(g000, Pf0), dot(g100, vec3(Pf1.x, Pf0.yz)),
           dot(g010, vec3(Pf0.x, Pf1.y, Pf0.z)), dot(g110, vec3(Pf1.xy, Pf0.z))),
      vec4(dot(g001, vec3(Pf0.xy, Pf1.z)), dot(g101, vec3(Pf1.x, Pf0.y, Pf1.z)),
           dot(g011, vec3(Pf0.x, Pf1.yz)), dot(g111, Pf1)),
      fishFade(Pf0).z);
    vec2 nyz = mix(nz.xy, nz.zw, fishFade(Pf0).y);
    return 2.2 * mix(nyz.x, nyz.y, fishFade(Pf0).x);
  }
`;

let _mat = null;
const _geos = [];

function fishMaterial() {
  if (_mat) return _mat;
  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    flatShading: true,
    roughness: 0.72,
    metalness: 0,
  });
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, wave);
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        /* glsl */ `#include <common>
        attribute float aFin;
        uniform float uTime;
        uniform float uWaveAmp;
        uniform float uWaveFreq;
        uniform float uWaveSpeed;
        uniform float uFinFlutter;
        ${PERLIN_GLSL}`
      )
      .replace(
        "#include <begin_vertex>",
        /* glsl */ `#include <begin_vertex>
        // baked nose sits at x = +0.5, tail tip at -0.5, so this ramps 0 -> 1
        // down the body and squares up into a whip at the very back
        float whip = clamp(0.5 - transformed.x, 0.0, 1.0);
        whip *= whip;
        // one noise lane per fish, picked by where it is in the lake, scrolling
        // from head to tail as time runs on
        vec3 anchor = modelMatrix[3].xyz;
        vec2 lane = anchor.xz * 0.37 + anchor.y * 0.11;
        vec3 np = vec3(transformed.x * uWaveFreq + uTime * uWaveSpeed, lane);
        transformed.y += fishNoise(np) * uWaveAmp * whip;
        transformed.z += fishNoise(np + vec3(0.0, 17.3, 5.9)) * uWaveAmp * 0.6 * whip;
        float shiver = fishNoise(np * 2.6 + vec3(9.1, 3.3, 0.0)) * uFinFlutter * aFin;
        transformed.y += shiver;
        transformed.z += shiver * 0.5;`
      );
  };
  // the cel pass carries this patch onto its toon twin, and needs its own
  // program for it (celshader.js)
  mat.customProgramCacheKey = () => "fishwave";
  _mat = mat;
  return mat;
}

/** a fish of the given species, nose along +x, unit length — size it with scale */
export function makeFish(variant) {
  const i = variant % FISH_VARIANTS;
  _geos[i] ??= buildGeometry(FISH_MODELS[i]);
  const mesh = new THREE.Mesh(_geos[i], fishMaterial());
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  return mesh;
}

/** drive the shared wave clock (called from Fishing.update) */
export function updateFishWave(elapsed) {
  wave.uTime.value = elapsed;
}

/**
 * Ground terrain for the lake basin.
 *
 * A single displaced grid that reads the fairway-channel SDF (see water.js):
 *   • under the water channel  -> the real lake bed (water.js bedProfile), which
 *     meets the sand exactly at the waterline, so the ground is one continuous
 *     surface whether you are looking down at it or diving through it
 *   • the beach at the waterline -> FLAT sand
 *   • the banks -> Perlin hills that get TALLER the further you are from water
 *   • far out (beyond the lake radius) -> the familiar radial mountain bowl
 *
 * That "taller inland" rule is the difficulty knob. A narrow neck of land
 * between two legs of the channel only ever rises into a low ridge you can lob
 * over, but a fat corner grows into a wall you have to go around — so cutting
 * the dogleg becomes a real gamble instead of a free shortcut. It also
 * guarantees you can never be stranded: anywhere a stone can fly to, it can
 * throw its way back downhill from.
 *
 * The height function is exported (`terrainHeightAt`) so physics can beach
 * rocks on land and props/grass can sit on the ground. Rebuild per hole via
 * `Terrain.setPath` (mirrors water.setPath) so the banks follow the channel.
 *
 * On top of the vertex-colour bands sit two world-XZ-projected detail textures,
 * sand and grass, cross-faded per vertex — see GROUND_TEX.
 */
import * as THREE from "three";
import { LAKE_R, CHANNEL_W, BED_MAX, bedProfile } from "./water.js";
import { getNoise, shoreWobble } from "./channelrender.js";
import { perlin2, fbm2, ridged2 } from "./noise.js";

const SAND_W = 3.5; // flat beach width at the waterline
const HILL_RAMP = 16; // bank width over which the hills wind up to full height
const HILL_H = 18; // tallest bank hill
/** roughly the apex of a max-power splash lob — hills above this are a wall */
export const LOB_CLEAR = 8;

// The tee bridge (world.js Pontoon) runs ~22u back from the first waypoint,
// directly away from the flag. Flatten an apron under it so the banks don't
// swallow the deck the player launches from.
const TEE_BACK = 23, TEE_HALF = 5.5;

// module state (mirrors the shader's path so JS height matches the visuals)
let _path = null;
let _halfW = CHANNEL_W;
let _tee = null; // { x, z, ux, uz } with ux/uz pointing back down the bridge
let _nfreq = 0.05, _namp = 7; // cached shoreline-noise so we don't hit localStorage per vertex

export function setTerrainPath(path, halfWidth = CHANNEL_W) {
  _path = path && path.length >= 2 ? path.map((p) => ({ x: p.x, z: p.z })) : null;
  _halfW = halfWidth;
  if (_path) {
    const tee = _path[0], flag = _path[_path.length - 1];
    const dx = flag.x - tee.x, dz = flag.z - tee.z;
    const l = Math.hypot(dx, dz) || 1;
    _tee = { x: tee.x, z: tee.z, ux: -dx / l, uz: -dz / l };
  } else {
    _tee = null;
  }
  const n = getNoise();
  _nfreq = n.freq; _namp = n.amp;
}

function distToPath(x, z) {
  let d = Infinity;
  for (let i = 0; i < _path.length - 1; i++) {
    const a = _path[i], b = _path[i + 1];
    const bax = b.x - a.x, baz = b.z - a.z;
    const pax = x - a.x, paz = z - a.z;
    const len2 = bax * bax + baz * baz || 1;
    const h = Math.min(1, Math.max(0, (pax * bax + paz * baz) / len2));
    const dx = pax - bax * h, dz = paz - baz * h;
    const dd = Math.sqrt(dx * dx + dz * dz);
    if (dd < d) d = dd;
  }
  return d;
}

const sstep = (e0, e1, x) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0 || 1))); return t * t * (3 - 2 * t); };
const clamp01 = (v) => Math.min(1, Math.max(0, v));

/**
 * The bank hill field at full strength, 0..HILL_H. Domain-warped so the ridges
 * meander across the map, with a ridged layer on top for crests and the pow()
 * biting the low end into open saddles — the passes a bold throw can thread.
 */
function hillsAt(x, z) {
  const wx = x + perlin2(x * 0.011 + 41.7, z * 0.011 - 12.3) * 26;
  const wz = z + perlin2(x * 0.011 - 8.9, z * 0.011 + 27.1) * 26;
  const rolling = fbm2(wx * 0.017, wz * 0.017, 4) * 0.5 + 0.5;
  const crests = ridged2(wx * 0.034, wz * 0.034, 3);
  return Math.pow(clamp01(rolling * 0.55 + crests * 0.45), 1.35) * HILL_H;
}

/** { y, kind } for a world point — the single source of truth for the mesh + physics */
function sample(x, z) {
  const r = Math.hypot(x, z);
  let d, edgeW;
  if (_path) { d = distToPath(x, z); edgeW = _halfW; } else { d = r; edgeW = LAKE_R; }
  const dw = d + shoreWobble(x, z, _nfreq, _namp);

  // How sandy the ground reads for the texture blend (see GROUND_TEX). The bed
  // and the beach shelf are all sand; it eases into grass over the first few
  // metres of bank so the two projected textures cross-fade instead of butting
  // up against each other along a single quad edge.
  const sand = 1 - sstep(edgeW + SAND_W, edgeW + SAND_W + 6, dw);

  let y, kind;
  if (dw < edgeW) { y = bedProfile(dw, edgeW); kind = "bed"; }
  else if (dw < edgeW + SAND_W) { y = 0; kind = "sand"; }
  else {
    // ramp keyed off distance inland, so the shore stays fair and the deep
    // banks turn into terrain you have to respect
    const ramp = sstep(0, HILL_RAMP, dw - (edgeW + SAND_W));
    const detail = fbm2(x * 0.13, z * 0.13, 2) * 0.7;
    y = (hillsAt(x, z) + detail) * ramp;
    kind = "grass";
  }
  // distant mountains ring the whole map by radius (keeps the familiar bowl)
  if (r > LAKE_R) {
    const dm = r - LAKE_R;
    const a = Math.atan2(z, x);
    y += Math.min(26, Math.pow(dm * 0.16, 1.55)) + Math.sin(a * 7 + dm * 0.14) * Math.min(2.5, dm * 0.05);
    if (kind === "bed") kind = "grass";
  }
  // press the tee apron flat under the launch bridge
  if (_tee && kind !== "bed") {
    const px = x - _tee.x, pz = z - _tee.z;
    const along = px * _tee.ux + pz * _tee.uz; // >0 is behind the tee
    const side = Math.abs(pz * _tee.ux - px * _tee.uz);
    const k = sstep(-12, -4, along)
      * (1 - sstep(TEE_BACK, TEE_BACK + 7, along))
      * (1 - sstep(TEE_HALF, TEE_HALF + 6, side));
    y *= 1 - 0.9 * k;
  }
  return { y, kind, sand };
}

/** ground height at a world point (mirrors the mesh) — used by physics & props */
export function terrainHeightAt(x, z) { return sample(x, z).y; }
/** height + biome ("bed" | "sand" | "grass") — one call instead of two */
export function terrainSampleAt(x, z) { return sample(x, z); }

// ---- colour palette ----------------------------------------------------------
const SAND = [0.93, 0.85, 0.64];
const MUD = [0.72, 0.66, 0.5]; // wet sand just under the waterline
const MUD_DEEP = [0.3, 0.42, 0.42];
const GRASS = [0.49, 0.77, 0.37];
const GRASS_DARK = [0.31, 0.6, 0.29];
const ROCK = [0.6, 0.65, 0.64];
const lerp3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

function colorFor(kind, y, x, z) {
  if (kind === "sand") return SAND;
  // the bed silts up as it drops, so a dive reads depth the way the water does
  if (kind === "bed") return lerp3(MUD, MUD_DEEP, clamp01(-y / (BED_MAX * 0.55)));
  // green while a lob could still clear it, bleaching to bare rock above —
  // the colour of a bank is the "can I get over that?" read from the tee
  let c = lerp3(GRASS, GRASS_DARK, clamp01(y / 10));
  if (y > LOB_CLEAR) c = lerp3(c, ROCK, clamp01((y - LOB_CLEAR) / 6));
  const n = (Math.sin(x * 0.53) + Math.cos(z * 0.61)) * 0.03; // subtle patchiness
  return [clamp01(c[0] + n), clamp01(c[1] + n), clamp01(c[2] + n)];
}

// ---- ground textures --------------------------------------------------------
// Ported from Spellwright's stylized ground material (its meadow and
// flat-desert presets), params unchanged. Both maps are projected from world XZ
// rather than the plane's UVs, so the tiling stays square no matter how the
// centre-biased grid stretches the quads. The albedo is reduced to luminance
// and lifted toward white, so it modulates the vertex-colour bands as painterly
// grain instead of replacing them — that's why the sand map's desert orange
// doesn't fight the lake's paler beach.
//
//   scale       world metres per texture tile
//   normalScale strength of the normal-map perturbation
//   lift        how far the greyscaled albedo is pushed to white (1 = invisible)
//   fadeStart/  slope window over which both maps fade out, slope being
//   fadeEnd     1 - |normal.y|. Grass is deliberately past vertical so it never
//               fades; sand quits almost immediately, since planar projection
//               smears on anything but the flat shelf it was authored for.
const GROUND_TEX = {
  grass: {
    albedo: "textures/ground/grass-albedo.webp",
    normal: "textures/ground/grass-normal.webp",
    scale: 8, normalScale: 0.015, lift: 0.89, fadeStart: 1.0, fadeEnd: 2.0,
  },
  sand: {
    albedo: "textures/ground/sand-albedo.webp",
    normal: "textures/ground/sand-normal.webp",
    scale: 4, normalScale: 0.04, lift: 0, fadeStart: 0.05, fadeEnd: 0.2,
  },
};

const _texLoader = new THREE.TextureLoader();
function loadGroundTex(url, isNormal) {
  const t = _texLoader.load(url);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = isNormal ? THREE.NoColorSpace : THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/**
 * Blend both ground maps into a lit material, weighted per vertex by the `aSand`
 * attribute. One shader samples both sets so the beach can dissolve into the
 * bank without a second draw or a stencil, at the cost of two extra fetches.
 * The .x/.y of each packed uniform is grass/sand respectively.
 */
function patchGroundTex(mat) {
  const G = GROUND_TEX.grass, S = GROUND_TEX.sand;
  const uniforms = {
    uGrassMap: { value: loadGroundTex(G.albedo, false) },
    uGrassNrm: { value: loadGroundTex(G.normal, true) },
    uSandMap: { value: loadGroundTex(S.albedo, false) },
    uSandNrm: { value: loadGroundTex(S.normal, true) },
    uTexScale: { value: new THREE.Vector2(G.scale, S.scale) },
    uNrmScale: { value: new THREE.Vector2(G.normalScale, S.normalScale) },
    uTexLift: { value: new THREE.Vector2(G.lift, S.lift) },
    uSlopeFade: { value: new THREE.Vector4(G.fadeStart, G.fadeEnd, S.fadeStart, S.fadeEnd) },
  };
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        /* glsl */ `
        #include <common>
        attribute float aSand;
        varying float vSand;
        varying vec3 vGroundPos;
        varying vec3 vGroundNrm;`
      )
      .replace(
        "#include <begin_vertex>",
        /* glsl */ `
        #include <begin_vertex>
        vSand = aSand;
        vGroundPos = (modelMatrix * vec4(position, 1.0)).xyz;`
      )
      .replace(
        "#include <beginnormal_vertex>",
        /* glsl */ `
        #include <beginnormal_vertex>
        vGroundNrm = mat3(modelMatrix) * objectNormal;`
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        /* glsl */ `
        #include <common>
        varying float vSand;
        varying vec3 vGroundPos;
        varying vec3 vGroundNrm;
        uniform sampler2D uGrassMap;
        uniform sampler2D uGrassNrm;
        uniform sampler2D uSandMap;
        uniform sampler2D uSandNrm;
        uniform vec2 uTexScale;
        uniform vec2 uNrmScale;
        uniform vec2 uTexLift;
        uniform vec4 uSlopeFade;
        // Slope from the interpolated vertex normal, not the flat-shaded face
        // normal, so the fades sweep smoothly instead of stepping facet by facet.
        float groundSlope() { return 1.0 - abs(normalize(vGroundNrm).y); }
        vec2 groundFade(float slope) {
          return vec2(
            1.0 - smoothstep(uSlopeFade.x, uSlopeFade.y, slope),
            1.0 - smoothstep(uSlopeFade.z, uSlopeFade.w, slope)
          );
        }`
      )
      .replace(
        "#include <color_fragment>",
        /* glsl */ `
        #include <color_fragment>
        {
          vec2 fade = groundFade(groundSlope());
          const vec3 LUMA = vec3(0.299, 0.587, 0.114);
          float g = dot(texture2D(uGrassMap, vGroundPos.xz / uTexScale.x).rgb, LUMA);
          float s = dot(texture2D(uSandMap, vGroundPos.xz / uTexScale.y).rgb, LUMA);
          g = mix(mix(g, 1.0, uTexLift.x), 1.0, 1.0 - fade.x);
          s = mix(mix(s, 1.0, uTexLift.y), 1.0, 1.0 - fade.y);
          diffuseColor.rgb *= mix(g, s, clamp(vSand, 0.0, 1.0));
        }`
      )
      .replace(
        "#include <normal_fragment_maps>",
        /* glsl */ `
        #include <normal_fragment_maps>
        {
          // Nudge whatever normal the shading path already settled on rather
          // than rebuilding one from vGroundNrm — that keeps the terrain's flat
          // shading and just adds surface grain on top of the facets. The
          // tangent frame is anchored to world +X so the perturbation lines up
          // with the world-XZ projection above.
          vec2 fade = groundFade(groundSlope());
          float sandW = clamp(vSand, 0.0, 1.0);
          float kG = uNrmScale.x * fade.x * (1.0 - sandW);
          float kS = uNrmScale.y * fade.y * sandW;
          vec2 dn = (texture2D(uGrassNrm, vGroundPos.xz / uTexScale.x).xy * 2.0 - 1.0) * kG
                  + (texture2D(uSandNrm, vGroundPos.xz / uTexScale.y).xy * 2.0 - 1.0) * kS;
          vec3 n = normalize(normal);
          vec3 wx = normalize((viewMatrix * vec4(1.0, 0.0, 0.0, 0.0)).xyz);
          vec3 t = normalize(wx - n * dot(n, wx));
          normal = normalize(n + dn.x * t + dn.y * cross(n, t));
        }`
      );
  };
  mat.customProgramCacheKey = () => "groundtex";
  return mat;
}

// Grid density is biased toward the middle of the map: the playfield gets
// ~1u quads so the hills collide the way they look, while the outer mountain
// ring coasts along on big ones.
const CENTER_BIAS = 0.42;
const gridWarp = (u) => u * (CENTER_BIAS + (1 - CENTER_BIAS) * u * u * u * u);

export class Terrain {
  constructor(scene) {
    const SIZE = 500, SEG = 224;
    this.geo = new THREE.PlaneGeometry(2, 2, SEG, SEG);
    this.geo.rotateX(-Math.PI / 2);
    const pos = this.geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      pos.setX(i, gridWarp(pos.getX(i)) * (SIZE / 2));
      pos.setZ(i, gridWarp(pos.getZ(i)) * (SIZE / 2));
    }
    this.mat = patchGroundTex(new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true }));
    this.mesh = new THREE.Mesh(this.geo, this.mat);
    this.mesh.receiveShadow = true;
    scene.add(this.mesh);
    this.setPath(null);
  }

  /** rebuild the displaced mesh for a hole's channel (null => radial disc) */
  setPath(path, halfWidth = CHANNEL_W) {
    setTerrainPath(path, halfWidth);
    const pos = this.geo.attributes.position;
    const n = pos.count;
    let colAttr = this.geo.getAttribute("color");
    if (!colAttr) { colAttr = new THREE.BufferAttribute(new Float32Array(n * 3), 3); this.geo.setAttribute("color", colAttr); }
    let sandAttr = this.geo.getAttribute("aSand");
    if (!sandAttr) { sandAttr = new THREE.BufferAttribute(new Float32Array(n), 1); this.geo.setAttribute("aSand", sandAttr); }
    const colors = colAttr.array;
    for (let i = 0; i < n; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      const s = sample(x, z);
      pos.setY(i, s.y);
      const c = colorFor(s.kind, s.y, x, z);
      colors[i * 3] = c[0]; colors[i * 3 + 1] = c[1]; colors[i * 3 + 2] = c[2];
      sandAttr.array[i] = s.sand;
    }
    pos.needsUpdate = true;
    colAttr.needsUpdate = true;
    sandAttr.needsUpdate = true;
    this.geo.computeVertexNormals();
    this.geo.computeBoundingSphere();
  }
}

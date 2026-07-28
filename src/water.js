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

export const WATER_Y = 0;
export const LAKE_R = 64; // water becomes shore past this radius

// The lake is shaped as a winding "fairway channel": water lives within
// CHANNEL_W of the current hole's centreline path, everything else reads as
// grassy bank. Feeds both the shader (visuals) and lakeDepthAt (bobbing).
export const CHANNEL_MAX_PTS = 32; // shader path-uniform capacity
export const CHANNEL_W = 13; // default half-width of the water channel

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

// module-level mirror of the shader's path so JS helpers match the visuals
let _path = null; // Array<{x,z}> | null (null => full radial disc, e.g. title)
let _halfW = CHANNEL_W;
let _nfreq = DEFAULT_NOISE.freq, _namp = DEFAULT_NOISE.amp; // cached per hole

/** shortest distance from (x,z) to the current fairway centreline polyline */
export function distToPath(x, z) {
  if (!_path || _path.length < 2) return Math.hypot(x, z); // radial fallback
  let d = Infinity;
  for (let i = 0; i < _path.length - 1; i++) {
    const a = _path[i], b = _path[i + 1];
    const bax = b.x - a.x, baz = b.z - a.z;
    const pax = x - a.x, paz = z - a.z;
    const len2 = bax * bax + baz * baz || 1;
    const h = Math.min(1, Math.max(0, (pax * bax + paz * baz) / len2));
    const dx = pax - bax * h, dz = paz - baz * h;
    d = Math.min(d, Math.sqrt(dx * dx + dz * dz));
  }
  return d;
}

/** true when (x,z) sits over open water (inside the channel) */
export function isWaterAt(x, z) {
  if (!_path || _path.length < 2) return Math.hypot(x, z) < LAKE_R;
  return distToPath(x, z) < _halfW;
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

/** lake-bed height at a world point: 0 at the shoreline, -BED_MAX at the spine */
export function bedHeightAt(x, z) {
  const edgeW = _path && _path.length >= 2 ? _halfW : LAKE_R;
  return bedProfile(distToPath(x, z) + shoreWobble(x, z, _nfreq, _namp), edgeW);
}

/** depth of water over the bed — the positive mirror of bedHeightAt */
export function lakeDepthAt(x, z) { return -bedHeightAt(x, z); }

/** where a sunk stone settles: on the bed, but never so shallow it pokes out */
export function sunkRestY(x, z) { return Math.min(-0.45, bedHeightAt(x, z) + 0.4); }

export class Water {
  constructor(scene) {
    const geo = new THREE.PlaneGeometry(LAKE_R * 2.6, LAKE_R * 2.6, 96, 96);
    geo.rotateX(-Math.PI / 2);

    const pathArr = [];
    for (let i = 0; i < CHANNEL_MAX_PTS; i++) pathArr.push(new THREE.Vector2(0, 0));

    this.uniforms = {
      uTime: { value: 0 },
      uSunDir: { value: new THREE.Vector3(0.5, 0.7, 0.3).normalize() },
      // four flat tones, spine outwards, then the whites
      uDeep: { value: paint(0x175e8a) },
      uMid: { value: paint(0x2186ac) },
      uShallow: { value: paint(0x3cb8c6) },
      uShelf: { value: paint(0x62d8cf) },
      uSheen: { value: paint(0xd6f4ff) },
      uFoam: { value: paint(0xffffff) },
      uLakeR: { value: LAKE_R },
      // fairway-channel shape: polyline centreline + half-width
      uPath: { value: pathArr },
      uPathCount: { value: 0 }, // 0 => radial disc fallback (title screen)
      uChannelW: { value: CHANNEL_W },
      // shoreline noise (tweakable in the admin editor, persisted to localStorage)
      uNoiseFreq: { value: getNoise().freq },
      uNoiseAmp: { value: getNoise().amp },
      // the hole punched for the whirlpool: centre, and radius (0 => no hole)
      uVortex: { value: new THREE.Vector2(0, 0) },
      uVortexR: { value: 0 },
    };

    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: /* glsl */ `
        uniform float uTime;
        varying vec3 vWorld;

        ${SWELL_GLSL}

        void main() {
          vec4 wp = modelMatrix * vec4(position, 1.0);
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
        uniform vec2 uPath[${CHANNEL_MAX_PTS}];
        uniform int uPathCount;
        uniform float uChannelW;
        uniform float uNoiseFreq;
        uniform float uNoiseAmp;
        uniform vec2 uVortex;
        uniform float uVortexR;
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

        // distance from p to a segment a-b
        float segDist(vec2 p, vec2 a, vec2 b) {
          vec2 pa = p - a, ba = b - a;
          float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-4), 0.0, 1.0);
          return length(pa - ba * h);
        }

        // distance from p to the fairway centreline polyline
        float distToPath(vec2 p) {
          float d = 1e9;
          for (int i = 0; i < ${CHANNEL_MAX_PTS - 1}; i++) {
            if (i >= uPathCount - 1) break;
            d = min(d, segDist(p, uPath[i], uPath[i + 1]));
          }
          return d;
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
          float d, edgeW;
          if (uPathCount >= 2) {
            d = distToPath(P);
            edgeW = uChannelW;
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
          water *= 1.0 + 0.13 * hardEdge(0.82, 0.02, lam)
                       - 0.15 * (1.0 - hardEdge(0.66, 0.02, lam));

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
          water = mix(water, uFoam, clamp(streak, 0.0, 1.0) * 0.72);

          // --- whitecaps on the highest crests ---------------------------------
          float capN = noise(P * 0.55 + vec2(t * 0.18, -t * 0.12));
          float cap = hardEdge(0.90, 0.012, crest * 0.55 + 0.5 + capN * 0.22);
          water = mix(water, uFoam, cap * 0.55);

          // --- toon sun glitter -------------------------------------------------
          // One tight highlight band, hard-stepped, plus blinking stars. Anything
          // broader than this turns the lake into white continents. Both fade with
          // distance, where the cell detail would only alias into shimmer.
          float sun = smoothstep(0.05, 0.28, pow(max(dot(N, normalize(L + V)), 0.0), 30.0));
          float sunBand = hardEdge(0.5, 0.06, sun);
          water = mix(water, uSheen, sunBand * 0.50);
          // Confined to that band so every star lands at full white: a half-lit
          // sparkle on flat water reads as a dirt speck, not a glint.
          water = mix(water, uFoam, sparkle(P, t) * sunBand * near);

          // --- quantised horizon sheen -----------------------------------------
          // Kept faint on purpose: any more and the near-white sheen milks the
          // flat bands into grey patches, which is the opposite of the look.
          float fres = clamp(pow(1.0 - max(dot(N, V), 0.0), 3.0), 0.0, 1.0);
          water = mix(water, uSheen, floor(fres * 3.0) / 3.0 * 0.10);

          // --- drifting cloud shadows, hard-stepped ----------------------------
          float cloud = hardEdge(0.60, 0.02, noise(P * 0.016 + vec2(t * 0.013, t * 0.007)));
          water *= 1.0 - 0.07 * cloud;

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
            clamp(collar * (0.78 + 0.22 * speck) + trail * 0.50, 0.0, 1.0));

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
  }

  update(dt, elapsed) {
    this.uniforms.uTime.value = elapsed;
  }

  /**
   * Shape the lake to a fairway channel that follows `path` (Array<{x,z}>),
   * with `halfWidth` of open water either side of the centreline. Pass a null/
   * short path to fall back to the full radial disc (used on the title screen).
   */
  setPath(path, halfWidth = CHANNEL_W) {
    _halfW = halfWidth;
    this.uniforms.uChannelW.value = halfWidth;
    const noise = getNoise();
    _nfreq = noise.freq; _namp = noise.amp;
    this.uniforms.uNoiseFreq.value = noise.freq;
    this.uniforms.uNoiseAmp.value = noise.amp;
    const arr = this.uniforms.uPath.value;
    if (!path || path.length < 2) {
      _path = null;
      this.uniforms.uPathCount.value = 0;
      return;
    }
    _path = path.map((p) => ({ x: p.x, z: p.z }));
    const n = Math.min(path.length, CHANNEL_MAX_PTS);
    for (let i = 0; i < n; i++) arr[i].set(path[i].x, path[i].z);
    this.uniforms.uPathCount.value = n;
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

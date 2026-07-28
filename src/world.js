/**
 * The lake world: gradient sky dome with a fat toon sun, low-poly shore ring
 * with sand -> grass -> hills, instanced voxel trees, drifting clouds, the
 * whirlpool hole (spiralling bowl, funnel throat, bare flagpole), tee dock, and
 * wander-y ducks.
 * Lighting per the mood-lighting-rig scrap: warm key, cool fill, low ambient.
 */
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { HOOK_SPEED } from "./fishing.js";
import {
  LAKE_R, WATER_Y, lakeDepthAt, sunkRestY, SWELL_GLSL, WAVE_AMP,
  VORTEX_R, VORTEX_THROAT_R, VORTEX_DEPTH, vortexSurfaceY,
} from "./water.js";
import { Terrain, terrainHeightAt } from "./terrain.js";
import { Grass } from "./grass.js";
import { celMat } from "./celshader.js";

const INK = 0x16324a;

// ------------------------------------------------------------------ sky
function makeSky(scene) {
  const geo = new THREE.SphereGeometry(420, 24, 16);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      uTop: { value: new THREE.Color("#3f9bd8") },
      uMid: { value: new THREE.Color("#a7dcef") },
      uBot: { value: new THREE.Color("#ffe9c4") },
      uSunDir: { value: new THREE.Vector3(0.5, 0.55, 0.35).normalize() },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uTop; uniform vec3 uMid; uniform vec3 uBot; uniform vec3 uSunDir;
      varying vec3 vDir;
      void main() {
        float h = vDir.y;
        vec3 col = h > 0.25 ? mix(uMid, uTop, smoothstep(0.25, 0.9, h))
                            : mix(uBot, uMid, smoothstep(-0.1, 0.25, h));
        // fat cartoon sun with a hard edge and a halo
        float d = distance(normalize(vDir), uSunDir);
        col = mix(col, vec3(1.0, 0.95, 0.75), smoothstep(0.075, 0.055, d));
        col += vec3(1.0, 0.9, 0.6) * smoothstep(0.4, 0.06, d) * 0.22;
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
  const sky = new THREE.Mesh(geo, mat);
  scene.add(sky);
  return sky;
}

// ------------------------------------------------------------------ trees
/** ground height — now delegated to the displaced Terrain (src/terrain.js) */
export function shoreHeight(x, z) {
  return terrainHeightAt(x, z);
}

// shared clock for the wind-sway shader patch (team scrap: vertex-sway-shader-patch)
const swayTime = { value: 0 };

/**
 * `y0`..`y1` is the local height band over which the sway winds up, so a tree
 * can hold its trunk still and only stir from the canopy up.
 */
function patchSway(mat, amp, y0 = -1.2, y1 = 1.6) {
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
          transformed.x += sin(uSwayTime * 1.7 + swayW.x * 0.35 + swayW.z * 0.31) * ${amp.toFixed(3)} * swayK;
          transformed.z += cos(uSwayTime * 1.3 + swayW.z * 0.29) * ${(amp * 0.7).toFixed(3)} * swayK;
        }`
      );
  };
  mat.customProgramCacheKey = () => `sway${amp}_${y0}_${y1}`;
}

// Voxel box trees ported from spellwright's prop models (tree.js, pine-tree.js).
// Sizes, offsets and the size-graded canopy greens are verbatim; origin sits at
// the trunk base so an instance drops straight onto the ground height. Spellwright
// gives every part its own scene node to rustle; here the whole tree merges into
// one geometry with the palette baked into vertex colours, so the forest is two
// instanced draws and the canopy motion comes from the vertex sway above.
const TREE_PARTS = {
  // Broadleaf: trunk buried mid-canopy, core block with four overlapping side
  // bulges and a cap, each cube a hair lighter as it gets smaller.
  broadleaf: [
    { size: [0.8, 4.8, 0.8], at: [0, 2.4, 0], color: 0x4a2f1c },
    { size: [0.36, 0.36, 0.36], at: [0.44, 2.8, 0], color: 0x33200f },
    { size: [2.8, 2.0, 2.8], at: [0, 4.6, 0], color: 0x3e6b2c },
    { size: [1.6, 1.0, 1.6], at: [-0.2, 5.8, 0.1], color: 0x487536 },
    { size: [1.0, 1.4, 1.2], at: [-1.4, 4.8, 0.4], color: 0x497637 },
    { size: [1.0, 1.2, 1.2], at: [1.4, 4.9, -0.2], color: 0x4a7738 },
    { size: [1.2, 1.0, 0.8], at: [0.2, 5.1, -1.4], color: 0x4b7839 },
    { size: [1.0, 0.8, 0.8], at: [-0.1, 4.2, 1.4], color: 0x4c793a },
  ],
  // Pine: slim trunk under four tapered tiers, each sunk 30% into the one below
  // so the silhouette reads as a cone rather than a stack.
  pine: [
    { size: [0.5, 4.0, 0.5], at: [0, 2.0, 0], color: 0x3a2410 },
    { size: [2.4, 1.4, 2.4], at: [0, 2.4, 0], color: 0x274d2a },
    { size: [2.0, 1.3, 2.0], at: [0, 3.45, 0], color: 0x2b542f },
    { size: [1.6, 1.2, 1.6], at: [0, 4.45, 0], color: 0x2f5b33 },
    { size: [1.0, 1.0, 1.0], at: [0, 5.35, 0], color: 0x336337 },
  ],
};

function makeTreeGeometry(parts) {
  const boxes = parts.map(({ size, at, color }) => {
    const g = new THREE.BoxGeometry(size[0], size[1], size[2]);
    g.translate(at[0], at[1], at[2]);
    g.deleteAttribute("uv"); // untextured, and merging needs the sets to match
    const c = new THREE.Color(color);
    const n = g.attributes.position.count;
    const rgb = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { rgb[i * 3] = c.r; rgb[i * 3 + 1] = c.g; rgb[i * 3 + 2] = c.b; }
    g.setAttribute("color", new THREE.BufferAttribute(rgb, 3));
    return g;
  });
  return mergeGeometries(boxes);
}

function makeTrees(scene) {
  const N = 90;
  const species = ["pine", "broadleaf"].map((key) => {
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true });
    // Dead below 1.2u so the trunk stays rooted, full by 5.5u — the trunk holds
    // still and the canopy stirs, which is how spellwright's gated trunk sway
    // plus per-leaf rustle reads from a distance.
    patchSway(mat, 0.14, 1.2, 5.5);
    const mesh = new THREE.InstancedMesh(makeTreeGeometry(TREE_PARTS[key]), mat, N);
    mesh.count = 0;
    scene.add(mesh);
    return mesh;
  });
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  let placed = 0, guard = 0;
  while (placed < N && guard++ < 4000) {
    const a = Math.random() * Math.PI * 2;
    const r = LAKE_R + 8 + Math.random() * 90;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    const y = shoreHeight(x, z);
    if (y < 0.4 || y > 34) continue; // the banks stand a lot taller now
    // The voxel trees are ~6u tall where the old cones were ~4.6u, so the scale
    // range is pulled in to keep the same 4–10u spread of silhouettes.
    const s = 0.65 + Math.random() * 0.85;
    e.set(0, Math.random() * Math.PI, (Math.random() - 0.5) * 0.08);
    q.setFromEuler(e);
    m.compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(s, s, s));
    const mesh = species[Math.random() < 0.55 ? 0 : 1]; // pine-leaning mix
    mesh.setMatrixAt(mesh.count++, m);
    placed++;
  }
  for (const mesh of species) mesh.instanceMatrix.needsUpdate = true;
}

// ------------------------------------------------------------------ clouds
function makeClouds(scene) {
  const group = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, flatShading: true });
  for (let i = 0; i < 9; i++) {
    const cloud = new THREE.Group();
    const blobs = 2 + Math.floor(Math.random() * 3);
    for (let b = 0; b < blobs; b++) {
      const g = new THREE.SphereGeometry(3 + Math.random() * 4, 7, 5);
      const mBlob = new THREE.Mesh(g, mat);
      mBlob.position.set(b * 4.5 - blobs * 2, Math.random() * 1.5, (Math.random() - 0.5) * 3);
      mBlob.scale.y = 0.55;
      cloud.add(mBlob);
    }
    const a = Math.random() * Math.PI * 2;
    const r = 120 + Math.random() * 160;
    cloud.position.set(Math.cos(a) * r, 38 + Math.random() * 30, Math.sin(a) * r);
    cloud.userData.speed = 0.4 + Math.random() * 0.7;
    group.add(cloud);
  }
  scene.add(group);
  return group;
}

// ------------------------------------------------------------- whirlpool hole
// The hole is a vortex in the fairway with the flagpole planted bare in the
// middle of it — no buoy, nothing to land on. Its rim is the capture radius, so
// the swirl is literally the target: put a stone into that water and you're in,
// sail over the top and the whirlpool never touches you.
//
// Two pieces: the vortex surface itself — real geometry, lathed from the shared
// profile in water.js, dishing down and plunging into a funnel throat, sitting in
// a hole the lake shader cuts for it — and the pole leaning as the swirl tugs.

// gl_FragColor is written raw here, like the lake and the sky dome, so bypass
// THREE's sRGB->linear step and let these bytes land on screen as picked.
const paint = (hex) => new THREE.Color().setHex(hex, THREE.LinearSRGBColorSpace);

// The churn. Hard-edged logarithmic spiral arms, not a smooth gradient sweep:
// next to this lake's flat quantised bands a soft swirl reads as fog on the
// water rather than as painted foam.
const CHURN_GLSL = /* glsl */ `
  float vhash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float vnoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(vhash(i), vhash(i + vec2(1, 0)), u.x),
               mix(vhash(i + vec2(0, 1)), vhash(i + vec2(1, 1)), u.x), u.y);
  }
  float hardEdge(float e, float w, float x) { return smoothstep(e - w, e + w, x); }

  // One band of a spiral, evenly spaced in radius: "arms" of them, each sweeping
  // "turns" revolutions from the rim in to the throat. Deliberately not a log
  // spiral — those wind infinitely tight as r falls and the middle of the vortex
  // collapses into a moire of concentric rings instead of reading as a swirl.
  float spiralArm(float a, float nr, float t, float arms, float turns, float spin, float w) {
    float ph = a * arms + (1.0 - nr) * turns * 6.2831853 - t * spin;
    float f = fract(ph / 6.2831853);
    return hardEdge(0.03, 0.04, f) - hardEdge(w, 0.04, f);
  }
`;

const VORTEX_PALETTE = {
  uMid: { value: paint(0x2186ac) }, // matches the lake's mid band at the rim
  uDeep: { value: paint(0x175e8a) },
  uThroat: { value: paint(0x0e3a5c) },
  uAbyss: { value: paint(0x061f36) },
  uFoam: { value: paint(0xffffff) },
};
const vortexUniforms = (extra) => {
  const u = { uTime: { value: 0 } };
  for (const k in VORTEX_PALETTE) u[k] = { value: VORTEX_PALETTE[k].value };
  return Object.assign(u, extra);
};

export class WhirlpoolHole {
  constructor(scene) {
    this.group = new THREE.Group();
    this.uniforms = [];

    this._buildBowl();
    this._buildPole();

    // beacon glow column — the vortex sits flat on the water and vanishes at
    // any distance, so the pole and this column are all you can see from the tee
    this.beacon = new THREE.Mesh(
      new THREE.CylinderGeometry(0.5, 0.9, 26, 10, 1, true),
      new THREE.MeshBasicMaterial({
        color: 0xffd24a, transparent: true, opacity: 0.12,
        side: THREE.DoubleSide, depthWrite: false,
      })
    );
    // no hole until a fairway puts one somewhere (the title lake is unbroken)
    this.group.visible = false;
    this.beacon.position.y = 13;
    this.beacon.renderOrder = 5;
    this.group.add(this.beacon);

    scene.add(this.group);
  }

  get radius() { return VORTEX_R; }
  get position() { return this.group.position; }

  /** The vortex itself: a lathed surface of revolution running from the rim, down
   *  through the dished bowl, over the lip and away into the funnel throat. One
   *  continuous profile so the dish and the funnel cannot part company, and the
   *  rim rides the lake's own swell so it meets the water it was cut out of. */
  _buildBowl() {
    // walk the shared profile from the rim inward, packing points where it bends
    const prof = [];
    const DISH_SEG = 16, FUNNEL_SEG = 20;
    for (let i = 0; i <= DISH_SEG; i++) {
      const r = VORTEX_R + (VORTEX_THROAT_R - VORTEX_R) * (i / DISH_SEG);
      prof.push(new THREE.Vector2(r, vortexSurfaceY(r)));
    }
    for (let i = 1; i <= FUNNEL_SEG; i++) {
      const t = i / FUNNEL_SEG;
      // bunch these toward the throat, where the taper is tightest
      const r = VORTEX_THROAT_R * (1 - Math.pow(t, 0.7));
      prof.push(new THREE.Vector2(Math.max(0, r), vortexSurfaceY(r)));
    }
    const geo = new THREE.LatheGeometry(prof, 96);

    const uniforms = vortexUniforms({
      uR: { value: VORTEX_R },
      uDepth: { value: VORTEX_DEPTH },
    });
    const mat = new THREE.ShaderMaterial({
      uniforms,
      vertexShader: /* glsl */ `
        uniform float uTime;
        uniform float uR;
        varying vec3 vLocal;
        ${SWELL_GLSL}
        void main() {
          vLocal = position;
          float nr = clamp(length(position.xz) / uR, 0.0, 1.0);
          vec4 wp = modelMatrix * vec4(position, 1.0);
          // The whole outer half rides the lake's swell exactly, so the rim can
          // never drift off the water it laps over; only the throat, which is
          // below the waves entirely, damps out of it.
          wp.y += swell(wp.xz, uTime).x * ${WAVE_AMP} * smoothstep(0.15, 0.55, nr);
          // and the rim sits a few centimetres proud of the lake, so the depth
          // test resolves that overlap the same way every frame instead of
          // flickering between the two along the seam
          wp.y += 0.035 * smoothstep(0.88, 1.0, nr);
          gl_Position = projectionMatrix * viewMatrix * wp;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        uniform float uR;
        uniform float uDepth;
        uniform vec3 uMid; uniform vec3 uDeep; uniform vec3 uThroat;
        uniform vec3 uAbyss; uniform vec3 uFoam;
        varying vec3 vLocal;
        ${CHURN_GLSL}
        void main() {
          vec2 P = vLocal.xz;
          float r = length(P);
          float nr = clamp(r / uR, 0.0, 1.0);
          float a = atan(P.y, P.x);
          float t = uTime;
          // how far under the waterline this bit of the surface has been dragged
          float sink = clamp(-vLocal.y / uDepth, 0.0, 1.0);

          // Flat tonal bands, stepped on depth rather than on radius: the deeper
          // the water has been pulled, the darker it goes. Wobbled, and dragged
          // round by the swirl, so the steps read as water being sucked under
          // rather than as printed rings.
          float band = sink
                     + (vnoise(P * 0.6 + vec2(t * 0.05, -t * 0.04)) - 0.5) * 0.05
                     + 0.03 * sin(a * 2.0 + sink * 7.0 - t * 0.9);
          vec3 col = uMid;
          col = mix(col, uDeep,   hardEdge(0.055, 0.012, band));
          col = mix(col, uThroat, hardEdge(0.30, 0.02, band));
          col = mix(col, uAbyss,  hardEdge(0.62, 0.03, band));

          // spiral foam arms, two scales, wrapping in toward the throat. Kept
          // narrow and well spaced — widen them and the whole middle of the
          // vortex washes out into one milky disc.
          float arm = spiralArm(a, nr, t, 3.0, 1.15, 1.5, 0.26);
          arm = max(arm, 0.7 * spiralArm(a, nr, t, 2.0, 0.75, 1.0, 0.18));
          // Torn apart before they reach the rim, and gone by the lip: these are
          // laid out in plan, so on the steep wall of the throat they would
          // compress into printed-looking rings instead of reading as swirl.
          arm *= (1.0 - smoothstep(0.72, 0.97, nr))
               * (1.0 - smoothstep(0.10, 0.34, sink));
          col = mix(col, uFoam, clamp(arm, 0.0, 1.0) * 0.85);

          // flecks of foam dragged round the dish, inner rings faster than outer
          float sp = t * (0.55 + 1.9 / max(0.7, r));
          float cs = cos(sp), sn = sin(sp);
          vec2 Pr = vec2(cs * P.x - sn * P.y, sn * P.x + cs * P.y);
          float fleck = hardEdge(0.74, 0.02, vnoise(Pr * 2.3));
          col = mix(col, uFoam, fleck * 0.22 * (1.0 - smoothstep(0.6, 0.95, nr))
                                * (1.0 - smoothstep(0.1, 0.4, sink)));

          // Scalloped foam collar riding the rim. Doing real work: it is the
          // capture edge, and it straddles the seam where this mesh laps over
          // the hole the lake shader cut for it.
          float lip = 0.90 + 0.05 * vnoise(P * 0.8 + vec2(t * 0.07, -t * 0.05))
                    + 0.028 * sin(a * 5.0 - t * 1.1);
          float collar = hardEdge(lip, 0.018, nr);
          col = mix(col, uFoam, collar * 0.8);

          gl_FragColor = vec4(col, 1.0);
        }
      `,
      // Opaque, so it lands in the opaque pass ahead of the lake: the water is
      // then free to close over whatever of this plunges behind it.
      side: THREE.DoubleSide,
    });

    this.bowl = new THREE.Mesh(geo, mat);
    this.group.add(this.bowl);
    this.uniforms.push(uniforms);
  }

  /** bare flagpole standing in the middle of the vortex, leaning into the pull */
  _buildPole() {
    this.pole = new THREE.Group();

    // runs down into the throat, so it reads as planted in the hole rather than
    // resting on it; the funnel wall occludes it properly from here on
    const POLE_TOP = 5.4, POLE_BOT = -2.4;
    const shaft = new THREE.Mesh(
      new THREE.CylinderGeometry(0.1, 0.13, POLE_TOP - POLE_BOT, 6),
      new THREE.MeshStandardMaterial({ color: 0xf4efe2 })
    );
    shaft.position.y = (POLE_TOP + POLE_BOT) / 2;
    this.pole.add(shaft);

    const knob = new THREE.Mesh(
      new THREE.SphereGeometry(0.22, 8, 6),
      new THREE.MeshStandardMaterial({ color: 0xffd24a })
    );
    knob.position.y = POLE_TOP + 0.05;
    this.pole.add(knob);

    // waving cloth flag (CPU vertex wave)
    this.flagGeo = new THREE.PlaneGeometry(2.6, 1.5, 10, 5);
    this.flagBase = this.flagGeo.attributes.position.array.slice();
    this.cloth = new THREE.Mesh(
      this.flagGeo,
      new THREE.MeshStandardMaterial({ color: 0xff5470, side: THREE.DoubleSide, flatShading: true })
    );
    this.cloth.position.set(1.34, 4.55, 0);
    this.pole.add(this.cloth);

    this.group.add(this.pole);
  }

  setPosition(x, z) {
    // the dish adds the swell itself, per-vertex, so the group sits dead level
    this.group.position.set(x, WATER_Y, z);
    this.group.visible = true;
  }

  update(dt, elapsed, water) {
    for (const u of this.uniforms) u.uTime.value = elapsed;

    // the pole never quite gets pulled under, but it never stops trying: a slow
    // precessing lean, as if the swirl were walking it around its own footing
    this.pole.rotation.x = Math.sin(elapsed * 0.55) * 0.055;
    this.pole.rotation.z = Math.cos(elapsed * 0.55) * 0.055;

    // flag cloth wave
    const pos = this.flagGeo.attributes.position;
    const base = this.flagBase;
    for (let i = 0; i < pos.count; i++) {
      const bx = base[i * 3];
      const t = (bx + 1.3) / 2.6; // 0 at pole, 1 at tip
      pos.setZ(i, Math.sin(bx * 2.4 + elapsed * 7) * 0.22 * t + Math.sin(elapsed * 3.1) * 0.1 * t);
      pos.setY(i, base[i * 3 + 1] + Math.sin(bx * 1.8 + elapsed * 5) * 0.08 * t);
    }
    pos.needsUpdate = true;
    this.flagGeo.computeVertexNormals();

    this.beacon.material.opacity = 0.09 + Math.sin(elapsed * 1.7) * 0.035;
  }
}

// ------------------------------------------------------------------ tee pontoon
// A floating wooden pontoon: the launch pad every rock starts from. Sits at the
// hole's tee, its long axis pointing down-fairway so stones skip off the front
// edge. Bobs gently on the swell like the flag buoy.
// deck-top height above the waterline — physics seats resting tee rocks here
export const PONTOON_DECK = 0.57;

export class Pontoon {
  constructor(scene) {
    this.group = new THREE.Group();
    const wood = new THREE.MeshStandardMaterial({ color: 0xa9682f, flatShading: true });
    const woodDark = new THREE.MeshStandardMaterial({ color: 0x7c4a1e, flatShading: true });
    const woodMid = new THREE.MeshStandardMaterial({ color: 0x93571f, flatShading: true });

    // a raised bridge: the tee cluster sits near the flag end (+X) and the
    // long tail runs back onto the beach behind the tee
    const FRONT = 5.5, BACK = -22, WID = 9;
    const LEN = FRONT - BACK, off = (FRONT + BACK) / 2;

    // cross-beams that the deck planks rest on (run across the short axis)
    const beams = new THREE.Group();
    for (let i = 0; i < 8; i++) {
      const beam = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.5, WID + 0.6), woodDark);
      beam.position.set(BACK + 0.9 + (i / 7) * (LEN - 1.8), -0.28, 0);
      beams.add(beam);
    }
    this.group.add(beams);

    // deck planks running the length of the pontoon, with hairline gaps
    const nPlanks = 9;
    const plankW = WID / nPlanks;
    for (let i = 0; i < nPlanks; i++) {
      const plank = new THREE.Mesh(
        new THREE.BoxGeometry(LEN, 0.24, plankW * 0.86),
        i % 2 ? wood : woodMid
      );
      plank.position.set(off, 0, -WID / 2 + plankW * (i + 0.5));
      plank.receiveShadow = true;
      this.group.add(plank);
    }

    // rimming trim so the edges read cleanly against the water
    for (const side of [-1, 1]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(LEN, 0.28, 0.32), woodDark);
      rail.position.set(off, 0.05, side * (WID / 2 - 0.16));
      this.group.add(rail);
    }

    // support piles along both sides — unit-height cylinders that setPose
    // stretches down to the lake bed (or the beach) under each hole's tee
    this.piles = [];
    const nPiles = 5;
    for (let i = 0; i < nPiles; i++) {
      const px = BACK + 0.7 + (i / (nPiles - 1)) * (LEN - 1.4);
      for (const sz of [-1, 1]) {
        const pile = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.3, 1, 7), woodDark);
        pile.userData.px = px;
        pile.userData.pz = sz * (WID / 2 - 0.7);
        this.group.add(pile);
        this.piles.push(pile);
      }
    }

    // a couple of little mooring posts on the down-fairway edge (+X)
    for (const sz of [-1, 1]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, 0.7, 6), woodMid);
      post.position.set(FRONT - 0.35, 0.42, sz * (WID / 2 - 1.1));
      this.group.add(post);
    }

    this.group.visible = false;
    scene.add(this.group);
  }

  /** place at the tee, long axis (+X) pointing toward the flag. The bridge
   *  is rigid — no wave sway — with each pile stretched down to whatever is
   *  under it: the lake bed in the water, the sand where it meets the beach. */
  setPose(x, z, angleToFlag) {
    this.group.position.set(x, WATER_Y + PONTOON_DECK - 0.12, z);
    this.group.rotation.y = -angleToFlag; // world +X row rotates to face the flag
    this.group.visible = true;
    this.group.updateMatrixWorld(true);
    const w = new THREE.Vector3();
    for (const pile of this.piles) {
      w.set(pile.userData.px, 0, pile.userData.pz);
      this.group.localToWorld(w);
      const groundY = shoreHeight(w.x, w.z);
      const len = Math.max(0.5, this.group.position.y - 0.2 - groundY + 0.6);
      pile.scale.y = len;
      pile.position.set(pile.userData.px, -0.2 - len / 2, pile.userData.pz);
    }
  }
}

// ------------------------------------------------------------------ ducks
class Duck {
  constructor(scene) {
    this.group = new THREE.Group();
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0xf7f3e8, flatShading: true });
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.45, 8, 6), bodyMat);
    body.scale.set(1.25, 0.8, 0.9);
    body.position.y = 0.22;
    this.group.add(body);
    this.wings = [];
    for (const side of [-1, 1]) {
      const wing = new THREE.Mesh(new THREE.SphereGeometry(0.3, 7, 5), bodyMat);
      wing.scale.set(1.05, 0.18, 0.7);
      wing.position.set(-0.05, 0.33, side * 0.38);
      this.group.add(wing);
      this.wings.push(wing);
    }
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 6), bodyMat);
    head.position.set(0.42, 0.62, 0);
    this.group.add(head);
    const beak = new THREE.Mesh(
      new THREE.ConeGeometry(0.09, 0.24, 6),
      new THREE.MeshStandardMaterial({ color: 0xffa63d, flatShading: true })
    );
    beak.rotation.z = -Math.PI / 2;
    beak.position.set(0.66, 0.6, 0);
    this.group.add(beak);
    scene.add(this.group);

    const a = Math.random() * Math.PI * 2;
    const r = LAKE_R * (0.3 + Math.random() * 0.5);
    this.group.position.set(Math.cos(a) * r, 0, Math.sin(a) * r);
    this.heading = Math.random() * Math.PI * 2;
    this.speed = 0.7 + Math.random() * 0.6;
    this.turnT = 2 + Math.random() * 3;
    this.scare = 0;
    this.flying = false;
    this.flyT = 0;
    this.flySpeed = 0;
    this.respawnT = 0;
  }

  update(dt, elapsed, water) {
    if (!this.group.visible) {
      this.respawnT -= dt;
      if (this.respawnT <= 0) {
        const a = Math.random() * Math.PI * 2;
        const r = LAKE_R * (0.3 + Math.random() * 0.5);
        this.group.position.set(Math.cos(a) * r, WATER_Y, Math.sin(a) * r);
        this.heading = Math.random() * Math.PI * 2;
        this.flying = false;
        this.group.visible = true;
      }
      return;
    }

    const p = this.group.position;
    if (this.flying) {
      this.flyT += dt;
      p.x += Math.cos(this.heading) * this.flySpeed * dt;
      p.z += Math.sin(this.heading) * this.flySpeed * dt;
      p.y += (2.8 + this.flyT * 1.4) * dt;
      this.group.rotation.y = -this.heading;
      this.group.rotation.z = Math.sin(elapsed * 18) * 0.12;
      const flap = Math.sin(elapsed * 28) * 1.05;
      this.wings[0].rotation.x = flap;
      this.wings[1].rotation.x = -flap;
      if (this.flyT > 2.2) {
        this.group.visible = false;
        this.respawnT = 4 + Math.random() * 3;
      }
      return;
    }

    this.turnT -= dt;
    if (this.turnT <= 0) {
      this.turnT = 2 + Math.random() * 4;
      this.heading += (Math.random() - 0.5) * 1.6;
    }
    // stay in the lake
    const r = Math.hypot(p.x, p.z);
    if (r > LAKE_R * 0.85) {
      this.heading = Math.atan2(-p.z, -p.x) + (Math.random() - 0.5) * 0.5;
    }
    const sp = this.speed * (1 + this.scare * 3);
    this.scare = Math.max(0, this.scare - dt * 0.7);
    p.x += Math.cos(this.heading) * sp * dt;
    p.z += Math.sin(this.heading) * sp * dt;
    p.y = WATER_Y + water.heightAt(p.x, p.z, elapsed) + 0.02;
    this.group.rotation.y = -this.heading;
    this.group.rotation.z = Math.sin(elapsed * 3 + p.x) * 0.06;
    this.wings[0].rotation.x = 0;
    this.wings[1].rotation.x = 0;
  }

  scareFrom(pos) {
    if (this.flying || !this.group.visible) return;
    const d = this.group.position.distanceTo(pos);
    if (d < 9) {
      this.scare = 1;
      this.heading = Math.atan2(this.group.position.z - pos.z, this.group.position.x - pos.x);
    }
  }

  flyAway(from, incomingVel) {
    if (this.flying || !this.group.visible) return false;
    let dx = this.group.position.x - from.x;
    let dz = this.group.position.z - from.z;
    if (dx * dx + dz * dz < 0.01) {
      dx = incomingVel.x || 1;
      dz = incomingVel.z;
    }
    this.heading = Math.atan2(dz, dx);
    this.flySpeed = 7 + Math.min(5, Math.hypot(incomingVel.x, incomingVel.z) * 0.2);
    this.flyT = 0;
    this.scare = 1;
    this.flying = true;
    return true;
  }
}

// ------------------------------------------------------------------ course markers
// Fairway buoys strung along the hole's path + island rest stops. Rebuilt per hole.
export class CourseMarkers {
  constructor(scene) {
    this.scene = scene;
    // buoy pool
    this.buoys = [];
    const buoyMat = new THREE.MeshStandardMaterial({ color: 0xff8a3d, flatShading: true });
    const tipMat = new THREE.MeshStandardMaterial({ color: 0xfdf6e3, flatShading: true });
    for (let i = 0; i < 26; i++) {
      const g = new THREE.Group();
      const ball = new THREE.Mesh(new THREE.SphereGeometry(0.38, 8, 6), buoyMat);
      ball.position.y = 0.1;
      g.add(ball);
      const tip = new THREE.Mesh(new THREE.ConeGeometry(0.14, 0.5, 6), tipMat);
      tip.position.y = 0.55;
      g.add(tip);
      g.visible = false;
      scene.add(g);
      this.buoys.push(g);
    }
    this.islandGroup = new THREE.Group();
    scene.add(this.islandGroup);
    this._bobPhases = this.buoys.map(() => Math.random() * 10);
    // big rock outcrops we can fade when they block an underwater camera
    this.outcrops = [];
  }

  setHole(path, islands, rocks = []) {
    // ---- buoys every ~9u along the polyline, skipping ends
    let placed = 0;
    for (let seg = 0; seg < path.length - 1 && placed < this.buoys.length; seg++) {
      const a = path[seg], b = path[seg + 1];
      const len = Math.hypot(b.x - a.x, b.z - a.z);
      const n = Math.max(1, Math.round(len / 9));
      for (let k = 1; k < n && placed < this.buoys.length; k++) {
        const t = k / n;
        const x = a.x + (b.x - a.x) * t;
        const z = a.z + (b.z - a.z) * t;
        // don't drop a buoy on an island
        if (islands.some((isl) => Math.hypot(x - isl.x, z - isl.z) < isl.r + 1.5)) continue;
        const g = this.buoys[placed++];
        g.position.set(x, 0, z);
        g.visible = true;
      }
    }
    for (let i = placed; i < this.buoys.length; i++) this.buoys[i].visible = false;

    // ---- islands (rebuilt fresh; tiny geometry)
    this.islandGroup.clear();
    const sand = new THREE.MeshStandardMaterial({ color: 0xeed9a4, flatShading: true });
    const grass = new THREE.MeshStandardMaterial({ color: 0x6fbf55, flatShading: true });
    const trunk = new THREE.MeshStandardMaterial({ color: 0x9a6b3a, flatShading: true });
    for (const isl of islands) {
      const g = new THREE.Group();
      const dome = new THREE.Mesh(new THREE.SphereGeometry(isl.r, 14, 9), sand);
      dome.scale.y = 0.32;
      dome.position.y = -isl.r * 0.1;
      g.add(dome);
      // grass tufts
      for (let i = 0; i < 3; i++) {
        const tuft = new THREE.Mesh(new THREE.ConeGeometry(0.28, 0.5, 5), grass);
        const a = Math.random() * Math.PI * 2;
        const rr = isl.r * (0.3 + Math.random() * 0.35);
        tuft.position.set(Math.cos(a) * rr, isl.r * 0.2, Math.sin(a) * rr);
        tuft.rotation.z = (Math.random() - 0.5) * 0.4;
        g.add(tuft);
      }
      // little leaning palm
      const palm = new THREE.Group();
      const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.14, 1.8, 6), trunk);
      stem.position.y = 0.9;
      palm.add(stem);
      for (let i = 0; i < 4; i++) {
        const leaf = new THREE.Mesh(new THREE.ConeGeometry(0.16, 1.1, 4), grass);
        const a = (i / 4) * Math.PI * 2 + 0.4;
        leaf.position.set(Math.cos(a) * 0.42, 1.85, Math.sin(a) * 0.42);
        leaf.rotation.set(Math.sin(a) * 1.25, 0, Math.cos(a) * -1.25);
        palm.add(leaf);
      }
      palm.rotation.z = 0.16;
      palm.position.set(-isl.r * 0.3, isl.r * 0.12, 0);
      g.add(palm);
      g.position.set(isl.x, 0, isl.z);
      this.islandGroup.add(g);
    }

    // ---- big rock outcrops walling off the direct line to the flag
    // Per-outcrop material clones so we can fade an individual spire out when it
    // wedges between an underwater camera and the rock it's tracking.
    this.outcrops = [];
    for (const o of rocks) {
      const stone = new THREE.MeshStandardMaterial({ color: 0x7d8a90, flatShading: true });
      const stoneDark = new THREE.MeshStandardMaterial({ color: 0x5d686e, flatShading: true });
      const moss = new THREE.MeshStandardMaterial({ color: 0x5da24e, flatShading: true });
      const g = new THREE.Group();
      // submerged root — the spire continues down to the lake bed, so the
      // underwater fishing view shows solid rock, not a floating island
      const depth = lakeDepthAt(o.x, o.z);
      const root = new THREE.Mesh(
        new THREE.CylinderGeometry(o.r * 0.72, o.r * 0.95, depth + 1.2, 8),
        stoneDark
      );
      root.position.y = -(depth + 1.2) / 2 + 0.4;
      g.add(root);
      // main spire — jagged, tall, unmistakably "not through here"
      const spire = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 1), stone);
      spire.scale.set(o.r * 0.8, o.h * 0.62, o.r * 0.72);
      spire.position.y = o.h * 0.42;
      spire.rotation.y = (o.x * 13.7) % Math.PI;
      g.add(spire);
      // leaning side slabs
      for (let i = 0; i < 3; i++) {
        const slab = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 0), i % 2 ? stoneDark : stone);
        const a = (i / 3) * Math.PI * 2 + o.z;
        const rr = o.r * (0.5 + (i % 2) * 0.3);
        slab.scale.set(o.r * 0.42, o.h * (0.22 + i * 0.09), o.r * 0.4);
        slab.position.set(Math.cos(a) * rr, o.h * (0.14 + i * 0.05), Math.sin(a) * rr);
        slab.rotation.set((i - 1) * 0.24, a, (i - 1) * 0.18);
        g.add(slab);
      }
      // mossy cap
      const cap = new THREE.Mesh(new THREE.SphereGeometry(o.r * 0.34, 7, 5), moss);
      cap.scale.y = 0.4;
      cap.position.y = o.h * 0.98;
      g.add(cap);
      g.position.set(o.x, 0, o.z);
      this.islandGroup.add(g);
      this.outcrops.push({ x: o.x, z: o.z, r: o.r, mats: [stone, stoneDark, moss], op: 1 });
    }
  }

  /**
   * Fade any rock outcrop that sits between the camera and its focus point so
   * the underwater view never gets walled off by a spire in the foreground.
   * Only fades while `enabled` (i.e. the camera is submerged); otherwise it
   * eases everything back to solid.
   */
  updateOcclusion(camPos, focus, enabled, dt) {
    if (!this.outcrops.length) return;
    const ax = camPos.x, az = camPos.z;
    const bx = focus.x, bz = focus.z;
    const abx = bx - ax, abz = bz - az;
    const abLen2 = abx * abx + abz * abz;
    const k = Math.min(1, dt * 9); // fade smoothing
    for (const o of this.outcrops) {
      let target = 1;
      if (enabled && abLen2 > 1e-3) {
        const t = ((o.x - ax) * abx + (o.z - az) * abz) / abLen2;
        if (t > -0.1 && t < 1) {
          const cx = ax + abx * t, cz = az + abz * t;
          const perp = Math.hypot(o.x - cx, o.z - cz);
          if (perp < o.r + 2.2) target = 0.08;
        }
      }
      o.op += (target - o.op) * k;
      const transparent = o.op < 0.985;
      for (const m of o.mats) {
        const tm = celMat(m); // animate the toon twin actually being rendered
        tm.transparent = transparent;
        tm.opacity = o.op;
        tm.depthWrite = o.op > 0.6;
        if (tm !== m) { m.transparent = transparent; m.opacity = o.op; m.depthWrite = o.op > 0.6; }
      }
    }
  }

  update(dt, elapsed, water) {
    for (let i = 0; i < this.buoys.length; i++) {
      const g = this.buoys[i];
      if (!g.visible) continue;
      g.position.y = water.heightAt(g.position.x, g.position.z, elapsed) * 1.3;
      g.rotation.z = Math.sin(elapsed * 1.6 + this._bobPhases[i]) * 0.12;
      g.rotation.x = Math.cos(elapsed * 1.3 + this._bobPhases[i]) * 0.1;
    }
  }
}

// ------------------------------------------------------------------ rival fishing lines
// While a rival's stone is being reeled back, a bobber sits on the surface
// above it with a line running down to the sunken rock — you can watch who's
// paying the price, from above the water or during your own dive.
const RIVAL_REEL_SPEED = 6; // rival stones reel up a touch slower than the player's 7.5

export class RivalLines {
  constructor(scene) {
    this.rigs = [];
    this.jobs = new Map(); // skimmer -> { rig, mode: down|reel, lineY }
    const lineMat = new THREE.MeshBasicMaterial({ color: 0xe8e8e8 });
    const redMat = new THREE.MeshStandardMaterial({ color: 0xd94040, flatShading: true });
    const whiteMat = new THREE.MeshStandardMaterial({ color: 0xf4f0e6, flatShading: true });
    for (let i = 0; i < 8; i++) {
      const g = new THREE.Group();
      const bobber = new THREE.Group();
      const top = new THREE.Mesh(new THREE.SphereGeometry(0.17, 8, 6), redMat);
      top.position.y = 0.07;
      bobber.add(top);
      const bottom = new THREE.Mesh(new THREE.SphereGeometry(0.14, 8, 6), whiteMat);
      bottom.position.y = -0.07;
      bobber.add(bottom);
      g.add(bobber);
      const line = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 1, 4), lineMat);
      g.add(line);
      g.visible = false;
      scene.add(g);
      this.rigs.push({ g, bobber, line, phase: Math.random() * 10, busy: false });
    }
  }

  /**
   * A rig over every rival currently fishing; exclude = local player.
   * Same choreography as the player's dive: the line drops to the sunken
   * stone, hooks it, reels it back up, and dangles it at the surface until
   * its owner takes it back. Remote stones animate their own y (their client
   * runs the minigame), so their line just tracks the rock.
   */
  update(dt, elapsed, water, racers, exclude) {
    const active = new Set();
    for (const s of racers ?? []) {
      if (s === exclude || s.state !== "fishing") continue;
      let job = this.jobs.get(s);
      if (!job) {
        // the line waits until the stone has settled out of sight
        const bedY = sunkRestY(s.pos.x, s.pos.z);
        const settled = s.isRemote ? s.mesh.position.y < -0.3 : s.mesh.position.y <= bedY + 0.01;
        if (!settled) { active.add(s); continue; }
        const rig = this.rigs.find((r) => !r.busy);
        if (!rig) { active.add(s); continue; }
        rig.busy = true;
        job = { rig, mode: "down", lineY: water.heightAt(s.pos.x, s.pos.z, elapsed) - 1.1 };
        this.jobs.set(s, job);
      }
      active.add(s);
      const rig = job.rig;
      rig.g.visible = true;
      const rx = s.mesh.position.x, rz = s.mesh.position.z;
      const sway = Math.sin(elapsed * 1.3 + rig.phase) * 0.2;
      const surfY = water.heightAt(rx, rz, elapsed) + Math.sin(elapsed * 2.2 + rig.phase) * 0.05;
      rig.bobber.position.set(rx + sway, surfY + 0.08, rz);
      rig.bobber.rotation.z = sway * 0.5;

      const rockTop = s.mesh.position.y + 0.35;
      if (s.isRemote || job.mode === "down") {
        job.lineY = Math.max(rockTop, job.lineY - HOOK_SPEED * dt);
        if (!s.isRemote && job.lineY <= rockTop) {
          job.mode = "reel";
          s.hookedByLine = true; // physics stops pinning the stone to the bed
        }
      } else {
        // reel up: the stone rides just under the hook, then dangles at the
        // surface until the bot's fishing timer hands it back
        const holdY = surfY + 0.55;
        job.lineY = Math.min(holdY, job.lineY + RIVAL_REEL_SPEED * dt);
        s.pos.y = job.lineY - 0.35;
        s.mesh.position.y = s.pos.y;
      }

      const lineTop = rig.bobber.position.y - 0.07;
      const len = Math.max(0.3, lineTop - job.lineY);
      rig.line.scale.y = len;
      rig.line.position.set(rx + sway * 0.5, job.lineY + len / 2, rz);
      rig.line.rotation.z = sway * 0.12;
    }
    for (const [s, job] of this.jobs) {
      if (!active.has(s)) this._release(s, job);
    }
  }

  _release(s, job) {
    job.rig.busy = false;
    job.rig.g.visible = false;
    s.hookedByLine = false;
    this.jobs.delete(s);
  }

  hideAll() {
    for (const [s, job] of this.jobs) this._release(s, job);
    for (const rig of this.rigs) rig.g.visible = false;
  }
}

// ------------------------------------------------------------------ world facade
export class World {
  constructor(scene) {
    this.scene = scene;
    makeSky(scene);
    this.terrain = new Terrain(scene);
    makeTrees(scene);
    this.grass = new Grass(scene);
    this.clouds = makeClouds(scene);
    this.flag = new WhirlpoolHole(scene);
    this.pontoon = new Pontoon(scene);
    this.course = new CourseMarkers(scene);
    this.ducks = [new Duck(scene), new Duck(scene), new Duck(scene)];

    // mood lighting rig: warm key, cool fill, low ambient (team scrap)
    const key = new THREE.DirectionalLight(0xfff2d8, 1.9);
    key.position.set(60, 80, 40);
    scene.add(key);
    const fill = new THREE.DirectionalLight(0x9fd0ff, 0.55);
    fill.position.set(-50, 30, -60);
    scene.add(fill);
    scene.add(new THREE.AmbientLight(0x88aabb, 0.5));
    const hemi = new THREE.HemisphereLight(0xbfeaf5, 0x2a6448, 0.5);
    scene.add(hemi);

    scene.fog = new THREE.Fog(0xa7dcef, 150, 400);
  }

  /** rebuild the ground + grass for a hole's channel (null path => radial disc) */
  setHole(path, halfWidth) {
    this.terrain.setPath(path, halfWidth);
    this.grass.setHole();
  }

  update(dt, elapsed, water) {
    swayTime.value = elapsed;
    this.grass.update(elapsed);
    this.flag.update(dt, elapsed, water);
    this.course.update(dt, elapsed, water);
    for (const d of this.ducks) d.update(dt, elapsed, water);
    for (const c of this.clouds.children) {
      c.position.x += c.userData.speed * dt;
      if (c.position.x > 300) c.position.x = -300;
    }
  }

  scareDucks(pos) {
    for (const d of this.ducks) d.scareFrom(pos);
  }

  hitDuck(pos, vel) {
    for (const d of this.ducks) {
      if (d.flying || !d.group.visible) continue;
      const p = d.group.position;
      const dx = p.x - pos.x;
      const dz = p.z - pos.z;
      if (dx * dx + dz * dz < 0.8 * 0.8 && Math.abs((p.y + 0.3) - pos.y) < 0.85) {
        const at = p.clone().add(new THREE.Vector3(0, 0.35, 0));
        if (d.flyAway(pos, vel)) return at;
      }
    }
    return null;
  }
}

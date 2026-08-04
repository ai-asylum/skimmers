/**
 * Instanced grass — ported from spellwright's Environment.js grass and adapted
 * to this game's small, static-per-hole world.
 *
 * Each instance is a 3-blade clump (merged plane quads). A MeshToonMaterial is
 * patched via onBeforeCompile for GPU wind sway; unlike spellwright we bake the
 * ground height straight into each instance matrix (the course is small and
 * rebuilt per hole) instead of sampling a sliding heightmap texture. Blades are
 * scattered only on the grassy banks using terrainSampleAt.
 */
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { LAKE_R } from "./water.js";
import { terrainSampleAt } from "./terrain.js";

// Deterministic scatter (see foliage.js): a seeded PRNG reset each setHole so
// the meadow lands in the same spots every rebuild, bench/title lake included.
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const SEED_GRASS = 0x5eed7 + 83;

const BLADE_ROOT_FACTOR = 0.45;

function makeBladeGeometry(height, width) {
  const geo = new THREE.PlaneGeometry(width, height, 1, 3);
  geo.translate(0, height / 2, 0);
  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const yNorm = pos.getY(i) / height;
    pos.setX(i, pos.getX(i) * (1 - yNorm * 0.92)); // taper to the tip
    const f = BLADE_ROOT_FACTOR + (1 - BLADE_ROOT_FACTOR) * yNorm; // baked AO gradient
    colors[i * 3] = f; colors[i * 3 + 1] = f; colors[i * 3 + 2] = f;
  }
  pos.needsUpdate = true;
  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  return geo;
}

function makeClumpGeometry(height, width) {
  const center = makeBladeGeometry(height, width);
  const left = makeBladeGeometry(height * 0.85, width * 0.9);
  left.rotateZ(0.25); left.rotateY(-0.6); left.translate(-width * 0.6, 0, -width * 0.3);
  const right = makeBladeGeometry(height * 0.9, width * 0.9);
  right.rotateZ(-0.22); right.rotateY(0.7); right.translate(width * 0.6, 0, width * 0.25);
  return mergeGeometries([center, left, right]);
}

export class Grass {
  // count scales with the scattered area (see setHole's maxR) so a hole that
  // runs corner to corner isn't grassed thinner than a compact one was
  constructor(scene, { count = 11000, height = 1.15, bladeWidth = 0.17, color = 0x8fdb5c } = {}) {
    this.max = count; // instances allocated; a biome can only thin below this
    this.cap = count;
    this.uTime = { value: 0 };
    this.uWind = { value: 0.16 };
    this.uWindSpeed = { value: 1.8 };
    this.uWindDir = { value: new THREE.Vector2(0.8, 0.6).normalize() };

    const geo = makeClumpGeometry(height, bladeWidth);
    const mat = new THREE.MeshStandardMaterial({
      color, vertexColors: true, side: THREE.DoubleSide, roughness: 1, metalness: 0,
    });
    this.mat = mat;
    mat.userData.noCel = true; // keep our own sway patch; don't let the cel pass replace it
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = this.uTime;
      shader.uniforms.uWind = this.uWind;
      shader.uniforms.uWindSpeed = this.uWindSpeed;
      shader.uniforms.uWindDir = this.uWindDir;
      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", `#include <common>
uniform float uTime; uniform float uWind; uniform float uWindSpeed; uniform vec2 uWindDir;`)
        // one shared up-normal so the meadow reads as a cohesive surface
        .replace("#include <beginnormal_vertex>", "vec3 objectNormal = vec3(0.0, 1.0, 0.0);")
        .replace("#include <begin_vertex>", `#include <begin_vertex>
        float bend = max(transformed.y, 0.0); bend = bend * bend;
        vec2 bxz = vec2(instanceMatrix[3].x, instanceMatrix[3].z);
        float spatial = dot(bxz, uWindDir) * 0.21;
        float jit = fract(sin(dot(bxz, vec2(127.1, 311.7))) * 43758.5453) * 6.2831853;
        float w = sin(uTime * uWindSpeed - spatial + jit) * uWind;
        transformed.x += w * bend * uWindDir.x;
        transformed.z += w * bend * uWindDir.y;`);
      // even lighting on both faces of the double-sided blades
      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <normal_fragment_begin>",
        "#include <normal_fragment_begin>\nnormal = normalize( vNormal );"
      );
    };
    mat.customProgramCacheKey = () => "grasswind";

    this.mesh = new THREE.InstancedMesh(geo, mat, count);
    this.mesh.count = 0;
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = true;
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);

    this._dummy = new THREE.Object3D();
  }

  /** re-scatter blades over the grassy banks of the current hole */
  setHole() {
    const dummy = this._dummy;
    const rand = mulberry32(SEED_GRASS);
    // reaches the far ends of a corner-to-corner hole without running out onto
    // the peaks (terrain.js holds the mountain ring back around the channel)
    const maxR = LAKE_R * 1.7;
    let placed = 0, guard = 0;
    while (placed < this.cap && guard++ < this.cap * 8) {
      const a = rand() * Math.PI * 2;
      const rr = Math.sqrt(rand()) * maxR;
      const x = Math.cos(a) * rr, z = Math.sin(a) * rr;
      const { y, kind } = terrainSampleAt(x, z);
      if (kind !== "grass") continue;
      if (y < 0.05 || y > 17) continue; // skip beach/water and the bare rocky crests
      const s = 0.7 + rand() * 0.7;
      dummy.position.set(x, y, z);
      dummy.rotation.set(0, rand() * Math.PI * 2, 0);
      dummy.scale.set(0.9 + rand() * 0.3, s, 0.9 + rand() * 0.3);
      dummy.updateMatrix();
      this.mesh.setMatrixAt(placed++, dummy.matrix);
    }
    this.mesh.count = placed;
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  update(elapsed) { this.uTime.value = elapsed; }

  // ---- debug tweak-menu hooks ----
  getColor() { return "#" + this.mat.color.getHexString(); }
  setColor(hex) { this.mat.color.set(hex); }
  /** thin the meadow for a biome; 1 is full, and it can never exceed the pool */
  setDensity(mul = 1) { this.cap = Math.min(this.max, Math.round(this.max * mul)); }
  getWind() { return this.uWind.value; }
  setWind(v) { this.uWind.value = v; }
  getWindSpeed() { return this.uWindSpeed.value; }
  setWindSpeed(v) { this.uWindSpeed.value = v; }
}

/**
 * Stylised lake water: one big plane with a custom shader — depth-tinted
 * gradient, two layers of scrolling ripple noise, cartoon sun glints cut with
 * a hard step (toon sparkle), soft foam ring at the shore, gentle vertex bob.
 */
import * as THREE from "three";

export const WATER_Y = 0;
export const LAKE_R = 64; // water becomes shore past this radius

/** lake-bed depth below the surface — a bowl: shallow at the shore, deep mid-lake */
export function lakeDepthAt(x, z) {
  const r = Math.min(1, Math.hypot(x, z) / LAKE_R);
  return 4 + 9.5 * (1 - r * r);
}

export class Water {
  constructor(scene) {
    const geo = new THREE.PlaneGeometry(LAKE_R * 2.6, LAKE_R * 2.6, 96, 96);
    geo.rotateX(-Math.PI / 2);

    this.uniforms = {
      uTime: { value: 0 },
      uSunDir: { value: new THREE.Vector3(0.5, 0.7, 0.3).normalize() },
      uDeep: { value: new THREE.Color("#12557f") },
      uShallow: { value: new THREE.Color("#2fbfd3") },
      uSky: { value: new THREE.Color("#bfeaf5") },
      uFoam: { value: new THREE.Color("#eafcff") },
      uLakeR: { value: LAKE_R },
    };

    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: /* glsl */ `
        uniform float uTime;
        varying vec3 vWorld;
        varying float vWave;

        float wave(vec2 p, float t) {
          return sin(p.x * 0.28 + t * 1.1) * 0.5
               + sin(p.y * 0.22 - t * 0.8) * 0.4
               + sin((p.x + p.y) * 0.16 + t * 0.6) * 0.35;
        }

        void main() {
          vec3 pos = position;
          vec4 wp = modelMatrix * vec4(pos, 1.0);
          float w = wave(wp.xz, uTime);
          pos.y += w * 0.09;
          vWave = w;
          wp = modelMatrix * vec4(pos, 1.0);
          vWorld = wp.xyz;
          gl_Position = projectionMatrix * viewMatrix * wp;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        uniform vec3 uSunDir;
        uniform vec3 uDeep;
        uniform vec3 uShallow;
        uniform vec3 uSky;
        uniform vec3 uFoam;
        uniform float uLakeR;
        varying vec3 vWorld;
        varying float vWave;

        // cheap value noise
        float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float noise(vec2 p) {
          vec2 i = floor(p), f = fract(p);
          vec2 u = f * f * (3.0 - 2.0 * f);
          return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x),
                     mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
        }

        void main() {
          float r = length(vWorld.xz);
          float shoreT = smoothstep(uLakeR * 0.45, uLakeR * 0.98, r);

          // two scrolling ripple layers
          float n1 = noise(vWorld.xz * 0.35 + vec2(uTime * 0.22, uTime * 0.14));
          float n2 = noise(vWorld.xz * 0.9 - vec2(uTime * 0.16, uTime * 0.28));
          float rip = n1 * 0.6 + n2 * 0.4;

          // base gradient: deep centre -> shallow turquoise at shore
          vec3 col = mix(uDeep, uShallow, shoreT * 0.85 + rip * 0.18);

          // toon sparkle: hard-stepped glints where ripple noise peaks toward the sun
          float glint = smoothstep(0.74, 0.78, rip * (0.6 + 0.4 * max(0.0, uSunDir.y)));
          col += glint * vec3(0.9, 0.95, 1.0) * 0.55;

          // secondary soft sheen bands
          float sheen = smoothstep(0.45, 0.85, n1) * 0.10;
          col += sheen * uSky;

          // wave-crest tint
          col += max(0.0, vWave) * 0.045 * uSky;

          // drifting cloud shadows (team scrap: shared-cloud-shadow-shader-term)
          float cloud = smoothstep(0.55, 0.85, noise(vWorld.xz * 0.016 + vec2(uTime * 0.013, uTime * 0.007)));
          col *= 1.0 - 0.13 * cloud;

          // shore foam: wobbling ring at the water's edge
          float foamEdge = uLakeR - 1.2 + sin(atan(vWorld.z, vWorld.x) * 9.0 + uTime * 0.8) * 0.55 + n2 * 1.2;
          float foam = smoothstep(foamEdge - 1.6, foamEdge, r);
          float foamDots = step(0.52, noise(vWorld.xz * 2.4 + uTime * 0.15));
          col = mix(col, uFoam, foam * (0.55 + 0.45 * foamDots));

          gl_FragColor = vec4(col, 1.0);
        }
      `,
    });

    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.position.y = WATER_Y;
    this.mesh.renderOrder = 1;
    scene.add(this.mesh);
  }

  update(dt, elapsed) {
    this.uniforms.uTime.value = elapsed;
  }

  /** analytic wave height matching the vertex shader, for bobbing objects */
  heightAt(x, z, t) {
    return (
      (Math.sin(x * 0.28 + t * 1.1) * 0.5 +
        Math.sin(z * 0.22 - t * 0.8) * 0.4 +
        Math.sin((x + z) * 0.16 + t * 0.6) * 0.35) * 0.09
    );
  }
}

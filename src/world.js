/**
 * The lake world: gradient sky dome with a fat toon sun, low-poly shore ring
 * with sand -> grass -> hills, instanced pine trees, drifting clouds, the flag
 * buoy (waving cloth flag, pulsing capture ring), tee dock, and wander-y ducks.
 * Lighting per the mood-lighting-rig scrap: warm key, cool fill, low ambient.
 */
import * as THREE from "three";
import { LAKE_R, WATER_Y, lakeDepthAt } from "./water.js";

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

// ------------------------------------------------------------------ terrain ring
function makeShore(scene) {
  const R = 240;
  // RingGeometry (not CircleGeometry): we need radial subdivisions so the
  // beach rise actually exists in the mesh, not just at center + rim.
  const geo = new THREE.RingGeometry(0.5, R, 128, 100);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const sand = new THREE.Color("#eed9a4");
  const grass = new THREE.Color("#7cc45e");
  const dark = new THREE.Color("#4e9a4a");
  const rockc = new THREE.Color("#9aa5a3");
  const tmp = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    const r = Math.hypot(x, z);
    const a = Math.atan2(z, x);
    const wob = Math.sin(a * 5 + 1.7) * 2.2 + Math.sin(a * 11 + 0.4) * 1.1;
    const edge = LAKE_R + wob;
    let y;
    if (r < edge) {
      y = -0.45; // just under water
      tmp.copy(sand);
    } else {
      const d = r - edge;
      y = Math.min(26, Math.pow(d * 0.16, 1.55)) - 0.4;
      // rolling bumps
      y += Math.sin(a * 7 + d * 0.14) * Math.min(2.5, d * 0.05);
      if (d < 6) tmp.copy(sand);
      else if (d < 14) tmp.copy(sand).lerp(grass, (d - 6) / 8);
      else if (y > 14) tmp.copy(dark).lerp(rockc, Math.min(1, (y - 14) / 9));
      else tmp.copy(grass).lerp(dark, Math.min(1, d / 70));
      // subtle color noise
      const n = (Math.sin(x * 0.53) + Math.cos(z * 0.61)) * 0.035;
      tmp.offsetHSL(0, 0, n);
    }
    pos.setY(i, y);
    colors[i * 3] = tmp.r; colors[i * 3 + 1] = tmp.g; colors[i * 3 + 2] = tmp.b;
  }
  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  scene.add(mesh);
  return mesh;
}

// ------------------------------------------------------------------ trees
export function shoreHeight(x, z) {
  // must mirror makeShore's height formula (without the per-vertex noise wobble)
  const r = Math.hypot(x, z);
  const a = Math.atan2(z, x);
  const wob = Math.sin(a * 5 + 1.7) * 2.2 + Math.sin(a * 11 + 0.4) * 1.1;
  const edge = LAKE_R + wob;
  if (r < edge) return -0.45;
  const d = r - edge;
  let y = Math.min(26, Math.pow(d * 0.16, 1.55)) - 0.4;
  y += Math.sin(a * 7 + d * 0.14) * Math.min(2.5, d * 0.05);
  return y;
}

// shared clock for the wind-sway shader patch (team scrap: vertex-sway-shader-patch)
const swayTime = { value: 0 };

function patchSway(mat, amp) {
  mat.userData.noCel = true; // cel swap would discard onBeforeCompile
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
          float swayK = smoothstep(-1.2, 1.6, position.y);
          transformed.x += sin(uSwayTime * 1.7 + swayW.x * 0.35 + swayW.z * 0.31) * ${amp.toFixed(3)} * swayK;
          transformed.z += cos(uSwayTime * 1.3 + swayW.z * 0.29) * ${(amp * 0.7).toFixed(3)} * swayK;
        }`
      );
  };
  mat.customProgramCacheKey = () => "sway" + amp;
}

function makeTrees(scene) {
  const trunkGeo = new THREE.CylinderGeometry(0.22, 0.34, 1.4, 6);
  const leafGeo = new THREE.ConeGeometry(1.5, 3.2, 7);
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x8a5a33, flatShading: true });
  const leafMat = new THREE.MeshStandardMaterial({ color: 0x3f9950, flatShading: true });
  patchSway(leafMat, 0.14);
  const N = 90;
  const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, N);
  const leaves = new THREE.InstancedMesh(leafGeo, leafMat, N);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  let placed = 0, guard = 0;
  while (placed < N && guard++ < 4000) {
    const a = Math.random() * Math.PI * 2;
    const r = LAKE_R + 8 + Math.random() * 90;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    const y = shoreHeight(x, z);
    if (y < 0.4 || y > 20) continue;
    const s = 0.8 + Math.random() * 1.6;
    e.set(0, Math.random() * Math.PI, (Math.random() - 0.5) * 0.08);
    q.setFromEuler(e);
    m.compose(new THREE.Vector3(x, y + 0.6 * s, z), q, new THREE.Vector3(s, s, s));
    trunks.setMatrixAt(placed, m);
    m.compose(new THREE.Vector3(x, y + (1.2 + 1.6) * s, z), q, new THREE.Vector3(s, s, s));
    leaves.setMatrixAt(placed, m);
    placed++;
  }
  trunks.count = placed;
  leaves.count = placed;
  scene.add(trunks, leaves);
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

// ------------------------------------------------------------------ flag buoy
export class FlagBuoy {
  constructor(scene) {
    this.group = new THREE.Group();

    // floating platform
    const base = new THREE.Mesh(
      new THREE.CylinderGeometry(1.9, 2.2, 0.55, 10),
      new THREE.MeshStandardMaterial({ color: 0xc8763a, flatShading: true })
    );
    base.position.y = 0.12;
    this.group.add(base);
    const rim = new THREE.Mesh(
      new THREE.TorusGeometry(1.95, 0.22, 8, 14),
      new THREE.MeshStandardMaterial({ color: 0xe0e6e8, flatShading: true })
    );
    rim.rotation.x = Math.PI / 2;
    rim.position.y = 0.34;
    this.group.add(rim);

    // pole
    const pole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.09, 0.12, 5.2, 6),
      new THREE.MeshStandardMaterial({ color: 0xf4efe2 })
    );
    pole.position.y = 2.8;
    this.group.add(pole);
    const knob = new THREE.Mesh(
      new THREE.SphereGeometry(0.22, 8, 6),
      new THREE.MeshStandardMaterial({ color: 0xffd24a })
    );
    knob.position.y = 5.45;
    this.group.add(knob);

    // waving cloth flag (CPU vertex wave)
    this.flagGeo = new THREE.PlaneGeometry(2.6, 1.5, 10, 5);
    this.flagBase = this.flagGeo.attributes.position.array.slice();
    const flagMat = new THREE.MeshStandardMaterial({
      color: 0xff5470, side: THREE.DoubleSide, flatShading: true,
    });
    this.flag = new THREE.Mesh(this.flagGeo, flagMat);
    this.flag.position.set(1.34, 4.55, 0);
    this.group.add(this.flag);

    // pulsing capture ring on the water
    const ringGeo = new THREE.RingGeometry(0.9, 1.0, 48);
    ringGeo.rotateX(-Math.PI / 2);
    this.ring = new THREE.Mesh(
      ringGeo,
      new THREE.MeshBasicMaterial({ color: 0xffd24a, transparent: true, opacity: 0.8, depthWrite: false })
    );
    this.ring.position.y = 0.05;
    this.group.add(this.ring);

    // beacon glow column (helps you find it across the lake)
    this.beacon = new THREE.Mesh(
      new THREE.CylinderGeometry(0.5, 0.9, 26, 10, 1, true),
      new THREE.MeshBasicMaterial({
        color: 0xffd24a, transparent: true, opacity: 0.12,
        side: THREE.DoubleSide, depthWrite: false,
      })
    );
    this.beacon.position.y = 13;
    this.group.add(this.beacon);

    this.captureR = 4.2;
    scene.add(this.group);
  }

  setPosition(x, z) {
    this.group.position.set(x, WATER_Y, z);
  }

  get position() { return this.group.position; }

  update(dt, elapsed, water) {
    // bob on the waves
    const p = this.group.position;
    this.group.position.y = WATER_Y + water.heightAt(p.x, p.z, elapsed) * 1.4;
    this.group.rotation.z = Math.sin(elapsed * 0.9) * 0.03;
    this.group.rotation.x = Math.cos(elapsed * 0.7) * 0.03;

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

    // capture ring pulse
    const k = 1 + Math.sin(elapsed * 2.4) * 0.12;
    this.ring.scale.setScalar(this.captureR * k);
    this.ring.material.opacity = 0.5 + Math.sin(elapsed * 2.4) * 0.25;
    this.beacon.material.opacity = 0.09 + Math.sin(elapsed * 1.7) * 0.035;
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
  }

  update(dt, elapsed, water) {
    this.turnT -= dt;
    if (this.turnT <= 0) {
      this.turnT = 2 + Math.random() * 4;
      this.heading += (Math.random() - 0.5) * 1.6;
    }
    const p = this.group.position;
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
  }

  scareFrom(pos) {
    const d = this.group.position.distanceTo(pos);
    if (d < 9) {
      this.scare = 1;
      this.heading = Math.atan2(this.group.position.z - pos.z, this.group.position.x - pos.x);
    }
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
    const stone = new THREE.MeshStandardMaterial({ color: 0x7d8a90, flatShading: true });
    const stoneDark = new THREE.MeshStandardMaterial({ color: 0x5d686e, flatShading: true });
    const moss = new THREE.MeshStandardMaterial({ color: 0x5da24e, flatShading: true });
    for (const o of rocks) {
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

// ------------------------------------------------------------------ world facade
export class World {
  constructor(scene) {
    this.scene = scene;
    makeSky(scene);
    makeShore(scene);
    makeTrees(scene);
    this.clouds = makeClouds(scene);
    this.flag = new FlagBuoy(scene);
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

  update(dt, elapsed, water) {
    swayTime.value = elapsed;
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
}

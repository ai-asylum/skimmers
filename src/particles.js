/**
 * Fixed-pool particle system in a handful of batched draw calls
 * (team scrap: common-pooled-particles — THREE.Points clouds, no per-frame
 * allocation) plus a small pool of expanding ripple-ring meshes for the water.
 */
import * as THREE from "three";

const WATER_Y = 0;

// ------------------------------------------------------------------ points pool
class PointPool {
  constructor(scene, max, { additive = false, sizeAtten = 90 } = {}) {
    this.max = max;
    this.pos = new Float32Array(max * 3);
    this.col = new Float32Array(max * 3);
    this.alpha = new Float32Array(max);
    this.size = new Float32Array(max);
    this.vel = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.grav = new Float32Array(max);
    this.drag = new Float32Array(max);
    this.baseSize = new Float32Array(max);
    this.splashOnWater = new Uint8Array(max); // droplets that ripple when they land
    this.head = 0;
    this.alive = 0;

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(this.col, 3));
    geo.setAttribute("aAlpha", new THREE.BufferAttribute(this.alpha, 1));
    geo.setAttribute("aSize", new THREE.BufferAttribute(this.size, 1));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5); // never culled

    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      uniforms: { uAtten: { value: sizeAtten } },
      vertexShader: /* glsl */ `
        attribute float aAlpha;
        attribute float aSize;
        varying float vAlpha;
        varying vec3 vColor;
        uniform float uAtten;
        void main() {
          vAlpha = aAlpha;
          vColor = color;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = aSize * (uAtten / max(1.0, -mv.z));
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        varying float vAlpha;
        varying vec3 vColor;
        void main() {
          vec2 uv = gl_PointCoord - 0.5;
          float d = length(uv);
          if (d > 0.5) discard;
          float soft = smoothstep(0.5, 0.32, d);
          gl_FragColor = vec4(vColor, vAlpha * soft);
        }
      `,
      vertexColors: true,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
    scene.add(this.points);
    // park everything far below
    for (let i = 0; i < max; i++) this.pos[i * 3 + 1] = -1000;
  }

  emit(x, y, z, vx, vy, vz, life, size, r, g, b, grav = 9.8, drag = 0.4, splashOnWater = 0) {
    const i = this.head;
    this.head = (this.head + 1) % this.max;
    const i3 = i * 3;
    this.pos[i3] = x; this.pos[i3 + 1] = y; this.pos[i3 + 2] = z;
    this.vel[i3] = vx; this.vel[i3 + 1] = vy; this.vel[i3 + 2] = vz;
    this.life[i] = life;
    this.maxLife[i] = life;
    this.size[i] = size;
    this.baseSize[i] = size;
    this.col[i3] = r; this.col[i3 + 1] = g; this.col[i3 + 2] = b;
    this.alpha[i] = 1;
    this.grav[i] = grav;
    this.drag[i] = drag;
    this.splashOnWater[i] = splashOnWater;
  }

  update(dt, onWaterHit) {
    const { pos, vel, life, maxLife, alpha, size, grav, drag, baseSize } = this;
    for (let i = 0; i < this.max; i++) {
      if (life[i] <= 0) continue;
      life[i] -= dt;
      const i3 = i * 3;
      if (life[i] <= 0) {
        pos[i3 + 1] = -1000;
        alpha[i] = 0;
        continue;
      }
      vel[i3 + 1] -= grav[i] * dt;
      const dr = Math.max(0, 1 - drag[i] * dt);
      vel[i3] *= dr; vel[i3 + 1] *= dr; vel[i3 + 2] *= dr;
      pos[i3] += vel[i3] * dt;
      pos[i3 + 1] += vel[i3 + 1] * dt;
      pos[i3 + 2] += vel[i3 + 2] * dt;
      const t = life[i] / maxLife[i];
      alpha[i] = t < 0.35 ? t / 0.35 : 1;
      size[i] = baseSize[i] * (0.5 + 0.5 * t);
      // droplet re-entering the water: tiny secondary ripple then die
      if (this.splashOnWater[i] && pos[i3 + 1] <= WATER_Y && vel[i3 + 1] < 0) {
        if (onWaterHit && Math.random() < 0.3) onWaterHit(pos[i3], pos[i3 + 2]);
        life[i] = 0;
        pos[i3 + 1] = -1000;
        alpha[i] = 0;
      }
    }
    this.points.geometry.attributes.position.needsUpdate = true;
    this.points.geometry.attributes.color.needsUpdate = true;
    this.points.geometry.attributes.aAlpha.needsUpdate = true;
    this.points.geometry.attributes.aSize.needsUpdate = true;
  }
}

// ------------------------------------------------------------------ ripple rings
class RingPool {
  constructor(scene, max = 40) {
    this.rings = [];
    const geo = new THREE.RingGeometry(0.82, 1.0, 40);
    geo.rotateX(-Math.PI / 2);
    for (let i = 0; i < max; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: 0xffffff, transparent: true, opacity: 0, depthWrite: false,
      });
      const m = new THREE.Mesh(geo, mat);
      m.visible = false;
      m.renderOrder = 3;
      scene.add(m);
      this.rings.push({ mesh: m, t: 0, dur: 1, maxScale: 3 });
    }
    this.head = 0;
  }

  spawn(x, z, maxScale = 3, dur = 0.9, color = 0xffffff) {
    const r = this.rings[this.head];
    this.head = (this.head + 1) % this.rings.length;
    r.t = 0;
    r.dur = dur;
    r.maxScale = maxScale;
    r.mesh.visible = true;
    r.mesh.material.color.setHex(color);
    r.mesh.position.set(x, WATER_Y + 0.03 + this.head * 0.0005, z);
    r.mesh.scale.setScalar(0.05);
  }

  update(dt) {
    for (const r of this.rings) {
      if (!r.mesh.visible) continue;
      r.t += dt;
      const k = r.t / r.dur;
      if (k >= 1) { r.mesh.visible = false; continue; }
      const e = 1 - Math.pow(1 - k, 2.2);
      r.mesh.scale.setScalar(0.05 + e * r.maxScale);
      r.mesh.material.opacity = 0.85 * (1 - k);
    }
  }
}

// ------------------------------------------------------------------ facade
export class Particles {
  constructor(scene) {
    this.spray = new PointPool(scene, 2600, { additive: false, sizeAtten: 110 });
    this.glow = new PointPool(scene, 1200, { additive: true, sizeAtten: 130 });
    this.rings = new RingPool(scene, 48);
    this._tmpC = new THREE.Color();
  }

  update(dt) {
    const secondary = (x, z) => this.rings.spawn(x, z, 0.5 + Math.random() * 0.5, 0.5);
    this.spray.update(dt, secondary);
    this.glow.update(dt, null);
    this.rings.update(dt);
  }

  /** skip splash — ring + fan of droplets kicked up behind the bounce */
  skipSplash(pos, vel, power = 0.7) {
    const p = Math.min(1.4, 0.35 + power);
    this.rings.spawn(pos.x, pos.z, 1.6 + 2.2 * p, 0.7 + 0.25 * p);
    this.rings.spawn(pos.x, pos.z, 0.9 + 1.2 * p, 0.5);
    const n = Math.floor(14 + 26 * p);
    const hx = vel.x, hz = vel.z;
    const hmag = Math.max(0.001, Math.hypot(hx, hz));
    for (let i = 0; i < n; i++) {
      const back = -0.3 - Math.random() * 0.8;
      const side = (Math.random() - 0.5) * 1.6;
      const vx = (hx / hmag) * back * 3 - (hz / hmag) * side * 2 + (Math.random() - 0.5) * 2;
      const vz = (hz / hmag) * back * 3 + (hx / hmag) * side * 2 + (Math.random() - 0.5) * 2;
      const vy = (2.5 + Math.random() * 4.5) * (0.5 + p * 0.6);
      const white = 0.85 + Math.random() * 0.15;
      this.spray.emit(
        pos.x, WATER_Y + 0.05, pos.z, vx, vy, vz,
        0.5 + Math.random() * 0.5, 3.5 + Math.random() * 4,
        white, white, 1.0, 11, 0.5, 1
      );
    }
    // sparkle glints
    for (let i = 0; i < 6 + 8 * p; i++) {
      this.glow.emit(
        pos.x + (Math.random() - 0.5), WATER_Y + 0.1, pos.z + (Math.random() - 0.5),
        (Math.random() - 0.5) * 3, 1 + Math.random() * 3, (Math.random() - 0.5) * 3,
        0.35 + Math.random() * 0.3, 3 + Math.random() * 3,
        0.7, 0.95, 1.0, 6, 1
      );
    }
  }

  /** vertical plunge column for a sink */
  sinkSplash(pos, big = 1) {
    this.rings.spawn(pos.x, pos.z, 2.2 * big, 0.9);
    this.rings.spawn(pos.x, pos.z, 3.4 * big, 1.3);
    const n = Math.floor(30 * big);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * 0.5;
      const white = 0.8 + Math.random() * 0.2;
      this.spray.emit(
        pos.x + Math.cos(a) * r, WATER_Y, pos.z + Math.sin(a) * r,
        Math.cos(a) * (0.5 + Math.random() * 2), 5 + Math.random() * 7 * big, Math.sin(a) * (0.5 + Math.random() * 2),
        0.7 + Math.random() * 0.5, 4 + Math.random() * 6,
        white, white, 1.0, 12, 0.6, 1
      );
    }
    // bubbles rising after
    for (let i = 0; i < 10; i++) {
      this.glow.emit(
        pos.x + (Math.random() - 0.5) * 0.8, WATER_Y - 0.2, pos.z + (Math.random() - 0.5) * 0.8,
        0, 0.8 + Math.random(), 0,
        0.8 + Math.random() * 0.8, 2 + Math.random() * 2,
        0.6, 0.9, 1.0, -1.5, 1.5
      );
    }
  }

  /** rock-on-rock splash blast */
  blast(pos) {
    this.rings.spawn(pos.x, pos.z, 5, 1.1, 0xfff2c0);
    this.rings.spawn(pos.x, pos.z, 3, 0.7);
    for (let i = 0; i < 60; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 2 + Math.random() * 6;
      const white = 0.85 + Math.random() * 0.15;
      this.spray.emit(
        pos.x, WATER_Y + 0.1, pos.z,
        Math.cos(a) * sp, 4 + Math.random() * 8, Math.sin(a) * sp,
        0.6 + Math.random() * 0.6, 4 + Math.random() * 7,
        white, white, 1.0, 12, 0.5, 1
      );
    }
    for (let i = 0; i < 24; i++) {
      const a = Math.random() * Math.PI * 2;
      this.glow.emit(
        pos.x, WATER_Y + 0.2, pos.z,
        Math.cos(a) * (1 + Math.random() * 4), 2 + Math.random() * 6, Math.sin(a) * (1 + Math.random() * 4),
        0.4 + Math.random() * 0.4, 4 + Math.random() * 4,
        1.0, 0.85, 0.4, 8, 1
      );
    }
  }

  /** flight trail droplets shed by a spinning wet rock */
  trail(pos, tint) {
    this._tmpC.set(tint ?? 0xbfe8ff);
    this.glow.emit(
      pos.x, pos.y, pos.z,
      (Math.random() - 0.5) * 0.6, (Math.random() - 0.5) * 0.6, (Math.random() - 0.5) * 0.6,
      0.28 + Math.random() * 0.15, 2.5 + Math.random() * 2,
      this._tmpC.r, this._tmpC.g, this._tmpC.b, 0.5, 2
    );
  }

  /** blazing trail for a rock that's ON FIRE (5+ skip chain) */
  fireTrail(pos) {
    const r = Math.random();
    // hot orange core
    this.glow.emit(
      pos.x, pos.y, pos.z,
      (r - 0.5) * 1.2, 0.4 + r * 1.2, (Math.random() - 0.5) * 1.2,
      0.34 + r * 0.22, 7 + r * 5,
      1.0, 0.5 + r * 0.25, 0.12, -2, 1.6
    );
    // yellow flicker
    if (Math.random() < 0.7) {
      this.glow.emit(
        pos.x, pos.y + 0.1, pos.z,
        (Math.random() - 0.5) * 0.8, 0.8 + Math.random(), (Math.random() - 0.5) * 0.8,
        0.22 + Math.random() * 0.15, 3 + Math.random() * 2,
        1.0, 0.9, 0.35, -2.5, 1.8
      );
    }
    // stray ember
    if (Math.random() < 0.25) {
      this.spray.emit(
        pos.x, pos.y, pos.z,
        (Math.random() - 0.5) * 3, 1 + Math.random() * 2, (Math.random() - 0.5) * 3,
        0.5 + Math.random() * 0.4, 1.5 + Math.random(),
        1.0, 0.35, 0.1, 5, 1, 1
      );
    }
  }

  /** stone chips while grinding (small: viewed from very close) */
  grindChips(pos) {
    for (let i = 0; i < 5; i++) {
      const g = 0.45 + Math.random() * 0.25;
      this.spray.emit(
        pos.x, pos.y, pos.z,
        (Math.random() - 0.5) * 2.5, 1 + Math.random() * 2.5, (Math.random() - 0.5) * 2.5,
        0.4 + Math.random() * 0.4, 0.7 + Math.random() * 0.7,
        g, g * 0.95, g * 0.85, 10, 1
      );
    }
  }

  paintPuff(pos, color) {
    this._tmpC.set(color);
    for (let i = 0; i < 8; i++) {
      this.spray.emit(
        pos.x, pos.y, pos.z,
        (Math.random() - 0.5) * 2, 0.5 + Math.random() * 1.5, (Math.random() - 0.5) * 2,
        0.35 + Math.random() * 0.25, 0.9 + Math.random() * 0.8,
        this._tmpC.r, this._tmpC.g, this._tmpC.b, 3, 2
      );
    }
  }

  /** celebration confetti above a point */
  confetti(pos, count = 80) {
    for (let i = 0; i < count; i++) {
      const hue = Math.random();
      this._tmpC.setHSL(hue, 0.9, 0.6);
      const a = Math.random() * Math.PI * 2;
      const sp = 1 + Math.random() * 5;
      this.spray.emit(
        pos.x, pos.y + 1, pos.z,
        Math.cos(a) * sp, 5 + Math.random() * 7, Math.sin(a) * sp,
        1.2 + Math.random() * 1.2, 4 + Math.random() * 4,
        this._tmpC.r, this._tmpC.g, this._tmpC.b, 6, 1.2
      );
    }
  }

  /** firework shell burst at a sky position */
  firework(pos, hue = Math.random()) {
    this._tmpC.setHSL(hue, 1.0, 0.62);
    for (let i = 0; i < 70; i++) {
      const th = Math.random() * Math.PI * 2;
      const ph = Math.acos(2 * Math.random() - 1);
      const sp = 4 + Math.random() * 5;
      this.glow.emit(
        pos.x, pos.y, pos.z,
        Math.sin(ph) * Math.cos(th) * sp, Math.cos(ph) * sp, Math.sin(ph) * Math.sin(th) * sp,
        0.9 + Math.random() * 0.6, 3.5 + Math.random() * 3,
        this._tmpC.r, this._tmpC.g, this._tmpC.b, 3.5, 0.8
      );
    }
  }

  /** gentle idle ripple around a resting rock */
  idleRipple(pos) {
    this.rings.spawn(pos.x, pos.z, 0.8 + Math.random() * 0.4, 1.4);
  }

  /** oar dip ripples for the boats */
  oarDip(x, z) {
    this.rings.spawn(x, z, 0.7, 0.8);
  }
}

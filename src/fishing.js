/**
 * The fishing minigame, underwater edition. Your rock sank — the camera dives
 * below the surface into a little aquarium diorama: light shafts, seaweed,
 * bubbles, a school of very territorial fish, and your googly rock waiting on
 * the lake bed. Steer the hook (pointer left/right) as it lowers; touch a
 * fish and it shoves the hook back up. Reach the rock to reel it home.
 */
import * as THREE from "three";
import { audio } from "./audio.js";
import { lakeDepthAt } from "./water.js";
import { els } from "./ui.js";

const ROCK_Y = 0.55; // local y of the rock on the bed
const HOOK_SPEED = 2.0;
const STEER_RANGE = 8.5;

const FISH_COLORS = [0xffa63d, 0x37c8e0, 0xff5470, 0x9d7cf4, 0xffd24a, 0x6fe07a];

function makeFish(color) {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color, flatShading: true });
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.42, 8, 6), mat);
  body.scale.set(1.5, 0.85, 0.6);
  g.add(body);
  const tail = new THREE.Mesh(new THREE.ConeGeometry(0.3, 0.55, 4), mat);
  tail.rotation.z = Math.PI / 2;
  tail.position.x = -0.72;
  tail.scale.z = 0.4;
  g.add(tail);
  const eyeMat = new THREE.MeshBasicMaterial({ color: 0x111111 });
  const eye = new THREE.Mesh(new THREE.SphereGeometry(0.07, 6, 5), eyeMat);
  eye.position.set(0.42, 0.12, 0.22);
  g.add(eye);
  const eye2 = eye.clone();
  eye2.position.z = -0.22;
  g.add(eye2);
  return g;
}

export class Fishing {
  constructor(scene, particles) {
    this.scene = scene;
    this.particles = particles;
    this.active = false;
    this.onDone = null;
    this.rock = null;

    // UI
    this.el = document.getElementById("fishing-ui");
    this.catchesEl = document.getElementById("fishing-catches");

    // fake pendulum state for the line/hook swing
    this.swingAng = 0;
    this.swingVel = 0;
    this.anchorX = 0;
    this.prevHookX = 0;

    // ---------- diorama (built once, hidden) ----------
    const g = new THREE.Group();
    this.group = g;
    g.visible = false;
    scene.add(g);

    // deep-water backdrop dome
    const backMat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: { uTime: { value: 0 } },
      vertexShader: /* glsl */ `
        varying vec3 vPos;
        void main() { vPos = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
      `,
      fragmentShader: /* glsl */ `
        varying vec3 vPos;
        uniform float uTime;
        void main() {
          float h = clamp(vPos.y / 30.0 + 0.5, 0.0, 1.0);
          vec3 deep = vec3(0.03, 0.15, 0.27);
          vec3 shallow = vec3(0.16, 0.52, 0.68);
          vec3 col = mix(deep, shallow, h * h);
          // faint drifting caustic shimmer
          float c = sin(vPos.x * 0.55 + uTime * 0.7) * sin(vPos.z * 0.5 - uTime * 0.5) * sin(vPos.y * 0.4 + uTime * 0.3);
          col += max(0.0, c) * 0.045 * h;
          gl_FragColor = vec4(col, 1.0);
        }
      `,
    });
    this.backMat = backMat;
    const dome = new THREE.Mesh(new THREE.SphereGeometry(42, 24, 16), backMat);
    dome.position.y = 8;
    g.add(dome);

    // sandy bed
    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(30, 36),
      new THREE.MeshStandardMaterial({ color: 0xc8b98a, flatShading: true })
    );
    floor.rotation.x = -Math.PI / 2;
    g.add(floor);
    // scattered pebbles
    const pebbleMat = new THREE.MeshStandardMaterial({ color: 0x8f9aa3, flatShading: true });
    for (let i = 0; i < 10; i++) {
      const p = new THREE.Mesh(new THREE.SphereGeometry(0.2 + Math.random() * 0.3, 6, 5), pebbleMat);
      const a = Math.random() * Math.PI * 2;
      const r = 3 + Math.random() * 12;
      p.position.set(Math.cos(a) * r, 0.12, Math.sin(a) * r);
      p.scale.y = 0.6;
      g.add(p);
    }

    // seaweed (swayed in update)
    this.weeds = [];
    const weedMat = new THREE.MeshStandardMaterial({ color: 0x2e7d4f, flatShading: true });
    for (let i = 0; i < 7; i++) {
      const w = new THREE.Mesh(new THREE.ConeGeometry(0.22, 2.6 + Math.random() * 2, 5), weedMat);
      const a = Math.random() * Math.PI * 2;
      const r = 4.5 + Math.random() * 9;
      w.position.set(Math.cos(a) * r, 1.3, Math.sin(a) * r);
      w.userData.phase = Math.random() * 10;
      g.add(w);
      this.weeds.push(w);
    }

    // light shafts from the surface
    const shaftMat = new THREE.MeshBasicMaterial({
      color: 0xbfeaff, transparent: true, opacity: 0.055, depthWrite: false,
      blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    });
    for (let i = 0; i < 4; i++) {
      const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.7 + i * 0.3, 2.4 + i * 0.5, 26, 8, 1, true), shaftMat);
      shaft.position.set(-6 + i * 4.2, 13, -3 - (i % 2) * 3);
      shaft.rotation.z = 0.16;
      g.add(shaft);
    }

    // the line: a verlet rope — free middle points under gravity, pinned to
    // the rod tip and the hook, so fast steering whips it into S-curves
    this.ropeN = 12;
    this.ropePts = [];
    for (let i = 0; i < this.ropeN; i++) this.ropePts.push({ x: 0, y: 0, px: 0, py: 0 });
    this.ropeGroup = new THREE.Group();
    const ropeMat = new THREE.MeshBasicMaterial({ color: 0xeeeeee });
    this.ropeSegs = [];
    for (let i = 0; i < this.ropeN - 1; i++) {
      const seg = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 1, 5), ropeMat);
      this.ropeGroup.add(seg);
      this.ropeSegs.push(seg);
    }
    g.add(this.ropeGroup);
    this.lineMesh = this.ropeGroup; // visibility toggles reuse this handle
    this.hook = new THREE.Group();
    const hookMat = new THREE.MeshStandardMaterial({ color: 0xd8dde0, flatShading: true, metalness: 0.4 });
    const curve = new THREE.Mesh(new THREE.TorusGeometry(0.34, 0.07, 6, 12, Math.PI * 1.4), hookMat);
    curve.rotation.z = Math.PI * 0.8;
    this.hook.add(curve);
    const barb = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.28, 6), hookMat);
    barb.position.set(0.33, 0.28, 0);
    this.hook.add(barb);
    const sinker = new THREE.Mesh(new THREE.SphereGeometry(0.12, 6, 5), new THREE.MeshStandardMaterial({ color: 0x66707a }));
    sinker.position.y = 0.42;
    this.hook.add(sinker);
    g.add(this.hook);

    // fish school
    this.fish = [];
    for (let i = 0; i < 6; i++) {
      const f = makeFish(FISH_COLORS[i % FISH_COLORS.length]);
      g.add(f);
      this.fish.push({
        mesh: f,
        y: 2.6 + i * 1.35 + Math.random() * 0.5, // stacked lanes between rock and surface
        xr: 5.5 + Math.random() * 2.5,
        speed: (1.6 + Math.random() * 1.6) * (Math.random() < 0.5 ? 1 : -1),
        phase: Math.random() * 10,
        scare: 0,
      });
    }

    this._bubbleT = 0;
    this._tickY = 0;
  }

  /** dive in: the lake bed is a bowl — the diorama floor sits at the real
   *  depth under the sink spot, so shoreline dives are quick grabs and
   *  mid-lake sinks are a long, fishy descent */
  start(spot, rock, onDone) {
    this.active = true;
    this.onDone = onDone;
    this.rock = rock;
    this.hits = 0;
    this.phase = "fall"; // fall -> drop -> reel
    this.depth = lakeDepthAt(spot.x, spot.z);
    this.floorY = -this.depth;
    this.hookStart = Math.max(2.4, this.depth - 1.1); // local: just under the surface
    this.group.position.set(spot.x, this.floorY, spot.z);
    this.group.visible = true;

    // your stone tumbles down from the surface first; the line comes after
    this._rockSaved = { parent: rock.group.parent, pos: rock.group.position.clone(), rot: rock.group.rotation.clone() };
    this.fallY = this.depth - 0.7; // local, just under the surface
    this.fallPhase = Math.random() * 10;
    rock.group.position.set(spot.x, this.floorY + this.fallY, spot.z);
    rock.group.rotation.set(0, Math.random() * Math.PI * 2, 0);
    rock.kickEyes(1.5);
    this.hook.visible = false;
    this.lineMesh.visible = false;

    this.hookX = 0;
    this.hookY = this.hookStart;
    this._tickY = this.hookStart;
    this.swingAng = 0;
    this.swingVel = 0;
    this.anchorX = 0;
    this.prevHookX = 0;

    // deeper water = more fish in the gauntlet, lanes squeezed to the depth
    const active = Math.max(2, Math.min(this.fish.length, Math.round(this.depth / 2.2)));
    const laneLo = ROCK_Y + 1.15;
    const laneHi = Math.max(laneLo + 0.8, this.hookStart - 0.6);
    this.fish.forEach((f, i) => {
      if (i < active) {
        f.y = laneLo + ((i + 0.5) / active) * (laneHi - laneLo);
        f.mesh.visible = true;
        f.mesh.position.set((Math.random() - 0.5) * f.xr * 2, f.y, (Math.random() - 0.5) * 1.2);
      } else {
        f.mesh.visible = false;
        f.mesh.position.set(999, -999, 0);
      }
      f.scare = 0;
    });

    this.el.classList.remove("hidden");
    els.throwUi.classList.add("hidden");
    this.catchesEl.textContent = "";
  }

  /** camera pose for main's "fishing" mode — aquarium side view, framed to depth */
  getCamPose() {
    const p = this.group.position;
    const d = this.depth ?? 10;
    return {
      pos: new THREE.Vector3(p.x, this.floorY + d * 0.42 + 1.2, p.z + 7.5 + d * 0.55),
      look: new THREE.Vector3(p.x, this.floorY + d * 0.38, p.z),
    };
  }

  /** pointerX01: pointer x in [0,1] across the screen */
  update(dt, elapsed, pointerX01 = 0.5) {
    if (!this.active) return;
    this.backMat.uniforms.uTime.value = elapsed;

    // scenery life
    for (const w of this.weeds) {
      w.rotation.x = Math.sin(elapsed * 1.1 + w.userData.phase) * 0.14;
      w.rotation.z = Math.cos(elapsed * 0.9 + w.userData.phase) * 0.14;
    }
    this._bubbleT -= dt;
    if (this._bubbleT <= 0) {
      this._bubbleT = 0.3 + Math.random() * 0.5;
      const p = this.group.position;
      this.particles.glow.emit(
        p.x + (Math.random() - 0.5) * 14, this.floorY + 0.5 + Math.random() * 3, p.z + (Math.random() - 0.5) * 4,
        0, 1.2 + Math.random(), 0, 1.5 + Math.random(), 2 + Math.random() * 2,
        0.65, 0.85, 1.0, -1.2, 0.4
      );
    }

    // fish patrol their lanes
    for (const f of this.fish) {
      const boost = 1 + f.scare * 2.5;
      f.scare = Math.max(0, f.scare - dt);
      f.mesh.position.x += f.speed * boost * dt;
      if (Math.abs(f.mesh.position.x) > f.xr) {
        f.mesh.position.x = Math.sign(f.mesh.position.x) * f.xr;
        f.speed *= -1;
      }
      f.mesh.position.y = f.y + Math.sin(elapsed * 2 + f.phase) * 0.22;
      f.mesh.scale.x = f.speed > 0 ? 1 : -1;
      f.mesh.rotation.z = Math.sin(elapsed * 6 + f.phase) * 0.08;
    }

    // ---- intro: the stone rocks gently down to the bed, then the line drops in
    if (this.phase === "fall") {
      const fallSpeed = Math.max(2, this.depth / 2.4);
      this.fallY = Math.max(ROCK_Y, this.fallY - fallSpeed * dt);
      const wp = this.group.position;
      this.rock.group.position.set(
        wp.x + Math.sin(elapsed * 2.1 + this.fallPhase) * 0.35,
        this.floorY + this.fallY,
        wp.z
      );
      this.rock.group.rotation.x += dt * 0.9;
      this.rock.group.rotation.y += dt * 0.5;
      if (Math.random() < 0.35) {
        this.particles.glow.emit(
          this.rock.group.position.x, this.rock.group.position.y + 0.3, this.rock.group.position.z,
          (Math.random() - 0.5) * 0.4, 1 + Math.random(), (Math.random() - 0.5) * 0.4,
          0.8 + Math.random() * 0.6, 2 + Math.random() * 2, 0.65, 0.85, 1.0, -1.2, 0.5
        );
      }
      if (this.fallY <= ROCK_Y) {
        this.phase = "drop";
        this.rock.group.position.set(wp.x, this.floorY + ROCK_Y, wp.z);
        this.rock.group.rotation.set(0, this.rock.group.rotation.y, 0);
        this.rock.squashKick?.(0.8);
        this.rock.kickEyes(1.2);
        this.hook.visible = true;
        this.lineMesh.visible = true;
        this.hookY = this.hookStart;
        this._tickY = this.hookStart;
        // lay the rope straight down before the verlet sim takes over
        const topY = this.depth + 6, botY = this.hookStart + 0.45;
        this.ropePts.forEach((p, i) => {
          const t = i / (this.ropeN - 1);
          p.x = p.px = 0;
          p.y = p.py = topY + (botY - topY) * t;
        });
        audio.settle();
        // a puff of sand where it lands
        this.particles.grindChips(this.rock.group.position);
      }
      return;
    }

    // ---- fake pendulum: steering drags the hook, the line lags and swings
    const steerVel = (this.hookX - this.prevHookX) / Math.max(dt, 1e-4);
    this.prevHookX = this.hookX;
    this.swingVel += (-this.swingAng * 24 - this.swingVel * 3 - steerVel * 0.85) * dt;
    this.swingAng += this.swingVel * dt;
    const dispX = this.hookX + Math.sin(this.swingAng) * 1.15;

    if (this.phase === "drop") {
      // steer + descend
      const targetX = (pointerX01 - 0.5) * 2 * STEER_RANGE * 0.55;
      this.hookX += (targetX - this.hookX) * Math.min(1, 9 * dt);
      this.hookY -= HOOK_SPEED * dt;
      if (this.hookY < this._tickY) {
        this._tickY = this.hookY - 0.5;
        audio.reelTick();
      }

      // fish collisions shove the hook back up (tested against the SWUNG position)
      for (const f of this.fish) {
        const dx = f.mesh.position.x - dispX;
        const dy = f.mesh.position.y - this.hookY;
        if (Math.abs(dx) < 0.85 && Math.abs(dy) < 0.5) {
          this.hits++;
          this.hookY = Math.min(this.hookStart, this.hookY + 2.7);
          this._tickY = this.hookY;
          f.scare = 1.4;
          f.speed = Math.abs(f.speed) * Math.sign(dx || 1); // dart away from the hook
          this.swingVel += (Math.random() - 0.5) * 8; // the bump sets the line swinging
          audio.fishMiss();
          this.rock.kickEyes(1);
          this.catchesEl.textContent = `fish bumps: ${this.hits}`;
          const wp = this.group.position;
          this.particles.glow.emit(wp.x + dispX, this.floorY + this.hookY, wp.z, dx * 2, 1, 0,
            0.4, 5, 1.0, 0.6, 0.3, 2, 1);
        }
      }

      // reached the rock?
      if (this.hookY <= ROCK_Y + 0.55) {
        if (Math.abs(dispX) < 1.15) {
          this.phase = "reel";
          audio.catchRock();
          this.rock.kickEyes(2);
          this.rock.squashKick?.(1);
        } else {
          this.hookY = ROCK_Y + 0.55; // hover the bed until you line it up
        }
      }
    } else if (this.phase === "reel") {
      this.hookY += 7.5 * dt;
      this.hookX *= 1 - Math.min(1, 6 * dt);
      this.rock.group.position.set(
        this.group.position.x + dispX,
        this.floorY + this.hookY - 0.5,
        this.group.position.z
      );
      this.rock.group.rotation.z = this.swingAng * 0.6 + Math.sin(this.hookY * 2) * 0.1;
      if (Math.random() < 0.4) {
        this.particles.glow.emit(
          this.rock.group.position.x, this.rock.group.position.y, this.rock.group.position.z,
          (Math.random() - 0.5), 1.5, (Math.random() - 0.5), 0.6, 2.5, 0.7, 0.9, 1.0, -1, 0.6
        );
      }
      if (this.hookY >= this.hookStart + 2.5) this._finish(this.hits === 0);
    }

    // hook transform + verlet rope between the rod tip and the hook
    this.anchorX += (dispX * 0.85 - this.anchorX) * Math.min(1, 3.2 * dt);
    this.hook.position.set(dispX, this.hookY, 0);
    this.hook.rotation.z = this.swingAng * 1.25;
    this._updateRope(Math.min(dt, 1 / 30), dispX);
  }

  _updateRope(dt, dispX) {
    const pts = this.ropePts;
    const n = this.ropeN;
    const topX = this.anchorX, topY = this.depth + 6; // rod tip above the surface
    const botX = dispX, botY = this.hookY + 0.45;

    // verlet integrate the free middle points (gravity + inertia)
    for (let i = 1; i < n - 1; i++) {
      const p = pts[i];
      const vx = (p.x - p.px) * 0.985;
      const vy = (p.y - p.py) * 0.985;
      p.px = p.x;
      p.py = p.y;
      p.x += vx;
      p.y += vy - 22 * dt * dt;
    }
    // pins
    pts[0].x = topX; pts[0].y = topY;
    pts[n - 1].x = botX; pts[n - 1].y = botY;

    // distance constraints, slight slack so the rope sags and whips
    const segLen = (Math.hypot(botX - topX, botY - topY) / (n - 1)) * 1.04;
    for (let iter = 0; iter < 4; iter++) {
      for (let i = 0; i < n - 1; i++) {
        const a = pts[i], b = pts[i + 1];
        const dx = b.x - a.x, dy = b.y - a.y;
        const d = Math.hypot(dx, dy) || 1e-5;
        const diff = (d - segLen) / d;
        const aPinned = i === 0, bPinned = i + 1 === n - 1;
        if (aPinned && bPinned) continue;
        if (aPinned) { b.x -= dx * diff; b.y -= dy * diff; }
        else if (bPinned) { a.x += dx * diff; a.y += dy * diff; }
        else {
          a.x += dx * diff * 0.5; a.y += dy * diff * 0.5;
          b.x -= dx * diff * 0.5; b.y -= dy * diff * 0.5;
        }
      }
      pts[0].x = topX; pts[0].y = topY;
      pts[n - 1].x = botX; pts[n - 1].y = botY;
    }

    // lay the segment cylinders along the points
    for (let i = 0; i < n - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      const dx = b.x - a.x, dy = b.y - a.y;
      const len = Math.max(0.02, Math.hypot(dx, dy));
      const seg = this.ropeSegs[i];
      seg.scale.y = len;
      seg.position.set((a.x + b.x) / 2, (a.y + b.y) / 2, 0);
      seg.rotation.z = Math.atan2(dx, dy);
    }
  }

  _finish(clean) {
    this.active = false;
    this.group.visible = false;
    this.el.classList.add("hidden");
    els.throwUi.classList.remove("hidden");
    // hand the rock back to the game (main repositions it via placeAt)
    this.onDone?.(clean, this.hits);
  }

  /** abort without result (hole was decided while we fished) */
  cancel() {
    if (!this.active) return;
    this.active = false;
    this.group.visible = false;
    this.el.classList.add("hidden");
    els.throwUi.classList.remove("hidden");
  }
}

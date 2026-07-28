/**
 * The fishing minigame, underwater edition. Your rock sank — the camera dives
 * below the surface into a little aquarium diorama: light shafts, seaweed,
 * bubbles, a school of very territorial fish, and your googly rock waiting on
 * the lake bed. Steer the hook (pointer left/right) as it lowers; touch a
 * fish and it shoves the hook back up. Reach the rock to reel it home.
 */
import * as THREE from "three";
import { audio } from "./audio.js";
import { lakeDepthAt, bedHeightAt, DIVE_MIN, WATER_Y } from "./water.js";
import { terrainHeightAt } from "./terrain.js";
import { makeLifebuoy } from "./lifebuoy.js";
import { paintFloater } from "./cosmetics.js";
import { DEFAULT_MODS } from "./upgrades.js";
import { makeFish, updateFishWave, wave as fishWave } from "./fish.js";

const ROCK_Y = 0.55; // local y of the rock on the bed
export const HOOK_SPEED = 2.0;
const STEER_RANGE = 8.5;
export const BUOY_REST = 0.42; // rock center height above the waterline when nestled in the buoy

// view-picking (see _pickView): the lake is a narrow bowl, so a fixed camera
// azimuth regularly ends up buried in the bank or staring into a spire
const VIEW_YAWS = 24; // azimuths tried around the sink spot
const VIEW_PULLINS = [1, 0.82, 0.66]; // and how far we'll crowd the rock to get out of the way
const SIGHT_CLEARANCE = 0.6; // world units the sightline must clear the lake bed by

const _tip = new THREE.Vector3();

export class Fishing {
  constructor(scene, particles, water) {
    this.scene = scene;
    this.particles = particles;
    this.water = water;
    this.active = false;
    this.onDone = null;
    this.rock = null;
    this.mods = DEFAULT_MODS;
    this.wave = fishWave; // the school's swim shader, live-tunable from the console

    /** dress the lake buoy in a bought floater (cosmetics.js FLOATERS) */
    this.setFloater = (id) => paintFloater(this.buoyRing, id);

    // chosen view: the diorama is yawed to face the camera, so its local x/y
    // plane (the whole 2D minigame) always reads flat on screen
    this.camYaw = 0;
    this.camDist = 12;
    this._sin = 0;
    this._cos = 1;

    // ---------- the buoy: a small inflatable ring carrying the line ----
    // Scene-level, NOT part of the diorama group — it stays behind after the
    // dive so the reeled-in rock has somewhere to sit for the next throw.
    const buoy = new THREE.Group();
    this.buoy = buoy;
    buoy.visible = false;
    scene.add(buoy);
    // the lake buoy wears the same floater the player bought for the bench
    this.buoyRing = makeLifebuoy();
    const ringGrp = this.buoyRing.group;
    ringGrp.position.y = 0.12;
    buoy.add(ringGrp);
    // the line ties straight off the ring's bow edge
    this.lineAnchor = new THREE.Object3D();
    this.lineAnchor.position.set(0, 0.4, 0.8);
    buoy.add(this.lineAnchor);
    this.buoyPhase = Math.random() * 10;

    // UI
    this.el = document.getElementById("fishing-ui");

    // fake pendulum state for the line/hook swing
    this.swingAng = 0;
    this.swingVel = 0;
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

    // No floor of our own: the ground down here is the lake bed of the real
    // terrain mesh (src/terrain.js), which now carries the bowl all the way up
    // to the beach. The dressing below just gets seated onto it in start().
    this.dressing = [];
    const pebbleMat = new THREE.MeshStandardMaterial({ color: 0x8f9aa3, flatShading: true });
    for (let i = 0; i < 10; i++) {
      const p = new THREE.Mesh(new THREE.SphereGeometry(0.2 + Math.random() * 0.3, 6, 5), pebbleMat);
      const a = Math.random() * Math.PI * 2;
      const r = 3 + Math.random() * 12;
      p.position.set(Math.cos(a) * r, 0, Math.sin(a) * r);
      p.userData.sit = 0.12;
      p.scale.y = 0.6;
      g.add(p);
      this.dressing.push(p);
    }

    // seaweed (swayed in update)
    this.weeds = [];
    const weedMat = new THREE.MeshStandardMaterial({ color: 0x2e7d4f, flatShading: true });
    for (let i = 0; i < 7; i++) {
      const h = 2.6 + Math.random() * 2;
      const w = new THREE.Mesh(new THREE.ConeGeometry(0.22, h, 5), weedMat);
      const a = Math.random() * Math.PI * 2;
      const r = 4.5 + Math.random() * 9;
      w.position.set(Math.cos(a) * r, 0, Math.sin(a) * r);
      w.userData.sit = h / 2;
      w.userData.phase = Math.random() * 10;
      g.add(w);
      this.weeds.push(w);
      this.dressing.push(w);
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

    // fish school — the three sculpted species (src/fish.js), twice over
    this.fish = [];
    for (let i = 0; i < 6; i++) {
      const f = makeFish(i);
      const len = 1.7 + Math.random() * 0.9; // the models are baked to unit length
      f.scale.setScalar(len);
      g.add(f);
      this.fish.push({
        mesh: f,
        y: 2.6 + i * 1.35 + Math.random() * 0.5, // stacked lanes between rock and surface
        xr: 5.5 + Math.random() * 2.5,
        speed: (1.6 + Math.random() * 1.6) * (Math.random() < 0.5 ? 1 : -1),
        phase: Math.random() * 10,
        // a few degrees off the flat side-on profile, so the sculpt reads as a
        // solid and the sideways half of the shader's wave shows on screen
        yaw: (0.2 + Math.random() * 0.22) * (Math.random() < 0.5 ? 1 : -1),
        // hook clearance follows what's actually drawn, so the big ones are
        // genuinely harder to thread than the little ones
        hx: len * 0.42,
        hy: len * 0.26,
        scare: 0,
      });
    }

    this._bubbleT = 0;
    this._tickY = 0;
  }

  /** dive in: the diorama sits on the real lake bed under the sink spot, so
   *  bank-side dives are quick grabs and mid-channel sinks are a long, fishy
   *  descent */
  start(spot, rock, onDone, blockers = [], mods = DEFAULT_MODS) {
    this.active = true;
    this.onDone = onDone;
    this.rock = rock;
    this.mods = mods; // fishing upgrades: fewer fish, faster line, wider grab
    this.hits = 0;
    this.phase = "fall"; // fall -> drop -> reel
    spot = this._diveSpot(spot);
    this.depth = lakeDepthAt(spot.x, spot.z);
    this.floorY = -this.depth;
    // local, just under the surface — DIVE_MIN keeps the floor clear of it
    this.hookStart = Math.max(2.4, this.depth - 1.1);
    this._pickView(spot, blockers);
    this.group.position.set(spot.x, this.floorY, spot.z);
    this.group.rotation.y = this.camYaw; // face the diorama at the camera
    this.group.visible = true;

    // buoy bobs on the surface above, just past the rock; the line drops from
    // its bow edge, which faces the camera along with the rest of the diorama
    this.buoy.position.set(this._worldX(0, -0.9), WATER_Y, this._worldZ(0, -0.9));
    this.buoy.rotation.set(0, this.camYaw, 0);
    this.buoy.visible = true;

    // sit the pebbles and weeds on the bed where they actually stand, so they
    // follow the slope of the terrain instead of hovering at the spot's depth
    for (const d of this.dressing) {
      const wy = bedHeightAt(this._worldX(d.position.x, d.position.z), this._worldZ(d.position.x, d.position.z));
      d.position.y = wy - this.floorY + d.userData.sit;
    }

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
    this.prevHookX = 0;

    // deeper water = more fish in the gauntlet, lanes squeezed to the depth.
    // Fish Repellent thins the crowd; it can clear the water completely in the
    // shallows, which is exactly what 190 shells ought to buy you.
    const active = Math.max(0, Math.min(this.fish.length, Math.round(this.depth / 2.2) - this.mods.fishFewer));
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
  }

  /** camera pose for main's "fishing" mode — aquarium side view, framed to depth */
  getCamPose() {
    const p = this.group.position;
    const d = this.depth ?? 10;
    return {
      pos: new THREE.Vector3(p.x + this._sin * this.camDist, this.floorY + d * 0.42 + 1.2, p.z + this._cos * this.camDist),
      look: new THREE.Vector3(p.x, this.floorY + d * 0.38, p.z),
    };
  }

  /**
   * Where to stage the dive. A stone can settle in the shallows against a bank,
   * where there is no water column to fish in, so let the spot roll downhill
   * along the bed until it has DIVE_MIN of water over it. The camera cuts, so
   * the few metres it travels are never seen.
   */
  _diveSpot(spot) {
    const p = { x: spot.x, z: spot.z };
    const step = 1.5;
    for (let i = 0; i < 24 && -bedHeightAt(p.x, p.z) < DIVE_MIN; i++) {
      const gx = bedHeightAt(p.x + step, p.z) - bedHeightAt(p.x - step, p.z);
      const gz = bedHeightAt(p.x, p.z + step) - bedHeightAt(p.x, p.z - step);
      const l = Math.hypot(gx, gz);
      if (l < 1e-4) break;
      p.x -= (gx / l) * step;
      p.z -= (gz / l) * step;
    }
    return p;
  }

  /** diorama-local x/z offset -> world, honouring the view yaw */
  _worldX(lx, lz) { return this.group.position.x + lx * this._cos + lz * this._sin; }
  _worldZ(lx, lz) { return this.group.position.z - lx * this._sin + lz * this._cos; }

  /**
   * Pick the azimuth (and how close to sit) for the dive camera. The lake bed is
   * a bowl barely wider than the fairway, so the old fixed +Z view often sank
   * into the bank or wedged a spire in front of the rock. Score a ring of
   * candidate views on how far the sightline clears the bed and the outcrops,
   * with a nudge back toward the default so the framing stays familiar.
   * `blockers`: [{x, z, r}] world-space cylinders (the hole's rock outcrops).
   */
  _pickView(spot, blockers) {
    const d = this.depth;
    const baseDist = 7.5 + d * 0.55;
    const camY = this.floorY + d * 0.42 + 1.2;
    // the strictest sightline is the one to the rock sitting on the bed — the
    // bowl rising toward the shore is what buries the view, not the spires
    const rockY = this.floorY + ROCK_Y + 0.8;
    let bestCost = Infinity;
    for (let i = 0; i < VIEW_YAWS; i++) {
      // signed yaw in (-PI, PI] so the turn-away penalty is symmetric
      const yaw = ((i / VIEW_YAWS) * Math.PI * 2 + Math.PI) % (Math.PI * 2) - Math.PI;
      const s = Math.sin(yaw), c = Math.cos(yaw);
      for (const pull of VIEW_PULLINS) {
        const dist = baseDist * pull;
        let cost = Math.abs(yaw) * 0.5 + (1 - pull) * 5;
        // does the line of sight graze the ground on its way out? (terrain, not
        // the smooth bowl: the shoreline wobbles and the banks carry hills)
        for (let k = 2; k <= 10; k++) {
          const t = k / 10;
          const groundY = terrainHeightAt(spot.x + s * dist * t, spot.z + c * dist * t);
          const buried = groundY + SIGHT_CLEARANCE - (rockY + (camY - rockY) * t);
          if (buried > 0) cost += buried * 4;
        }
        // ...or run through an outcrop?
        for (const b of blockers) {
          const along = ((b.x - spot.x) * s + (b.z - spot.z) * c) / dist;
          if (along < 0.02 || along > 1.15) continue;
          const perp = Math.hypot(b.x - (spot.x + s * dist * along), b.z - (spot.z + c * dist * along));
          const overlap = b.r + 2.2 - perp;
          if (overlap > 0) cost += 8 + overlap * 4;
        }
        if (cost < bestCost) {
          bestCost = cost;
          this.camYaw = yaw;
          this.camDist = dist;
        }
      }
    }
    this._sin = Math.sin(this.camYaw);
    this._cos = Math.cos(this.camYaw);
  }

  /** pointerX01: pointer x in [0,1] across the screen */
  update(dt, elapsed, pointerX01 = 0.5) {
    // the buoy rides the real wave field whether we're fishing or it's
    // parked as the player's lie after a catch — inflatables bob lively
    if (this.buoy.visible) {
      const bp = this.buoy.position;
      bp.y = WATER_Y + this.water.heightAt(bp.x, bp.z, elapsed);
      this.buoy.rotation.z = Math.sin(elapsed * 1.1 + this.buoyPhase) * 0.06;
      this.buoy.rotation.x = Math.cos(elapsed * 1.4 + this.buoyPhase) * 0.05;
    }
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
      const bx = (Math.random() - 0.5) * 14, bz = (Math.random() - 0.5) * 4;
      this.particles.glow.emit(
        this._worldX(bx, bz), this.floorY + 0.5 + Math.random() * 3, this._worldZ(bx, bz),
        0, 1.2 + Math.random(), 0, 1.5 + Math.random(), 2 + Math.random() * 2,
        0.65, 0.85, 1.0, -1.2, 0.4
      );
    }

    // fish patrol their lanes — the tail beat itself lives in the vertex shader
    updateFishWave(elapsed);
    for (const f of this.fish) {
      const boost = 1 + f.scare * 2.5;
      f.scare = Math.max(0, f.scare - dt);
      f.mesh.position.x += f.speed * boost * dt;
      if (Math.abs(f.mesh.position.x) > f.xr) {
        f.mesh.position.x = Math.sign(f.mesh.position.x) * f.xr;
        f.speed *= -1;
      }
      f.mesh.position.y = f.y + Math.sin(elapsed * 2 + f.phase) * 0.22;
      f.mesh.rotation.y = (f.speed > 0 ? 0 : Math.PI) + f.yaw;
      // nose angles into the climb and fall of its own bob (z pitches the nose
      // whichever way the fish is facing, so this needs no mirroring)
      f.mesh.rotation.z = Math.cos(elapsed * 2 + f.phase) * 0.13;
    }

    // ---- intro: the stone rocks gently down to the bed, then the line drops in
    if (this.phase === "fall") {
      const fallSpeed = Math.max(2, this.depth / 2.4);
      this.fallY = Math.max(ROCK_Y, this.fallY - fallSpeed * dt);
      const wp = this.group.position;
      const sway = Math.sin(elapsed * 2.1 + this.fallPhase) * 0.35;
      this.rock.group.position.set(
        this._worldX(sway, 0),
        this.floorY + this.fallY,
        this._worldZ(sway, 0)
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
        // face the camera, so the reel-in roll reads as a screen-plane swing
        this.rock.group.rotation.set(0, this.camYaw, 0);
        this.rock.squashKick?.(0.8);
        this.rock.kickEyes(1.2);
        this.hook.visible = true;
        this.lineMesh.visible = true;
        this.hookY = this.hookStart;
        this._tickY = this.hookStart;
        // lay the rope straight from the buoy's bow before the verlet sim takes over
        const tip = this._lineTopLocal();
        const botY = this.hookStart + 0.45;
        this.ropePts.forEach((p, i) => {
          const t = i / (this.ropeN - 1);
          p.x = p.px = tip.x * (1 - t);
          p.y = p.py = tip.y + (botY - tip.y) * t;
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
      this.hookY -= HOOK_SPEED * this.mods.hookSpeedMul * dt;
      if (this.hookY < this._tickY) {
        this._tickY = this.hookY - 0.5;
        audio.reelTick();
      }

      // fish collisions shove the hook back up (tested against the SWUNG position)
      for (const f of this.fish) {
        const dx = f.mesh.position.x - dispX;
        const dy = f.mesh.position.y - this.hookY;
        if (Math.abs(dx) < f.hx && Math.abs(dy) < f.hy) {
          this.hits++;
          this.hookY = Math.min(this.hookStart, this.hookY + this.mods.fishBump);
          this._tickY = this.hookY;
          f.scare = 1.4;
          f.speed = Math.abs(f.speed) * Math.sign(dx || 1); // dart away from the hook
          this.swingVel += (Math.random() - 0.5) * 8; // the bump sets the line swinging
          audio.fishMiss();
          this.rock.kickEyes(1);
          this.particles.glow.emit(
            this._worldX(dispX, 0), this.floorY + this.hookY, this._worldZ(dispX, 0),
            dx * 2 * this._cos, 1, dx * -2 * this._sin,
            0.4, 5, 1.0, 0.6, 0.3, 2, 1);
        }
      }

      // reached the rock?
      if (this.hookY <= ROCK_Y + 0.55) {
        if (Math.abs(dispX) < this.mods.catchWidth) {
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
        this._worldX(dispX, 0),
        this.floorY + this.hookY - 0.5,
        this._worldZ(dispX, 0)
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

    // hook transform + verlet rope between the buoy's bow and the hook
    this.hook.position.set(dispX, this.hookY, 0);
    this.hook.rotation.z = this.swingAng * 1.25;
    const tip = this._lineTopLocal();
    this._updateRope(Math.min(dt, 1 / 30), dispX, tip.x, tip.y);
  }

  /** the line's tie-off point in diorama-local coords (the rope's 2D x/y plane) */
  _lineTopLocal() {
    this.lineAnchor.getWorldPosition(_tip);
    this.group.worldToLocal(_tip); // the diorama is yawed at the camera
    return { x: _tip.x, y: _tip.y };
  }

  _updateRope(dt, dispX, topX, topY) {
    const pts = this.ropePts;
    const n = this.ropeN;
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
    // (rotating +Y by θ gives (-sinθ, cosθ), so θ = atan2(-dx, dy))
    for (let i = 0; i < n - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      const dx = b.x - a.x, dy = b.y - a.y;
      const len = Math.max(0.02, Math.hypot(dx, dy));
      const seg = this.ropeSegs[i];
      seg.scale.y = len * 1.06; // slight overlap hides the joints
      seg.position.set((a.x + b.x) / 2, (a.y + b.y) / 2, 0);
      seg.rotation.z = Math.atan2(-dx, dy);
    }
  }

  _finish(clean) {
    this.active = false;
    this.group.visible = false;
    this.el.classList.add("hidden");
    // hand the rock back to the game (main repositions it via placeAt);
    // the buoy stays out — main parks it under the new lie
    this.onDone?.(clean, this.hits);
  }

  /** after the catch the buoy drifts under the drop spot and becomes the lie */
  parkBuoy(x, z) {
    this.buoy.position.x = x;
    this.buoy.position.z = z;
  }

  hideBuoy() {
    this.buoy.visible = false;
  }

  /** abort without result (hole was decided while we fished) */
  cancel() {
    if (!this.active) return;
    this.active = false;
    this.group.visible = false;
    this.buoy.visible = false;
    this.el.classList.add("hidden");
  }
}

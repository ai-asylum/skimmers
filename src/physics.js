/**
 * The skip simulation. One Skimmer per racer (human and bots run the exact
 * same code — ghost-matchmaking spirit: rivals play through identical systems).
 *
 * A throw is ballistic; on water contact the entry angle + speed + rock
 * flatness decide: SKIP (shallow + fast), SETTLE (slow), or SINK (steep).
 * Flat, fast throws chain hops. Splash lobs detonate on impact and knock
 * rival stones under. simulateThrow() runs the identical step for the
 * aiming preview, so the dots never lie.
 */
import * as THREE from "three";
import { LAKE_R, WATER_Y } from "./water.js";

export const GRAVITY = 14;
export const MAX_SPEED = 27;
export const SKIP_ELEV = 0.16; // radians above horizontal for a skip throw
export const LOB_ELEV = 0.92; // radians for a splash lob
export const BLAST_R = 2.6; // splash lob knock radius

const _tmp = new THREE.Vector3();

/** cylinder test against a hole's big rock outcrops */
function hitOutcrop(pos, rocks) {
  for (const o of rocks) {
    const dx = pos.x - o.x, dz = pos.z - o.z;
    const d = Math.hypot(dx, dz);
    if (d < o.r && pos.y < o.h) {
      return { o, nx: dx / (d || 1), nz: dz / (d || 1) };
    }
  }
  return null;
}

export class Skimmer {
  constructor(rock, name, isPlayer = false, tint = "#ffd24a") {
    this.rock = rock; // Rock instance (owns the mesh)
    this.name = name;
    this.isPlayer = isPlayer;
    this.tint = tint;

    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.state = "resting"; // resting | flying | sinking | fishing | beached | onboat | done
    this.skips = 0; // hops in the current throw
    this.bestCombo = 0;
    this.throws = 0; // this hole
    this.totalThrows = 0;
    this.holesWon = 0;
    this.finished = false; // reached flag this hole
    this.spin = 0;
    this.boat = null; // riding a boat
    this.boatLocal = new THREE.Vector3();
    this.lastThrowMode = "skip";
    this.sinkT = 0;
    this.bobPhase = Math.random() * 10;
    this.knocked = false; // sunk because a rival splashed us
    this.onEvent = null; // (type, data) => {}
    // networking
    this.isRemote = false; // driven by snapshots, not local physics
    this.netId = -1;
    this.netTarget = null; // latest snapshot [x, y, z, ry]
    // flight recorder for the killcam (ring buffer of the last ~2.5s)
    this.tape = [];
    this.tapeSkips = [];
  }

  get mesh() { return this.rock.group; }

  placeAt(x, z) {
    this.pos.set(x, WATER_Y + 0.1, z);
    this.vel.set(0, 0, 0);
    this.state = "resting";
    this.boat = null;
    this.mesh.position.copy(this.pos);
  }

  resetHole(teeX, teeZ, spread = 3) {
    const a = Math.random() * Math.PI * 2;
    this.placeAt(teeX + Math.cos(a) * spread * Math.random(), teeZ + Math.sin(a) * spread * Math.random());
    this.throws = 0;
    this.skips = 0;
    this.finished = false;
    this.knocked = false;
    this.state = "resting";
  }

  _emit(type, data) { this.onEvent?.(type, { skimmer: this, ...data }); }

  /** launch from current rest position. dirXZ is a normalized horizontal aim. */
  throwRock(dirXZ, power, mode = "skip") {
    if (this.state !== "resting" && this.state !== "beached" && this.state !== "onboat") return false;
    if (this.boat) { this.boat = null; } // leaving the ferry
    const elev = mode === "skip" ? SKIP_ELEV + 0.10 * (1 - power) : LOB_ELEV;
    const speed = MAX_SPEED * (0.28 + 0.72 * power) * (mode === "skip" ? 1 : 0.68);
    const cosE = Math.cos(elev), sinE = Math.sin(elev);
    this.vel.set(dirXZ.x * cosE * speed, sinE * speed, dirXZ.z * cosE * speed);
    this.pos.y = WATER_Y + 0.5;
    this.state = "flying";
    this.skips = 0;
    this.throws++;
    this.totalThrows++;
    this.spin = 14 + power * 22;
    this.lastThrowMode = mode;
    this.rock.kickEyes(1.2);
    this.rock.squashKick?.(0.5);
    this.tape = [];
    this.tapeSkips = [];
    this._emit("throw", { power, mode });
    return true;
  }

  /** advance the sim. ctx: { dt, elapsed, water, boats, others, flagPos, captureR } */
  step(ctx) {
    const { dt, elapsed, water } = ctx;
    const rockH = 0.18;

    switch (this.state) {
      case "flying": {
        this.vel.y -= GRAVITY * dt;
        this.pos.addScaledVector(this.vel, dt);
        this.spin = Math.max(2, this.spin - dt * 6);

        // big rock outcrops wall off the direct line — CLONK and drop
        if (ctx.rocks) {
          const hit = hitOutcrop(this.pos, ctx.rocks);
          if (hit) {
            const { o, nx, nz } = hit;
            this.pos.x = o.x + nx * o.r;
            this.pos.z = o.z + nz * o.r;
            const dot = this.vel.x * nx + this.vel.z * nz;
            if (dot < 0) {
              this.vel.x -= 2 * dot * nx;
              this.vel.z -= 2 * dot * nz;
            }
            this.vel.x *= 0.4;
            this.vel.z *= 0.4;
            this.vel.y = Math.min(this.vel.y * 0.4, 1.5);
            this.skips = Math.max(this.skips, 1); // a clonk breaks the chain
            this.rock.kickEyes(2);
            this.rock.squashKick?.(1.1);
            this._emit("clonk", { at: this.pos.clone() });
          }
        }

        // killcam tape
        this.tape.push({ x: this.pos.x, y: this.pos.y, z: this.pos.z, ry: this.mesh.rotation.y });
        if (this.tape.length > 160) {
          this.tape.shift();
          this.tapeSkips = this.tapeSkips.map((i) => i - 1).filter((i) => i >= 0);
        }

        // boat collision
        if (ctx.boats) {
          const hit = ctx.boats.collide(this.pos, this.vel, 0.45);
          if (hit?.type === "hull") {
            // thunk off the side
            const n = hit.normal;
            const d = this.vel.dot(n);
            if (d < 0) this.vel.addScaledVector(n, -1.7 * d);
            this.vel.multiplyScalar(0.55);
            this._emit("boatThunk", { at: this.pos.clone() });
          } else if (hit?.type === "deck" && this.vel.y < 0) {
            // landed on the deck — ride the ferry!
            this.state = "onboat";
            this.boat = hit.boat;
            this.boatLocal.copy(hit.boat.worldToLocal(this.pos.clone()));
            this.boatLocal.y = hit.deckY;
            this.vel.set(0, 0, 0);
            this.rock.squashKick?.(0.9);
            this._emit("deckLand", { at: this.pos.clone() });
            break;
          }
        }

        // splash-lob mid-air proximity hit on a rival (direct bonk)
        if (ctx.others) {
          for (const o of ctx.others) {
            if (o === this || o.finished) continue;
            if ((o.state === "resting" || o.state === "beached") &&
                this.pos.distanceTo(o.pos) < 0.9 && this.vel.lengthSq() > 9) {
              this._knockRival(o, ctx);
            }
          }
        }

        // island rest stop — dry land mid-lake, no fishing required
        if (ctx.islands) {
          let landed = false;
          for (const isl of ctx.islands) {
            const d = Math.hypot(this.pos.x - isl.x, this.pos.z - isl.z);
            if (d < isl.r * 0.85 && this.pos.y <= 0.55 && this.vel.y < 0) {
              this.pos.y = 0.45;
              this.vel.set(0, 0, 0);
              this.state = "beached";
              this.rock.squashKick?.(0.9);
              this._emit("island", { at: this.pos.clone() });
              landed = true;
              break;
            }
          }
          if (landed) break;
        }

        // beached on the shore?
        const r = Math.hypot(this.pos.x, this.pos.z);
        if (r > LAKE_R - 1.2 && this.pos.y < WATER_Y + 1.2) {
          _tmp.set(this.pos.x, 0, this.pos.z).setLength(LAKE_R - 1.5);
          this.pos.x = _tmp.x; this.pos.z = _tmp.z;
          this.pos.y = WATER_Y + 0.15;
          this.vel.set(0, 0, 0);
          this.state = "beached";
          this._emit("beach", { at: this.pos.clone() });
          break;
        }

        // water contact
        const waterY = WATER_Y + water.heightAt(this.pos.x, this.pos.z, elapsed);
        if (this.pos.y <= waterY + rockH && this.vel.y < 0) {
          this._waterContact(ctx, waterY);
        }
        break;
      }

      case "onboat": {
        if (this.boat) {
          this.pos.copy(this.boat.localToWorld(this.boatLocal.clone()));
        }
        break;
      }

      case "sinking": {
        this.sinkT += dt;
        this.pos.y -= dt * (1.2 + this.rock.heft * 1.6);
        this.vel.multiplyScalar(1 - 2.5 * dt);
        this.pos.addScaledVector(this.vel, dt);
        break;
      }

      case "resting": {
        // bob on the waves
        const wy = WATER_Y + water.heightAt(this.pos.x, this.pos.z, elapsed);
        this.pos.y = wy + 0.06 + Math.sin(elapsed * 2 + this.bobPhase) * 0.02;
        break;
      }

      case "beached":
        break;
    }

    // visual transform
    const m = this.mesh;
    m.position.copy(this.pos);
    if (this.state === "flying") {
      m.rotation.y -= this.spin * dt;
      m.rotation.z = THREE.MathUtils.lerp(m.rotation.z, -0.12, 0.1);
    } else if (this.state === "resting" || this.state === "beached" || this.state === "onboat") {
      m.rotation.z = THREE.MathUtils.lerp(m.rotation.z, 0, 5 * dt);
      m.rotation.x = THREE.MathUtils.lerp(m.rotation.x, 0, 5 * dt);
      // face travel direction is irrelevant at rest; slow lazy turn
      m.rotation.y += dt * 0.15;
    } else if (this.state === "sinking") {
      m.rotation.x += dt * 2.2;
    }
    this.rock.update(dt);
  }

  _waterContact(ctx, waterY) {
    const hSpeed = Math.hypot(this.vel.x, this.vel.z);
    const angle = Math.atan2(-this.vel.y, Math.max(0.001, hSpeed));
    const flat = this.rock.flat;
    const heft = this.rock.heft;

    // splash lob: detonate on contact
    if (this.lastThrowMode === "splash") {
      this._emit("blast", { at: this.pos.clone() });
      let victims = 0;
      if (ctx.others) {
        for (const o of ctx.others) {
          if (o === this || o.finished) continue;
          if ((o.state === "resting" || o.state === "beached") && this.pos.distanceTo(o.pos) < BLAST_R) {
            this._knockRival(o, ctx);
            victims++;
          }
        }
      }
      // your stone settles where it detonated (lobs never sink you)
      this.pos.y = waterY + 0.06;
      this.vel.set(0, 0, 0);
      this.state = "resting";
      this._emit("settle", { at: this.pos.clone(), victims });
      this._checkFlag(ctx, true);
      return;
    }

    const critAngle = 0.30 + flat * 0.30; // ~17°..34°
    const minSkipSpeed = 5.6 - flat * 1.8;

    if (angle < critAngle && hSpeed > minSkipSpeed) {
      // SKIP — reflect with restitution, bleed horizontal speed
      this.skips++;
      this.bestCombo = Math.max(this.bestCombo, this.skips);
      const rest = 0.5 + flat * 0.22;
      this.vel.y = Math.max(-this.vel.y * rest, 1.15 + hSpeed * 0.045);
      const keep = 0.845 + heft * 0.05 - (angle / critAngle) * 0.05;
      this.vel.x *= keep;
      this.vel.z *= keep;
      this.pos.y = waterY + 0.19;
      this.rock.kickEyes(0.8);
      this.rock.squashKick?.(0.8 + Math.min(0.6, hSpeed / 30));
      this.tapeSkips.push(this.tape.length - 1);
      this._emit("skip", { at: this.pos.clone(), n: this.skips, speed: hSpeed });
      this._checkFlag(ctx, false);
    } else if (hSpeed <= Math.max(2.6, minSkipSpeed * 0.75) && angle < 0.9) {
      // ran out of steam — settle and float
      this.pos.y = waterY + 0.06;
      this.vel.set(0, 0, 0);
      this.state = "resting";
      this.rock.squashKick?.(0.45);
      this._emit("settle", { at: this.pos.clone() });
      this._checkFlag(ctx, true);
    } else {
      // too steep, too heavy — GLUB
      this.state = "sinking";
      this.sinkT = 0;
      this.vel.multiplyScalar(0.2);
      this.vel.y = -1;
      this._emit("sink", { at: this.pos.clone(), knocked: false });
    }
  }

  _knockRival(victim, ctx) {
    if (victim.state === "sinking" || victim.state === "fishing") return;
    if (victim.isRemote) {
      // their client owns the physics — we just fire the juice + let main
      // relay a knock message to the victim
      victim.rock.kickEyes(2.5);
      this._emit("splashHit", { victim, at: victim.pos.clone() });
      return;
    }
    victim.applyKnock(this.pos);
    this._emit("splashHit", { victim, at: victim.pos.clone() });
  }

  /** get punted by a splash blast (local or via network) */
  applyKnock(fromPos) {
    if (this.state === "sinking" || this.state === "fishing") return;
    _tmp.subVectors(this.pos, fromPos);
    _tmp.y = 0;
    if (_tmp.lengthSq() < 0.01) _tmp.set(1, 0, 0);
    _tmp.normalize();
    this.vel.set(_tmp.x * 6, 4.5, _tmp.z * 6);
    this.pos.y += 0.3;
    this.state = "flying"; // brief tumble...
    this.knocked = true; // ...then _waterContact turns steep entry into a sink
    this.lastThrowMode = "knocked";
    this.skips = 99; // ensure no skip credit
    this.rock.kickEyes(2.5);
    this._forceSink = true;
  }

  _checkFlag(ctx, atRest) {
    if (this.finished || !ctx.flagPos) return;
    const d = Math.hypot(this.pos.x - ctx.flagPos.x, this.pos.z - ctx.flagPos.z);
    if (d < ctx.captureR) {
      this.finished = true;
      // park the stone by the flag
      this.state = "resting";
      this.vel.set(0, 0, 0);
      this._emit("flag", { at: this.pos.clone() });
    }
  }

  distToFlag(flagPos) {
    return Math.hypot(this.pos.x - flagPos.x, this.pos.z - flagPos.z);
  }
}

// patch: forced sinks from knocks override the skip check
const origWaterContact = Skimmer.prototype._waterContact;
Skimmer.prototype._waterContact = function (ctx, waterY) {
  if (this._forceSink) {
    this._forceSink = false;
    this.state = "sinking";
    this.sinkT = 0;
    this.vel.multiplyScalar(0.2);
    this.vel.y = -1;
    this._emit("sink", { at: this.pos.clone(), knocked: true });
    return;
  }
  origWaterContact.call(this, ctx, waterY);
};

/**
 * Dry-run a throw with the same maths for the aim preview.
 * Returns { points: Vector3[], skips: Vector3[], end: 'rest'|'sink'|'flying' }.
 */
export function simulateThrow(startPos, dirXZ, power, mode, rock, water, elapsed, maxT = 6, islands = null, rocks = null) {
  const s = {
    pos: startPos.clone(),
    vel: new THREE.Vector3(),
  };
  const elev = mode === "skip" ? SKIP_ELEV + 0.10 * (1 - power) : LOB_ELEV;
  const speed = MAX_SPEED * (0.28 + 0.72 * power) * (mode === "skip" ? 1 : 0.68);
  s.vel.set(dirXZ.x * Math.cos(elev) * speed, Math.sin(elev) * speed, dirXZ.z * Math.cos(elev) * speed);
  s.pos.y = WATER_Y + 0.5;

  const flat = rock.flat, heft = rock.heft;
  const points = [];
  const skips = [];
  let end = "flying";
  const dt = 1 / 60;
  let skipCount = 0;
  for (let t = 0; t < maxT; t += dt) {
    s.vel.y -= GRAVITY * dt;
    s.pos.addScaledVector(s.vel, dt);
    if ((points.length === 0) || t % (dt * 3) < dt) points.push(s.pos.clone());
    if (rocks) {
      const hit = hitOutcrop(s.pos, rocks);
      if (hit) {
        // preview shows the clonk honestly: reflect, damp, keep simulating
        const { o, nx, nz } = hit;
        s.pos.x = o.x + nx * o.r;
        s.pos.z = o.z + nz * o.r;
        const dot = s.vel.x * nx + s.vel.z * nz;
        if (dot < 0) { s.vel.x -= 2 * dot * nx; s.vel.z -= 2 * dot * nz; }
        s.vel.x *= 0.4; s.vel.z *= 0.4;
        s.vel.y = Math.min(s.vel.y * 0.4, 1.5);
        skips.push(s.pos.clone());
      }
    }
    if (islands) {
      let hitIsl = false;
      for (const isl of islands) {
        if (Math.hypot(s.pos.x - isl.x, s.pos.z - isl.z) < isl.r * 0.85 && s.pos.y <= 0.55 && s.vel.y < 0) {
          hitIsl = true;
          break;
        }
      }
      if (hitIsl) { end = "island"; points.push(s.pos.clone()); break; }
    }
    const r = Math.hypot(s.pos.x, s.pos.z);
    if (r > LAKE_R - 1.2) { end = "beach"; break; }
    const wy = WATER_Y + water.heightAt(s.pos.x, s.pos.z, elapsed);
    if (s.pos.y <= wy + 0.18 && s.vel.y < 0) {
      const hSpeed = Math.hypot(s.vel.x, s.vel.z);
      const angle = Math.atan2(-s.vel.y, Math.max(0.001, hSpeed));
      if (mode === "splash") { end = "blast"; skips.push(s.pos.clone()); break; }
      const critAngle = 0.30 + flat * 0.30;
      const minSkipSpeed = 5.6 - flat * 1.8;
      if (angle < critAngle && hSpeed > minSkipSpeed) {
        skipCount++;
        skips.push(s.pos.clone());
        const rest = 0.5 + flat * 0.22;
        s.vel.y = Math.max(-s.vel.y * rest, 1.15 + hSpeed * 0.045);
        const keep = 0.845 + heft * 0.05 - (angle / critAngle) * 0.05;
        s.vel.x *= keep; s.vel.z *= keep;
        s.pos.y = wy + 0.19;
        if (skipCount > 14) { end = "rest"; break; }
      } else if (hSpeed <= Math.max(2.6, minSkipSpeed * 0.75) && angle < 0.9) {
        end = "rest";
        points.push(s.pos.clone());
        break;
      } else {
        end = "sink";
        points.push(s.pos.clone());
        break;
      }
    }
  }
  return { points, skips, end };
}

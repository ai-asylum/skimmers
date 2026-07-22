/**
 * Row boats: moving checkpoints and hazards. Each boat rides a closed
 * Catmull-Rom loop across the lake (team scrap: arc-length-parameterized
 * journey spline, simplified to curve.getPointAt), rowed by a little
 * cartoon oarsman whose strokes dip ripples into the water.
 *
 * collide() classifies a flying rock's contact: "hull" (bounce off the side)
 * or "deck" (land in the boat and get ferried — a moving checkpoint!).
 */
import * as THREE from "three";
import { LAKE_R, WATER_Y } from "./water.js";

const HULL_LEN = 3.4, HULL_WID = 1.5, DECK_Y = 0.62;

function buildBoatMesh() {
  const g = new THREE.Group();
  const wood = new THREE.MeshStandardMaterial({ color: 0xa9682f, flatShading: true });
  const woodDark = new THREE.MeshStandardMaterial({ color: 0x7c4a1e, flatShading: true });

  // hull: stretched, bevelled box + prow cones
  const hull = new THREE.Mesh(new THREE.BoxGeometry(HULL_LEN, 0.7, HULL_WID), wood);
  hull.position.y = 0.35;
  g.add(hull);
  const inner = new THREE.Mesh(new THREE.BoxGeometry(HULL_LEN - 0.5, 0.5, HULL_WID - 0.45), woodDark);
  inner.position.y = 0.5;
  g.add(inner);
  for (const s of [-1, 1]) {
    const prow = new THREE.Mesh(new THREE.ConeGeometry(HULL_WID / 2, 1.1, 4), wood);
    prow.rotation.z = s * Math.PI / 2;
    prow.rotation.y = Math.PI / 4;
    prow.position.set(s * (HULL_LEN / 2 + 0.35), 0.35, 0);
    prow.scale.y = 1.4;
    g.add(prow);
  }
  // bench + rower
  const bench = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.12, HULL_WID - 0.4), woodDark);
  bench.position.y = 0.62;
  g.add(bench);
  const shirt = new THREE.MeshStandardMaterial({ color: 0xe0503a, flatShading: true });
  const skin = new THREE.MeshStandardMaterial({ color: 0xf2c49b, flatShading: true });
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.28, 0.4, 4, 8), shirt);
  body.position.y = 1.05;
  g.add(body);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 7), skin);
  head.position.y = 1.62;
  g.add(head);
  const hat = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.3, 0.16, 8), woodDark);
  hat.position.y = 1.78;
  g.add(hat);

  // oars (animated in update)
  const oarMat = new THREE.MeshStandardMaterial({ color: 0xdcb377, flatShading: true });
  const oars = [];
  for (const s of [-1, 1]) {
    const pivot = new THREE.Group();
    pivot.position.set(0, 0.75, s * (HULL_WID / 2 + 0.02));
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 2.0, 6), oarMat);
    shaft.rotation.x = s * Math.PI / 2.6;
    shaft.position.z = s * 0.8;
    shaft.position.y = -0.3;
    pivot.add(shaft);
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.05, 0.5), oarMat);
    blade.position.set(0, -1.05, s * 1.55);
    pivot.add(blade);
    g.add(pivot);
    oars.push({ pivot, side: s, blade });
  }
  g.userData.oars = oars;
  return g;
}

class Boat {
  constructor(scene, pathPoints, speed, phase) {
    this.group = buildBoatMesh();
    scene.add(this.group);
    this.curve = new THREE.CatmullRomCurve3(pathPoints, true, "centripetal", 0.6);
    this.speed = speed;
    this.len = this.curve.getLength();
    this.t = phase; // distance along the loop
    this.strokePhase = Math.random() * Math.PI * 2;
    this._lastDip = 0;
  }

  update(dt, elapsed, water, particles) {
    if (!Number.isFinite(this.t)) this.t = 0;
    this.t = (((this.t + this.speed * dt) % this.len) + this.len) % this.len;
    // clamp hard: getUtoTmapping goes NaN on u outside [0,1)
    const u = Math.min(0.999999, Math.max(0, this.t / this.len));
    const p = this.curve.getPointAt(u);
    const tan = this.curve.getTangentAt(u);
    this.group.position.set(p.x, WATER_Y + water.heightAt(p.x, p.z, elapsed) * 1.2, p.z);
    this.group.rotation.y = Math.atan2(-tan.z, tan.x);
    this.group.rotation.z = Math.sin(elapsed * 1.3 + this.strokePhase) * 0.04;

    // rowing animation + oar-dip ripples
    this.strokePhase += dt * 2.4;
    const stroke = Math.sin(this.strokePhase);
    for (const oar of this.group.userData.oars) {
      oar.pivot.rotation.x = stroke * 0.35 * oar.side;
      oar.pivot.rotation.y = Math.cos(this.strokePhase) * 0.4;
    }
    if (stroke > 0.92 && elapsed - this._lastDip > 1.2 && particles) {
      this._lastDip = elapsed;
      const side = new THREE.Vector3(-tan.z, 0, tan.x);
      for (const s of [-1, 1]) {
        particles.oarDip(p.x + side.x * s * 1.6, p.z + side.z * s * 1.6);
      }
    }
  }
}

export class Boats {
  constructor(scene) {
    this.boats = [];
    // three loops criss-crossing the fairway
    const mk = (n, rad, yJitter, cx, cz) => {
      const pts = [];
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        const r = rad * (0.75 + Math.sin(a * 2 + cz) * 0.22);
        pts.push(new THREE.Vector3(cx + Math.cos(a) * r, 0, cz + Math.sin(a) * r * 0.7));
      }
      return pts;
    };
    this.boats.push(new Boat(scene, mk(7, LAKE_R * 0.55, 0, 0, 8), 2.4, 0));
    this.boats.push(new Boat(scene, mk(6, LAKE_R * 0.42, 0, -12, -14), 3.1, 20));
    this.boats.push(new Boat(scene, mk(8, LAKE_R * 0.62, 0, 10, -4), 2.0, 45));
  }

  update(dt, elapsed, water, particles) {
    for (const b of this.boats) b.update(dt, elapsed, water, particles);
  }

  /**
   * Classify contact of a sphere (rock) with any boat.
   * Returns null, { type:"hull", normal } or { type:"deck", boat, deckY }.
   */
  collide(pos, vel, radius) {
    for (const b of this.boats) {
      const local = b.group.worldToLocal(pos.clone());
      const hx = HULL_LEN / 2 + radius, hy = 1.0, hz = HULL_WID / 2 + radius;
      if (Math.abs(local.x) > hx || Math.abs(local.z) > hz || local.y < -0.2 || local.y > hy + 0.6) continue;
      // above the open deck, coming down -> land inside
      if (local.y > DECK_Y - 0.15 && vel.y < 0 &&
          Math.abs(local.x) < HULL_LEN / 2 - 0.3 && Math.abs(local.z) < HULL_WID / 2 - 0.2) {
        return { type: "deck", boat: b.group, deckY: DECK_Y + 0.15 };
      }
      // otherwise bounce off the hull: push out along the dominant axis
      const px = hx - Math.abs(local.x);
      const pz = hz - Math.abs(local.z);
      const n = new THREE.Vector3();
      if (px < pz) n.set(Math.sign(local.x) || 1, 0, 0);
      else n.set(0, 0, Math.sign(local.z) || 1);
      n.applyQuaternion(b.group.quaternion);
      n.y = 0;
      n.normalize();
      return { type: "hull", normal: n };
    }
    return null;
  }
}

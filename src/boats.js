/**
 * Boats: moving checkpoints, hazards — and BUMPERS. Three types share the
 * spline-loop movement (team scrap: arc-length-parameterized journey spline):
 *
 *   row   — the classic oarsman, medium pace, oar-dip ripples
 *   sail  — lean and quick, heeling with a fluttering sail
 *   steam — a slow fat tug with a puffing smokestack
 *
 * collide() classifies a flying rock's contact: "hull" (elastic rebound —
 * bank shots keep your skip chain alive) or "deck" (land in the boat and
 * get ferried).
 */
import * as THREE from "three";
import { LAKE_R, WATER_Y } from "./water.js";

const HULL_TOP = 0.7; // top of the bare hull sides

// `decks` are the standable surfaces along local x — a stone coming down onto
// one is caught and ferried. `blocks` are solid with nothing to stand on (the
// tug's smokestack): those just clang. Everything above both is open sky.
const TYPES = {
  row: { len: 3.4, wid: 1.5, deckY: 0.62 },
  sail: { len: 4.4, wid: 1.6, deckY: 0.68 },
  steam: {
    len: 5.4, wid: 2.3, deckY: 0.9,
    decks: [
      { x0: -2.7, x1: -1.6, y: 0.9 },   // aft deck
      { x0: -1.6, x1: 0.4, y: 1.84 },   // cabin roof
      { x0: 1.35, x1: 2.7, y: 0.9 },    // foredeck, past the smokestack
    ],
    blocks: [{ x0: 0.4, x1: 1.35, top: 2.28 }], // smokestack + its brass rim
  },
};

const wood = new THREE.MeshStandardMaterial({ color: 0xa9682f, flatShading: true });
const woodDark = new THREE.MeshStandardMaterial({ color: 0x7c4a1e, flatShading: true });
const canvasMat = new THREE.MeshStandardMaterial({ color: 0xf4efe2, flatShading: true, side: THREE.DoubleSide });
const skin = new THREE.MeshStandardMaterial({ color: 0xf2c49b, flatShading: true });

function buildHull(len, wid, color = wood) {
  const g = new THREE.Group();
  const hull = new THREE.Mesh(new THREE.BoxGeometry(len, 0.7, wid), color);
  hull.position.y = 0.35;
  g.add(hull);
  const inner = new THREE.Mesh(new THREE.BoxGeometry(len - 0.5, 0.5, wid - 0.45), woodDark);
  inner.position.y = 0.5;
  g.add(inner);
  for (const s of [-1, 1]) {
    const prow = new THREE.Mesh(new THREE.ConeGeometry(wid / 2, 1.1, 4), color);
    prow.rotation.z = s * Math.PI / 2;
    prow.rotation.y = Math.PI / 4;
    prow.position.set(s * (len / 2 + 0.35), 0.35, 0);
    prow.scale.y = 1.4;
    g.add(prow);
  }
  return g;
}

function addCrew(g, shirtColor, x = 0) {
  const shirt = new THREE.MeshStandardMaterial({ color: shirtColor, flatShading: true });
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.28, 0.4, 4, 8), shirt);
  body.position.set(x, 1.05, 0);
  g.add(body);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 7), skin);
  head.position.set(x, 1.62, 0);
  g.add(head);
  const hat = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.3, 0.16, 8), woodDark);
  hat.position.set(x, 1.78, 0);
  g.add(hat);
}

function buildBoatMesh(type) {
  const dims = TYPES[type];
  const g = new THREE.Group();

  if (type === "row") {
    g.add(buildHull(dims.len, dims.wid));
    const bench = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.12, dims.wid - 0.4), woodDark);
    bench.position.y = 0.62;
    g.add(bench);
    addCrew(g, 0xe0503a);
    const oarMat = new THREE.MeshStandardMaterial({ color: 0xdcb377, flatShading: true });
    const oars = [];
    for (const s of [-1, 1]) {
      const pivot = new THREE.Group();
      pivot.position.set(0, 0.75, s * (dims.wid / 2 + 0.02));
      const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 2.0, 6), oarMat);
      shaft.rotation.x = s * Math.PI / 2.6;
      shaft.position.z = s * 0.8;
      shaft.position.y = -0.3;
      pivot.add(shaft);
      const blade = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.05, 0.5), oarMat);
      blade.position.set(0, -1.05, s * 1.55);
      pivot.add(blade);
      g.add(pivot);
      oars.push({ pivot, side: s });
    }
    g.userData.oars = oars;
  } else if (type === "sail") {
    const white = new THREE.MeshStandardMaterial({ color: 0xe8ecee, flatShading: true });
    g.add(buildHull(dims.len, dims.wid, white));
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 3.4, 6), woodDark);
    mast.position.set(0.4, 2.2, 0);
    g.add(mast);
    // triangular sail
    const shape = new THREE.Shape();
    shape.moveTo(0, 0);
    shape.lineTo(0, 2.7);
    shape.lineTo(-1.9, 0);
    shape.lineTo(0, 0);
    const sail = new THREE.Mesh(new THREE.ShapeGeometry(shape), canvasMat);
    sail.position.set(0.36, 0.9, 0);
    sail.rotation.y = 0.2;
    g.add(sail);
    g.userData.sail = sail;
    addCrew(g, 0x37c8e0, -1.2);
  } else {
    // steam tug
    const red = new THREE.MeshStandardMaterial({ color: 0xb44a3a, flatShading: true });
    g.add(buildHull(dims.len, dims.wid, red));
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.9, 1.1, dims.wid - 0.8), canvasMat);
    cabin.position.set(-0.6, 1.15, 0);
    g.add(cabin);
    const roof = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.16, dims.wid - 0.5), woodDark);
    roof.position.set(-0.6, 1.76, 0);
    g.add(roof);
    const stack = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.3, 1.3, 8),
      new THREE.MeshStandardMaterial({ color: 0x3c454a, flatShading: true }));
    stack.position.set(0.9, 1.6, 0);
    g.add(stack);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.24, 0.06, 6, 10),
      new THREE.MeshStandardMaterial({ color: 0xffd24a, flatShading: true }));
    rim.rotation.x = Math.PI / 2;
    rim.position.set(0.9, 2.22, 0);
    g.add(rim);
    g.userData.stack = stack;
    addCrew(g, 0x2e5d8f, -0.6);
  }
  return g;
}

class Boat {
  constructor(scene, type, pathPoints, speed, phase) {
    this.type = type;
    this.dims = TYPES[type];
    this.group = buildBoatMesh(type);
    scene.add(this.group);
    // tallest first, so a stone dropping onto the tug lands on the cabin roof
    // rather than punching through to the deck below it
    this.decks = (this.dims.decks ||
      [{ x0: -this.dims.len / 2, x1: this.dims.len / 2, y: this.dims.deckY }])
      .slice().sort((a, b) => b.y - a.y);
    // how high the boat is solid at each stretch of x: a deck plus the crew,
    // mast or cabin standing on it, or a block's own top
    this.columns = [
      ...this.decks.map((d) => ({ x0: d.x0, x1: d.x1, top: d.y + 1.0 })),
      ...(this.dims.blocks || []),
    ];
    this.curve = new THREE.CatmullRomCurve3(pathPoints, true, "centripetal", 0.6);
    this.speed = speed;
    this.len = this.curve.getLength();
    this.t = phase;
    this.strokePhase = Math.random() * Math.PI * 2;
    this._lastDip = 0;
    this._smokeT = 0;
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

    this.strokePhase += dt * 2.4;
    if (this.type === "row") {
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
    } else if (this.type === "sail") {
      const sail = this.group.userData.sail;
      sail.rotation.y = 0.2 + Math.sin(elapsed * 2.1 + this.strokePhase) * 0.09;
      this.group.rotation.z += 0.06; // constant heel
    } else {
      // steam tug puffs
      this._smokeT -= dt;
      if (this._smokeT <= 0 && particles) {
        this._smokeT = 0.35 + Math.random() * 0.25;
        const stackWorld = this.group.localToWorld(new THREE.Vector3(0.9, 2.3, 0));
        particles.smoke(stackWorld);
      }
    }
  }

  /**
   * A deck's catch window along local x. `grip` is slack for a stone hanging
   * over the rail, so it only applies at the bow/stern ends — internal edges
   * (where one deck level meets the next) stay exact.
   */
  _deckX(d, grip) {
    const half = this.dims.len / 2;
    return [d.x0 <= -half + 0.01 ? d.x0 - grip : d.x0, d.x1 >= half - 0.01 ? d.x1 + grip : d.x1];
  }

  /** how high the boat is solid at local x — above this the stone flies free */
  _ceilingAt(x) {
    let top = HULL_TOP;
    for (const c of this.columns) {
      if (x >= c.x0 && x <= c.x1) top = Math.max(top, c.top);
    }
    return top;
  }

  /** the highest deck the stone is over at local x/z, if any */
  _deckUnder(x, z, grip) {
    if (Math.abs(z) > this.dims.wid / 2 + grip) return null;
    for (const d of this.decks) {
      const [lo, hi] = this._deckX(d, grip);
      if (x >= lo && x <= hi) return d;
    }
    return null;
  }

  /**
   * Sweep prev -> now against the decks. A stone covers more than a deck's
   * thickness in a single frame, so a point sample at the new position misses
   * the deck and the stone drops clean through the boat. Instead: clip the
   * frame's segment to the deck's footprint and see whether the stone was above
   * the deck entering it and below on the way out — that's a landing, however
   * fast or steep the arc was.
   */
  _deckLanding(prev, local, radius) {
    const { wid } = this.dims;
    // matches the hull box below, so there's no seam where a stone dropping just
    // outside the gunwale gets boinged instead of caught
    const grip = radius;
    const hz = wid / 2 + grip;
    const dx = local.x - prev.x, dz = local.z - prev.z, dy = local.y - prev.y;

    for (const d of this.decks) {
      // window of the segment spent over this deck's footprint
      const [xLo, xHi] = this._deckX(d, grip);
      let t0 = 0, t1 = 1;
      let over = true;
      for (const [p, delta, lo, hi] of [[prev.x, dx, xLo, xHi], [prev.z, dz, -hz, hz]]) {
        if (Math.abs(delta) < 1e-6) { over = p >= lo && p <= hi; }
        else {
          const a = (lo - p) / delta, b = (hi - p) / delta;
          t0 = Math.max(t0, Math.min(a, b));
          t1 = Math.min(t1, Math.max(a, b));
          over = t1 >= t0;
        }
        if (!over) break;
      }
      if (!over) continue;
      // above the deck on the way in, at or under it on the way out?
      if (prev.y + dy * t0 < d.y || prev.y + dy * t1 > d.y + 0.1) continue;

      const t = THREE.MathUtils.clamp(dy < -1e-5 ? (d.y - prev.y) / dy : t1, t0, t1);
      return {
        type: "deck",
        boat: this.group,
        boatType: this.type,
        local: new THREE.Vector3(
          THREE.MathUtils.clamp(prev.x + dx * t, d.x0 + 0.1, d.x1 - 0.1),
          d.y + 0.15,
          THREE.MathUtils.clamp(prev.z + dz * t, -(wid / 2 - 0.2), wid / 2 - 0.2),
        ),
      };
    }
    return null;
  }

  /** world-space AABB-ish test in the boat's local frame */
  collideLocal(pos, vel, radius, prevPos = null) {
    const local = this.group.worldToLocal(pos.clone());
    const prev = prevPos ? this.group.worldToLocal(prevPos.clone()) : local.clone();
    const { len, wid } = this.dims;
    const falling = vel.y < 0 || local.y < prev.y;

    if (falling) {
      // crossed a deck this frame -> land aboard and get ferried
      const deck = this._deckLanding(prev, local, radius);
      if (deck) return deck;
      // still in the air above a deck: no contact yet. Waiting for the crossing
      // keeps the landing snap-free — and stops the hull test below from
      // boinging a stone that is on its way down INTO the boat.
      const over = this._deckUnder(local.x, local.z, radius);
      if (over && local.y > over.y) return null;
    }

    const hx = len / 2 + radius, hz = wid / 2 + radius;
    if (Math.abs(local.x) > hx || Math.abs(local.z) > hz ||
        local.y < -0.2 || local.y > this._ceilingAt(local.x)) return null;
    // otherwise: BOING — push out along the dominant axis
    const px = hx - Math.abs(local.x);
    const pz = hz - Math.abs(local.z);
    const n = new THREE.Vector3();
    if (px < pz) n.set(Math.sign(local.x) || 1, 0, 0);
    else n.set(0, 0, Math.sign(local.z) || 1);
    n.applyQuaternion(this.group.quaternion);
    n.y = 0;
    n.normalize();
    return { type: "hull", normal: n };
  }
}

export class Boats {
  constructor(scene) {
    this.boats = [];
    const mk = (n, rad, yJitter, cx, cz) => {
      const pts = [];
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        const r = rad * (0.75 + Math.sin(a * 2 + cz) * 0.22);
        pts.push(new THREE.Vector3(cx + Math.cos(a) * r, 0, cz + Math.sin(a) * r * 0.7));
      }
      return pts;
    };
    this.boats.push(new Boat(scene, "row", mk(7, LAKE_R * 0.55, 0, 0, 8), 2.4, 0));
    this.boats.push(new Boat(scene, "steam", mk(6, LAKE_R * 0.42, 0, -12, -14), 1.5, 20));
    this.boats.push(new Boat(scene, "sail", mk(8, LAKE_R * 0.62, 0, 10, -4), 3.9, 45));
    this.boats.push(new Boat(scene, "row", mk(6, LAKE_R * 0.5, 0, -6, 18), 2.8, 60));
  }

  update(dt, elapsed, water, particles) {
    for (const b of this.boats) b.update(dt, elapsed, water, particles);
  }

  collide(pos, vel, radius, prevPos = null) {
    // decks win over hulls: a stone dropping onto one boat's deck shouldn't be
    // stolen by a hull graze on another
    let hull = null;
    for (const b of this.boats) {
      const hit = b.collideLocal(pos, vel, radius, prevPos);
      if (hit?.type === "deck") return hit;
      if (hit && !hull) hull = hit;
    }
    return hull;
  }
}

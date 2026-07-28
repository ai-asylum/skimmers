/**
 * Boats: moving checkpoints, hazards — and BUMPERS. Three types share the
 * spline-loop movement (team scrap: arc-length-parameterized journey spline):
 *
 *   row      — a wooden rowboat, medium pace, its paddler dipping a blade a side
 *   outboard — the same hull with a motor on the transom: quick, drags a wake
 *   trawler  — a slow fat fishing boat, three levels to land on, funnel smoke
 *
 * The hulls are baked models (src/boatdata.js, out of scripts/bake-boats.mjs)
 * normalised to unit length with the keel at y = 0. A type gives its world `len`
 * and how deep it floats (`sink`); every collision surface below is then written
 * as a fraction of that same model, measured off the geometry, so the boxes
 * follow the art instead of drifting from it.
 *
 * collide() classifies a flying rock's contact: "hull" (elastic rebound —
 * bank shots keep your skip chain alive) or "deck" (land in the boat and
 * get ferried).
 */
import * as THREE from "three";
import { LAKE_R, WATER_Y } from "./water.js";
import { BOAT_MODELS, POS_SCALE } from "./boatdata.js";

// How far above a deck the boat still counts as solid: the paddler, the
// wheelhouse, the motor. A stone crossing lower than this off to the side
// clangs into them rather than sailing through.
const STAND = 1.0;

// The paddle, as a fraction of its boat's length — a real one is about half a
// small rowboat long.
const PADDLE_LEN = 0.52;

// A deck edge this close to the model's own bow or stern is the open end of the
// boat, and gets slack for a stone hanging over the rail (see _deckX).
const END_EDGE = 0.03;

/**
 * `decks` are the standable surfaces along local x — a stone coming down onto
 * one is caught and ferried. `blocks` are solid with nothing to stand on (the
 * outboard motor): those just clang. Everything above both is open sky.
 *
 * Heights are fractions of the model's length, measured up from its lowest
 * point, and `sink` is where the waterline crosses it. Decks sit at the highest
 * real surface a stone can rest on: the thwarts of the rowboats, the hold floor
 * and the roof of the trawler. These hulls are much shallower for their length
 * than the boxes they replaced, so those decks sit low — what keeps a skimming
 * stone out of them is the rail test in _cameInOverRail, not their height. The
 * two wooden boats share a hull, so they share a waterline: about a third of it
 * is wet on both.
 */
const TYPES = {
  row: {
    model: "rowboat",
    len: 4.2,
    sink: 0.05, // waterline just under the rubbing strake
    hullTop: 0.148, // gunwale
    decks: [{ x0: -0.48, x1: 0.47, y: 0.12 }], // thwarts, and the open boat around them
    paddler: { x: -0.12, shirt: 0xe0503a, reach: { x: 0.3, y: 0.5 } }, // out front, on the shaft
    paddle: true,
  },
  outboard: {
    model: "outboard",
    len: 4.4,
    // measured from the propeller rather than the keel, which sits at 0.10, so
    // the number is bigger than the rowboat's for the same waterline
    sink: 0.146,
    hullTop: 0.24,
    decks: [{ x0: -0.3, x1: 0.47, y: 0.21 }], // thwarts, forward of the motor
    blocks: [{ x0: -0.5, x1: -0.3, top: 0.29 }], // cowling and tiller
    // reaching back and down for the tiller, which the cowling block covers
    paddler: { x: -0.2, shirt: 0x37c8e0, reach: { x: -0.32, y: 0.38 } },
  },
  trawler: {
    model: "trawler",
    len: 6.2,
    sink: 0.14, // the boot stripe painted round the hull
    hullTop: 0.28, // bulwarks
    decks: [
      { x0: -0.48, x1: -0.13, y: 0.19 }, // fish hold, aft
      { x0: -0.13, x1: 0.16, y: 0.34 }, // wheelhouse roof
      { x0: 0.16, x1: 0.48, y: 0.27 }, // foredeck
    ],
    funnel: { x: -0.05, y: 0.36 }, // where the smoke leaves, just clear of the roof
  },
};

const skin = new THREE.MeshStandardMaterial({ color: 0xf2c49b, flatShading: true });
const hatMat = new THREE.MeshStandardMaterial({ color: 0x7c4a1e, flatShading: true });

/** base64 -> typed array; the bake format src/fish.js reads too */
function decode(b64, Type) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Type(bytes.buffer);
}

const _geos = {};
let _mat = null;

/** rebuild a baked model: dequantise the vertices, expand the palette per triangle */
function boatGeometry(name) {
  if (_geos[name]) return _geos[name];
  const model = BOAT_MODELS[name];
  const quant = decode(model.pos, Int16Array);
  const tri = decode(model.tri, Uint8Array);

  const pos = new Float32Array(quant.length);
  for (let i = 0; i < quant.length; i++) pos[i] = quant[i] / POS_SCALE;

  const palette = model.palette.map((hex) => new THREE.Color().setHex(hex));
  const col = new Float32Array(quant.length);
  for (let t = 0; t < tri.length; t++) {
    const c = palette[tri[t]];
    for (let k = 0; k < 3; k++) {
      const i = (t * 3 + k) * 3;
      col[i] = c.r;
      col[i + 1] = c.g;
      col[i + 2] = c.b;
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
  // non-indexed, so this hands every triangle its own face normal — the flat
  // look the rest of the game uses
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  _geos[name] = geo;
  return geo;
}

/** one material for every boat: the colour rides in the vertices */
function boatMaterial() {
  _mat ??= new THREE.MeshStandardMaterial({
    vertexColors: true,
    flatShading: true,
    roughness: 0.78,
    metalness: 0,
  });
  return _mat;
}

/**
 * A baked model at world scale `len`. `drop` shifts it down, in model units: the
 * waterline for a hull, the mid-plane of the blades for the paddle.
 */
function modelMesh(name, len, drop) {
  const mesh = new THREE.Mesh(boatGeometry(name), boatMaterial());
  mesh.scale.setScalar(len);
  mesh.position.y = -drop * len;
  return mesh;
}

/** a bone between two points: a capsule spun round to look along b - a */
function limb(a, b, radius, mat) {
  const span = new THREE.Vector3().subVectors(b, a);
  const mesh = new THREE.Mesh(
    new THREE.CapsuleGeometry(radius, Math.max(span.length() - radius * 2, 0.01), 2, 6),
    mat,
  );
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), span.clone().normalize());
  mesh.position.addVectors(a, b).multiplyScalar(0.5);
  return mesh;
}

/**
 * A crew member sitting on `deckY`, facing the bow, hands out at `reach` — where
 * the paddle goes on the rowboat and the tiller on the outboard. Sizes are in
 * world units and don't scale with the boat: a person is a person.
 *
 * Its shape is doing a job. The old crew was one fat capsule, which at the size
 * a ferry crosses the screen read as a thermos flask stood on a plank, so the
 * torso is narrow, the head clears the shoulders, and the arms run out to the
 * hands to tie the figure to whatever it is holding.
 */
function addCrew(g, shirtColor, x, deckY, reach) {
  const shirt = new THREE.MeshStandardMaterial({ color: shirtColor, flatShading: true });
  const parts = [
    [new THREE.CylinderGeometry(0.19, 0.14, 0.5, 8), shirt, 0.34], // torso, widening to the shoulders
    [new THREE.CylinderGeometry(0.07, 0.08, 0.1, 6), skin, 0.62],
    [new THREE.SphereGeometry(0.15, 8, 6), skin, 0.79],
    [new THREE.CylinderGeometry(0.26, 0.26, 0.03, 12), hatMat, 0.86], // brim
    [new THREE.CylinderGeometry(0.13, 0.16, 0.13, 8), hatMat, 0.92],
  ];
  for (const [geo, mat, y] of parts) {
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, deckY + y, 0);
    g.add(mesh);
  }

  const hands = new THREE.Vector3(x + reach.x, deckY + reach.y, 0);
  for (const side of [-1, 1]) {
    const shoulder = new THREE.Vector3(x, deckY + 0.55, side * 0.16);
    g.add(limb(shoulder, hands.clone().setZ(side * 0.18), 0.055, shirt));
  }
  return hands;
}

/**
 * The paddle hangs in its own pivot at the paddler's hands, laid across the boat
 * so rolling the pivot dips one blade and then the other — a kayak stroke, which
 * is what this double-bladed model is for.
 */
function addPaddle(g, hands, len) {
  const pivot = new THREE.Group();
  pivot.position.copy(hands);
  const paddle = modelMesh("paddle", len, BOAT_MODELS.paddle.size[1] / 2);
  paddle.rotation.y = -Math.PI / 2; // a bow-to-stern model, laid port-to-starboard
  pivot.add(paddle);
  g.add(pivot);
  return pivot;
}

function buildBoat(spec) {
  const g = new THREE.Group();
  g.add(modelMesh(spec.model, spec.len, spec.sink));

  // the crew and the paddle stand on the highest deck, in the group's frame
  const topDeck = spec.decks.reduce((a, d) => Math.max(a, d.y), -Infinity);
  const deckY = (topDeck - spec.sink) * spec.len;

  if (spec.paddler) {
    const { x, shirt, reach } = spec.paddler;
    const hands = addCrew(g, shirt, x * spec.len, deckY, reach);
    if (spec.paddle) g.userData.paddle = addPaddle(g, hands, spec.len * PADDLE_LEN);
  }
  return g;
}

class Boat {
  constructor(scene, type, pathPoints, speed, phase) {
    this.type = type;
    const spec = TYPES[type];
    this.spec = spec;
    this.group = buildBoat(spec);
    scene.add(this.group);

    // model fractions -> the group's frame: the group origin rides the
    // waterline, so every height loses `sink` and everything scales by `len`
    const toX = (x) => x * spec.len;
    const toY = (y) => (y - spec.sink) * spec.len;

    this.halfLen = spec.len / 2;
    this.beam = BOAT_MODELS[spec.model].size[2] * spec.len;
    this.keelY = toY(0);
    this.hullTop = toY(spec.hullTop);
    // tallest first, so a stone dropping onto the trawler lands on the
    // wheelhouse roof rather than punching through to the deck below it
    this.decks = spec.decks
      .map((d) => ({
        x0: toX(d.x0),
        x1: toX(d.x1),
        y: toY(d.y),
        openLo: d.x0 <= -0.5 + END_EDGE,
        openHi: d.x1 >= 0.5 - END_EDGE,
      }))
      .sort((a, b) => b.y - a.y);
    // how high the boat is solid at each stretch of x: a deck plus whatever
    // stands on it, or a block's own top
    this.columns = [
      ...this.decks.map((d) => ({ x0: d.x0, x1: d.x1, top: d.y + STAND })),
      ...(spec.blocks || []).map((b) => ({ x0: toX(b.x0), x1: toX(b.x1), top: toY(b.top) })),
    ];
    this.funnel = spec.funnel
      ? new THREE.Vector3(toX(spec.funnel.x), toY(spec.funnel.y), 0)
      : null;

    this.curve = new THREE.CatmullRomCurve3(pathPoints, true, "centripetal", 0.6);
    this.speed = speed;
    this.len = this.curve.getLength();
    this.t = phase;
    this.strokePhase = Math.random() * Math.PI * 2;
    this._dipSide = 0;
    this._wakeT = 0;
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
      const paddle = this.group.userData.paddle;
      // steep enough that the low blade reaches the water the ripples appear in
      paddle.rotation.x = stroke * 0.85; // the +z blade goes down on the positive half
      paddle.rotation.y = Math.cos(this.strokePhase) * 0.22;
      // ripples where the blade that just went under enters the water: local +z
      // is the boat's port side out here
      const side = Math.sign(stroke);
      if (Math.abs(stroke) > 0.9 && side !== this._dipSide && particles) {
        this._dipSide = side;
        const reach = this.spec.len * PADDLE_LEN * 0.42;
        particles.oarDip(p.x - tan.z * side * reach, p.z + tan.x * side * reach);
      }
    } else if (this.type === "outboard") {
      this._wakeT -= dt;
      if (this._wakeT <= 0 && particles) {
        this._wakeT = 0.2 + Math.random() * 0.12;
        particles.wake(p.x - tan.x * this.halfLen, p.z - tan.z * this.halfLen);
      }
    } else {
      this._smokeT -= dt;
      if (this._smokeT <= 0 && particles) {
        this._smokeT = 0.35 + Math.random() * 0.25;
        particles.smoke(this.group.localToWorld(this.funnel.clone()));
      }
    }
  }

  /**
   * A deck's catch window along local x. `grip` is slack for a stone hanging
   * over the rail, so it only applies where the deck runs out to the bow or the
   * stern — internal edges (where one deck level meets the next) stay exact.
   */
  _deckX(d, grip) {
    return [d.openLo ? d.x0 - grip : d.x0, d.openHi ? d.x1 + grip : d.x1];
  }

  /** how high the boat is solid at local x — above this the stone flies free */
  _ceilingAt(x) {
    let top = this.hullTop;
    for (const c of this.columns) {
      if (x >= c.x0 && x <= c.x1) top = Math.max(top, c.top);
    }
    return top;
  }

  /** the highest deck the stone is over at local x/z, if any */
  _deckUnder(x, z, grip) {
    if (Math.abs(z) > this.beam / 2 + grip) return null;
    for (const d of this.decks) {
      const [lo, hi] = this._deckX(d, grip);
      if (x >= lo && x <= hi) return d;
    }
    return null;
  }

  /**
   * Did the stone get in over the rail, or through the side of the boat?
   *
   * A deck below the gunwale sits at the bottom of a box that is open at the top
   * only. Come down through that opening and you are aboard; arrive through a
   * side and you were only ever grazing the flank, which is what keeps a flat
   * skim boinging off these low hulls instead of dropping into them.
   *
   * The frame's segment is extended into a ray, so the answer depends on the
   * direction the stone arrived from rather than on where the frame happened to
   * start — a fast drop clears the whole freeboard inside one step, and testing
   * the segment alone would find no crossing at all.
   */
  _cameInOverRail(prev, dir, d, xLo, xHi, hz) {
    const rail = Math.max(d.y, this.hullTop);
    if (rail <= d.y + 1e-6) return true; // an open deck on top: nothing to clear

    let tEnter = -Infinity, tExit = Infinity, axis = -1;
    const slabs = [
      [prev.x, dir.x, xLo, xHi, 0],
      [prev.y, dir.y, d.y, rail, 1],
      [prev.z, dir.z, -hz, hz, 2],
    ];
    for (const [p, delta, lo, hi, ax] of slabs) {
      if (Math.abs(delta) < 1e-9) {
        if (p < lo || p > hi) return false; // parallel to this slab and outside it
        continue;
      }
      const a = (lo - p) / delta, b = (hi - p) / delta;
      const near = Math.min(a, b), far = Math.max(a, b);
      if (near > tEnter) { tEnter = near; axis = ax; }
      if (far < tExit) tExit = far;
    }
    return tExit >= tEnter && axis === 1;
  }

  /**
   * Sweep prev -> now against the decks. A stone covers more than a deck's
   * thickness in a single frame, so a point sample at the new position misses
   * the deck and the stone drops clean through the boat. Instead: clip the
   * frame's segment to the deck's footprint and see whether the stone was above
   * the deck entering it and below on the way out — that's a landing, however
   * fast or steep the arc was, as long as it came in over the rail.
   */
  _deckLanding(prev, local, radius) {
    // matches the hull box below, so there's no seam where a stone dropping just
    // outside the gunwale gets boinged instead of caught
    const grip = radius;
    const hz = this.beam / 2 + grip;
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
      if (!this._cameInOverRail(prev, { x: dx, y: dy, z: dz }, d, xLo, xHi, hz)) continue;

      const t = THREE.MathUtils.clamp(dy < -1e-5 ? (d.y - prev.y) / dy : t1, t0, t1);
      return {
        type: "deck",
        boat: this.group,
        boatType: this.type,
        local: new THREE.Vector3(
          THREE.MathUtils.clamp(prev.x + dx * t, d.x0 + 0.1, d.x1 - 0.1),
          d.y + 0.15,
          THREE.MathUtils.clamp(prev.z + dz * t, -(this.beam / 2 - 0.2), this.beam / 2 - 0.2),
        ),
      };
    }
    return null;
  }

  /** world-space AABB-ish test in the boat's local frame */
  collideLocal(pos, vel, radius, prevPos = null) {
    const local = this.group.worldToLocal(pos.clone());
    const prev = prevPos ? this.group.worldToLocal(prevPos.clone()) : local.clone();
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

    const hx = this.halfLen + radius, hz = this.beam / 2 + radius;
    if (Math.abs(local.x) > hx || Math.abs(local.z) > hz ||
        local.y < this.keelY || local.y > this._ceilingAt(local.x)) return null;
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
    const mk = (n, rad, cx, cz) => {
      const pts = [];
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        const r = rad * (0.75 + Math.sin(a * 2 + cz) * 0.22);
        pts.push(new THREE.Vector3(cx + Math.cos(a) * r, 0, cz + Math.sin(a) * r * 0.7));
      }
      return pts;
    };
    this.boats.push(new Boat(scene, "row", mk(7, LAKE_R * 0.55, 0, 8), 2.4, 0));
    this.boats.push(new Boat(scene, "trawler", mk(6, LAKE_R * 0.42, -12, -14), 1.5, 20));
    this.boats.push(new Boat(scene, "outboard", mk(8, LAKE_R * 0.62, 10, -4), 3.9, 45));
    this.boats.push(new Boat(scene, "row", mk(6, LAKE_R * 0.5, -6, 18), 2.8, 60));
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

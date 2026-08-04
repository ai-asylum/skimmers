/**
 * Hole furniture — everything a fairway can have in it besides rock, water and
 * a flag. Waterfalls, mill wheels, plank bridges, cave tunnels, fallen trees,
 * beaver dams and reed beds are all authored the same way the spires are
 * (a point on the map plus a couple of numbers, in holes.js) and all rebuilt
 * together by `HoleProps.setHole`.
 *
 * They divide into two kinds, and the split is the whole design of this file:
 *
 *   • STATIC things reduce to shapes the sim already understands. A bridge pier
 *     is a spire that happens to be holding up a deck, so it goes out through
 *     `solids` as one more `{x,z,r,h}` cylinder and CLONKs for free — including
 *     in the aim preview and the bot planner, which read the same list. A deck
 *     or a cave roof is the one genuinely new shape: an oriented slab you have
 *     to pass *under*, published as `ceilings` and tested in both sims.
 *
 *   • MOVING things — the paddles of a mill wheel — work like the boats do:
 *     `collide()` is called once per frame from the real sim only, and the
 *     preview deliberately doesn't know about them. A dotted line cannot
 *     promise where a paddle will be by the time the stone gets there, so it
 *     doesn't try; you read the wheel and time it yourself.
 *
 * Waterfalls are the odd one out and barely live here at all: the terrace is a
 * property of the lake and the ground (water.js `waterLevelAt`, terrain.js), and
 * what this file adds is the curtain hanging in the strip both of them leave
 * empty, plus the churn at the bottom of it.
 */
import * as THREE from "three";
import {
  waterLevelAt, terraceLiftAt, lakeDepthAt, isWaterAt, wetMarginAt, pathTangentAt,
  channelWidthAt, fallSites, FALL_LIP, FALL_RUN,
} from "./water.js";

import { terrainHeightAt } from "./terrain.js";

const PADDLES = 8; // blades on a mill wheel — sets the size of the gap you time

// Shared palette. One set of materials for every prop in every hole: they are
// rebuilt on each setHole and there is no reason to hand the GPU a new program
// for the same brown plank three times a race.
const MAT = {
  plank: new THREE.MeshStandardMaterial({ color: 0xa9773f, flatShading: true }),
  plankDark: new THREE.MeshStandardMaterial({ color: 0x82582c, flatShading: true }),
  beam: new THREE.MeshStandardMaterial({ color: 0x6d4726, flatShading: true }),
  rope: new THREE.MeshStandardMaterial({ color: 0xd8c48c, flatShading: true }),
  stone: new THREE.MeshStandardMaterial({ color: 0x9aa0a0, flatShading: true }),
  stoneDark: new THREE.MeshStandardMaterial({ color: 0x6c7476, flatShading: true }),
  stoneWet: new THREE.MeshStandardMaterial({ color: 0x55605f, flatShading: true }),
  moss: new THREE.MeshStandardMaterial({ color: 0x5da24e, flatShading: true }),
  foam: new THREE.MeshStandardMaterial({ color: 0xf4fbff, flatShading: true }),
  reed: new THREE.MeshStandardMaterial({ color: 0x5c7f45, flatShading: true }),
  reedDark: new THREE.MeshStandardMaterial({ color: 0x3e5c30, flatShading: true }),
  tile: new THREE.MeshStandardMaterial({ color: 0xc2543f, flatShading: true }),
  wall: new THREE.MeshStandardMaterial({ color: 0xe8dcc0, flatShading: true }),
};

const clamp01 = (v) => Math.min(1, Math.max(0, v));
const sstep = (e0, e1, x) => { const t = clamp01((x - e0) / (e1 - e0 || 1)); return t * t * (3 - 2 * t); };

// ------------------------------------------------------------------ waterfall
/**
 * The sheet of water in the gap the lake shader leaves at a lip. Vertical
 * streaks scrolling down a hard-edged blue-to-white ramp — the same cartoon
 * logic as the lake surface, just stood on its end. The mesh is built to the
 * exact profile the terrain ramps down behind it so the two never part company.
 */
function fallProfile(u) { return 1 - sstep(0.16, 0.9, u); }

function makeCurtain(fall, halfW, base) {
  const { ux, uz, drop } = fall;
  const sx = uz, sz = -ux; // across the flow
  const W = halfW + 1.6;
  const NS = 14, NA = 26;
  const geo = new THREE.PlaneGeometry(1, 1, NA, NS);
  const pos = geo.attributes.position;
  const uvs = geo.attributes.uv;
  const wet = new Float32Array(pos.count);
  for (let i = 0; i < pos.count; i++) {
    const a = uvs.getX(i), b = 1 - uvs.getY(i); // a across 0..1, b down 0..1
    const s = -FALL_LIP + b * (FALL_LIP + FALL_RUN);
    // the sheet leans out from the lip and bows slightly at the edges, where a
    // real fall thins and curls back toward the middle
    const across = (a - 0.5) * 2 * W * (1 - 0.06 * b);
    const y = base + drop * fallProfile(b) - 0.05;
    const px = fall.x + sx * across + ux * s, pz = fall.z + sz * across + uz * s;
    pos.setXYZ(i, px, y, pz);
    // The gap in the lake is the shape of the water, and the sheet is a
    // rectangle wide enough to reach every corner of it — so past the wobbling
    // waterline there is nothing to fill and the sheet fades out. Without this
    // the flanks of a wide weir hang over the beach. The fade is carried a
    // little way onto the sand so the sheet is still solid where the lake's own
    // edge feathers out, and thins from there rather than ending on a line.
    wet[i] = clamp01((wetMarginAt(px, pz) + 0.8) / 1.4);
  }
  geo.setAttribute("aWet", new THREE.BufferAttribute(wet, 1));
  geo.computeVertexNormals();
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    side: THREE.DoubleSide,
    depthWrite: false,
    uniforms: { uTime: { value: 0 }, uDrop: { value: drop } },
    vertexShader: /* glsl */ `
      attribute float aWet;
      varying vec2 vUvF;
      varying vec3 vW;
      varying float vWet;
      void main() {
        vUvF = uv;
        vWet = aWet;
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vW = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform float uDrop;
      varying vec2 vUvF;
      varying vec3 vW;
      varying float vWet;
      float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float noise(vec2 p) {
        vec2 i = floor(p), f = fract(p);
        vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x),
                   mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
      }
      void main() {
        float down = 1.0 - vUvF.y;              // 0 at the lip, 1 at the pool
        // stretched streaks racing down the face, each on its own speed
        vec2 q = vec2(vUvF.x * 26.0, down * 3.0 - uTime * 1.5);
        float streak = noise(q) * 0.6 + noise(q * vec2(2.3, 1.7) + 11.0) * 0.4;
        float lines = smoothstep(0.42, 0.72, streak);
        vec3 col = mix(vec3(0.42, 0.72, 0.84), vec3(1.0), lines * 0.75);
        // it goes white as it breaks up on the way down, and again at the lip
        col = mix(col, vec3(1.0), smoothstep(0.55, 1.0, down) * 0.7);
        col = mix(col, vec3(1.0), smoothstep(0.14, 0.0, down) * 0.5);
        float a = (0.72 + 0.24 * lines) * vWet;
        if (a < 0.02) discard;
        gl_FragColor = vec4(col, a);
      }
    `,
  });
  mat.userData.noCel = true;
  const mesh = new THREE.Mesh(geo, mat);
  mesh.renderOrder = 2;
  return { mesh, mat };
}

function buildFall(group, fall, halfW, shaders) {
  const { x, z, ux, uz, drop } = fall;
  const sx = uz, sz = -ux;
  // Falls stack: on a hole with two of them the upper curtain hangs from the
  // level of the pool below it, not from zero. Sample the water a stride past
  // the lip to find the surface this one lands on.
  const base = waterLevelAt(x + ux * (FALL_RUN + 2), z + uz * (FALL_RUN + 2));
  const { mesh, mat } = makeCurtain(fall, halfW, base);
  group.add(mesh);
  shaders.push(mat);

  // The sheet has to span the whole gap the lake leaves, dry margins included;
  // the boil and the rocks belong to the water that is actually going over, so
  // they are hung off the pouring stretch inside it (water.js `fallSites`).
  const px = fall.pourX ?? x, pz = fall.pourZ ?? z, pW = fall.pourW ?? halfW;

  // Churn where it lands: a raft of flattened white blobs that breathe. Scaled
  // off the drop, because the same boil that reads as spray under a six-metre
  // cataract reads as floating polystyrene under a beaver dam.
  const churn = new THREE.Group();
  const blob = 0.28 + Math.min(1, drop / 7) * 0.5;
  // by the metre, so a weir that spans a fork and its river is not lathered at
  // one end and bare at the other
  for (let i = 0, n = Math.max(9, Math.round(pW * 0.9)); i < n; i++) {
    const b = new THREE.Mesh(new THREE.IcosahedronGeometry(blob + Math.random() * blob, 0), MAT.foam);
    const across = (Math.random() - 0.5) * 2 * (pW + 0.6);
    const s = FALL_RUN - 0.6 + Math.random() * 3.4;
    b.position.set(px + sx * across + ux * s, base + 0.04, pz + sz * across + uz * s);
    b.scale.y = 0.3;
    b.userData.phase = Math.random() * 10;
    churn.add(b);
  }
  group.add(churn);

  // the shoulders of the cliff, so the drop reads as rock either side of it
  for (const dir of [-1, 1]) {
    const across = dir * (pW + 1.4);
    const r = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 0), MAT.stoneWet);
    r.scale.set(3.2, drop * 0.75, 2.6);
    r.position.set(px + sx * across + ux * (FALL_RUN * 0.3), base + drop * 0.28, pz + sz * across + uz * (FALL_RUN * 0.3));
    r.rotation.y = dir * 0.6;
    group.add(r);
    const cap = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 0), MAT.moss);
    cap.scale.set(1.7, 0.5, 1.5);
    cap.position.set(px + sx * across * 1.05 - ux * 1.4, base + drop + 0.25, pz + sz * across * 1.05 - uz * 1.4);
    group.add(cap);
  }
  // keyed to the pouring water rather than to the sheet, so the spray thrown
  // off it in update() lands in the pool instead of out on the beach
  return { churn, x: px, z: pz, ux, uz, sx, sz, drop, base, halfW: pW };
}

// ------------------------------------------------------------------ mill wheel
/**
 * An undershot wheel: the stream drives it, so the blades at the bottom sweep
 * downstream and the ones on the upstream face are on their way down into the
 * water. That asymmetry is the whole shot. Clip a bottom blade and it throws
 * your stone down the fairway; catch the front face on its downstroke and it
 * swats you under. In between the blades there is a gap, once every eighth of a
 * turn, and threading it is the reason to look at the wheel before you throw.
 */
function buildWheel(group, w) {
  const g = new THREE.Group();
  g.position.set(w.x, w.y, w.z);
  g.rotation.y = Math.atan2(-w.uz, w.ux); // local +X downstream, +Z along the axle

  const spinner = new THREE.Group();
  g.add(spinner);
  const hw = w.halfW;

  for (const side of [-hw, hw]) {
    const rim = new THREE.Mesh(new THREE.TorusGeometry(w.r, 0.17, 5, 18), MAT.plankDark);
    rim.position.z = side;
    spinner.add(rim);
    const inner = new THREE.Mesh(new THREE.TorusGeometry(w.r * 0.42, 0.12, 5, 14), MAT.plankDark);
    inner.position.z = side;
    spinner.add(inner);
  }
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, hw * 2.9, 8), MAT.beam);
  hub.rotation.x = Math.PI / 2;
  spinner.add(hub);

  for (let k = 0; k < PADDLES; k++) {
    const a = (k / PADDLES) * Math.PI * 2;
    const spoke = new THREE.Mesh(new THREE.BoxGeometry(w.r * 0.95, 0.13, 0.13), MAT.beam);
    spoke.position.set(Math.cos(a) * w.r * 0.5, Math.sin(a) * w.r * 0.5, 0);
    spoke.rotation.z = a;
    spinner.add(spoke);
    for (const side of [-hw * 0.62, hw * 0.62]) {
      const stay = new THREE.Mesh(new THREE.BoxGeometry(w.r * 0.9, 0.1, 0.1), MAT.beam);
      stay.position.set(Math.cos(a) * w.r * 0.52, Math.sin(a) * w.r * 0.52, side);
      stay.rotation.z = a;
      spinner.add(stay);
    }
    // the blade itself: a scoop, canted back so it bites the current
    const blade = new THREE.Mesh(new THREE.BoxGeometry(w.r * 0.42, 0.16, hw * 2), MAT.plank);
    blade.position.set(Math.cos(a) * w.r * 0.8, Math.sin(a) * w.r * 0.8, 0);
    blade.rotation.z = a - 0.22;
    spinner.add(blade);
    const back = new THREE.Mesh(new THREE.BoxGeometry(0.14, w.r * 0.3, hw * 2), MAT.plankDark);
    back.position.set(Math.cos(a) * (w.r - 0.1), Math.sin(a) * (w.r - 0.1), 0);
    back.rotation.z = a;
    spinner.add(back);
  }

  // the mill it drives, up on the nearer bank, with a shaft running to the hub
  const bankSide = w.bank; // +1 / -1 across the channel
  const bx = w.x + w.sx * bankSide * (w.reach), bz = w.z + w.sz * bankSide * (w.reach);
  const ground = terrainHeightAt(bx, bz);
  const house = new THREE.Group();
  house.position.set(bx, ground - 0.4, bz);
  house.rotation.y = Math.atan2(-w.uz, w.ux);
  const body = new THREE.Mesh(new THREE.BoxGeometry(6.5, 5, 6), MAT.wall);
  body.position.y = 2.5;
  house.add(body);
  const roof = new THREE.Mesh(new THREE.ConeGeometry(5.6, 3.2, 4), MAT.tile);
  roof.position.y = 6.4;
  roof.rotation.y = Math.PI / 4;
  house.add(roof);
  const door = new THREE.Mesh(new THREE.BoxGeometry(0.2, 2.2, 1.4), MAT.plankDark);
  door.position.set(-3.3, 1.1, 0);
  house.add(door);
  const chimney = new THREE.Mesh(new THREE.BoxGeometry(0.9, 2.4, 0.9), MAT.stone);
  chimney.position.set(1.8, 6.6, 1.6);
  house.add(chimney);
  // local +Z runs back across the channel toward the wheel (see the rotation
  // above), so the drive shaft reaches out of the mill along it
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, w.reach, 6), MAT.beam);
  shaft.rotation.x = Math.PI / 2;
  shaft.position.set(0, w.y - (ground - 0.4), bankSide * w.reach * 0.5);
  house.add(shaft);
  group.add(house);
  group.add(g);
  return { ...w, spinner, ang: Math.random() * Math.PI * 2, house };
}

// ------------------------------------------------------------------ bridge
/**
 * A plank bridge is a lid on the fairway. There is no way round it — it runs
 * bank to bank — so the only line through is a flat one under the deck, which
 * makes it the exact opposite of a spire: the spire punishes the low shot and
 * this punishes the lob. The piers hand themselves to the sim as ordinary
 * outcrops, so they CLONK, show up in the preview, and the bots respect them.
 */
function buildBridge(group, b, halfW, solids, ceilings) {
  const { x, z, ux, uz } = b;
  const sx = uz, sz = -ux;
  const lvl = waterLevelAt(x, z);
  const span = halfW + 4.5;
  const under = lvl + b.clear;
  const deckT = 0.42;
  const top = under + deckT;
  const along = 3.4; // how far the deck reaches up and down the fairway

  const g = new THREE.Group();
  g.position.set(x, 0, z);
  g.rotation.y = Math.atan2(-uz, ux); // +X downstream, +Z across
  group.add(g);

  // deck: individual planks so it reads as boards, with a beam under each edge
  const n = Math.round(span * 2 / 1.1);
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n;
    const plank = new THREE.Mesh(
      new THREE.BoxGeometry(along, deckT, (span * 2) / n * 0.88),
      i % 3 === 0 ? MAT.plankDark : MAT.plank
    );
    plank.position.set(0, under + deckT / 2, -span + t * span * 2);
    plank.rotation.x = (Math.random() - 0.5) * 0.02;
    g.add(plank);
  }
  for (const s of [-1, 1]) {
    const beam = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.34, span * 2), MAT.beam);
    beam.position.set(s * (along / 2 - 0.25), under - 0.14, 0);
    g.add(beam);
    // handrail on posts
    const rail = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.16, span * 2), MAT.plankDark);
    rail.position.set(s * (along / 2 - 0.2), top + 1.05, 0);
    g.add(rail);
    for (let i = -3; i <= 3; i++) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.18, 1.1, 0.18), MAT.plankDark);
      post.position.set(s * (along / 2 - 0.2), top + 0.55, (i / 3) * (span - 0.6));
      g.add(post);
    }
  }

  // piers: stone stacks standing in the channel, evenly spread
  const count = b.piers ?? 2;
  for (let i = 0; i < count; i++) {
    const t = count === 1 ? 0 : -1 + (2 * i) / (count - 1);
    const across = t * halfW * 0.62;
    const px = x + sx * across, pz = z + sz * across;
    const depth = lakeDepthAt(px, pz);
    const pier = new THREE.Mesh(new THREE.CylinderGeometry(0.85, 1.15, under + depth + 1, 7), MAT.stone);
    pier.position.set(px, (under - depth - 1) / 2 + 0.5, pz);
    group.add(pier);
    const cap = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.4, 2.1), MAT.stoneDark);
    cap.position.set(px, under - 0.2, pz);
    cap.rotation.y = 0.3;
    group.add(cap);
    solids.push({ x: px, z: pz, r: 1.15, h: top });
  }

  // abutments where it meets the banks
  for (const s of [-1, 1]) {
    const ax = x + sx * s * (span - 0.8), az = z + sz * s * (span - 0.8);
    const ground = terrainHeightAt(ax, az);
    const ab = new THREE.Mesh(new THREE.BoxGeometry(along + 1.4, Math.max(1.2, under - ground + 1.4), 2.6), MAT.stoneDark);
    ab.position.set(ax, under - Math.max(1.2, under - ground + 1.4) / 2 + 0.3, az);
    ab.rotation.y = Math.atan2(-uz, ux);
    group.add(ab);
  }

  ceilings.push({ x, z, ux, uz, half: along / 2, span, y: under, top, kind: "bridge" });
}

// ------------------------------------------------------------------ cave
/**
 * A tunnel through a headland: the same "get under it" problem as a bridge, but
 * long, dark, propped up on pillars you have to steer around, and — the part
 * that actually changes how a hole plays — you cannot see the far end from the
 * tee. The roof is an arch, so the clearance is real in the middle and mean at
 * the edges; the ceiling is published as five stepped slabs across the mouth so
 * the shape the stone hits is the shape you can see.
 */
function buildCave(group, c, halfW, solids, ceilings) {
  const { x, z, ux, uz } = c;
  const sx = uz, sz = -ux;
  const lvl = waterLevelAt(x, z);
  const iw = halfW + 0.9; // inner half-width — the whole channel goes through
  const apex = c.clear;
  const len = c.len;
  const OW = iw + 7.5;
  const OH = apex + 6.5;

  // cross-section: a rock mound with an arched hole bored through it
  const shape = new THREE.Shape();
  shape.moveTo(-OW, -11);
  shape.lineTo(-OW, OH * 0.34);
  shape.quadraticCurveTo(-OW * 0.7, OH * 0.94, -OW * 0.24, OH);
  shape.quadraticCurveTo(0, OH * 1.1, OW * 0.26, OH * 0.97);
  shape.quadraticCurveTo(OW * 0.72, OH * 0.9, OW, OH * 0.3);
  shape.lineTo(OW, -11);
  shape.closePath();

  // The mouth is much wider than it is tall — it has to swallow the whole
  // channel — so the roof is a flattened ellipse rather than a semicircle:
  // headroom in the middle, and it closes right down at the walls.
  const spring = apex * 0.42; // where the wall stops being vertical
  const rise = apex - spring;
  const roofAt = (across) => spring + rise * Math.sqrt(Math.max(0, 1 - (across / iw) ** 2));

  const hole = new THREE.Path();
  hole.moveTo(-iw, -11);
  hole.lineTo(-iw, spring);
  hole.absellipse(0, spring, iw, rise, Math.PI, 0, true);
  hole.lineTo(iw, -11);
  hole.closePath();
  shape.holes.push(hole);

  const geo = new THREE.ExtrudeGeometry(shape, { depth: len, bevelEnabled: false, curveSegments: 9 });
  // Rough the outside up. A swept quadratic reads as poured concrete however
  // hard it is flat-shaded, so every vertex that isn't part of the arch gets
  // pushed around a little and the facets stop lining up. The mouth is left
  // exactly as authored — that outline is the collision shape the roof bands
  // are derived from, and a lumpy one would lie about the headroom.
  {
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const px = pos.getX(i), py = pos.getY(i), pz = pos.getZ(i);
      if (py < -1) continue; // buried skirt, leave it flat so it seals into the bank
      if (Math.abs(px) < iw + 0.6 && py < roofAt(Math.min(iw, Math.abs(px))) + 0.6) continue;
      const n = Math.sin(px * 0.7 + pz * 0.31) * Math.cos(py * 0.55 - pz * 0.23);
      pos.setXYZ(i, px + n * 0.9, py + Math.sin(px * 1.3 + pz * 0.7) * 0.7, pz);
    }
    geo.computeVertexNormals();
  }
  // ExtrudeGeometry groups the two end caps separately from the swept sides,
  // so the portal faces can be the darker stone. They are the flattest thing
  // on the model and reading them as shadowed rock rather than lit rock is
  // most of what stops the whole mound looking like a poured overpass.
  const mesh = new THREE.Mesh(geo, [MAT.stoneDark, MAT.stone]);
  const g = new THREE.Group();
  g.position.set(x - ux * len / 2, lvl, z - uz * len / 2);
  g.rotation.y = Math.atan2(ux, uz); // local +Z downstream, +X across
  g.add(mesh);
  group.add(g);

  // A dark plug hung inside the arch so the tunnel actually looks like one.
  // It is cut to the mouth rather than being a rectangle: a square of gloom
  // has corners, and you can see them poking out into the daylight either
  // side of the opening from anywhere but dead ahead.
  const gloomShape = new THREE.Shape();
  gloomShape.moveTo(-iw, -11);
  gloomShape.lineTo(-iw, spring);
  gloomShape.absellipse(0, spring, iw, rise, Math.PI, 0, true);
  gloomShape.lineTo(iw, -11);
  gloomShape.closePath();
  const gloomGeo = new THREE.ShapeGeometry(gloomShape, 14);
  const gloomMat = new THREE.MeshBasicMaterial({
    color: 0x0b1720, transparent: true, opacity: 0.55, depthWrite: false, side: THREE.DoubleSide,
  });
  gloomMat.userData.noCel = true;
  for (const s of [0.16, 0.84]) {
    const gl = new THREE.Mesh(gloomGeo, gloomMat);
    gl.position.set(0, 0, len * s);
    g.add(gl);
  }

  // Grass the crown over. Without this it is a concrete overpass: the whole
  // point is a green headland the river happens to run under, so the moss
  // follows the actual outline of the mound rather than a flat height, and it
  // is laid thickly enough to be the silhouette from downstream.
  const crown = shape.getPoints(26).filter((p) => p.y > OH * 0.28);
  for (let s = 0; s <= 6; s++) {
    const zz = (len * s) / 6;
    for (const p of crown) {
      const cap = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 0), MAT.moss);
      cap.scale.set(1.5 + Math.random() * 0.9, 0.75 + Math.random() * 0.5, 1.9 + Math.random());
      cap.position.set(p.x + (Math.random() - 0.5), p.y - 0.5 + Math.random() * 0.5, zz + (Math.random() - 0.5) * 2);
      cap.rotation.y = Math.random() * Math.PI;
      g.add(cap);
    }
  }
  // and a scatter of boulders sitting on top of the turf
  for (let i = 0; i < 9; i++) {
    const p = crown[(Math.random() * crown.length) | 0];
    const b = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 0), MAT.stoneDark);
    b.scale.set(1 + Math.random() * 1.2, 0.9 + Math.random(), 1 + Math.random() * 1.2);
    b.position.set(p.x + (Math.random() - 0.5) * 2, p.y + 0.5, len * Math.random());
    b.rotation.set(Math.random(), Math.random(), Math.random());
    g.add(b);
  }
  // a rim of broken rock round both mouths, so the portal is a hole worn
  // through a cliff instead of a shape cut out of a sheet
  for (const end of [0, len]) {
    for (let i = 0; i <= 12; i++) {
      const a = Math.PI * (i / 12);
      const rx = Math.cos(a) * (iw + 0.9), ry = spring + Math.sin(a) * (rise + 0.9);
      const b = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 0), i % 3 ? MAT.stone : MAT.stoneDark);
      b.scale.set(0.8 + Math.random() * 0.7, 0.7 + Math.random() * 0.6, 0.9 + Math.random() * 0.8);
      b.position.set(rx, Math.max(0.3, ry), end + (Math.random() - 0.5) * 0.8);
      b.rotation.set(Math.random(), Math.random(), Math.random());
      g.add(b);
    }
  }

  // stalactites biting down out of the roof, and the pillars they have grown into
  for (let i = 0; i < 10; i++) {
    const t = 0.1 + 0.8 * ((i + 0.5) / 10);
    const across = (Math.random() - 0.5) * 2 * iw * 0.86;
    const roofY = roofAt(across);
    const reach = Math.min(0.45 + Math.random() * 1.3, Math.max(0.35, roofY - 1.4));
    const st = new THREE.Mesh(new THREE.ConeGeometry(0.24 + Math.random() * 0.18, reach, 5), MAT.stoneDark);
    st.position.set(across, roofY - reach / 2, len * t);
    st.rotation.x = Math.PI;
    g.add(st);
  }
  // two full-height pillars — the actual obstacle inside the dark
  for (let i = 0; i < (c.pillars ?? 2); i++) {
    const t = 0.3 + 0.4 * i;
    const across = (i % 2 ? 1 : -1) * iw * (0.34 + 0.12 * i);
    const px = x + ux * (len * (t - 0.5)) + sx * across;
    const pz = z + uz * (len * (t - 0.5)) + sz * across;
    const col = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.95, apex + 8, 7), MAT.stoneWet);
    col.position.set(px, lvl + (apex + 8) / 2 - 8, pz);
    group.add(col);
    solids.push({ x: px, z: pz, r: 0.95, h: lvl + apex });
  }

  // a shaft of daylight down a hole in the roof, because a cave you cannot see
  // the inside of is just a wall
  const shaftMat = new THREE.MeshBasicMaterial({
    color: 0xfff3c4, transparent: true, opacity: 0.15, depthWrite: false, side: THREE.DoubleSide,
  });
  shaftMat.userData.noCel = true;
  const shaft = new THREE.Mesh(new THREE.ConeGeometry(2.2, apex + OH * 0.8, 10, 1, true), shaftMat);
  shaft.position.set(iw * 0.22, (apex + OH * 0.8) / 2 - 0.6, len * 0.5);
  shaft.renderOrder = 3;
  g.add(shaft);

  // The roof, stepped across the arch so what the stone hits is the shape you
  // can see: headroom down the middle, and the walls closing in at the sides.
  for (const b of [{ o: 0, w: 0.36 }, { o: 0.56, w: 0.2 }, { o: -0.56, w: 0.2 },
                   { o: 0.88, w: 0.12 }, { o: -0.88, w: 0.12 }]) {
    const across = b.o * iw;
    // the lowest point of the band is what you have to clear
    const edge = (Math.abs(b.o) + b.w) * iw;
    ceilings.push({
      x: x + sx * across, z: z + sz * across, ux, uz,
      half: len / 2, span: b.w * iw,
      y: lvl + roofAt(Math.min(iw, edge)),
      top: lvl + OH + 3,
      kind: "cave",
    });
  }
}

// ------------------------------------------------------------------ deadwood
/**
 * A fallen tree across the channel. Same "get under it" problem as a bridge,
 * with the difference that matters: it came down at an angle, so the headroom
 * is different at every point across the river. There is always a line under a
 * log — it is just never the middle, and never the one you were already on.
 *
 * Published as a run of stepped slabs rather than one, so the ceiling the stone
 * meets is the slope you can see. The trunk is landable, too: come down on top
 * and you throw the next one from up there.
 */
function buildLog(group, l, halfW, solids, ceilings) {
  const { x, z, ux, uz, clear, tilt, bank } = l;
  const sx = uz, sz = -ux;
  const lvl = waterLevelAt(x, z);
  const span = halfW + 2.6; // it rests on both banks, so it overhangs them
  const R = 0.62; // trunk radius
  const BANDS = 7;
  // height above the water at an across-offset, low end first
  const heightAt = (a) => clear + tilt * ((a * bank + span) / (span * 2));

  const g = new THREE.Group();
  group.add(g);
  // The trunk is one cylinder laid across the flow and tipped along its own
  // length; the maths below is easier in a frame where "across" is +X.
  const lo = lvl + heightAt(-span * bank), hi = lvl + heightAt(span * bank);
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(R * 0.86, R, span * 2.1, 9), MAT.beam);
  trunk.rotation.z = Math.PI / 2; // stand the cylinder on its side, along local X
  trunk.rotation.y = Math.atan2(-sz, sx); // and swing that X onto the across axis
  // tip it so the ends sit at the two heights, then park it at their midpoint.
  // A positive turn about the flow direction raises the +across end, which is
  // the high one when `bank` is +1 (see heightAt).
  const tiltAng = Math.atan2(hi - lo, span * 2);
  trunk.rotateOnWorldAxis(_v.set(ux, 0, uz), bank > 0 ? tiltAng : -tiltAng);
  trunk.position.set(x, (lo + hi) / 2 + R, z);
  g.add(trunk);

  // bark: a few slabs pinned along the top so it isn't a smooth dowel
  for (let i = 0; i < 9; i++) {
    const a = (i / 8 - 0.5) * 2 * span * 0.92;
    const b = new THREE.Mesh(new THREE.IcosahedronGeometry(R * 0.55, 0), MAT.plankDark);
    b.scale.set(1, 0.5, 1.4);
    b.position.set(x + sx * a + ux * (Math.random() - 0.5) * 0.5,
      lvl + heightAt(a) + R * 0.75, z + sz * a + uz * (Math.random() - 0.5) * 0.5);
    b.rotation.set(Math.random(), Math.random(), Math.random());
    g.add(b);
  }
  // the root plate it tore up on the way down, and a stump opposite
  for (const s of [-1, 1]) {
    const ax = x + sx * s * span, az = z + sz * s * span;
    const ground = terrainHeightAt(ax, az);
    const y = lvl + heightAt(s * span);
    if (s === -bank) {
      // the root plate stands in the plane the trunk points out of, so its
      // spokes have to be built from the flow direction and straight up —
      // laying them out in world x/y puts them at an angle to their own disc
      const plate = new THREE.Mesh(new THREE.IcosahedronGeometry(2.1, 0), MAT.plankDark);
      plate.scale.set(1, 1, 0.42);
      plate.rotation.y = Math.atan2(sx, sz); // local +Z along the trunk, so the disc faces down it
      plate.position.set(ax + sx * 0.9, y, az + sz * 0.9);
      g.add(plate);
      for (let i = 0; i < 7; i++) {
        const a = (i / 7) * Math.PI * 2;
        const root = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.2, 1.5 + Math.random(), 5), MAT.beam);
        const c = Math.cos(a) * 1.4, sn = Math.sin(a) * 1.4;
        root.position.set(ax + sx * 1.2 + ux * c, y + sn, az + sz * 1.2 + uz * c);
        root.lookAt(ax + sx * 1.2 + ux * c * 2, y + sn * 2, az + sz * 1.2 + uz * c * 2);
        root.rotateX(Math.PI / 2); // cylinders are built up their own Y
        g.add(root);
      }
    } else {
      const stump = new THREE.Mesh(new THREE.CylinderGeometry(0.95, 1.2, Math.max(1, y - ground + 1.4), 8), MAT.beam);
      stump.position.set(ax, y - Math.max(1, y - ground + 1.4) / 2 + 0.3, az);
      g.add(stump);
      solids.push({ x: ax, z: az, r: 1.2, h: y, kind: "stump" });
    }
    // a scruff of moss on the top of each end, sized to the trunk it is on
    const cap = new THREE.Mesh(new THREE.IcosahedronGeometry(R * 1.15, 0), MAT.moss);
    cap.scale.set(1.1, 0.35, 1.5);
    cap.position.set(ax - sx * s * 1.2, y + R * 0.85, az - sz * s * 1.2);
    cap.rotation.y = Math.atan2(sx, sz); // long axis along the trunk it is sat on
    g.add(cap);
  }

  // the slope, as slabs the sim can test — one band per stretch across
  for (let i = 0; i < BANDS; i++) {
    const t = (i + 0.5) / BANDS;
    const a = -span + t * span * 2;
    const y = lvl + heightAt(a);
    ceilings.push({
      x: x + sx * a, z: z + sz * a, ux, uz,
      half: R + 0.25, span: (span / BANDS) * 1.02,
      y, top: y + R * 2, kind: "log",
    });
  }
}

/**
 * A beaver dam. A wall of sticks and mud right across the river with one notch
 * chewed in it, and the whole hole is that notch: it is the only way through at
 * water level, and going through it means going over the lip the dam is holding
 * back (holes.js `holeFalls` turns every dam into a terrace, which is where the
 * curtain and the pour come from).
 */
function buildDam(group, d, halfW, solids) {
  const { x, z, ux, uz } = d;
  const sx = uz, sz = -ux;
  // The two levels this thing exists to keep apart. A point exactly on the lip
  // reads as the low side (water.js fallSide), so the pond has to be sampled
  // from upstream of it — get this wrong and the dam is built shorter than the
  // water it is holding back, which is quite a way wrong.
  const pond = waterLevelAt(x - ux * (FALL_LIP + 1), z - uz * (FALL_LIP + 1));
  const below = waterLevelAt(x + ux * (FALL_RUN + 1), z + uz * (FALL_RUN + 1));
  const notch = d.notch ?? 0;
  const gap = d.gap ?? 2.4;
  const crest = pond + 1.0;
  // Stand the timber a little way up into the pond rather than on the lip. On
  // the lip it shares its pixels with its own falling water and the notch — the
  // only part of it that matters — disappears behind the curtain; a step back
  // and the gap is a hole in a wall with the river pouring through it.
  const bx = x - ux * (FALL_LIP - 0.4), bz = z - uz * (FALL_LIP - 0.4);

  const g = new THREE.Group();
  group.add(g);
  // two banks of piled sticks, from each shore in to the edge of the notch
  for (const side of [-1, 1]) {
    const inner = notch + side * gap / 2;
    const outer = side * (halfW + 1.6);
    const from = Math.min(inner, outer), to = Math.max(inner, outer);
    const width = to - from;
    if (width < 0.6) continue;
    const n = Math.max(4, Math.round(width * 2.2));
    for (let i = 0; i < n; i++) {
      const a = from + ((i + 0.5) / n) * width;
      const cx = bx + sx * a, cz = bz + sz * a;
      // the wall carries on down into the pool, or on to the ground once it
      // has climbed out onto the bank — otherwise the ends hang in the air
      const foot = Math.max(below - 1.2, terrainHeightAt(cx, cz) - 0.4);
      if (crest - foot < 0.5) continue; // up the bank far enough to be buried
      const layers = Math.max(2, Math.round((crest - foot) / 0.75));
      for (let k = 0; k < layers; k++) {
        const stick = new THREE.Mesh(
          new THREE.CylinderGeometry(0.13, 0.17, 1.6 + Math.random() * 1.7, 5),
          k % 2 ? MAT.plankDark : MAT.beam
        );
        stick.position.set(
          cx + sx * (Math.random() - 0.5) * 0.5 + ux * (Math.random() - 0.5) * 1.5,
          foot + ((k + 0.5) / layers) * (crest - foot),
          cz + sz * (Math.random() - 0.5) * 0.5 + uz * (Math.random() - 0.5) * 1.5
        );
        stick.rotation.set(Math.PI / 2 + (Math.random() - 0.5) * 0.7, Math.random() * Math.PI, (Math.random() - 0.5) * 1.1);
        g.add(stick);
      }
      // mud packed into the upstream face, which is what makes it hold water
      const mud = new THREE.Mesh(new THREE.IcosahedronGeometry(0.85, 0), MAT.plankDark);
      mud.scale.set(1.1, 0.9, 0.7);
      mud.position.set(cx - ux * 0.9, pond - 0.25, cz - uz * 0.9);
      g.add(mud);
    }
    // one solid per bank so the wall is genuinely a wall to the sim, sized to
    // the stretch it covers rather than a token post in the middle of it
    const mid = (from + to) / 2;
    solids.push({ x: bx + sx * mid, z: bz + sz * mid, r: Math.max(1.2, width / 2), h: crest + 0.6, kind: "dam" });
  }

  // the lodge, up on the bank, because somebody built all this
  const lx = x + sx * (halfW + 3.6) - ux * 2.5, lz = z + sz * (halfW + 3.6) - uz * 2.5;
  const ground = terrainHeightAt(lx, lz);
  const lodge = new THREE.Mesh(new THREE.IcosahedronGeometry(2.6, 1), MAT.beam);
  lodge.scale.set(1, 0.62, 1);
  lodge.position.set(lx, ground + 0.7, lz);
  g.add(lodge);
  for (let i = 0; i < 16; i++) {
    const a = Math.random() * Math.PI * 2, r = 1.2 + Math.random() * 1.5;
    const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.13, 2.2 + Math.random(), 5), MAT.plankDark);
    stick.position.set(lx + Math.cos(a) * r, ground + 0.5 + Math.random() * 1.4, lz + Math.sin(a) * r);
    stick.rotation.set(Math.random() * 1.2 - 0.6, a, 0.7 + Math.random() * 0.6);
    g.add(stick);
  }
}

// ------------------------------------------------------------------ weed bed
/**
 * Reeds. The bed itself is water (water.js `weedAt` is what slows a stone
 * down); this is the part you can see, and it has to be legible from the tee or
 * the slow water is just an unexplained punishment. Clumps thin out toward the
 * rim so the edge of the mesh agrees with the edge of the effect.
 */
function buildWeeds(group, w) {
  const g = new THREE.Group();
  group.add(g);
  const r = w.r ?? 5;
  // Clumps rather than an even scatter: reeds grow in tussocks, and a handful
  // of dense ones read as a bed from the tee where twice as many spread thin
  // just look like litter.
  const tufts = Math.round(r * 1.8);
  for (let i = 0; i < tufts; i++) {
    const a = Math.random() * Math.PI * 2;
    const rr = r * Math.sqrt(Math.random()) * 0.92;
    const cx = w.x + Math.cos(a) * rr, cz = w.z + Math.sin(a) * rr;
    if (!isWaterAt(cx, cz)) continue;
    const lvl = waterLevelAt(cx, cz);
    for (let k = 0; k < 5 + (Math.random() * 6 | 0); k++) {
      const px = cx + (Math.random() - 0.5) * 1.9, pz = cz + (Math.random() - 0.5) * 1.9;
      const h = 1.6 + Math.random() * 1.9;
      const blade = new THREE.Mesh(new THREE.ConeGeometry(0.13, h, 4), k % 3 ? MAT.reed : MAT.reedDark);
      blade.position.set(px, lvl + h / 2 - 0.2, pz);
      blade.rotation.set((Math.random() - 0.5) * 0.42, Math.random() * Math.PI, (Math.random() - 0.5) * 0.42);
      g.add(blade);
      if (Math.random() < 0.3) {
        // a bulrush head, for the ones that get to be the silhouette
        const head = new THREE.Mesh(new THREE.CapsuleGeometry(0.13, 0.5, 3, 5), MAT.plankDark);
        head.position.set(px, lvl + h + 0.15, pz);
        head.rotation.z = (Math.random() - 0.5) * 0.3;
        g.add(head);
      }
    }
    // lily pads floating in the gaps between the tussocks
    for (let k = 0; k < 3; k++) {
      const pad = new THREE.Mesh(new THREE.CircleGeometry(0.4 + Math.random() * 0.5, 6), MAT.reedDark);
      pad.rotation.x = -Math.PI / 2;
      pad.rotation.z = Math.random() * Math.PI;
      pad.position.set(cx + (Math.random() - 0.5) * 3.4, lvl + 0.05, cz + (Math.random() - 0.5) * 3.4);
      g.add(pad);
    }
  }
  return g;
}

// ------------------------------------------------------------------ facade
export class HoleProps {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    scene.add(this.group);
    this.wheels = [];
    this.falls = [];
    this.solids = [];
    this.ceilings = [];
    this._shaders = [];
    this._mistT = 0;
  }

  /**
   * Rebuild every prop for a hole. Call *after* water.setPath/setFalls and the
   * terrain rebuild — half of this reads back the water level and the ground
   * height it is standing on.
   */
  setHole(hole, halfW) {
    this.group.clear();
    this.wheels = [];
    this.falls = [];
    this.solids = [];
    this.ceilings = [];
    this._shaders = [];
    if (!hole) return;

    // Everything that spans the water is built to the width of the water it is
    // standing in, not the hole's. On a hole with a shortcut in it those are
    // different numbers, and a tree felled across a seven-metre gut has no
    // business being as long as one across the main river (channel.js).
    const spanAt = (x, z) => Math.min(halfW, channelWidthAt(x, z));

    // One curtain per lip per channel, not per lip: a terrace is a step in the
    // whole valley, so a hole with a shortcut in it goes over the same fall
    // twice, in two different bits of water (water.js `fallSites`).
    for (const site of fallSites()) {
      this.falls.push(buildFall(this.group, site, site.halfW, this._shaders));
    }

    for (const spec of hole.wheels ?? []) {
      const [ux, uz] = pathTangentAt(spec.x, spec.z);
      const r = spec.r ?? 4.2;
      const lvl = waterLevelAt(spec.x, spec.z);
      const sx = uz, sz = -ux;
      const w = spanAt(spec.x, spec.z);
      // which bank is nearer — that is where the mill goes
      const bank = spec.bank ?? (terrainHeightAt(spec.x + sx * w, spec.z + sz * w)
        > terrainHeightAt(spec.x - sx * w, spec.z - sz * w) ? 1 : -1);
      this.wheels.push(buildWheel(this.group, {
        x: spec.x, z: spec.z, y: lvl + r * 0.74, r,
        halfW: spec.w ?? 1.5,
        ux, uz, sx, sz, bank,
        reach: Math.abs(spec.reach ?? (w + 5.5)),
        omega: ((spec.rpm ?? 5.5) * Math.PI * 2) / 60,
      }));
    }

    for (const spec of hole.bridges ?? []) {
      const [ux, uz] = pathTangentAt(spec.x, spec.z);
      buildBridge(this.group, {
        x: spec.x, z: spec.z, ux, uz,
        clear: spec.clear ?? 2.3, piers: spec.piers ?? 2,
      }, spanAt(spec.x, spec.z), this.solids, this.ceilings);
    }

    for (const spec of hole.caves ?? []) {
      const [ux, uz] = pathTangentAt(spec.x, spec.z);
      buildCave(this.group, {
        x: spec.x, z: spec.z, ux, uz,
        clear: spec.clear ?? 3.4, len: spec.len ?? 18, pillars: spec.pillars,
      }, spanAt(spec.x, spec.z), this.solids, this.ceilings);
    }

    for (const spec of hole.logs ?? []) {
      const [ux, uz] = pathTangentAt(spec.x, spec.z);
      buildLog(this.group, {
        x: spec.x, z: spec.z, ux, uz,
        clear: spec.clear ?? 2.2, tilt: spec.tilt ?? 2.6, bank: spec.bank ?? 1,
      }, spanAt(spec.x, spec.z), this.solids, this.ceilings);
    }

    for (const spec of hole.dams ?? []) {
      const [ux, uz] = pathTangentAt(spec.x, spec.z);
      buildDam(this.group, { ...spec, ux, uz }, spanAt(spec.x, spec.z), this.solids);
    }

    for (const spec of hole.weeds ?? []) buildWeeds(this.group, spec);
  }

  update(dt, elapsed, particles) {
    for (const m of this._shaders) m.uniforms.uTime.value = elapsed;

    for (const f of this.falls) {
      for (const b of f.churn.children) {
        b.position.y = f.base + 0.04 + Math.sin(elapsed * 2.6 + b.userData.phase) * 0.12;
        const s = 1 + Math.sin(elapsed * 3.1 + b.userData.phase) * 0.13;
        b.scale.set(s, 0.3 * s, s);
      }
    }
    // spray thrown off the bottom of each fall
    if (particles) {
      this._mistT -= dt;
      if (this._mistT <= 0 && this.falls.length) {
        this._mistT = 0.06;
        const f = this.falls[(Math.random() * this.falls.length) | 0];
        const across = (Math.random() - 0.5) * 2 * f.halfW;
        const s = FALL_RUN * (0.1 + Math.random() * 0.5);
        _v.set(f.x + f.sx * across + f.ux * s, f.base + 0.2 + Math.random() * 1.2, f.z + f.sz * across + f.uz * s);
        particles.smoke(_v);
      }
    }

    for (const w of this.wheels) {
      w.ang += w.omega * dt;
      w.spinner.rotation.z = w.ang;
      // a blade breaking the surface throws a sheet of water forward
      if (particles && Math.random() < dt * 9) {
        const a = -Math.PI / 2 + (Math.random() - 0.5) * 0.9;
        const rr = w.r * (0.85 + Math.random() * 0.15);
        const px = w.x + w.ux * Math.cos(a) * rr + w.sx * (Math.random() - 0.5) * w.halfW * 2;
        const pz = w.z + w.uz * Math.cos(a) * rr + w.sz * (Math.random() - 0.5) * w.halfW * 2;
        if (w.y + Math.sin(a) * rr < waterLevelAt(px, pz) + 0.7) particles.oarDip(px, pz);
      }
    }
  }

  /**
   * The moving parts, tested against a stone in flight. Mirrors Boats.collide:
   * one call per frame from the real sim, nothing from the preview.
   * Returns null, or { type: "paddle", ... }.
   */
  collide(pos, vel, radius = 0.4) {
    for (const w of this.wheels) {
      const px = pos.x - w.x, pz = pos.z - w.z;
      const side = px * w.sx + pz * w.sz;
      if (Math.abs(side) > w.halfW + radius) continue;
      const along = px * w.ux + pz * w.uz;
      const up = pos.y - w.y;
      const rad = Math.hypot(along, up);
      if (rad < w.r * 0.4 || rad > w.r + 0.45) continue;
      const a = Math.atan2(up, along);
      const step = (Math.PI * 2) / PADDLES;
      let d = a - w.ang;
      d -= Math.round(d / step) * step;
      if (Math.abs(d) * rad > 0.6 + radius) continue; // through the gap
      const tang = w.omega * rad;
      return {
        type: "paddle",
        ux: w.ux, uz: w.uz, sx: w.sx, sz: w.sz,
        vAlong: -Math.sin(a) * tang,
        vUp: Math.cos(a) * tang,
        nx: (along / (rad || 1)) , ny: up / (rad || 1),
      };
    }
    return null;
  }
}

const _v = new THREE.Vector3();

/**
 * The floaters: the inflatable your stone rides between throws. Built once and
 * used in three places — bobbing on the lake as the fishing line's tie-off
 * (fishing.js), three in a row along the bench seat (bench.js), and on its own
 * card in the garage (cosmeticpreview.js).
 *
 * Every ring in the shop (cosmetics.js FLOATERS) is its own shape, not just its
 * own colour: a life ring, a mint, a duck, a donut, a crust of cooling lava, a
 * velvet cushion. All of them are built up front and all but one hidden, so
 * changing floater is a visibility flip — nothing to rebuild mid-game, and no
 * fresh meshes for the cel shader to catch up with (celshader.js only rescans
 * what is visible, once a second).
 *
 * House rules for a shape, so a stone can sit in any of them:
 *   - y up, laid flat in the xz plane, centred on the group origin
 *   - the hole (radius BUOY_R - BUOY_TUBE) stays clear for the rock
 *   - the front — where the fishing line ties off — is +z
 *   - the body wears `ringMat` and its trim `patchMat`, the two materials a
 *     bought floater recolours. Anything the same colour whatever ring it is
 *     stuck on (a beak is orange either way) takes a shared detail material.
 */
import * as THREE from "three";

export const BUOY_R = 0.85;    // ring centreline radius
export const BUOY_TUBE = 0.34; // how fat the tube is
const RING_COLOR = 0xff5a3c;
const PATCH_COLOR = 0xf4f0e6;
const TAU = Math.PI * 2;

// The game holds four of every floater at once (three bench slots and the lake
// buoy) and the garage one more each, all identical in shape — so shapes are
// cut once, in their final pose, and every mesh shares them. Materials stay
// per-buoy: that is the part a bought ring repaints.
const _geo = new Map();
function geo(key, make) {
  let g = _geo.get(key);
  if (!g) _geo.set(key, (g = make()));
  return g;
}

/** a torus lying flat in the xz plane, axis up, optionally squashed to `flat` */
function ringGeo(key, r, tube, rseg = 8, tseg = 18, arc = TAU, flat = 1) {
  return geo(key, () => new THREE.TorusGeometry(r, tube, rseg, tseg, arc)
    .rotateX(-Math.PI / 2).scale(1, flat, 1));
}

const _detail = new Map();
/** a trim colour no floater ever repaints, shared across every buoy on screen */
function detail(hex, opts) {
  let m = _detail.get(hex);
  if (!m) _detail.set(hex, (m = new THREE.MeshStandardMaterial({ color: hex, flatShading: true, ...opts })));
  return m;
}

/** sit `mesh` at angle `a` round the ring, `r` out and `y` up, facing outward */
function around(mesh, a, r, y = 0) {
  mesh.position.set(Math.cos(a) * r, y, -Math.sin(a) * r);
  mesh.rotation.y = a; // local +x now points out; lean with rotation.z, not x
  return mesh;
}

const put = (parent, geometry, mat, x = 0, y = 0, z = 0) => {
  const m = new THREE.Mesh(geometry, mat);
  m.position.set(x, y, z);
  parent.add(m);
  return m;
};

const SPRINKLE_COLORS = [0xffffff, 0x37c8e0, 0xffd24a, 0x6fe07a, 0xff5470];

// ------------------------------------------------------------------ the shapes
const SHAPES = {
  /** the one every rock starts on: a fat ring, four patches, a grab rope */
  classic(ringMat, patchMat) {
    const g = new THREE.Group();
    put(g, ringGeo("classic/tube", BUOY_R, BUOY_TUBE, 10, 18, TAU, 0.88), ringMat);
    for (let i = 0; i < 4; i++) {
      const patch = put(g, ringGeo("classic/patch", BUOY_R, BUOY_TUBE + 0.02, 10, 4, Math.PI / 6, 0.88), patchMat);
      patch.rotation.y = i * (Math.PI / 2) - Math.PI / 12;
    }
    // the grab line, slung round the outside and knotted at the four corners
    const cord = detail(0xe3d3a6);
    const ropeR = BUOY_R + BUOY_TUBE + 0.02;
    put(g, ringGeo("classic/rope", ropeR, 0.045, 5, 22), cord);
    for (let i = 0; i < 4; i++) {
      const knot = new THREE.Mesh(geo("classic/knot", () => new THREE.IcosahedronGeometry(0.11, 0)), cord);
      around(knot, i * (Math.PI / 2) + Math.PI / 4, ropeR, 0.02);
      g.add(knot);
    }
    return g;
  },

  /** a boiled mint: squat, chalky, striped across the tube */
  mint(ringMat, patchMat) {
    const g = new THREE.Group();
    put(g, ringGeo("mint/body", BUOY_R, BUOY_TUBE * 1.04, 6, 20, TAU, 0.58), ringMat);
    for (let i = 0; i < 7; i++) {
      const stripe = put(g, ringGeo("mint/stripe", BUOY_R, BUOY_TUBE * 1.04 + 0.015, 6, 3, Math.PI / 9, 0.58), patchMat);
      stripe.rotation.y = (i / 7) * TAU;
    }
    // a crisp sugared lip round the hole, so the middle reads as bitten out
    put(g, ringGeo("mint/lip", BUOY_R - BUOY_TUBE * 1.04, 0.05, 5, 20), patchMat);
    return g;
  },

  /** bath-time yellow: the ring is the body, with a neck, head and beak up front */
  duck(ringMat, patchMat) {
    const g = new THREE.Group();
    put(g, ringGeo("duck/body", BUOY_R, BUOY_TUBE, 8, 18, TAU, 0.92), ringMat);

    // A proper neck, long enough that the head is not just a lump on the tube,
    // craned out over the bow so it never sits between the camera and the face
    // of the stone riding in the middle.
    const neck = put(g, geo("duck/neck", () => new THREE.CylinderGeometry(0.16, 0.23, 0.56, 7)), ringMat, 0, 0.45, 0.94);
    neck.rotation.x = 0.34;
    const head = put(g, geo("duck/head", () => new THREE.SphereGeometry(0.32, 9, 7)), ringMat, 0, 0.83, 1.15);
    head.scale.set(1, 0.96, 1.06);
    const beak = put(g, geo("duck/beak", () => new THREE.ConeGeometry(0.15, 0.32, 6)), patchMat, 0, 0.77, 1.45);
    beak.rotation.x = Math.PI / 2 + 0.12; // tipped down, the way a bath duck's is
    const eyes = geo("duck/eye", () => new THREE.SphereGeometry(0.07, 6, 5));
    for (const s of [-1, 1]) put(g, eyes, detail(0x241f1c), s * 0.18, 0.95, 1.38);

    // wings folded along the flanks and a tail cocked up at the back
    const wing = geo("duck/wing", () => new THREE.SphereGeometry(0.36, 7, 6));
    for (const s of [-1, 1]) {
      const w = put(g, wing, ringMat, s * 0.9, 0.18, -0.04);
      w.scale.set(0.36, 0.52, 0.95);
    }
    const tail = put(g, geo("duck/tail", () => new THREE.ConeGeometry(0.18, 0.38, 6)), ringMat, 0, 0.3, -0.92);
    tail.rotation.x = -0.75;
    // paddles, tucked under the front where the water hides them
    const foot = geo("duck/foot", () => new THREE.BoxGeometry(0.26, 0.07, 0.34));
    for (const s of [-1, 1]) {
      put(g, foot, patchMat, s * 0.24, -0.26, 0.7).rotation.y = s * -0.3;
    }
    return g;
  },

  /** dough underneath, a fat glaze poured over the top, drips down the outside */
  donut(ringMat, patchMat) {
    const g = new THREE.Group();
    put(g, ringGeo("donut/dough", BUOY_R, BUOY_TUBE, 8, 18, TAU, 0.94), patchMat);
    // the glaze is a second, fatter ring sunk into the first: it laps over both
    // edges and leaves a band of bare dough showing underneath
    const GLAZE_TUBE = BUOY_TUBE + 0.1, GLAZE_FLAT = 0.62, GLAZE_Y = 0.15;
    put(g, ringGeo("donut/glaze", BUOY_R, GLAZE_TUBE, 8, 20, TAU, GLAZE_FLAT), ringMat, 0, GLAZE_Y, 0);
    const drip = geo("donut/drip", () => new THREE.SphereGeometry(0.13, 6, 5));
    for (let i = 0; i < 7; i++) {
      const d = around(new THREE.Mesh(drip, ringMat), (i / 7) * TAU + 0.3, BUOY_R + GLAZE_TUBE * 0.82, -0.02);
      d.scale.set(0.8, 1.5 + Math.random() * 1.1, 1);
      g.add(d);
    }
    // sprinkles, scattered over the crown of the glaze and following its curve
    const bit = geo("donut/sprinkle", () => new THREE.BoxGeometry(0.13, 0.04, 0.045));
    for (let i = 0; i < 20; i++) {
      const a = (i / 20) * TAU + Math.random() * 0.22;
      const off = (Math.random() - 0.5) * 0.5;
      const y = GLAZE_Y + GLAZE_TUBE * GLAZE_FLAT * Math.sqrt(Math.max(0, 1 - (off / GLAZE_TUBE) ** 2)) - 0.01;
      const s = around(new THREE.Mesh(bit, detail(SPRINKLE_COLORS[i % SPRINKLE_COLORS.length])), a, BUOY_R + off, y);
      s.rotation.y += (Math.random() - 0.5) * 2.2;
      g.add(s);
    }
    return g;
  },

  /** a crust of black rock cooling over the glow, still cracked open in places */
  lava(ringMat, patchMat) {
    const g = new THREE.Group();
    const CORE_TUBE = BUOY_TUBE * 0.94, CORE_FLAT = 0.92;
    put(g, ringGeo("lava/core", BUOY_R, CORE_TUBE, 8, 20, TAU, CORE_FLAT), ringMat);
    // Ten plates of cooled crust riding the top of the glow, evenly spaced so
    // there is always a gap left between them for the heat to come through.
    const crest = CORE_TUBE * CORE_FLAT;
    const chunk = geo("lava/chunk", () => new THREE.DodecahedronGeometry(0.26, 0));
    for (let i = 0; i < 10; i++) {
      const c = around(new THREE.Mesh(chunk, patchMat), (i / 10) * TAU, BUOY_R + (Math.random() - 0.5) * 0.16, crest * (0.6 + Math.random() * 0.35));
      c.scale.set(0.85 + Math.random() * 0.2, 0.62 + Math.random() * 0.3, 1.1 + Math.random() * 0.35);
      c.rotation.z = (Math.random() - 0.5) * 0.7;
      g.add(c);
    }
    const glow = detail(0xffb03a, { emissive: 0xff6a1e, emissiveIntensity: 0.85 });
    const seam = geo("lava/seam", () => new THREE.BoxGeometry(0.44, 0.06, 0.1));
    for (let i = 0; i < 5; i++) {
      g.add(around(new THREE.Mesh(seam, glow), (i / 5) * TAU + Math.PI / 10, BUOY_R, crest - 0.02));
    }
    return g;
  },

  /** velvet cushion, gold rope round both edges, buttoned and crowned */
  royal(ringMat, patchMat) {
    const g = new THREE.Group();
    const TUBE = BUOY_TUBE * 1.05, FLAT = 0.86;
    const crest = TUBE * FLAT;
    put(g, ringGeo("royal/cushion", BUOY_R, TUBE, 8, 20, TAU, FLAT), ringMat);
    // gold rope round the outside and round the lip of the hole
    put(g, ringGeo("royal/outer", BUOY_R + TUBE + 0.01, 0.055, 5, 22), patchMat);
    put(g, ringGeo("royal/inner", BUOY_R - TUBE + 0.03, 0.05, 5, 20), patchMat, 0, crest * 0.55, 0);
    const button = geo("royal/button", () => new THREE.OctahedronGeometry(0.11, 0));
    for (let i = 0; i < 8; i++) {
      const b = around(new THREE.Mesh(button, patchMat), (i / 8) * TAU, BUOY_R, crest - 0.05);
      b.scale.y = 0.5; // pressed into the velvet, not standing on it
      g.add(b);
    }
    // four points of a crown standing on the cushion, between the buttons,
    // each pearled at the tip so they read as regalia and not as spikes
    const point = geo("royal/point", () => new THREE.ConeGeometry(0.12, 0.28, 6));
    const pearl = geo("royal/pearl", () => new THREE.SphereGeometry(0.065, 6, 5));
    for (let i = 0; i < 4; i++) {
      const a = i * (Math.PI / 2) + Math.PI / 8;
      const p = around(new THREE.Mesh(point, patchMat), a, BUOY_R, crest + 0.08);
      p.rotation.z = -0.14; // leaning out a touch, clear of the stone in the middle
      g.add(p);
      g.add(around(new THREE.Mesh(pearl, patchMat), a, BUOY_R + 0.02, crest + 0.2));
    }
    return g;
  },
};

/**
 * A floater, ready to be dressed by cosmetics.js `paintFloater`.
 *
 * @param only build this shape alone (a shop card only ever shows the one);
 *             left out, every shape is built and `setShape` picks between them.
 * @returns {{ group: THREE.Group, ringMat: THREE.Material, patchMat: THREE.Material,
 *             setShape: (id: string) => void }}
 */
export function makeFloater(only = null) {
  const group = new THREE.Group();
  const ringMat = new THREE.MeshStandardMaterial({ color: RING_COLOR, flatShading: true });
  const patchMat = new THREE.MeshStandardMaterial({ color: PATCH_COLOR, flatShading: true });

  const shapes = new Map();
  for (const [id, build] of Object.entries(SHAPES)) {
    if (only && id !== only) continue;
    const shape = build(ringMat, patchMat);
    shape.visible = false;
    group.add(shape);
    shapes.set(id, shape);
  }
  const first = shapes.get(only ?? "classic") ?? shapes.values().next().value;
  if (first) first.visible = true;

  return {
    group, ringMat, patchMat,
    /** wear one shape and hide the rest; a shape we didn't build is ignored */
    setShape(id) {
      if (!shapes.has(id)) return;
      for (const [key, shape] of shapes) shape.visible = key === id;
    },
  };
}

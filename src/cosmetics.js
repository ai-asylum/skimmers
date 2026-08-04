/**
 * The dressing-up box: hats, floaters and flight trails.
 *
 * Hats are built flat-shaded from primitives like every other prop, sized for a
 * unit-radius stone so the caller only has to scale by `rock.size` — see
 * `Rock.setHat`, which parents them next to the eyes and lets the stone's own
 * squash and spin carry them along. A hat with `userData.spinner` gets that
 * child turned every frame (the propeller earns its 400 shells).
 *
 * Floaters are the shapes in lifebuoy.js, which the bench and the fishing line
 * share, so a ring you buy shows up in both places. This file only holds the
 * catalogue and the two colours each one is painted in.
 *
 * Trails are pure particle recipes — no state, no meshes — called once a frame
 * per flying stone, in the same spot the stock wet trail used to go.
 */
import * as THREE from "three";
import { celMat } from "./celshader.js";

const flat = (color) => new THREE.MeshStandardMaterial({ color, flatShading: true });

// ------------------------------------------------------------------ hats
const HAT_BUILDERS = {
  none: () => null,

  cap: () => {
    const g = new THREE.Group();
    const cloth = flat(0x37c8e0);
    const dome = new THREE.Mesh(new THREE.SphereGeometry(0.52, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), cloth);
    g.add(dome);
    const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.52, 0.52, 0.07, 14, 1, false, -0.5, 2.2), cloth);
    brim.position.set(0.34, 0.03, 0);
    brim.scale.set(1.15, 1, 1);
    g.add(brim);
    const button = new THREE.Mesh(new THREE.SphereGeometry(0.08, 8, 6), flat(0xff5470));
    button.position.y = 0.5;
    g.add(button);
    return g;
  },

  topper: () => {
    const g = new THREE.Group();
    const felt = flat(0x1b2430);
    const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.78, 0.82, 0.08, 16), felt);
    brim.position.y = 0.04;
    g.add(brim);
    const stack = new THREE.Mesh(new THREE.CylinderGeometry(0.46, 0.5, 0.86, 16), felt);
    stack.position.y = 0.5;
    g.add(stack);
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.52, 0.52, 0.16, 16), flat(0xff5470));
    band.position.y = 0.18;
    g.add(band);
    return g;
  },

  crown: () => {
    const g = new THREE.Group();
    const gold = flat(0xffd24a);
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.56, 0.6, 0.3, 14), gold);
    band.position.y = 0.15;
    g.add(band);
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2;
      const spike = new THREE.Mesh(new THREE.ConeGeometry(0.13, 0.4, 5), gold);
      spike.position.set(Math.cos(a) * 0.53, 0.48, Math.sin(a) * 0.53);
      g.add(spike);
      const jewel = new THREE.Mesh(new THREE.OctahedronGeometry(0.08), flat(i % 2 ? 0xff5470 : 0x37c8e0));
      jewel.position.set(Math.cos(a) * 0.6, 0.16, Math.sin(a) * 0.6);
      g.add(jewel);
    }
    return g;
  },

  party: () => {
    const g = new THREE.Group();
    const cone = new THREE.Mesh(new THREE.ConeGeometry(0.42, 1.05, 12), flat(0xff8a3d));
    cone.position.y = 0.52;
    g.add(cone);
    for (let i = 0; i < 3; i++) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.3 - i * 0.09, 0.035, 6, 12), flat(0x37c8e0));
      ring.rotation.x = Math.PI / 2;
      ring.position.y = 0.24 + i * 0.26;
      g.add(ring);
    }
    const pom = new THREE.Mesh(new THREE.IcosahedronGeometry(0.15, 0), flat(0xfdf6e3));
    pom.position.y = 1.08;
    g.add(pom);
    return g;
  },

  viking: () => {
    const g = new THREE.Group();
    const iron = flat(0x8d99a6);
    const dome = new THREE.Mesh(new THREE.SphereGeometry(0.56, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), iron);
    g.add(dome);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.56, 0.07, 6, 16), iron);
    rim.rotation.x = Math.PI / 2;
    rim.position.y = 0.04;
    g.add(rim);
    const nose = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.34, 0.14), iron);
    nose.position.set(0.5, 0.02, 0);
    g.add(nose);
    for (const s of [-1, 1]) {
      const horn = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.66, 7), flat(0xf4f0e6));
      horn.position.set(0, 0.34, s * 0.5);
      horn.rotation.x = s * -0.85;
      g.add(horn);
    }
    return g;
  },

  halo: () => {
    const g = new THREE.Group();
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(0.44, 0.075, 8, 20),
      new THREE.MeshStandardMaterial({ color: 0xffe98a, emissive: 0xffd24a, emissiveIntensity: 0.9, flatShading: true }),
    );
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.5;
    g.add(ring);
    g.userData.spinner = ring;
    g.userData.spinRate = 1.1;
    g.userData.bob = 0.07;
    return g;
  },

  propeller: () => {
    const g = new THREE.Group();
    const dome = new THREE.Mesh(new THREE.SphereGeometry(0.5, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), flat(0x6fe07a));
    g.add(dome);
    for (let i = 0; i < 4; i++) {
      const wedge = new THREE.Mesh(
        new THREE.SphereGeometry(0.505, 6, 6, (i / 4) * Math.PI * 2, Math.PI / 4, 0, Math.PI / 2),
        flat(i % 2 ? 0xff5470 : 0xffd24a),
      );
      g.add(wedge);
    }
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.22, 6), flat(0x3c4b57));
    post.position.y = 0.58;
    g.add(post);
    const prop = new THREE.Group();
    prop.position.y = 0.7;
    for (const s of [-1, 1]) {
      const blade = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.04, 0.14), flat(0x37c8e0));
      blade.position.x = s * 0.26;
      blade.rotation.z = s * 0.25;
      prop.add(blade);
    }
    g.add(prop);
    g.userData.spinner = prop;
    g.userData.spinRate = 9;
    return g;
  },

  sombrero: () => {
    const g = new THREE.Group();
    const straw = flat(0xd9b168);
    const brim = new THREE.Mesh(new THREE.ConeGeometry(1.12, 0.26, 18, 1, true), straw);
    brim.position.y = 0.16;
    g.add(brim);
    const crown = new THREE.Mesh(new THREE.ConeGeometry(0.42, 0.6, 14), straw);
    crown.position.y = 0.44;
    g.add(crown);
    const band = new THREE.Mesh(new THREE.TorusGeometry(0.38, 0.05, 6, 14), flat(0xe0503a));
    band.rotation.x = Math.PI / 2;
    band.position.y = 0.24;
    g.add(band);
    return g;
  },

  bandana: () => {
    const g = new THREE.Group();
    const cloth = flat(0x1b2430);
    const wrap = new THREE.Mesh(new THREE.SphereGeometry(0.55, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2.4), cloth);
    wrap.scale.y = 0.62;
    g.add(wrap);
    const knot = new THREE.Mesh(new THREE.IcosahedronGeometry(0.16, 0), cloth);
    knot.position.set(-0.5, 0.06, 0.18);
    g.add(knot);
    for (const s of [-1, 1]) {
      const tail = new THREE.Mesh(new THREE.ConeGeometry(0.11, 0.5, 5), cloth);
      tail.position.set(-0.68, -0.06, 0.18 + s * 0.12);
      tail.rotation.z = 1.9;
      tail.rotation.y = s * 0.4;
      g.add(tail);
    }
    const skull = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.16, 0.16), flat(0xfdf6e3));
    skull.position.set(0.54, 0.14, 0);
    g.add(skull);
    return g;
  },

  daisy: () => {
    const g = new THREE.Group();
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.045, 0.42, 6), flat(0x4b9e4b));
    stem.position.y = 0.21;
    stem.rotation.z = -0.2;
    g.add(stem);
    const head = new THREE.Group();
    head.position.set(0.08, 0.45, 0);
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2;
      const petal = new THREE.Mesh(new THREE.SphereGeometry(0.13, 6, 5), flat(0xfdf6e3));
      petal.scale.set(1, 0.4, 0.7);
      petal.position.set(Math.cos(a) * 0.17, 0, Math.sin(a) * 0.17);
      head.add(petal);
    }
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.11, 8, 6), flat(0xffd24a));
    eye.scale.y = 0.55;
    head.add(eye);
    g.add(head);
    g.userData.spinner = head;
    g.userData.spinRate = 0.6;
    return g;
  },
};

/** @type {{id:string,name:string,cost:number,blurb:string}[]} */
export const HATS = [
  { id: "none", name: "Bare Stone", cost: 0, blurb: "Nothing on top. Classic." },
  { id: "party", name: "Party Cone", cost: 120, blurb: "Every throw is a celebration." },
  { id: "cap", name: "Ball Cap", cost: 150, blurb: "Worn backwards would be too much." },
  { id: "daisy", name: "Daisy", cost: 200, blurb: "A little flower, turning gently." },
  { id: "topper", name: "Top Hat", cost: 250, blurb: "For the distinguished skipping stone." },
  { id: "bandana", name: "Pirate Rag", cost: 350, blurb: "Sailed the lake. Feared by ducks." },
  { id: "propeller", name: "Propeller Beanie", cost: 400, blurb: "It spins. It really does spin." },
  { id: "sombrero", name: "Sombrero", cost: 500, blurb: "Shade for the long final stretch." },
  { id: "viking", name: "Viking Helm", cost: 600, blurb: "Horns are not historically accurate." },
  { id: "halo", name: "Halo", cost: 750, blurb: "Innocent of every splash you land." },
  { id: "crown", name: "Crown", cost: 900, blurb: "Only kings of the lake need apply." },
];

export const HAT_BY_ID = new Map(HATS.map((h) => [h.id, h]));

/** a hat group sized for a unit-radius stone, base at the origin, or null */
export function makeHat(id) {
  return (HAT_BUILDERS[id] ?? HAT_BUILDERS.none)();
}

// ------------------------------------------------------------------ floaters
// `ring` is the body colour and `patch` its trim; the shape itself is built by
// lifebuoy.js under the same id.
/** @type {{id:string,name:string,cost:number,blurb:string,ring:number,patch:number}[]} */
export const FLOATERS = [
  { id: "classic", name: "Lifebuoy", cost: 0, blurb: "The one every rock starts on.", ring: 0xff5a3c, patch: 0xf4f0e6 },
  { id: "mint", name: "Mint Ring", cost: 120, blurb: "Cool, calm, faintly minty.", ring: 0x6fe07a, patch: 0xfdf6e3 },
  { id: "duck", name: "Rubber Duck", cost: 180, blurb: "Bath-time yellow, lake-grade rubber.", ring: 0xffd24a, patch: 0xff8a3d },
  { id: "donut", name: "Frosted Donut", cost: 260, blurb: "Strawberry glaze, with sprinkles.", ring: 0xff8fc0, patch: 0xf9e0a2 },
  { id: "lava", name: "Lava Ring", cost: 340, blurb: "Still warm. Don't ask.", ring: 0xe0503a, patch: 0x2a1b18 },
  { id: "royal", name: "Royal Ring", cost: 480, blurb: "Purple velvet and gold trim.", ring: 0x7d55d6, patch: 0xffd24a },
];

export const FLOATER_BY_ID = new Map(FLOATERS.map((f) => [f.id, f]));

/**
 * Dress a floater in place — `buoy` is what makeFloater() handed back. It
 * swaps to that floater's shape and paints its two materials.
 *
 * The cel shader swaps every lit material for a toon twin (celshader.js), so
 * painting only the source leaves the ring on screen exactly as red as it was.
 * Both get the colour.
 */
export function paintFloater(buoy, id) {
  const spec = FLOATER_BY_ID.get(id) ?? FLOATERS[0];
  buoy.setShape?.(spec.id);
  buoy.ringMat.color.setHex(spec.ring);
  celMat(buoy.ringMat).color.setHex(spec.ring);
  buoy.patchMat.color.setHex(spec.patch);
  celMat(buoy.patchMat).color.setHex(spec.patch);
  return spec;
}

// ------------------------------------------------------------------ trails
const _c = new THREE.Color();
const RAINBOW = [0xff5470, 0xff8a3d, 0xffd24a, 0x6fe07a, 0x37c8e0, 0x9d7cf4];

/** @type {{id:string,name:string,cost:number,blurb:string}[]} */
export const TRAILS = [
  { id: "none", name: "Wet Spray", cost: 0, blurb: "Just lake water, like everyone else." },
  { id: "sparkle", name: "Sparkle", cost: 150, blurb: "Leaves a glittering thread behind you." },
  { id: "bubbles", name: "Bubbles", cost: 180, blurb: "A wobbling string of bubbles." },
  { id: "ink", name: "Ink Cloud", cost: 220, blurb: "Squid-black smoke. Very mysterious." },
  { id: "snow", name: "Frost", cost: 260, blurb: "Cold enough to frost the water." },
  { id: "embers", name: "Embers", cost: 300, blurb: "Burning without the five-hop chain." },
  { id: "hearts", name: "Lovestruck", cost: 340, blurb: "The lake loves you back." },
  { id: "rainbow", name: "Rainbow", cost: 420, blurb: "Full spectrum, every hop." },
  { id: "bolt", name: "Live Wire", cost: 500, blurb: "Crackling arcs off a screaming stone." },
];

export const TRAIL_BY_ID = new Map(TRAILS.map((t) => [t.id, t]));

const rnd = (s) => (Math.random() - 0.5) * s;

/**
 * One frame of a stone's flight trail. `id` "none" falls through to the stock
 * wet spray so an unequipped rock looks exactly like it always did.
 */
export function emitTrail(particles, id, pos, tint) {
  const glow = particles.glow;
  switch (id) {
    case "sparkle":
      for (let i = 0; i < 2; i++) {
        _c.setHex(Math.random() < 0.5 ? 0xffffff : 0xffe98a);
        glow.emit(pos.x + rnd(0.4), pos.y + rnd(0.4), pos.z + rnd(0.4), rnd(0.5), 0.6 + Math.random(), rnd(0.5),
          0.5 + Math.random() * 0.4, 1.6 + Math.random() * 2.6, _c.r, _c.g, _c.b, -1.2, 1.4);
      }
      break;
    case "bubbles":
      _c.setHex(0xbfe8ff);
      glow.emit(pos.x + rnd(0.5), pos.y + rnd(0.3), pos.z + rnd(0.5), rnd(0.3), 1.6 + Math.random(), rnd(0.3),
        0.7 + Math.random() * 0.5, 2.4 + Math.random() * 3, _c.r, _c.g, _c.b, -2.4, 1.8);
      break;
    case "ink":
      _c.setHex(Math.random() < 0.3 ? 0x4a3f6b : 0x14121c);
      particles.spray.emit(pos.x + rnd(0.5), pos.y + rnd(0.4), pos.z + rnd(0.5), rnd(0.8), 0.5 + Math.random() * 0.7, rnd(0.8),
        0.75 + Math.random() * 0.5, 5 + Math.random() * 5, _c.r, _c.g, _c.b, -0.6, 2.6);
      break;
    case "snow":
      for (let i = 0; i < 2; i++) {
        _c.setHex(Math.random() < 0.5 ? 0xffffff : 0xa8e4ff);
        glow.emit(pos.x + rnd(0.7), pos.y + rnd(0.5), pos.z + rnd(0.7), rnd(0.6), rnd(0.5), rnd(0.6),
          0.9 + Math.random() * 0.6, 1.8 + Math.random() * 2, _c.r, _c.g, _c.b, 1.2, 2.2);
      }
      break;
    case "embers":
      for (let i = 0; i < 2; i++) {
        _c.setHex(Math.random() < 0.4 ? 0xffd24a : 0xff5a1e);
        glow.emit(pos.x + rnd(0.35), pos.y + rnd(0.3), pos.z + rnd(0.35), rnd(0.7), 1.1 + Math.random() * 1.2, rnd(0.7),
          0.4 + Math.random() * 0.35, 2.4 + Math.random() * 3, _c.r, _c.g, _c.b, -2.6, 1.6);
      }
      break;
    case "hearts":
      _c.setHex(Math.random() < 0.4 ? 0xffffff : 0xff6fa8);
      glow.emit(pos.x + rnd(0.5), pos.y + rnd(0.3), pos.z + rnd(0.5), rnd(0.4), 1.3 + Math.random(), rnd(0.4),
        0.8 + Math.random() * 0.5, 3.4 + Math.random() * 3, _c.r, _c.g, _c.b, -1.8, 1.5);
      break;
    case "rainbow":
      for (let i = 0; i < 2; i++) {
        _c.setHex(RAINBOW[(Math.random() * RAINBOW.length) | 0]);
        glow.emit(pos.x + rnd(0.6), pos.y + rnd(0.5), pos.z + rnd(0.6), rnd(0.5), rnd(0.8), rnd(0.5),
          0.55 + Math.random() * 0.4, 3 + Math.random() * 3.5, _c.r, _c.g, _c.b, 0.4, 1.8);
      }
      break;
    case "bolt":
      for (let i = 0; i < 3; i++) {
        _c.setHex(Math.random() < 0.35 ? 0xffffff : 0x8ad6ff);
        glow.emit(pos.x + rnd(1.1), pos.y + rnd(0.9), pos.z + rnd(1.1), rnd(2.4), rnd(2.4), rnd(2.4),
          0.16 + Math.random() * 0.14, 2 + Math.random() * 3.5, _c.r, _c.g, _c.b, 0, 4);
      }
      break;
    default:
      particles.trail(pos, tint);
  }
}

/** a little puff of the trail's own flavour, for the shop preview and unlocks */
export function trailBurst(particles, id, pos, tint) {
  for (let i = 0; i < 14; i++) emitTrail(particles, id, pos, tint);
}

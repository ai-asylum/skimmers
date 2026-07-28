/**
 * Live 3D previews for the garage's dressing-up box.
 *
 * The shop cards used to wear emoji stand-ins, which meant buying a Sombrero on
 * the strength of a cactus. Every card here shows the real article instead: the
 * hats come out of the same builders the stone on the bench wears
 * (cosmetics.js), the floaters are the same lifebuoy repainted (lifebuoy.js),
 * and the trails are the actual per-frame recipes a flying stone emits, running
 * on a stone flying across the card.
 *
 * One WebGL context does the lot. Each item gets a cell in a single scene,
 * spaced far enough apart that nothing bleeds into its neighbour, plus its own
 * camera; a frame is one clear and then a scissored render per card slot on
 * screen (the three.js multiple-elements trick), so eleven hats cost eleven
 * small viewports rather than eleven contexts. The canvas is a transparent
 * overlay laid exactly over the scrolling card grid and only ever painted
 * inside the slots, so the DOM keeps owning the layout — cards can hover,
 * wobble and scroll and the previews follow.
 *
 * Nothing here is load-bearing: if the context can't be had, the slots keep the
 * emoji they were built with.
 */
import * as THREE from "three";
import { CelShader } from "./celshader.js";
import { Particles } from "./particles.js";
import { makeHat, paintFloater, emitTrail } from "./cosmetics.js";
import { makeLifebuoy } from "./lifebuoy.js";
import { addOutline } from "./outline.js";

const CELL_GAP = 90;      // world units between cells — further than any trail carries
const PEBBLE_HALF = 0.46; // half-thickness of the stand-in stone, in hat units
const FRAME_PAD = 1.18;   // air left around a fitted subject
const TRAIL_TINT = 0xbfe8ff; // the wet spray a player's stone sheds
// A hat is framed on the hat, not on the stone under it: the shot starts a
// finger's width down the stone's crown and lets the rest run off the bottom of
// the box, which is how a hat shop displays a hat. `HAT_MIN_HALF` keeps the
// small ones (a halo, a daisy) from being blown up to fill the card.
const HAT_FLOOR = PEBBLE_HALF - 0.42;
const HAT_MIN_HALF = 0.62;
const FLY_PERIOD = 1.5; // seconds for a trail's stone to cross its card
const FLY_REST = 0.9;   // and the beat after it, long enough for the trail to fade
const EDGE = 3;         // px held back from the display box's rounded corners
// Two puffs a frame: a preview stone drifts across its card where a real throw
// crosses the lake, and one puff a frame leaves a dotted line rather than a
// trail. Ink is already a cloud at one.
const PUFFS = { ink: 1 };

// Hats face the camera at three-quarters and sway rather than spin: a cap you
// can only read for a third of its turn is a worse shop card than one you can
// always read. The stone's front is +x in the game (that's the way it travels
// and where its face is), so -90° swings that round to the viewer.
const HAT_YAW = -Math.PI / 4;
const HAT_SWAY = 0.35;

// A long lens on the hats and rings keeps them from bulging; the trails want a
// much longer one still, because point sprites shrink with distance and the
// particle sizes are tuned for a camera watching the lake from thirty metres.
const LENS = {
  hat: { dist: 9, dir: new THREE.Vector3(0, 0.34, 1).normalize() },
  floater: { dist: 9, dir: new THREE.Vector3(0, 0.3, 1).normalize() },
  trail: { dist: 38, dir: new THREE.Vector3(0, 0.16, 1).normalize() },
};

// the stand-in stone every hat sits on, and the one that flies the trails
let pebbleGeo = null;
let pebbleMat = null;
function pebble(scale = 1) {
  if (!pebbleGeo) {
    pebbleGeo = new THREE.IcosahedronGeometry(1, 1);
    pebbleGeo.scale(1, PEBBLE_HALF, 1);
    pebbleMat = new THREE.MeshStandardMaterial({ color: 0x8f9aa3, flatShading: true, roughness: 0.85 });
  }
  const m = new THREE.Mesh(pebbleGeo, pebbleMat);
  m.scale.setScalar(scale);
  addOutline(m, 0x16324a, { thickness: 0.05 });
  return m;
}

class Stage {
  constructor() {
    this.canvas = document.createElement("canvas");
    this.canvas.id = "preview-gl";
    document.body.appendChild(this.canvas);

    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.setClearAlpha(0);

    this.scene = new THREE.Scene();
    // the game's own lighting rig (world.js), scaled to these doll-sized scenes
    const key = new THREE.DirectionalLight(0xfff2d8, 1.9); key.position.set(6, 8, 6);
    const fill = new THREE.DirectionalLight(0x9fd0ff, 0.55); fill.position.set(-5, 3, -6);
    this.scene.add(key, fill);
    this.scene.add(new THREE.AmbientLight(0x88aabb, 0.6));
    this.scene.add(new THREE.HemisphereLight(0xbfeaf5, 0x2a6448, 0.6));

    // cel twins are made per cell as it's built, so nothing is ever drawn for a
    // frame in its untoned form; the periodic rescan is left off
    this.cel = new CelShader(this.scene, { steps: 4, floor: 0.42, rescanSec: 1e9 });
    // trails only, and only ever a couple of cards' worth alive at once
    this.particles = new Particles(this.scene, { spray: 700, glow: 1400, rings: 0, feathers: 0 });
    this.pointClouds = [this.particles.spray.points, this.particles.glow.points];

    this.cells = new Map(); // "kind:id" -> cell, kept for the session
    this.slots = [];        // { el, cell } for the cards currently on the grid
    this.container = null;
    this.running = false;
    this.elapsed = 0;
    this._last = 0;
    this._size = { w: 0, h: 0 };
    this._pos = new THREE.Vector3();
    this._target = new THREE.Vector3();
    this._frame = this._frame.bind(this);
  }

  // ---------------------------------------------------------------- the cells
  cellFor(kind, id) {
    const key = `${kind}:${id}`;
    let cell = this.cells.get(key);
    if (!cell) {
      cell = this._build(kind, id);
      this.cells.set(key, cell);
    }
    return cell;
  }

  _build(kind, id) {
    const holder = new THREE.Group();
    holder.position.x = this.cells.size * CELL_GAP;
    const content = new THREE.Group();
    holder.add(content);
    const cell = {
      kind, id, holder, content,
      camera: new THREE.PerspectiveCamera(20, 1, 0.1, 400),
      lens: LENS[kind] ?? LENS.hat,
      phase: this.cells.size * 0.7, // so a rack of them doesn't sway in lockstep
      flyer: null, hat: null, buoy: null, tilt: null,
      frame: null,
    };

    if (kind === "hat") {
      content.add(pebble());
      const hat = makeHat(id);
      if (hat) {
        // the same seat Rock._placeHat gives it, for a unit-sized stone
        hat.position.y = PEBBLE_HALF * 0.92;
        content.add(hat);
        cell.hat = hat;
      }
    } else if (kind === "floater") {
      // the ring is built lying flat for the water; lean it back towards the
      // camera so the card shows a fat ellipse instead of a bar
      const tilt = new THREE.Group();
      tilt.rotation.x = -0.72;
      const buoy = makeLifebuoy();
      paintFloater(buoy, id);
      tilt.add(buoy.group);
      content.add(tilt);
      cell.buoy = buoy;
      cell.tilt = tilt;
    } else {
      const flyer = pebble(0.5);
      content.add(flyer);
      cell.flyer = flyer;
    }

    this.scene.add(holder);
    this.cel.convert(holder);

    if (kind === "trail") {
      // particles have no bounds worth measuring: frame the flight path plus
      // room above and below for whatever the stone sheds
      cell.frame = { cx: 0, cy: 0.3, halfW: 3.3, halfH: 1.25 };
    } else if (cell.hat) {
      cell.frame = this._fit(cell, cell.hat, { floor: HAT_FLOOR, minHalfW: HAT_MIN_HALF });
    } else {
      cell.frame = this._fit(cell, cell.content);
    }
    return cell;
  }

  /** the box a subject sweeps as it turns, in cell-local units */
  _fit(cell, subject, { floor = null, minHalfW = 0 } = {}) {
    cell.holder.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(subject);
    if (floor != null) box.expandByPoint(this._pos.set(cell.holder.position.x, floor, 0));
    const size = box.getSize(new THREE.Vector3());
    const mid = box.getCenter(new THREE.Vector3());
    return {
      cx: mid.x - cell.holder.position.x,
      cy: mid.y,
      halfW: Math.max((Math.max(size.x, size.z) / 2) * FRAME_PAD, minHalfW),
      halfH: (size.y / 2) * FRAME_PAD,
    };
  }

  // ---------------------------------------------------------------- animation
  _animate(cell, dt) {
    if (cell.kind === "hat") {
      cell.content.rotation.y = HAT_YAW + Math.sin(this.elapsed * 0.5 + cell.phase) * HAT_SWAY;
    }

    if (cell.hat) {
      // moving parts, turned exactly as Rock.update turns them
      const ud = cell.hat.userData;
      if (ud.spinner) ud.spinner.rotation.y += (ud.spinRate ?? 1) * dt;
      if (ud.bob) ud.spinner.position.y = 0.5 + Math.sin(this.elapsed * 1.8) * ud.bob;
    }

    if (cell.buoy) {
      // rolling in its own plane, lolling like the ones on the bench seat
      cell.buoy.group.rotation.z += 0.45 * dt;
      cell.tilt.rotation.z = Math.sin(this.elapsed * 0.8) * 0.07;
    }

    if (cell.flyer) {
      // A stone crossing the card on a shallow arc, shedding its trail, then a
      // beat off-card while the last of it fades — without that gap the stone
      // comes back round the left while its own tail is still hanging on the
      // right, and the trail reads as something it's flying towards.
      const t = this.elapsed % (FLY_PERIOD + FLY_REST);
      cell.flyer.visible = t < FLY_PERIOD;
      if (!cell.flyer.visible) return;
      const k = t / FLY_PERIOD;
      const { halfW } = cell.frame;
      cell.flyer.position.set(-halfW * 0.84 + k * halfW * 1.68, 0.5 + Math.sin(k * Math.PI) * 0.34, 0);
      cell.flyer.rotation.y += 7 * dt;
      cell.flyer.rotation.z = 0.3;
      this._pos.copy(cell.flyer.position).add(cell.holder.position);
      for (let i = PUFFS[cell.id] ?? 2; i > 0; i--) {
        emitTrail(this.particles, cell.id, this._pos, TRAIL_TINT);
      }
    }
  }

  _aim(cell, aspect) {
    const { frame, camera, lens } = cell;
    // fixed distance, fov opened just wide enough to hold the subject: a card
    // that is wider than it is tall is framed by its height either way
    const halfH = Math.max(frame.halfH, frame.halfW / Math.max(0.001, aspect));
    camera.fov = THREE.MathUtils.radToDeg(2 * Math.atan(halfH / lens.dist));
    camera.aspect = aspect;
    this._target.set(cell.holder.position.x + frame.cx, frame.cy, 0);
    camera.position.copy(this._target).addScaledVector(lens.dir, lens.dist);
    camera.lookAt(this._target);
    camera.updateProjectionMatrix();
  }

  // ---------------------------------------------------------------- lifecycle
  /** claim every [data-preview] slot under `container` (its own scroll box) */
  sync(container) {
    this.container = container;
    this.slots = [];
    for (const el of container.querySelectorAll("[data-preview]")) {
      const [kind, id] = el.dataset.preview.split(":");
      if (!kind || !id) continue;
      el.classList.add("live"); // the emoji underneath steps aside
      this.slots.push({ el, cell: this.cellFor(kind, id) });
    }
    if (this.slots.length) this.start();
    else this.stop();
  }

  start() {
    this.canvas.style.display = "block";
    if (this.running) return;
    this.running = true;
    this._last = performance.now();
    requestAnimationFrame(this._frame);
  }

  stop() {
    this.running = false;
    this.canvas.style.display = "none";
    for (const s of this.slots) s.el.classList.remove("live");
    this.slots = [];
  }

  /** lay the canvas exactly over the card grid */
  _cover(rect) {
    const s = this.canvas.style;
    s.left = `${rect.left}px`;
    s.top = `${rect.top}px`;
    s.width = `${rect.width}px`;
    s.height = `${rect.height}px`;
    const w = Math.round(rect.width), h = Math.round(rect.height);
    if (w !== this._size.w || h !== this._size.h) {
      this._size = { w, h };
      this.renderer.setSize(w, h, false);
    }
  }

  _frame(now) {
    if (!this.running) return;
    requestAnimationFrame(this._frame);

    let dt = (now - this._last) / 1000;
    this._last = now;
    if (!Number.isFinite(dt) || dt < 0) dt = 1 / 60;
    dt = Math.min(0.05, dt);
    this.elapsed += dt;

    const box = this.container.getBoundingClientRect();
    if (!box.width || !box.height) return;
    this._cover(box);

    // only the cards actually on screen get animated or drawn
    const live = [];
    for (const { el, cell } of this.slots) {
      const r = el.getBoundingClientRect();
      if (r.bottom <= box.top || r.top >= box.bottom || !r.width || !r.height) continue;
      live.push({ cell, r });
      this._animate(cell, dt);
    }
    this.particles.update(dt);

    const gl = this.renderer;
    gl.setScissorTest(false);
    gl.clear();
    gl.setScissorTest(true);
    for (const { cell, r } of live) {
      const x = r.left - box.left;
      const y = box.bottom - r.bottom; // viewports count up from the bottom
      // The viewport carries the whole card slot, so the framing never shifts;
      // the scissor trims whatever has scrolled out of the grid, and holds a
      // hair inside the slot — a scissor is a rectangle and the display box has
      // rounded corners a stray spark would otherwise sit outside.
      const top = Math.max(r.top + EDGE, box.top);
      const bot = Math.min(r.bottom - EDGE, box.bottom);
      if (bot <= top) continue;
      gl.setViewport(x, y, r.width, r.height);
      gl.setScissor(x + EDGE, box.bottom - bot, Math.max(0, r.width - EDGE * 2), bot - top);
      this._aim(cell, r.width / r.height);
      for (const p of this.pointClouds) p.visible = cell.kind === "trail";
      gl.render(this.scene, cell.camera);
    }
    gl.setScissorTest(false);
  }
}

let stage = null;
let refused = false; // no context to be had: leave the emoji alone, for good

/** wire up every preview slot under `container`, and start drawing */
export function syncPreviews(container) {
  if (refused || !container) return;
  if (!stage) {
    try {
      stage = new Stage();
    } catch (err) {
      refused = true;
      console.warn("cosmetic previews off:", err);
      return;
    }
  }
  stage.sync(container);
}

export function stopPreviews() {
  stage?.stop();
}

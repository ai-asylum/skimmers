/**
 * Skippidy Skip — main loop and state machine.
 *
 * TITLE -> SHELF (the bench: race a rock you kept, or tap an empty floater) ->
 * FIND (pick a rock) -> SHAPE (grind it) -> PAINT -> NAME (and it's saved to
 * the bench) -> RACE (3 holes vs 7 bot rivals, all through the same Skimmer
 * physics) -> RESULTS.
 *
 * Camera: camRig (world placement) > shakeRig (trauma shake) > camera,
 * per the Spellbook engine layering. Hitstop scales sim time, UI keeps real dt.
 */
import * as THREE from "three";
import {
  hitstop, slowmo, updateTime, shake, applyShake, fovKick, updateFovKick,
  Spring, clamp, clamp01, lerp, damp, haptic,
} from "./juice.js";
import { audio } from "./audio.js";
import { CelShader } from "./celshader.js";
import { addOutline } from "./outline.js";
import { Particles } from "./particles.js";
import { Water, WATER_Y, LAKE_R, VORTEX_R } from "./water.js";
import { World, shoreHeight, RivalLines, PONTOON_DECK } from "./world.js";
import { Boats } from "./boats.js";
import { RockBench, rockLift } from "./bench.js";
import { SHELF_SLOTS, loadShelf, saveSlot, clearSlot, firstFreeSlot } from "./shelf.js";
import {
  Rock, ROCK_PATTERNS, PAINT_COLORS, BRUSH_MIN, BRUSH_MAX, BRUSH_DEF,
  rockName, randomBotRock, setEyeTarget,
} from "./rock.js";
import { EYE_EXPRESSIONS, EYE_INDEX } from "./flateyes.js";
import { Skimmer, simulateThrow, BLAST_R, SKIP_ELEV, MAX_ELEV } from "./physics.js";
import { BotBrain, BOT_PERSONAS } from "./bots.js";
import { Fishing, BUOY_REST } from "./fishing.js";
import { Minimap } from "./minimap.js";
import { HOLES } from "./holes.js";
import { Net, matchCode } from "./net.js";
import * as ui from "./ui.js";
import * as metaui from "./metaui.js";
import {
  loadMeta, shells, addShells, loadoutFor, clearLoadout, cupRecord, recordCup, resetMeta,
} from "./meta.js";
import { resolveMods, UPGRADE_BY_ID } from "./upgrades.js";
import { emitTrail, trailBurst } from "./cosmetics.js";
import { CUPS, TIERS, buildCourse, payoutFor } from "./cups.js";
import { initAnalytics, track } from "./analytics.js";
import { initTweakMenu } from "./tweakmenu.js";

// ------------------------------------------------------------------ renderer
const canvas = document.getElementById("c");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(58, window.innerWidth / window.innerHeight, 0.1, 900);
const camRig = new THREE.Group();
const shakeRig = new THREE.Group();
camRig.add(shakeRig);
shakeRig.add(camera);
// Group.lookAt points the rig's +z at the target while cameras look down -z:
// flip the camera inside the rig so camRig.lookAt(target) frames the target.
camera.rotation.y = Math.PI;
scene.add(camRig);

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ------------------------------------------------------------------ systems
const water = new Water(scene);
const world = new World(scene);
const boats = new Boats(scene);
const particles = new Particles(scene);
const fishing = new Fishing(scene, particles, water);
const rivalLines = new RivalLines(scene);
const bench = new RockBench(scene);
const minimap = new Minimap();
const cel = new CelShader(scene, { steps: 4, floor: 0.42, rescanSec: 1.0 });

// ------------------------------------------------------------------ match config
// Holes (fairway path + islands + spire rocks) live in ./holes.js so the admin
// level editor can share and re-export them. Land on an island and you throw
// from dry sand, no fishing. Edit visually at /admin.
// The hole is a whirlpool and its rim is the capture zone, so this comes from the
// same place the vortex is drawn from — the swirl you see is the zone you score
// in. You have to put the stone *into* that water; overflying it does nothing.
const CAPTURE_R = VORTEX_R;
const FERRY_NAMES = { row: "rowboat", outboard: "motorboat", trawler: "fishing boat" };

// PLAYABLE-AD slices (built with playable-kit). There are two, each a compile
// -time define that trims main.js to one half of the game:
//   __PLAYABLE_SKIP__  — the skip-and-chain race: skip title/find/shape/paint,
//                        drop straight onto one short obstacle-light hole with a
//                        few *nerfed* rivals (see bots.js AIM_NERF). Win => CTA.
//   __PLAYABLE_CRAFT__ — the make-a-rock loop: find -> shape -> paint, then the
//                        ad's end card. No racing at all.
// `typeof` guards keep the tokens inert in the normal web/Android build.
const IS_PLAYABLE_SKIP = typeof __PLAYABLE_SKIP__ !== "undefined" && !!__PLAYABLE_SKIP__;
const IS_PLAYABLE_CRAFT = typeof __PLAYABLE_CRAFT__ !== "undefined" && !!__PLAYABLE_CRAFT__;
// Shared "we're inside an ad" flag: skips meta/analytics/title bootstrapping.
const IS_PLAYABLE = IS_PLAYABLE_SKIP || IS_PLAYABLE_CRAFT;
// Debug scene-colour tweak menu (press `). Dev tool only — kept out of ads and
// only wired up when served locally, never in production.
const IS_LOCALHOST = /^(localhost|127\.0\.0\.1|\[?::1\]?|.*\.local)$/i.test(location.hostname)
  || /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(location.hostname);
if (!IS_PLAYABLE && IS_LOCALHOST) initTweakMenu({ scene, world, water });
if (IS_PLAYABLE_SKIP) {
  HOLES.length = 0;
  HOLES.push({
    time: 60,
    path: [{ x: 0, z: 34 }, { x: 0, z: 4 }, { x: 0, z: -30 }],
    islands: [],
    rocks: [{ x: 12, z: 9, r: 3, h: 6 }, { x: -12, z: -11, r: 3, h: 6 }],
  });
}

/**
 * The three holes this race is actually running. A cup rebuilds them from the
 * authored HOLES through its own transforms (cups.js `buildCourse`) — mirrored,
 * reversed, narrowed — so everything downstream reads the course out of here
 * rather than out of holes.js, and nothing has to know which cup it's in.
 */
let COURSE = HOLES;

// The hole doesn't close behind the first stone in. Dropping in starts the
// final stretch instead: everyone else has this long to hole out too, and the
// order they drop in is the order they score (holePoints). It's a deadline for
// the players, not a wait — the hole is called the moment they're all home. The
// ad slice runs a short one so its end-card isn't two minutes away.
const FINAL_STRETCH = IS_PLAYABLE_SKIP ? 15 : 120;
/** what a hole is worth from a given finishing place; stones still on the water
 * at the bell score nothing, so any stone in the hole beats any stone out of it */
const holePoints = (place) => Math.max(1, G.racers.length - place + 1);
const ordinal = (n) => {
  const teens = n % 100 >= 11 && n % 100 <= 13;
  return n + (teens ? "th" : ["th", "st", "nd", "rd"][n % 10] ?? "th");
};

const holeTee = (idx = G.hole) => COURSE[idx].path[0];
const holeFlag = (idx = G.hole) => COURSE[idx].path[COURSE[idx].path.length - 1];
/** what the aim (and the camera behind it) points at from the current lie: the
 * first island off the tee, since the flag is around the dogleg behind spires */
const aimTarget = (idx = G.hole) =>
  (G.player?.onStartBridge && COURSE[idx].islands?.[0]) || holeFlag(idx);
function holeLength(idx) {
  const p = COURSE[idx].path;
  let d = 0;
  for (let i = 1; i < p.length; i++) d += Math.hypot(p[i].x - p[i - 1].x, p[i].z - p[i - 1].z);
  return d;
}
/** Point on the fairway centreline — the line the buoys are strung along — at
 * arc distance `d` from the tee. Distances off either end extrapolate along the
 * end leg, so a camera can sit behind the tee or aim past the flag. */
function pathPointAtDist(d, idx = G.hole, out = new THREE.Vector3()) {
  const p = COURSE[idx].path;
  let rest = d;
  for (let i = 1; i < p.length; i++) {
    const a = p[i - 1], b = p[i];
    const len = Math.hypot(b.x - a.x, b.z - a.z) || 1;
    if (rest <= len || i === p.length - 1) {
      const f = rest / len;
      return out.set(a.x + (b.x - a.x) * f, 0, a.z + (b.z - a.z) * f);
    }
    rest -= len;
  }
  return out.set(p[0].x, 0, p[0].z);
}

// ------------------------------------------------------------------ game state
const G = {
  state: "title", // title | shelf | find | shape | paint | name | race | holeEnd | results
  elapsed: 0,
  hole: 0,
  holeTime: 0,
  holeWinner: null, // first stone in — it takes the star and the camera
  holeFinishers: [], // every stone that holed out, in the order it did
  holeOver: false, // hole is called: clock stopped, no more throws
  player: null, // Skimmer
  playerRock: null, // Rock (chosen in FIND)
  bots: [], // BotBrain[]
  racers: [], // all Skimmers
  candidates: [], // FIND-phase rocks
  candidateIdx: -1,
  sinkers: [], // passed-over candidates on their way down into the sand
  shapeHold: new THREE.Vector3(), // where SHAPE floats the stone: arm's length from the camera
  shelf: [], // saved-rock entries per bench slot (see shelf.js), null where empty
  shelfRocks: new Array(SHELF_SLOTS).fill(null), // the Rocks those entries grew into
  shelfSel: -1, // bench slot the player has picked to race
  slotIdx: -1, // bench slot the rock being made is headed for
  releaseArmed: false, // "back to the lake with it" wants a second tap
  sculpting: false, // finger is down on the stone in SHAPE
  shapeEyeFade: 1, // the face dims while you sculpt so you can see your work
  shapeEyeHold: 0, // game-time until which the face stays dimmed (post-breakthrough)
  throwMode: "skip",
  throwCooldown: 0,
  slowmoUsed: false,
  aimDir: new THREE.Vector3(0, 0, -1), // camera-following aim direction
  paintDrag: { mode: null, lastX: 0, lastY: 0, spinVel: 0 }, // paint-phase grab & spin
  brushColor: PAINT_COLORS[1], // paint loaded on the brush
  brushSize: BRUSH_DEF, // dab radius in skin texels
  idleSpinAt: 0, // game-time after which the rock's lazy turntable spin may resume (5s after last touch)
  raceTape: [], // rolling frames of EVERY racer's transform, for the killcam
  raceTapeEvents: [], // { frame, type, x, y, z, who } splashes etc, re-fired in replay
  effects: [], // { t, fn } delayed one-shots on game time
  // ---- career (meta.js / cups.js): what we're racing and what it pays
  cup: CUPS[0], // the three-course cup this match is running
  tier: TIERS[0], // the class it's running in
  cupIdx: 0,
  tierIdx: 0,
  loadout: null, // the equipped upgrades + cosmetics of the stone in play
  procT: new Map(), // upgrade id -> game-time it last shouted, so it can't spam
};
const TAPE_MAX = 200; // ~3.3s of full-scene replay
// per racer: x, y, z, rotation.y, eye-expression index (-1 = leave it alone)
const TAPE_STRIDE = 5;

function recordTapeFrame() {
  const n = G.racers.length;
  const frame = new Float32Array(n * TAPE_STRIDE);
  for (let i = 0; i < n; i++) {
    const s = G.racers[i];
    const m = s.mesh;
    const o = i * TAPE_STRIDE;
    frame[o] = m.position.x;
    frame[o + 1] = m.position.y;
    frame[o + 2] = m.position.z;
    frame[o + 3] = m.rotation.y;
    frame[o + 4] = EYE_INDEX[s.rock?.expression] ?? -1;
  }
  G.raceTape.push(frame);
  if (G.raceTape.length > TAPE_MAX) {
    G.raceTape.shift();
    for (const e of G.raceTapeEvents) e.frame--;
    G.raceTapeEvents = G.raceTapeEvents.filter((e) => e.frame >= 0);
  }
}

/** point the aim (and thus the camera) from the player's lie down the fairway */
function resetAim() {
  const p = G.player;
  if (!p) return;
  const f = aimTarget();
  G.aimDir.set(f.x - p.pos.x, 0, f.z - p.pos.z);
  if (G.aimDir.lengthSq() < 0.01) G.aimDir.set(0, 0, -1);
  G.aimDir.normalize();
}

function after(sec, fn) { G.effects.push({ t: sec, fn }); }

// ------------------------------------------------------------------ input
const pointer = {
  down: false, dragging: false,
  voided: false, // this stroke strayed into a no-aim state; it needs a fresh press
  startX: 0, startY: 0, x: 0, y: 0,
  dx: 0, dy: 0, dt: 0, t: 0, // per-event travel and the gap before it, for aim accel
};
const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();

canvas.addEventListener("pointerdown", (e) => {
  pointer.down = true;
  pointer.dragging = false;
  pointer.voided = false;
  pointer.startX = pointer.x = e.clientX;
  pointer.startY = pointer.y = e.clientY;
  pointer.dx = pointer.dy = pointer.dt = 0;
  pointer.t = performance.now();
  drag.aimX = 0;
  drag.aimSpeed = 0;
  onPointerDown(e);
});
window.addEventListener("pointermove", (e) => {
  const now = performance.now();
  pointer.dx = e.clientX - pointer.x;
  pointer.dy = e.clientY - pointer.y;
  // no event fires while the pointer sits still, so a long gap means the stroke
  // restarted rather than crawled: report it as a stall (dt 0 = no speed)
  pointer.dt = now - pointer.t > 120 ? 0 : Math.max(4, now - pointer.t);
  pointer.t = now;
  pointer.x = e.clientX;
  pointer.y = e.clientY;
  if (pointer.down) {
    const d = Math.hypot(pointer.x - pointer.startX, pointer.y - pointer.startY);
    if (d > 8) pointer.dragging = true;
  }
  onPointerMove(e);
});
window.addEventListener("pointerup", (e) => {
  onPointerUp(e);
  pointer.down = false;
  pointer.dragging = false;
});
window.addEventListener("keydown", (e) => {
  if (e.key === "x" || e.key === "X" || e.key === "Tab") {
    e.preventDefault();
    setThrowMode(G.throwMode === "skip" ? "splash" : "skip");
  }
});

/** point `raycaster` through a screen position without hitting anything with it */
function aimAt(clientX, clientY) {
  ndc.set((clientX / window.innerWidth) * 2 - 1, -(clientY / window.innerHeight) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  return raycaster.ray;
}

function raycastFrom(e, objects) {
  aimAt(e.clientX, e.clientY);
  return raycaster.intersectObjects(objects, true);
}

const _wsPos = new THREE.Vector3();
const _wsQuat = new THREE.Quaternion();
const _wsDir = new THREE.Vector3();
function worldToScreen(v) {
  camera.getWorldPosition(_wsPos);
  camera.getWorldDirection(_wsDir);
  const behind = _wsDir.dot(_wsPos.multiplyScalar(-1).add(v)) < 0;
  const p = v.clone().project(camera);
  return { x: (p.x * 0.5 + 0.5) * window.innerWidth, y: (-p.y * 0.5 + 0.5) * window.innerHeight, behind };
}

// ------------------------------------------------------------------ aim preview
const previewDots = [];
const previewMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, depthWrite: false });
{
  const geo = new THREE.SphereGeometry(0.16, 8, 6);
  const mat = previewMat;
  for (let i = 0; i < 26; i++) {
    const m = new THREE.Mesh(geo, mat);
    m.visible = false;
    m.renderOrder = 6;
    scene.add(m);
    previewDots.push(m);
  }
}
const blastRing = (() => {
  const geo = new THREE.RingGeometry(BLAST_R - 0.25, BLAST_R, 40);
  geo.rotateX(-Math.PI / 2);
  const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0xff5470, transparent: true, opacity: 0.8, depthWrite: false }));
  m.visible = false;
  m.renderOrder = 6;
  scene.add(m);
  return m;
})();

function hidePreview() {
  for (const d of previewDots) d.visible = false;
  blastRing.visible = false;
}

// ------------------------------------------------------------------ camera control
const cam = {
  pos: new THREE.Vector3(0, 30, 90),
  look: new THREE.Vector3(0, 0, 0),
  lookCur: new THREE.Vector3(0, 0, 0),
  mode: "orbit", // orbit | intro | aim | flight | fishing | replay | pan | closeup
  baseFov: 58,
  from: new THREE.Vector3(), // "pan" start pose
  fromLook: new THREE.Vector3(),
  panT: 0,
  panDur: 1,
};
// how far down the buoy line the hole-intro camera looks ahead of itself
const CAM_INTRO_LEAD = 13;

/** cut straight to a framed shot (used under a wipe, where no one can see it) */
function camSnapTo(pos, look) {
  cam.mode = "closeup";
  cam.pos.copy(pos);
  cam.look.copy(look);
  camRig.position.copy(pos);
  cam.lookCur.copy(look);
}

/** glide from wherever we are to a new closeup — the bench-to-beach trip */
function camPanTo(pos, look, dur = 1.4) {
  cam.from.copy(camRig.position);
  cam.fromLook.copy(cam.lookCur);
  cam.pos.copy(pos);
  cam.look.copy(look);
  cam.panT = 0;
  cam.panDur = dur;
  cam.mode = "pan";
}

function camUpdate(dt) {
  let targetPos = cam.pos, targetLook = cam.look;
  const p = G.player;

  if (cam.mode === "orbit") {
    const a = G.elapsed * 0.06;
    targetPos = new THREE.Vector3(Math.cos(a) * 70, 30, Math.sin(a) * 70);
    targetLook = new THREE.Vector3(0, -4, 0);
  } else if (cam.mode === "intro" && p) {
    // hole-intro flyover: back away from the flag to your stone along the buoy
    // line itself, rather than the tee->flag chord, so the sweep reads the route
    // you have to thread — doglegs included — with the buoys passing underneath.
    G.introT += dt;
    const t = clamp01(G.introT / 2.6);
    const e = t * t * (3 - 2 * t);
    const d = lerp(holeLength(G.hole) - CAM_INTRO_LEAD, -6.5, e);
    targetPos = pathPointAtDist(d).setY(lerp(7, 3.4, e));
    // keep the look point that far further down the line: the camera faces the
    // hole the whole way back instead of swinging round at the end
    targetLook = pathPointAtDist(d + CAM_INTRO_LEAD).setY(lerp(3.5, 1.2, e));
    // ease into the exact "aim" pose (facing the first island) over the tail of
    // the sweep so the handoff at t=1 doesn't jump
    const hand = clamp01((t - 0.72) / 0.28);
    if (hand > 0) {
      const h = hand * hand * (3 - 2 * hand);
      targetPos.lerp(p.pos.clone().addScaledVector(G.aimDir, -6.5).add(new THREE.Vector3(0, 3.4, 0)), h);
      targetLook.lerp(p.pos.clone().addScaledVector(G.aimDir, 10).add(new THREE.Vector3(0, 1.2, 0)), h);
    }
    if (t >= 1) cam.mode = "aim";
  } else if (cam.mode === "aim" && p) {
    // orbit behind the CURRENT aim so the trajectory previz stays centered
    const dir = G.aimDir;
    const pull = drag.power * 2.2;
    targetPos = p.pos.clone().addScaledVector(dir, -(6.5 + pull)).add(new THREE.Vector3(0, 3.4 + pull * 0.4, 0));
    targetLook = p.pos.clone().addScaledVector(dir, 10).add(new THREE.Vector3(0, 1.2, 0));
  } else if (cam.mode === "flight" && p) {
    const v = p.vel.clone();
    v.y = 0;
    if (v.lengthSq() < 1) v.set(0, 0, -1);
    v.normalize();
    targetPos = p.pos.clone().addScaledVector(v, -8.5).add(new THREE.Vector3(0, 4.2, 0));
    targetLook = p.pos.clone().addScaledVector(v, 4);
  } else if (cam.mode === "fishing" && fishing.active) {
    const pose = fishing.getCamPose();
    targetPos = pose.pos;
    targetLook = pose.look;
  } else if (cam.mode === "replay" && G.replay) {
    targetPos = G.replay.pos.clone().addScaledVector(G.replay.side, 9).add(new THREE.Vector3(0, 2.4, 0));
    targetLook = G.replay.pos;
  } else if (cam.mode === "pan") {
    // a walk along the shore: ease the whole pose over, then hand back to closeup
    cam.panT += dt;
    const t = clamp01(cam.panT / cam.panDur);
    const e = t * t * (3 - 2 * t);
    targetPos = cam.from.clone().lerp(cam.pos, e);
    targetLook = cam.fromLook.clone().lerp(cam.look, e);
    if (t >= 1) cam.mode = "closeup";
  } else if (cam.mode === "closeup") {
    // set explicitly by phase code via cam.pos/cam.look
    targetPos = cam.pos;
    targetLook = cam.look;
  }

  // snappier orbit while actively dragging so the previz tracks the pointer
  const l = cam.mode === "flight" ? 6.5
    : cam.mode === "intro" ? 8
    : cam.mode === "pan" ? 11
    : cam.mode === "replay" ? 6
    : cam.mode === "aim" && drag.active ? 6.5
    : 3.6;
  camRig.position.x = damp(camRig.position.x, targetPos.x, l, dt);
  camRig.position.y = damp(camRig.position.y, targetPos.y, l, dt);
  camRig.position.z = damp(camRig.position.z, targetPos.z, l, dt);
  // ride over the banks instead of burrowing through them (the dive camera is
  // meant to be underwater, so it opts out)
  // Over water the ground is the lake bed, metres down — hold the rig just
  // below the surface there rather than letting it follow the bowl.
  if (cam.mode !== "fishing") {
    const ground = Math.max(shoreHeight(camRig.position.x, camRig.position.z), WATER_Y - 0.6) + 1.6;
    if (camRig.position.y < ground) camRig.position.y = ground;
  }
  cam.lookCur.x = damp(cam.lookCur.x, targetLook.x, l + 1.5, dt);
  cam.lookCur.y = damp(cam.lookCur.y, targetLook.y, l + 1.5, dt);
  cam.lookCur.z = damp(cam.lookCur.z, targetLook.z, l + 1.5, dt);
  camRig.lookAt(cam.lookCur);

  camera.fov = cam.baseFov + updateFovKick(dt) + drag.power * 4;
  camera.updateProjectionMatrix();
}

function currentFlagV3() {
  const f = holeFlag();
  return new THREE.Vector3(f.x, 0, f.z);
}

// ------------------------------------------------------------------ drag / throw
// The drag is two independent axes rather than one slingshot pull.
//
//   sideways -> look. A full swipe across the short edge of the screen carries
//     you further than all the way round the stone, and it costs no power at
//     all, so you can spin the camera to read the hole and still throw the shot
//     you meant to throw. This is the whole reason power is not |drag|.
//   up/down  -> how the stone leaves your hand, and how hard. Pull back (down)
//     for the flat hard skipper; push forward (up) to loft it, all the way to
//     MAX_ELEV where it goes up like a mortar — and comes back down steep enough
//     to punch straight through the surface and glug, since the angle it meets
//     the water at is the whole of the skip test.
//     Distance travelled on this axis is the power either way.
const AIM_TURNS = 0.9; // screen-widths of sideways drag per full 360° of look
const PULL_SPAN = 0.30; // fraction of the short screen edge for a full-power pull
const LOFT_SPAN = 0.7; // of an upward pull, the part that steepens the throw
const FLAT_ELEV = SKIP_ELEV + 0.10; // the flattest end of the lofted range

// Pointer acceleration, look axis only. Sideways aim is accumulated per event
// with a speed-dependent gain, so a fast flick spins you further than the same
// distance crawled: whip the camera round to read the hole, then creep the last
// few degrees onto the line. Power stays a plain absolute pull — a given
// vertical distance must always mean the same throw.
// Speed is measured in short screen edges per second rather than pixels, so the
// same flick of the thumb boosts the same amount on a phone and on a monitor.
const AIM_GAIN_MAX = 2.6; // gain at full flick speed (1 = the old 1:1 tracking)
const AIM_SPEED_LO = 0.35; // edges/s below which aiming tracks 1:1
const AIM_SPEED_HI = 2.5; // edges/s at which the gain is maxed out
const AIM_SPEED_EASE = 0.4; // EMA on pointer speed; raw per-event speed is jittery

const drag = {
  active: false, power: 0, elev: FLAT_ELEV, dir: new THREE.Vector3(0, 0, -1),
  aimX: 0, // accelerated sideways travel, stands in for a raw pixel offset
  aimSpeed: 0, // smoothed sideways pointer speed, in short edges per second
};

/** the aim only answers to the pointer while the stone is in your hand: not in
 * flight, not sinking, and not while the fishing minigame owns the drag */
function canAim() {
  const p = G.player;
  if (!p || G.state !== "race" || G.holeOver || p.finished) return false;
  if (cam.mode === "intro" || G.replay || fishing.active) return false;
  return p.state === "resting" || p.state === "beached" || p.state === "onboat";
}

/** fold this pointer event's sideways travel into `drag.aimX`, gain and all */
function accumulateAim() {
  const shortEdge = Math.min(window.innerWidth, window.innerHeight);
  const speed = pointer.dt > 0 ? (Math.abs(pointer.dx) / shortEdge / pointer.dt) * 1000 : 0;
  drag.aimSpeed += (speed - drag.aimSpeed) * AIM_SPEED_EASE;
  const t = clamp01((drag.aimSpeed - AIM_SPEED_LO) / (AIM_SPEED_HI - AIM_SPEED_LO));
  drag.aimX += pointer.dx * (1 + (AIM_GAIN_MAX - 1) * t * t);
}

function updateDragAim() {
  const p = G.player;
  if (!p) return;
  const shortEdge = Math.min(window.innerWidth, window.innerHeight);
  const dx = drag.aimX;
  const dy = pointer.y - pointer.startY;

  const pull = clamp(dy / (shortEdge * PULL_SPAN), -1, 1); // +1 back, -1 forward
  drag.power = Math.abs(pull);
  const loft = clamp01(-pull / LOFT_SPAN); // tops out before the power does
  drag.elev = pull >= 0
    ? SKIP_ELEV + 0.10 * (1 - drag.power) // the old skipper curve, unchanged
    : FLAT_ELEV + (MAX_ELEV - FLAT_ELEV) * loft;

  // base direction: rock -> next fairway target, rotated by sideways drag
  const target = aimTarget();
  const base = new THREE.Vector3(target.x - p.pos.x, 0, target.z - p.pos.z);
  if (base.lengthSq() < 0.01) base.set(0, 0, -1);
  base.normalize();
  const ang = -dx * ((Math.PI * 2) / (shortEdge * AIM_TURNS));
  const cos = Math.cos(ang), sin = Math.sin(ang);
  drag.dir.set(base.x * cos - base.z * sin, 0, base.x * sin + base.z * cos);
  G.aimDir.copy(drag.dir); // camera orbits to keep the previz centered

  // the preview runs the stone's own upgrades, so Farsight really does show you
  // more of the flight and Long Skipper's extra hops are on the dotted line
  const sim = simulateThrow(p.pos, drag.dir, drag.power, G.throwMode, p.rock, water, G.elapsed, p.mods.previewT, COURSE[G.hole].islands, COURSE[G.hole].rocks, drag.elev, p.mods);
  // The line reads the ending, not the throw. A splash lob that will detonate
  // goes pink; an entry that meets the water too steeply to get a single hop out
  // of it goes blue, so you can see the glug coming before you let go. A skipper
  // that simply runs out of hops down the line is still a skipper, and stays
  // white. Same sim the throw runs, so the previz never lies about any of it.
  const duffed = sim.end === "sink" && sim.skips.length === 0;
  const marked = sim.end === "blast" || duffed;
  previewMat.color.setHex(sim.end === "blast" ? 0xff9aac : duffed ? 0x37c8e0 : 0xffffff);
  const step = Math.max(1, Math.floor(sim.points.length / previewDots.length));
  let di = 0;
  for (let i = 0; i < sim.points.length && di < previewDots.length; i += step) {
    const d = previewDots[di++];
    d.position.copy(sim.points[i]);
    d.visible = true;
    d.scale.setScalar(1 - (di / previewDots.length) * 0.6);
  }
  for (; di < previewDots.length; di++) previewDots[di].visible = false;
  // only mark the spot once the sim actually got there — a lob that outruns the
  // preview window would otherwise ring a point it is still flying through
  if (marked && sim.points.length) {
    blastRing.visible = true;
    // full size is the blast radius and means something; the glug marker is just
    // a spot, so it wears a small ring that can't be read as a knock range
    blastRing.material.color.setHex(duffed ? 0x37c8e0 : 0xff5470);
    blastRing.scale.setScalar(duffed ? 0.4 : 1);
    const endP = sim.points[sim.points.length - 1];
    blastRing.position.set(endP.x, Math.max(WATER_Y + 0.05, endP.y + 0.08), endP.z);
  } else {
    blastRing.visible = false;
  }
}

function tryPlayerThrow() {
  const p = G.player;
  if (!p || G.state !== "race" || G.holeOver || cam.mode === "intro") return;
  if (p.finished || G.throwCooldown > 0) return;
  if (p.state !== "resting" && p.state !== "beached" && p.state !== "onboat") return;
  if (drag.power < 0.08) return; // tap, not a throw
  const power = drag.power;

  // invisible aim assist (team scrap: invisible-driving-assist-layer):
  // if the throw would land near the flag line, nudge it a touch truer
  if (G.throwMode === "skip") {
    const sim = simulateThrow(p.pos, drag.dir, power, "skip", p.rock, water, G.elapsed, 6, COURSE[G.hole].islands, COURSE[G.hole].rocks, drag.elev, p.mods);
    const end = sim.points[sim.points.length - 1];
    if (end) {
      const flag = currentFlagV3();
      const dEnd = Math.hypot(end.x - flag.x, end.z - flag.z);
      const reach = p.mods.assistR; // Gyro Spin widens the catchment
      if (dEnd < reach) {
        const ideal = new THREE.Vector3(flag.x - p.pos.x, 0, flag.z - p.pos.z).normalize();
        drag.dir.lerp(ideal, 0.25 * (1 - dEnd / reach)).normalize();
        if (dEnd > 8) procUpgrade(p, "gyro"); // outside the stock assist: that was the upgrade
      }
    }
  }
  if (p.throwRock(drag.dir, power, G.throwMode, drag.elev)) {
    fishing.hideBuoy(); // leaving the buoy lie (no-op otherwise)
    cam.mode = "flight";
    G.slowmoUsed = false;
    audio.throwWhoosh(power);
    fovKick(3 + power * 5);
    shake(0.12 * power);
    haptic(18);
    G.throwCooldown = 0.5 * p.mods.cooldownMul; // Quick Draw
  }
}

// ------------------------------------------------------------------ pointer handlers per state
function onPointerDown(e) {
  if (G.state === "shelf") {
    const hits = raycastFrom(e, bench.picks);
    const slot = hits[0]?.object.userData.slot;
    if (slot != null) pickSlot(slot);
  } else if (G.state === "find") {
    const hits = raycastFrom(e, G.candidates.map((r) => r.group));
    if (hits.length) {
      // walk up to whichever candidate group owns the hit mesh
      let o = hits[0].object;
      while (o && !G.candidates.some((r) => r.group === o)) o = o.parent;
      const idx = G.candidates.findIndex((r) => r.group === o);
      if (idx === G.candidateIdx && idx >= 0) {
        // tapping the stone that's already floating takes it, same as "Shape it →"
        audio.pip(true);
        enterShape();
      } else if (idx >= 0) {
        selectCandidate(idx);
      }
    }
  } else if (G.state === "shape") {
    // touching freezes the lazy turntable so you can carve a fixed spot
    G.idleSpinAt = Infinity;
    G.paintDrag.spinVel = 0;
    // drag ON the stone sculpts; drag anywhere else grabs and spins it
    const hits = raycastFrom(e, [G.playerRock.mesh]);
    if (hits.length) {
      G.sculpting = true;
    } else {
      G.paintDrag.mode = "rotate";
      G.paintDrag.lastX = e.clientX;
      G.paintDrag.lastY = e.clientY;
    }
  } else if (G.state === "paint") {
    // touching freezes the lazy turntable so you can paint a fixed spot
    G.idleSpinAt = Infinity;
    G.paintDrag.spinVel = 0;
    // drag ON the stone paints; drag anywhere else grabs and spins it
    const hits = raycastFrom(e, [G.playerRock.mesh]);
    G.paintDrag.mode = hits.length ? "paint" : "rotate";
    G.paintDrag.lastX = e.clientX;
    G.paintDrag.lastY = e.clientY;
  }
}

function onPointerMove(e) {
  if (!pointer.down) return;
  // a finger held through the flight would otherwise measure its pull all the way
  // back to the press that threw the stone, and fire a full-power shot on release
  if (!canAim()) { pointer.voided = true; return; }
  if (pointer.voided) return;
  accumulateAim(); // also over the first few px, before this counts as a drag
  if (pointer.dragging) {
    if (!drag.active) drag.active = true;
    updateDragAim();
  }
}

function onPointerUp() {
  if (drag.active && canAim()) {
    updateDragAim();
    tryPlayerThrow();
    drag.active = false;
    drag.power = 0;
    drag.elev = FLAT_ELEV;
    hidePreview();
  }
  drag.active = false;
  drag.aimX = 0;
  drag.aimSpeed = 0;
  if (G.state === "shape") G.sculpting = false;
  // released: hold the rock still, only let it drift back into a lazy spin after 5s untouched
  if (G.state === "shape" || G.state === "paint") {
    G.idleSpinAt = G.elapsed + 5;
    G.paintDrag.spinVel = 0;
  }
  G.paintDrag.mode = null;
}

// ------------------------------------------------------------------ phase: TITLE
function enterTitle() {
  G.state = "title";
  cam.mode = "orbit";
  metaui.showShellHud(true);
  water.setPath(null); // full open lake behind the title, not a hole's channel
  water.setVortex(); // and no whirlpool cut into it
  world.setHole(null); // radial disc ground/grass to match the open lake
  ui.els.title.classList.remove("hidden");
}

ui.els.playBtn.addEventListener("click", () => {
  audio.pip(true);
  ui.els.title.classList.add("hidden");
  ui.wipe(() => enterShelf());
});

ui.els.muter.addEventListener("click", () => {
  audio.setMuted(!audio.muted);
  ui.els.muter.classList.toggle("muted", audio.muted);
  document.getElementById("ic-sound").classList.toggle("hidden", audio.muted);
  document.getElementById("ic-muted").classList.toggle("hidden", !audio.muted);
});

// ------------------------------------------------------------------ multiplayer
// Star topology over PeerJS (team scrap: p2p-netcode). Each client simulates
// its OWN rock with full local physics (zero input latency); positions stream
// as 10 Hz snapshots, juice fires from relayed events. The host owns match
// flow (start, clock, hole transitions, winner calls) and pilots the bots.
const net = new Net();
const MAX_RACERS = 8; // course + tint palette are sized for eight
// net ids at or above this are the host's bots; below it they are people. Every
// seat can tell the two apart from an id alone, which guests can't do any other
// way — only the host holds the BotBrains.
const BOT_ID_BASE = 100;
const NET = {
  mode: "solo", // solo | host | guest
  myId: 0,
  started: false,
  capacity: 0, // wanted humans in the room; 0 = open/unlimited (up to MAX_RACERS)
  players: new Map(), // id -> { id, name, ready, cfg }
  byId: new Map(), // netId -> Skimmer (during a race)
  snapAccum: 0,
  clockAccum: 0,
};
const capacityNum = (cap) => (cap === 0 ? MAX_RACERS : cap);
const capLabel = (cap) => (cap === 0 ? "OPEN ROOM" : `${capacityNum(cap)}-PLAYER ROOM`);
// matchmaking bookkeeping while we're probing public slots ({ cap, idx, ... })
let matchmaking = null;
let chosenCap = 2;
const PLAYER_TINTS = ["#ffd24a", "#ff5470", "#37c8e0", "#6fe07a", "#9d7cf4", "#ff8a3d", "#f4f0e6", "#e0503a"];
const tintFor = (id) => (id >= BOT_ID_BASE ? null : PLAYER_TINTS[id % PLAYER_TINTS.length]);

const lobbyEls = {
  panel: document.getElementById("lobby-panel"),
  code: document.getElementById("lobby-code"),
  list: document.getElementById("lobby-list"),
  start: document.getElementById("start-btn"),
  hint: document.getElementById("lobby-hint"),
  status: document.getElementById("net-status"),
  // title-screen menus
  menuMain: document.getElementById("menu-main"),
  menuMp: document.getElementById("menu-mp"),
  mpBtn: document.getElementById("mp-btn"),
  findBtn: document.getElementById("find-btn"),
  mpBack: document.getElementById("mp-back"),
  mpCancel: document.getElementById("mp-cancel"),
  sizeChips: [...document.querySelectorAll(".size-chip")],
};

function netStatus(text) {
  lobbyEls.status.textContent = text;
}

// The stone is a voxel field now, so the wire carries the seed that grows the
// pristine block plus the log of bites drilled out of it — a few hundred bytes
// either way, and the peer's copy comes out identical rather than approximate.
function rockCfg(rock) {
  return {
    seed: rock.seed, size: rock.size, thickness: rock.baseThickness,
    lumpAmp: rock.lumpAmp,
    color: rock.color, pattern: rock.pattern, sculpt: rock.sculptData(),
    strokes: rock.strokesDataURL(), name: rock.label,
  };
}

function rockFromCfg(c) {
  const r = new Rock({
    seed: c.seed, lumpAmp: c.lumpAmp, thickness: c.thickness,
    size: c.size, color: c.color, pattern: c.pattern, name: c.name ?? null,
  });
  r.applySculptData(c.sculpt);
  r.applyStrokesDataURL(c.strokes);
  return r;
}

function updateLobbyUI() {
  lobbyEls.list.innerHTML = "";
  for (const p of NET.players.values()) {
    const row = document.createElement("div");
    row.className = "lp";
    row.innerHTML =
      `<span class="dot" style="background:${tintFor(p.id)}"></span>` +
      `<span>${p.id === NET.myId ? "YOU" : p.name}</span>` +
      `<span>${p.ready ? "ready" : "shaping…"}</span>`;
    lobbyEls.list.appendChild(row);
  }
  // lobby subtitle: how the room fills / how the race starts
  const n = NET.players.size;
  if (NET.capacity === 0) {
    lobbyEls.hint.textContent = `open room · ${n} here — host starts, empty seats become bots`;
  } else {
    const target = capacityNum(NET.capacity);
    lobbyEls.hint.textContent = n < target
      ? `matched room · waiting for skippers (${n}/${target})…`
      : `room full (${n}/${target}) — race starts once everyone's ready`;
  }

  const players = [...NET.players.values()];
  const allReady = players.every((p) => p.ready);
  if (NET.mode === "host" && NET.players.get(0)?.ready && !NET.started) {
    lobbyEls.start.classList.remove("hidden");
    lobbyEls.start.textContent = allReady ? "Start race!" : `Start (${players.filter((p) => p.ready).length} ready)`;
  }
}

// -- title menu: solo vs multiplayer -----------------------------------------
lobbyEls.mpBtn.addEventListener("click", () => {
  if (NET.mode !== "solo") return;
  audio.pip(true);
  lobbyEls.menuMain.classList.add("hidden");
  lobbyEls.menuMp.classList.remove("hidden");
  selectCap(chosenCap);
  netStatus("");
});

lobbyEls.mpBack.addEventListener("click", () => {
  audio.pip(false);
  cancelMatchmaking();
  lobbyEls.menuMp.classList.add("hidden");
  lobbyEls.menuMain.classList.remove("hidden");
  netStatus("");
});

function selectCap(cap) {
  chosenCap = cap;
  for (const c of lobbyEls.sizeChips) c.classList.toggle("sel", +c.dataset.cap === cap);
}
lobbyEls.sizeChips.forEach((c) =>
  c.addEventListener("click", () => { if (matchmaking) return; audio.pip(true); selectCap(+c.dataset.cap); }),
);

lobbyEls.findBtn.addEventListener("click", () => {
  if (matchmaking || NET.mode !== "solo") return;
  audio.pip(true);
  startMatchmaking(chosenCap);
});

lobbyEls.mpCancel.addEventListener("click", () => {
  audio.pip(false);
  cancelMatchmaking();
});

// -- serverless matchmaking --------------------------------------------------
// Pair up randoms with no matchmaking server: probe the shared, well-known
// PeerJS slots for the chosen capacity (mm-<cap>-1, mm-<cap>-2, …). If a slot
// already has a host with room, we join it; if a slot is empty, we claim it as
// host; if it's full/busy we bump to the next slot. Whoever lands as host runs
// the match exactly like the old "host a lobby" flow.
// A slot can be registered on the broker and still be unreachable: the host
// closed the tab, or the two networks can't be traversed. Signalling completes,
// the data channel never opens, and PeerJS says nothing either way — no "open",
// no "peer-unavailable". Every probe therefore runs against our own clock, or a
// single dead slot parks the hunt on "finding a room…" forever.
const PROBE_TIMEOUT = 10000;

function startMatchmaking(cap) {
  NET.mode = "solo";
  NET.capacity = cap;
  NET.players.clear();
  matchmaking = { cap, idx: 1, helloTimer: null, probeTimer: null };
  lobbyEls.findBtn.classList.add("hidden");
  lobbyEls.mpBack.classList.add("hidden");
  lobbyEls.mpCancel.classList.remove("hidden");
  attachNetHandlers();
  tryMatchSlot();
}

function cancelMatchmaking() {
  if (!matchmaking) return;
  clearMatchTimers();
  matchmaking = null;
  net.close();
  NET.mode = "solo";
  NET.players.clear();
  lobbyEls.findBtn.classList.remove("hidden");
  lobbyEls.mpBack.classList.remove("hidden");
  lobbyEls.mpCancel.classList.add("hidden");
  netStatus("");
}

function clearMatchTimers() {
  if (!matchmaking) return;
  clearTimeout(matchmaking.helloTimer);
  clearTimeout(matchmaking.probeTimer);
}

/** give up on this slot and hunt the next one */
function nextMatchSlot() {
  if (!matchmaking) return;
  clearMatchTimers();
  matchmaking.idx++;
  tryMatchSlot();
}

function tryMatchSlot() {
  if (!matchmaking) return;
  const { cap, idx } = matchmaking;
  if (idx > 40) { netStatus("all rooms are busy — try again in a bit"); cancelMatchmaking(); return; }
  netStatus(cap === 0 ? "finding an open room…" : `finding a ${capacityNum(cap)}-player room…`);
  const code = matchCode(cap, idx);
  clearMatchTimers();
  net.close(); // drop any peer from the previous slot attempt
  attachNetHandlers();
  matchmaking.probeTimer = setTimeout(nextMatchSlot, PROBE_TIMEOUT);
  net.joinRoom(code, (err) => {
    if (!matchmaking) { net.close(); return; }
    clearTimeout(matchmaking.probeTimer); // the slot answered, one way or the other
    if (err) {
      if (err.type === "peer-unavailable") becomeMatchHost(code); // empty slot -> host it
      else setTimeout(() => { if (matchmaking) tryMatchSlot(); }, 400); // transient -> retry
      return;
    }
    NET.mode = "guest";
    net.send({ t: "hello" });
    // if the host never answers (mid-start, flaky), roll to the next slot
    matchmaking.helloTimer = setTimeout(nextMatchSlot, 4500);
  });
}

function becomeMatchHost(code) {
  if (!matchmaking) return;
  clearMatchTimers();
  net.close();
  attachNetHandlers();
  matchmaking.probeTimer = setTimeout(nextMatchSlot, PROBE_TIMEOUT); // claiming can stall too
  net.hostRoom(code, (err) => {
    if (!matchmaking) return;
    clearTimeout(matchmaking.probeTimer);
    if (err) { // someone grabbed the slot first — go back to joining it
      net.close();
      setTimeout(() => { if (matchmaking) tryMatchSlot(); }, 250);
      return;
    }
    NET.mode = "host";
    NET.myId = 0;
    NET.players.clear();
    // guests see this name in their lobby list, so it has to read from the
    // outside — the local list swaps in "YOU" by id, not by name
    NET.players.set(0, { id: 0, name: "Skipper 1", ready: false, cfg: null });
    settleIntoRoom();
  });
}

// We've landed in a room (as host or guest); leave the title and start prepping.
function settleIntoRoom() {
  clearMatchTimers();
  matchmaking = null;
  netStatus("");
  lobbyEls.code.textContent = capLabel(NET.capacity);
  lobbyEls.panel.classList.remove("hidden");
  updateLobbyUI();
  // reset the title menu for next time (e.g. after a reload-less return)
  lobbyEls.menuMp.classList.add("hidden");
  lobbyEls.menuMain.classList.remove("hidden");
  lobbyEls.findBtn.classList.remove("hidden");
  lobbyEls.mpBack.classList.remove("hidden");
  lobbyEls.mpCancel.classList.add("hidden");
  ui.els.title.classList.add("hidden");
  ui.wipe(() => enterShelf());
}

// Host: kick off automatically once the room is full and everyone's ready.
function maybeAutoStart() {
  if (NET.mode !== "host" || NET.started) return;
  const players = [...NET.players.values()];
  const full = players.length >= capacityNum(NET.capacity);
  const allReady = players.length > 0 && players.every((p) => p.ready);
  if (full && allReady) hostStartRace();
}

lobbyEls.start.addEventListener("click", () => {
  if (NET.mode !== "host" || NET.started) return;
  audio.pip(true);
  hostStartRace();
});

function attachNetHandlers() {
  net.onMessage = handleNetMsg;
  net.onPeerLeave = (id) => {
    if (NET.mode !== "host") return;
    net.broadcast({ t: "leave", id });
    removeParticipant(id);
  };
  net.onDown = () => {
    if (matchmaking) return; // we're tearing down a probe, not losing a real host
    ui.banner("HOST LEFT", "rowing back to shore…", 2.4);
    setTimeout(() => location.reload(), 2600);
  };
}

function removeParticipant(id) {
  NET.players.delete(id);
  const s = NET.byId.get(id);
  if (s) {
    scene.remove(s.mesh);
    NET.byId.delete(id);
    G.racers = G.racers.filter((r) => r !== s);
  }
  updateLobbyUI();
}

// ---------------- message routing ----------------
function handleNetMsg(from, msg) {
  if (NET.mode === "host") handleHostMsg(from, msg);
  else handleGuestMsg(msg);
}

function handleHostMsg(from, msg) {
  switch (msg.t) {
    case "hello": {
      if (NET.started) { net.sendTo(from, { t: "busy" }); return; }
      if (NET.players.size >= capacityNum(NET.capacity)) { net.sendTo(from, { t: "full" }); return; }
      const p = { id: from, name: `Skipper ${from + 1}`, ready: false, cfg: null };
      NET.players.set(from, p);
      net.sendTo(from, {
        t: "welcome", id: from, capacity: NET.capacity,
        players: [...NET.players.values()].map((q) => ({ id: q.id, name: q.name, ready: q.ready })),
      });
      net.broadcast({ t: "join", id: from, name: p.name }, from);
      updateLobbyUI();
      maybeAutoStart();
      break;
    }
    case "ready": {
      const p = NET.players.get(from);
      if (!p) return;
      p.ready = true;
      p.cfg = msg.rock;
      p.name = msg.rock.name;
      net.broadcast({ t: "ready", id: from, name: p.name }, from);
      updateLobbyUI();
      maybeAutoStart();
      break;
    }
    case "s":
      routeSnapshot(msg);
      net.broadcast(msg, from);
      break;
    case "e":
      routeEvent(msg);
      if (msg.type === "flag") {
        const s = NET.byId.get(msg.id);
        if (s) declareHoledOut(s, { tape: msg.d?.tape, skips: msg.d?.skips });
      }
      net.broadcast(msg, from);
      break;
    case "knock": {
      const victimId = msg.victim;
      if (victimId === 0) G.player?.applyKnock(new THREE.Vector3(msg.from[0], 0, msg.from[1]));
      else if (victimId >= BOT_ID_BASE) NET.byId.get(victimId)?.applyKnock(new THREE.Vector3(msg.from[0], 0, msg.from[1]));
      else net.sendTo(victimId, msg);
      break;
    }
  }
}

function handleGuestMsg(msg) {
  switch (msg.t) {
    case "welcome":
      NET.myId = msg.id;
      NET.capacity = msg.capacity ?? NET.capacity;
      NET.players.clear();
      for (const q of msg.players) NET.players.set(q.id, { id: q.id, name: q.name, ready: q.ready, cfg: null });
      settleIntoRoom();
      break;
    case "busy":
    case "full":
      // this slot can't take us — keep hunting for another room
      if (matchmaking) {
        nextMatchSlot();
      } else {
        netStatus("that race already started — try again");
        net.close();
        NET.mode = "solo";
      }
      break;
    case "join":
      NET.players.set(msg.id, { id: msg.id, name: msg.name, ready: false, cfg: null });
      updateLobbyUI();
      break;
    case "ready": {
      const p = NET.players.get(msg.id);
      if (p) { p.ready = true; p.name = msg.name ?? p.name; }
      updateLobbyUI();
      break;
    }
    case "leave":
      removeParticipant(msg.id);
      break;
    case "start":
      NET.started = true;
      beginNetRace(msg.players, msg.bots);
      break;
    case "s":
      if (msg.id !== NET.myId) routeSnapshot(msg);
      break;
    case "e":
      if (msg.id !== NET.myId) routeEvent(msg);
      break;
    case "knock":
      G.player?.applyKnock(new THREE.Vector3(msg.from[0], 0, msg.from[1]));
      break;
    case "clock":
      G.holeTime = msg.ht;
      msg.boats?.forEach((tv, i) => { if (boats.boats[i]) boats.boats[i].t = tv; });
      break;
    case "holed": {
      const s = NET.byId.get(msg.id);
      if (!s || G.holeOver || G.holeFinishers.includes(s)) return;
      s.throws = msg.throws ?? s.throws;
      s.bestCombo = msg.best ?? s.bestCombo;
      s.tape = msg.tape ?? [];
      s.tapeSkips = msg.skips ?? [];
      if (msg.ht != null) G.holeTime = msg.ht;
      holedOut(s, msg.place ?? G.holeFinishers.length + 1);
      break;
    }
    case "holeEnd": {
      if (G.holeOver) return;
      G.holeOver = true;
      ui.setHoleTimer(null);
      if (fishing.active) fishing.cancel();
      // the host's tally is the tally — rebuild the order from it rather than
      // trusting whatever `holed` messages happened to land here
      G.holeFinishers = [];
      ui.clearFinishers();
      for (const [id, pts] of msg.awards ?? []) {
        const s = NET.byId.get(id);
        if (!s) continue;
        s.points += pts;
        s.finished = true;
        if (!G.holeFinishers.length) s.holesWon++;
        G.holeFinishers.push(s);
        // a blank hole is awarded on distance, so nobody earned a place on the board
        if (!msg.blank) ui.addFinisher(G.holeFinishers.length, s.name, s.tint, s.isPlayer);
      }
      G.holeWinner ??= G.holeFinishers[0] ?? null;
      presentHoleEnd(msg.reason, !!msg.blank);
      break;
    }
    case "nextHole":
      gotoHole(msg.idx);
      break;
    case "end":
      if (G.replay) G.pendingEnd = msg.rows;
      else endMatch(msg.rows);
      break;
  }
}

function routeSnapshot(msg) {
  const s = NET.byId.get(msg.id);
  if (!s || !s.isRemote) return;
  s.netTarget = [msg.p[0], msg.p[1], msg.p[2], msg.ry];
  // a remote rival surfacing their rock deserves a splash
  if (s.state === "fishing" && msg.st === "resting") particles.sinkSplash(s.pos, 0.7);
  s.state = msg.st;
  s.skips = msg.sk ?? s.skips;
}

function routeEvent(msg) {
  const s = NET.byId.get(msg.id);
  if (!s || !s.isRemote) return;
  const d = msg.d ?? {};
  const data = {
    skimmer: s,
    at: d.at ? new THREE.Vector3(d.at[0], d.at[1], d.at[2]) : s.pos.clone(),
    n: d.n, speed: d.speed, power: d.power,
    victim: d.victim != null ? NET.byId.get(d.victim) : undefined,
  };
  if (msg.type === "throw") { s.throws++; s.totalThrows++; s.skips = 0; }
  if (msg.type === "skip") s.bestCombo = Math.max(s.bestCombo, d.n ?? 0);
  if (msg.type === "flag") {
    // the swirl takes it here and now; the placing is the host's call
    s.finished = true;
    s.pos.copy(data.at);
    particles.sinkSplash(data.at, 1.1);
    audio.sink();
    return;
  }
  // snap the rock to the event spot so effects line up despite interpolation lag
  if (data.at && msg.type !== "splashHit") s.pos.copy(data.at);
  onSkimmerEvent(msg.type, data);
}

function netSendEvent(s, type, data) {
  const d = {};
  if (data.at) d.at = [+data.at.x.toFixed(2), +data.at.y.toFixed(2), +data.at.z.toFixed(2)];
  if (data.n != null) d.n = data.n;
  if (data.speed != null) d.speed = +data.speed.toFixed(1);
  if (data.power != null) d.power = +data.power.toFixed(2);
  if (data.victim) d.victim = data.victim.netId;
  if (type === "flag") { d.tape = s.tape; d.skips = s.tapeSkips; }
  const msg = { t: "e", id: s.netId, type, d };
  if (NET.mode === "host") net.broadcast(msg);
  else net.send(msg);
}

// ------------------------------------------------------------------ phase: SHELF
// The bench is the front door now: three floaters, one stone each, and an empty
// ring is the only way into the workshop. Rocks live in localStorage (shelf.js)
// as seed + carve log + paint, so the stone you finished last week is the same
// stone down to the last drill hole.
const benchSpot = (() => {
  // Down on the flat sand at the top of the beach, a little way round the shore
  // from where the stones wash up, so the trip between them is worth a camera
  // move. The shoreline wobbles by several metres, so feel outward for where the
  // water actually ends instead of trusting a fixed radius — up on the bank the
  // grass grows over the lens and the lake disappears behind the hills.
  const a = Math.PI / 2 - 0.3;
  let r = LAKE_R - 6;
  for (let i = 0; i < 70 && shoreHeight(Math.cos(a) * r, Math.sin(a) * r) < -0.02; i++) r += 0.4;
  r += 1.6; // just past the waterline, on dry sand
  return new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r);
})();
// The bench sits at an angle across the top of the beach, facing up the shore
// rather than straight out at the water. That's what puts the lake behind it:
// the camera stands in front of the seat and so ends up looking out over the
// lake, sky and all, instead of into the wall of grass on the bank.
const BENCH_YAW = -1.0; // radians off "back to the water"
const benchFront = new THREE.Vector3(benchSpot.x, 0, benchSpot.z)
  .normalize()
  .applyAxisAngle(new THREE.Vector3(0, 1, 0), BENCH_YAW);
const _slotPt = new THREE.Vector3();
const _tagPt = new THREE.Vector3();

/** Far enough back that all three floaters fit the frame — a portrait phone
 *  needs a lot more room for the same width of bench than a laptop does. */
function shelfCamPose() {
  const dist = 4.8 + 4.6 / clamp(camera.aspect, 0.5, 2.2);
  const y = bench.group.position.y;
  const pos = benchSpot.clone().addScaledVector(benchFront, dist);
  // the bank behind the camera can be higher than the bench — stand on it
  pos.y = Math.max(y, shoreHeight(pos.x, pos.z)) + 2.3;
  return { pos, look: benchSpot.clone().addScaledVector(benchFront, 0.2).setY(y + 1.5) };
}

function enterShelf({ pan = false } = {}) {
  G.state = "shelf";
  G.shelfSel = -1;
  G.slotIdx = -1;
  G.releaseArmed = false;
  metaui.showShellHud(true);
  garageBtn.classList.add("hidden");
  water.setPath(null); // open lake behind the bench, no channel
  water.setVortex();
  world.setHole(null);
  bench.place(benchSpot.x, benchSpot.z, benchFront.x, benchFront.z);
  refreshShelfRocks();

  ui.showPhase("BENCHED ROCKS");
  ui.els.phaseNext.textContent = "To the lake! →";
  ui.els.phaseNext.classList.add("hidden");
  ui.els.phaseBack.classList.add("hidden"); // the bench is the root — nowhere back to
  ui.els.rockStats.classList.add("hidden");
  ui.els.shelfRelease.classList.add("hidden");

  const pose = shelfCamPose();
  if (pan) camPanTo(pose.pos, pose.look, 1.3);
  else camSnapTo(pose.pos, pose.look);
}

/** rebuild the stones on the bench from what's in storage */
function refreshShelfRocks() {
  for (const r of G.shelfRocks) r?.dispose();
  G.shelfRocks = new Array(SHELF_SLOTS).fill(null);
  G.shelf = loadShelf();
  G.shelf.forEach((entry, i) => {
    bench.setSlotFilled(i, !!entry);
    if (!entry) return;
    const rock = rockFromCfg(entry.cfg);
    rock.name = entry.name ?? entry.cfg.name ?? null;
    bench.slotPoint(i, _slotPt);
    rock.group.position.set(_slotPt.x, _slotPt.y + rockLift(rock), _slotPt.z);
    rock.group.rotation.y = (i * 2.3) % (Math.PI * 2);
    scene.add(rock.group);
    G.shelfRocks[i] = rock;
  });
  for (let i = 0; i < SHELF_SLOTS; i++) dressSlot(i);
}

/** put slot `i`'s bought hat on its stone and its bought ring under it */
function dressSlot(i) {
  const l = loadoutFor(i);
  bench.setSlotFloater(i, l.floater);
  G.shelfRocks[i]?.setHat(l.hat);
}

function updateShelf(dt) {
  // The set is struck before the wipe into a race, but this state stays live for
  // the frames the wipe takes — with the slots already emptied, carrying on here
  // would re-point the finger at a bench that's no longer there.
  if (!bench.group.visible) return;
  bench.update(dt, G.elapsed);
  // re-read the framing every frame so a rotated phone re-frames itself
  if (cam.mode === "closeup") {
    const pose = shelfCamPose();
    cam.pos.copy(pose.pos);
    cam.look.copy(pose.look);
  }

  const items = [];
  let firstFree = -1;
  for (let i = 0; i < SHELF_SLOTS; i++) {
    bench.slotPoint(i, _slotPt);
    const rock = G.shelfRocks[i];
    if (!rock) {
      if (firstFree < 0) firstFree = i;
      continue;
    }
    rock.group.position.copy(_slotPt);
    // riding the floater
    rock.group.position.y += rockLift(rock) + Math.sin(G.elapsed * 1.5 + i * 1.9) * 0.05;
    if (i === G.shelfSel) rock.group.rotation.y += dt * 0.9; // the chosen one shows off
    rock.update(dt);
    const s = worldToScreen(_tagPt.copy(_slotPt).setY(_slotPt.y + 1.45)); // plate floats over the stone
    items.push({ slot: i, x: s.x, y: s.y, behind: s.behind, name: rock.label, sub: "tap to race", sel: i === G.shelfSel });
  }
  ui.updateShelfTags(items, pickSlot);

  // the finger does the talking over the first free floater
  if (firstFree < 0) ui.setTapHand(null);
  else {
    const s = worldToScreen(bench.slotHandPoint(firstFree, _tagPt));
    ui.setTapHand(s.behind ? null : s);
  }
}

function pickSlot(i) {
  if (G.state !== "shelf") return;
  const rock = G.shelfRocks[i];
  if (!rock) { startCreation(i); return; }
  if (i === G.shelfSel) {
    // tapping the stone that's already chosen races it, same as "To the lake! →"
    audio.pip(true);
    launchFromShelf();
    return;
  }
  audio.pickRock();
  G.shelfSel = i;
  G.releaseArmed = false;
  ui.els.shelfRelease.textContent = "Toss it back";
  ui.els.shelfRelease.classList.remove("hidden");
  ui.els.phaseNext.classList.remove("hidden");
  garageBtn.classList.remove("hidden");
  ui.showStats(rock.flat, rock.heft, rock.grit);
  rock.react("excited", 1.4);
  rock.kickEyes(1.4);
  const s = worldToScreen(rock.group.position);
  if (!s.behind) ui.popup(s.x, s.y - 86, "let's go!", { size: 22, color: "#ffd24a" });
}

// ---------------------------------------------------------------- the garage
// Kit the selected stone out: two upgrade sockets plus its hat, its floater and
// its flight trail. Everything applies to the live bench scene as it's tapped —
// the hat goes on the rock you're looking at, the ring under it changes colour —
// because a shop you have to leave to see what you bought is a spreadsheet.
const garageBtn = document.getElementById("garage-btn");

garageBtn.addEventListener("click", () => {
  if (G.state !== "shelf" || G.shelfSel < 0) return;
  const slot = G.shelfSel;
  const rock = G.shelfRocks[slot];
  audio.pip(true);
  metaui.openGarage(slot, rock, {
    onHat: (id) => {
      rock?.setHat(id);
      rock?.react("excited", 1.2);
      if (rock) particles.paintPuff(rock.group.position, "#ffd24a");
    },
    onFloater: (id) => bench.setSlotFloater(slot, id),
    onTrail: (id) => {
      if (rock) trailBurst(particles, id, rock.group.position, 0xbfe8ff);
    },
    onUpgrades: () => { /* sockets are read fresh at race start */ },
    onClose: () => { if (G.shelfSel >= 0) ui.els.phaseNext.classList.remove("hidden"); },
  });
});

/** an empty floater: off to the beach to pick a base for a new stone */
function startCreation(slot) {
  G.slotIdx = slot;
  G.shelfSel = -1;
  audio.pip(true);
  ui.clearShelfTags();
  ui.els.rockStats.classList.add("hidden");
  ui.els.phaseNext.classList.add("hidden");
  enterFind({ pan: true });
}

/** back to the bench with an unfinished stone (nothing was saved yet) */
function cancelCreation() {
  audio.pip(false);
  for (const r of G.candidates) r.dispose();
  G.candidates = [];
  clearSinkers();
  G.candidateIdx = -1;
  G.playerRock = null;
  ui.els.phaseBack.classList.add("hidden");
  ui.hideNameUI();
  enterShelf({ pan: true });
}

ui.els.phaseBack.addEventListener("click", () => {
  if (G.state === "find" || G.state === "shape" || G.state === "paint" || G.state === "name") cancelCreation();
});

// Letting a rock go is the only way to free a full bench, so it takes two taps.
ui.els.shelfRelease.addEventListener("click", () => {
  if (G.state !== "shelf" || G.shelfSel < 0) return;
  if (!G.releaseArmed) {
    G.releaseArmed = true;
    ui.els.shelfRelease.textContent = "sure? tap to toss it";
    audio.pip(false);
    return;
  }
  const i = G.shelfSel;
  const rock = G.shelfRocks[i];
  if (rock) {
    particles.paintPuff(rock.group.position, "#bfe8ff");
    const s = worldToScreen(rock.group.position);
    if (!s.behind) ui.popup(s.x, s.y - 30, "so long!", { size: 22, color: "#37c8e0" });
  }
  audio.settle();
  clearSlot(i);
  clearLoadout(i); // the build went into the lake with the stone
  G.shelfSel = -1;
  G.releaseArmed = false;
  G.playerRock = null;
  refreshShelfRocks();
  ui.els.shelfRelease.classList.add("hidden");
  ui.els.phaseNext.classList.add("hidden");
  ui.els.rockStats.classList.add("hidden");
  garageBtn.classList.add("hidden");
});

/** race a stone that was already on the bench — no shaping, no painting */
function launchFromShelf() {
  const rock = G.shelfRocks[G.shelfSel];
  if (!rock) return;
  G.playerRock = rock;
  G.slotIdx = G.shelfSel;
  rock.group.rotation.set(0, 0, 0);
  G.candidates = [rock];
  ui.clearShelfTags(); // the multiplayer lobby lingers on this shot; lose the plates
  chooseRace();
}

/**
 * Between the bench and the water: which cup, and which class. Multiplayer
 * skips it — a room full of people has to agree on a course, so it stays on the
 * shipped three at stock difficulty and the lobby is the only gate.
 */
function chooseRace() {
  if (NET.mode !== "solo") {
    COURSE = HOLES;
    G.tier = TIERS[1]; // the honest middle class for a room of humans
    enterNetReady();
    return;
  }
  ui.hidePhase();
  garageBtn.classList.add("hidden");
  metaui.openCupSelect({
    cupIdx: G.cupIdx,
    tierIdx: G.tierIdx,
    onStart: (cup, tier, { cupIdx, tierIdx }) => {
      G.cup = cup;
      G.tier = tier;
      G.cupIdx = cupIdx;
      G.tierIdx = tierIdx;
      COURSE = buildCourse(cup, tier);
      startRace();
    },
    onBack: () => enterShelf(),
  });
}

/** strike the bench set: the race is about to rebuild the world under it */
function clearShelfScene() {
  for (let i = 0; i < SHELF_SLOTS; i++) {
    const r = G.shelfRocks[i];
    if (r && r !== G.playerRock) r.dispose();
    G.shelfRocks[i] = null;
  }
  bench.group.visible = false;
  ui.clearShelfTags();
}

// ------------------------------------------------------------------ phase: FIND
const beachSpot = (() => {
  // The wet sand at the water's edge on the south shore — found by feeling
  // outward for the waterline rather than assumed, because the shoreline noise
  // moves it by several metres (a fixed radius lands the stones in waist-high
  // grass up the bank).
  const a = Math.PI / 2; // +z side
  let r = LAKE_R - 6;
  for (let i = 0; i < 70 && shoreHeight(Math.cos(a) * r, Math.sin(a) * r) < -0.02; i++) r += 0.4;
  r += 1;
  return new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r);
})();

function enterFind({ pan = false } = {}) {
  G.state = "find";
  ui.showPhase("FIND YOUR ROCK");
  ui.els.phaseNext.textContent = "Shape it →";
  // there's a bench to go back to as soon as it has anything on it
  ui.els.phaseBack.classList.toggle("hidden", !G.shelf.some(Boolean));

  // Four contenders in a loose square on the sand. A row strung out along the
  // shore runs off both edges of a phone, so the spread mostly goes into depth —
  // two near, two far — with each stone nudged off the grid so it still reads as
  // stuff the lake washed up rather than a display case.
  const inland = new THREE.Vector3(beachSpot.x, 0, beachSpot.z).normalize();
  const along = new THREE.Vector3(-inland.z, 0, inland.x); // tangent to the shore
  const jitter = () => (Math.random() - 0.5) * 0.5;
  for (let i = 0; i < 4; i++) {
    const rock = new Rock({
      seed: (Math.random() * 1e6) | 0,
      lumpAmp: 0.12 + Math.random() * 0.26,
      thickness: 0.38 + Math.random() * 0.28,
      size: 0.5 + Math.random() * 0.18,
      color: "#8f9aa3",
      pattern: "plain",
    });
    const row = i < 2 ? -1 : 1, col = (i % 2) * 2 - 1;
    const p = beachSpot.clone()
      .addScaledVector(inland, 1.5 + row * 1.25 + jitter())
      .addScaledVector(along, col * 1.15 + jitter());
    rock.group.position.set(p.x, shoreHeight(p.x, p.z) + 0.16, p.z);
    rock.group.rotation.y = Math.random() * Math.PI * 2;
    scene.add(rock.group);
    G.candidates.push(rock);
  }
  const { pos, look } = findCamPose();
  if (pan) camPanTo(pos, look, 1.5); // the walk down from the bench
  else camSnapTo(pos, look);
}

/** Crouch on the sand behind the stones and look out over them, so the lake and
 *  the sky are the backdrop instead of the wall of grass up the bank. */
function findCamPose() {
  const inland = new THREE.Vector3(beachSpot.x, 0, beachSpot.z).normalize();
  const ground = shoreHeight(beachSpot.x, beachSpot.z);
  const pos = beachSpot.clone().addScaledVector(inland, 5.4 + 2.4 / clamp(camera.aspect, 0.5, 2.2));
  pos.y = ground + 2.7; // low: any higher and the shot tips down into the sand
  return { pos, look: beachSpot.clone().addScaledVector(inland, -1.6).setY(ground + 0.45) };
}

function selectCandidate(idx) {
  G.candidateIdx = idx;
  audio.pickRock();
  const rock = G.candidates[idx];
  ui.showStats(rock.flat, rock.heft, rock.grit);
  ui.els.phaseNext.classList.remove("hidden");
  // lift the chosen one, drop the rest
  G.candidates.forEach((r, i) => {
    r.group.userData.picked = i === idx;
  });
  const s = worldToScreen(rock.group.position);
  ui.popup(s.x, s.y - 30, "this one!", { size: 22, color: "#ffd24a" });
}

ui.els.phaseNext.addEventListener("click", () => {
  audio.pip(true);
  if (G.state === "shelf" && G.shelfSel >= 0) launchFromShelf();
  else if (G.state === "find" && G.candidateIdx >= 0) enterShape();
  else if (G.state === "shape") enterPaint();
  else if (G.state === "paint") { if (IS_PLAYABLE_CRAFT) finishCraftPlayable(); else enterName(); }
});

// ------------------------------------------------------------------ net ready + start
function enterNetReady() {
  G.state = "netlobby";
  ui.showPhase("READY!");
  ui.els.phaseNext.classList.add("hidden");
  ui.els.paintUi.classList.add("hidden");
  const cfg = rockCfg(G.playerRock);
  const me = NET.players.get(NET.myId);
  if (me) { me.ready = true; me.cfg = cfg; me.name = cfg.name; }
  if (NET.mode === "host") net.broadcast({ t: "ready", id: NET.myId, name: cfg.name });
  else net.send({ t: "ready", rock: cfg });
  updateLobbyUI();
  maybeAutoStart();
}

function hostStartRace() {
  NET.started = true;
  lobbyEls.start.classList.add("hidden");
  // anyone still shaping gets a default stone so the race can start
  for (const p of NET.players.values()) {
    if (!p.cfg) {
      p.cfg = { seed: 500 + p.id * 31, size: 0.58, thickness: 0.5, lumpAmp: 0.16, color: "#8f9aa3", pattern: "plain", strokes: null, name: rockName(500 + p.id * 31) };
      p.name = p.cfg.name;
    }
  }
  const humans = [...NET.players.values()];
  const botCount = Math.max(0, MAX_RACERS - humans.length);
  const bots = BOT_PERSONAS.slice(0, botCount).map((persona, i) => ({
    id: BOT_ID_BASE + i, name: persona.name, color: persona.color, seed: 1000 + i * 77,
  }));
  net.broadcast({
    t: "start",
    players: humans.map((p) => ({ id: p.id, name: p.name, rock: p.cfg })),
    bots,
  });
  beginNetRace(humans.map((p) => ({ id: p.id, name: p.name, rock: p.cfg })), bots);
}

function beginNetRace(playersArr, botsArr) {
  ui.hidePhase();
  lobbyEls.panel.classList.add("hidden");
  // finalize a straggler's rock prep if the host started early
  if (!G.playerRock) {
    G.playerRock = G.candidates[G.candidateIdx >= 0 ? G.candidateIdx : 2] ??
      new Rock({ seed: (Math.random() * 1e6) | 0 });
    if (!G.playerRock.group.parent) scene.add(G.playerRock.group);
  }
  for (const r of G.candidates) if (r !== G.playerRock) scene.remove(r.group);
  G.candidates = [G.playerRock];
  clearSinkers();
  clearShelfScene();

  ui.wipe(() => {
    G.state = "race";
    NET.byId.clear();
    G.racers = [];
    G.bots = [];

    const myName = G.playerRock.label;
    G.player = new Skimmer(G.playerRock, myName, true, tintFor(NET.myId) ?? "#ffd24a");
    G.player.netId = NET.myId;
    addOutline(G.playerRock.mesh, 0x16324a, { thickness: 0.05 });
    G.playerRock.group.rotation.set(0, 0, 0);
    G.racers.push(G.player);
    NET.byId.set(NET.myId, G.player);

    for (const p of playersArr) {
      if (p.id === NET.myId) continue;
      const rock = rockFromCfg(p.rock);
      scene.add(rock.group);
      const s = new Skimmer(rock, p.rock.name ?? p.name, false, tintFor(p.id));
      s.isRemote = true;
      s.netId = p.id;
      G.racers.push(s);
      NET.byId.set(p.id, s);
    }

    for (const b of botsArr) {
      const rock = randomBotRock(b.seed);
      scene.add(rock.group);
      const s = new Skimmer(rock, b.name, false, b.color);
      s.netId = b.id;
      if (NET.mode === "host") {
        const persona = BOT_PERSONAS.find((q) => q.name === b.name) ?? BOT_PERSONAS[0];
        G.bots.push(new BotBrain(s, persona));
      } else {
        s.isRemote = true;
      }
      G.racers.push(s);
      NET.byId.set(b.id, s);
    }

    for (const s of G.racers) s.onEvent = onSkimmerEvent;
    ui.els.raceHud.classList.remove("hidden");
    setThrowMode("skip");
    setupHole(0);
  });
}

// ------------------------------------------------------------------ phase: SHAPE
// Dragging on the stone drills, full stop — no tools to pick between. The bit
// eats whatever it meets, so shaving a bump flat and boring a tunnel are the
// same gesture, and it moves slowly enough that going clean through stays a
// decision. The stone itself does the aiming: the drill sits on the floor of
// the pit, and the floor keeps sinking — into stone that packs tighter the
// closer to the middle it gets, so the dark heart is a long grind, not a wall.
// The only bite it ever refuses is one that would snap the stone in two.
const CARVE_RATE = 1.0;
const CARVE_R = 0.36; // bore radius, in body radii
const _shapeDir = new THREE.Vector3();

function enterShape() {
  G.state = "shape";
  // keep the chosen rock, let the sand take the rest
  G.playerRock = G.candidates[G.candidateIdx];
  G.candidates.forEach((r, i) => {
    if (i !== G.candidateIdx) sinkRock(r);
  });
  G.candidates = [G.playerRock];

  ui.showPhase("SHAPE IT");
  ui.els.phaseNext.textContent = "Paint it →";
  ui.els.phaseNext.classList.remove("hidden");
  ui.showStats(G.playerRock.flat, G.playerRock.heft, G.playerRock.grit);
  G.shapeEyeFade = 1;
  G.shapeEyeHold = 0;
  G.coreBuzzed = false;
  G.bridgeTold = false;

  G.idleSpinAt = G.elapsed; // idle turntable spins from entry until first touch

  // The camera keeps the crouch it had on the sand — flying it somewhere else to
  // grind was a trip long enough to lose the stone in. Instead the stone comes
  // to it: straight up the view ray to arm's length, so picking and shaping are
  // one continuous shot. updateShape does the travelling.
  const dir = _shapeDir.copy(cam.lookCur).sub(camRig.position);
  if (dir.lengthSq() < 1e-6) dir.set(0, 0, -1);
  dir.normalize();
  const dist = 2.1 + 0.9 / clamp(camera.aspect, 0.5, 2.2); // portrait needs the room
  G.shapeHold.copy(camRig.position).addScaledVector(dir, dist);
  // never let it hang inside the bank or dip into the water
  const floor = Math.max(shoreHeight(G.shapeHold.x, G.shapeHold.z), WATER_Y) + 0.8;
  if (G.shapeHold.y < floor) G.shapeHold.y = floor;
  cam.mode = "closeup";
  cam.pos.copy(camRig.position);
  cam.look.copy(G.shapeHold);
}

/** a candidate the player passed over: it settles back into the wet sand */
function sinkRock(rock) {
  particles.paintPuff(rock.group.position, "#cdb994");
  G.sinkers.push({
    rock,
    floor: shoreHeight(rock.group.position.x, rock.group.position.z) - 1.3,
    tilt: (Math.random() < 0.5 ? -1 : 1) * (0.3 + Math.random() * 0.4),
    t: 0,
  });
}

function updateSinkers(dt) {
  for (let i = G.sinkers.length - 1; i >= 0; i--) {
    const s = G.sinkers[i];
    const g = s.rock.group;
    s.t += dt;
    g.position.y -= dt * (0.35 + Math.min(s.t, 1.2) * 0.7); // tips in, then goes under
    g.rotation.z += dt * s.tilt;
    s.rock.update(dt);
    if (g.position.y <= s.floor) {
      s.rock.dispose();
      G.sinkers.splice(i, 1);
    }
  }
}

function clearSinkers() {
  for (const s of G.sinkers) s.rock.dispose();
  G.sinkers.length = 0;
}

function updateShape(dt) {
  const rock = G.playerRock;
  const pd = G.paintDrag;
  // the stone floats off the sand up into frame (see enterShape)
  const gp = rock.group.position;
  gp.x = damp(gp.x, G.shapeHold.x, 3.4, dt);
  gp.y = damp(gp.y, G.shapeHold.y, 3.4, dt);
  gp.z = damp(gp.z, G.shapeHold.z, 3.4, dt);
  // The face is a sticker pinned over the middle of the stone — right where you
  // dig — so it ducks out of the way while you work, and stays out a moment
  // after a breakthrough so you get to see daylight through your own rock.
  const dim = G.sculpting || G.elapsed < G.shapeEyeHold;
  G.shapeEyeFade = damp(G.shapeEyeFade, dim ? 0.12 : 1, dim ? 16 : 3.5, dt);
  rock.fadeEyes(G.shapeEyeFade);
  if (pointer.down && pd.mode === "rotate") {
    // grab & spin to reach every lump — yaw free, tilt clamped
    const dx = pointer.x - pd.lastX;
    const dy = pointer.y - pd.lastY;
    rock.group.rotation.y += dx * 0.009;
    rock.group.rotation.x = clamp(rock.group.rotation.x + dy * 0.006, -1.2, 1.2);
    pd.lastX = pointer.x;
    pd.lastY = pointer.y;
    pd.spinVel = 0; // no coasting — the rock holds where you leave it
  } else if (!pointer.down && G.elapsed >= G.idleSpinAt) {
    // untouched for 5s: ease back into a lazy turntable spin
    pd.spinVel = damp(pd.spinVel, 0.6, 1.5, dt);
    rock.group.rotation.y += pd.spinVel * dt;
  } else {
    pd.spinVel = 0; // touching (sculpting/rotating) or inside the 5s hold: dead still
  }
  if (G.sculpting) {
    aimAt(pointer.x, pointer.y);
    const { hit, at, moved, punched, hard, blocked } = rock.carve(raycaster.ray, CARVE_R, dt * CARVE_RATE);
    if (hit) {
      if (blocked) {
        // The bit is on the neck holding two halves of the stone together, and
        // that is the one thing it won't cut: it skids and takes nothing. One
        // buzz the first time, then the skid and clank have to speak for it.
        if (Math.random() < 0.12) audio.coreClank();
        shake(0.01);
        rock.react("determined", 0.4);
        if (!G.bridgeTold) {
          G.bridgeTold = true;
          haptic(18);
        }
      } else if (hard > 0.3) {
        // the deeper in the bit gets the tighter the stone is packed: it rings
        // and crawls instead of biting, so hollowing out the middle is a
        // commitment
        if (Math.random() < 0.1 * hard) audio.coreClank();
        shake(0.016 * hard);
        rock.react("dizzy", 0.3);
        // one buzz the first time the bit hits the hard stuff, then it's on you
        if (!G.coreBuzzed && hard > 0.6) {
          G.coreBuzzed = true;
          haptic(12);
        }
      }
      if (moved > 0.00005) {
        particles.grindChips(at);
        if (Math.random() < 0.35) audio.grind();
        ui.showStats(rock.flat, rock.heft, rock.grit);
        // gritty, continuous rumble while stone is being worked
        shake(0.006 + Math.random() * 0.004);
        // squirmy carving face — held alive by the constant work, eases back to
        // the base expression a beat after you stop
        rock.react(Math.random() < 0.5 ? "dizzy" : "surprised", 0.35);
        rock.kickEyes(0.6);
      }
      // breakthrough: the bore met the far side and daylight came through
      if (punched) {
        G.shapeEyeHold = G.elapsed + 1.6; // linger so the hole gets its moment
        particles.grindChips(at);
        audio.thunk();
        shake(0.16);
        haptic(30);
        rock.react("surprised", 1.2);
        rock.kickEyes(1.5);
      }
    }
  }
}

// ------------------------------------------------------------------ phase: PAINT
let colorPipAt = 0; // hue drags stream, so the pip that follows them needs a floor

function enterPaint() {
  G.state = "paint";
  G.brushSize = BRUSH_DEF;
  G.paintDrag.spinVel = 0.5;
  G.idleSpinAt = G.elapsed; // idle turntable spins from entry until first touch
  ui.showPhase("PAINT IT");
  ui.els.phaseNext.textContent = IS_PLAYABLE_CRAFT ? "Done! ✓" : "To the lake! →";
  ui.els.rockStats.classList.add("hidden");
  G.playerRock.fadeEyes(1); // face back on for the paint booth
  ui.buildPaintUI({
    patterns: ["dunk", ...ROCK_PATTERNS, "wash"],
    brush: { min: BRUSH_MIN, max: BRUSH_MAX, value: G.brushSize },
    onColor: (c) => {
      G.brushColor = c;
      if (G.elapsed - colorPipAt > 0.09) {
        colorPipAt = G.elapsed;
        audio.pip(true);
      }
    },
    onPattern: (p) => {
      if (p === "dunk") G.playerRock.repaint(G.brushColor, null);
      else if (p === "wash") G.playerRock.clearStrokes();
      else G.playerRock.repaint(null, p);
      audio.paintDab();
      particles.paintPuff(G.playerRock.group.position, p === "wash" ? "#bfe8ff" : G.brushColor);
      G.playerRock.kickEyes(1);
    },
    onSize: (r) => {
      G.brushSize = r;
    },
  });
}

function updatePaint(dt) {
  const rock = G.playerRock;
  const pd = G.paintDrag;

  if (pointer.down && pd.mode === "paint") {
    const hits = raycastFrom({ clientX: pointer.x, clientY: pointer.y }, [rock.mesh]);
    if (hits.length && hits[0].uv) {
      rock.paintDab(hits[0].uv, G.brushColor, G.brushSize);
      if (Math.random() < 0.2) audio.paintDab();
      if (Math.random() < 0.12) particles.paintPuff(hits[0].point, G.brushColor);
    }
  } else if (pointer.down && pd.mode === "rotate") {
    // grab & spin: yaw with horizontal drag, tilt with vertical (clamped)
    const dx = pointer.x - pd.lastX;
    const dy = pointer.y - pd.lastY;
    rock.group.rotation.y += dx * 0.009;
    rock.group.rotation.x = clamp(rock.group.rotation.x + dy * 0.006, -0.85, 0.85);
    pd.lastX = pointer.x;
    pd.lastY = pointer.y;
    pd.spinVel = 0; // hold the rock still where you leave it
  } else if (!pointer.down && G.elapsed >= G.idleSpinAt) {
    // untouched for 5s: ease back into a lazy pottery-wheel turn
    pd.spinVel = damp(pd.spinVel, 0.5, 1.5, dt);
    rock.group.rotation.y += pd.spinVel * dt;
  } else {
    pd.spinVel = 0; // touching or inside the 5s hold: dead still
  }
}

// ------------------------------------------------------------------ phase: NAME
// The last thing that happens to a new stone: it gets a name, and with the name
// it gets a floater on the bench. Skip nothing — a stone with no name still
// keeps the one it was born with.
function enterName() {
  G.state = "name";
  const rock = G.playerRock;
  ui.showPhase("NAME IT");
  ui.els.paintUi.classList.add("hidden");
  ui.els.rockStats.classList.add("hidden");
  ui.els.phaseNext.classList.add("hidden");
  rock.fadeEyes(1);
  rock.react("excited", 2);
  rock.kickEyes(1.2);
  G.paintDrag.spinVel = 0.5;
  ui.showNameUI(rock.label);
}

function confirmName() {
  const rock = G.playerRock;
  rock.name = ui.nameValue(rockName(rock.seed));
  ui.hideNameUI();
  ui.els.phaseBack.classList.add("hidden");
  audio.pickRock();

  // straight onto the bench, in the floater the player tapped to start
  const slot = G.slotIdx >= 0 ? G.slotIdx : firstFreeSlot(loadShelf());
  if (slot >= 0) {
    G.slotIdx = slot;
    G.shelf = saveSlot(slot, { name: rock.name, cfg: rockCfg(rock) });
    ui.banner(rock.name.toUpperCase(), "saved to your bench", 1.6);
  } else {
    ui.banner(rock.name.toUpperCase(), "bench is full — race on", 1.6);
  }

  chooseRace();
}

ui.els.nameOk.addEventListener("click", () => {
  if (G.state === "name") confirmName();
});
ui.els.nameInput.addEventListener("keydown", (e) => {
  e.stopPropagation(); // typing "x" is a letter here, not the throw-mode key
  if (e.key === "Enter" && G.state === "name") confirmName();
});

// ------------------------------------------------------------------ phase: RACE
function startRace() {
  // whatever the stone is wearing and carrying: sockets resolve to one numbers
  // bag the sim reads, cosmetics go on the rock and the buoy it'll fish from
  G.loadout = G.slotIdx >= 0 ? loadoutFor(G.slotIdx) : null;
  const mods = resolveMods(G.loadout?.up);
  G.procT.clear();
  track("race_start", {
    mode: NET.mode, racers: NET.mode === "solo" ? G.tier.botCount + 1 : NET.players.size,
    cup: G.cup.id, tier: G.tier.id, upgrades: (G.loadout?.up ?? []).filter(Boolean).join(","),
  });
  ui.hidePhase();
  metaui.showShellHud(false); // the lake gets the whole screen
  metaui.hidePayout();
  clearSinkers();
  clearShelfScene();
  ui.wipe(() => {
    G.state = "race";
    G.hole = 0;

    // player skimmer
    const pName = G.playerRock.label;
    G.player = new Skimmer(G.playerRock, pName, true, "#ffd24a");
    G.player.setMods(mods);
    G.playerRock.setHat(G.loadout?.hat ?? "none");
    fishing.setFloater(G.loadout?.floater ?? "classic");
    // one shell only: a stone raced cup after cup would stack them otherwise
    if (!G.playerRock.mesh.userData._outlined) {
      addOutline(G.playerRock.mesh, 0x16324a, { thickness: 0.05 });
      G.playerRock.mesh.userData._outlined = true;
    }
    G.playerRock.group.rotation.set(0, 0, 0);

    // bots — how many and how sharp is the class the player picked
    G.racers = [G.player];
    // Skip playable: a small pack of rivals (all nerfed via bots.js AIM_NERF) so
    // the demo feels like a race, not a solo throw.
    const fleet = IS_PLAYABLE_SKIP ? 3 : (NET.mode === "solo" ? G.tier.botCount : BOT_PERSONAS.length);
    BOT_PERSONAS.slice(0, fleet).forEach((persona, i) => {
      const rock = randomBotRock(1000 + i * 77);
      scene.add(rock.group);
      const s = new Skimmer(rock, persona.name, false, persona.color);
      G.racers.push(s);
      G.bots.push(new BotBrain(s, persona, G.tier));
    });
    for (const s of G.racers) s.onEvent = onSkimmerEvent;

    ui.els.raceHud.classList.remove("hidden");
    setThrowMode("skip");
    setupHole(0);
  });
}

function setupHole(idx) {
  bench.group.visible = false; // the hole's terrain replaces the ground it stood on
  G.hole = idx;
  G.holeTime = COURSE[idx].time;
  G.holeWinner = null;
  G.holeFinishers = [];
  G.holeOver = false;
  ui.setHoleTimer(null);
  ui.clearFinishers();
  G.slowmoUsed = false;
  G.raceTape = [];
  G.raceTapeEvents = [];
  const tee = holeTee(idx), flag = holeFlag(idx);
  // rebuild the ground + grass first so shoreHeight() reflects this channel
  world.setHole(COURSE[idx].path, COURSE[idx].width);
  water.setPath(COURSE[idx].path, COURSE[idx].width);
  water.setVortex(flag.x, flag.z); // punch the lake open for the whirlpool
  world.flag.setPosition(flag.x, flag.z);
  // the deck faces down the opening leg, not the tee->flag chord: on a hole that
  // elbows away early those two disagree and you'd launch off the side of it
  const leg = COURSE[idx].path[1];
  world.pontoon.setPose(tee.x, tee.z, Math.atan2(leg.z - tee.z, leg.x - tee.x));
  world.course.setHole(COURSE[idx].path, COURSE[idx].islands, COURSE[idx].rocks);
  minimap.bake(COURSE[idx].path, COURSE[idx].islands, COURSE[idx].rocks, COURSE[idx].width);
  for (const s of G.racers) {
    s.resetHole(tee.x, tee.z, 4);
    s.restY = PONTOON_DECK + 0.85; // opening lie is up on the pontoon deck
  }
  clearGaze();
  fishing.hideBuoy();
  for (const b of G.bots) {
    b.cooldown = 3.2 + Math.random() * 3.5; // let the intro flyover breathe
    b.fishAt = null;
  }
  cam.mode = "intro";
  G.introT = 0;
  resetAim();
  // snap the rig to the flyover start so the wipe reveals a framed shot
  {
    const len = holeLength(idx);
    camRig.position.copy(pathPointAtDist(len - CAM_INTRO_LEAD, idx)).setY(7);
    cam.lookCur.copy(pathPointAtDist(len, idx)).setY(3.5);
  }
  const nIsl = COURSE[idx].islands.length;
  const title = COURSE[idx].name ? `${idx + 1}. ${COURSE[idx].name.toUpperCase()}` : `HOLE ${idx + 1}`;
  ui.banner(
    title,
    `${Math.round(holeLength(idx))}m of fairway · ${nIsl} island${nIsl === 1 ? "" : "s"} — follow the buoys!`
  );
  audio.pip(true);
}

/**
 * An upgrade just did the thing it's for. It gets a shout, a flash and a pinch
 * of confetti, rate-limited per upgrade so a chain of them reads as one moment
 * instead of a wall of text. Only the player's stone talks — rivals run vanilla.
 */
function procUpgrade(s, id) {
  if (!s?.isPlayer || G.replay) return;
  const u = UPGRADE_BY_ID.get(id);
  if (!u?.proc) return;
  const last = G.procT.get(id) ?? -99;
  if (G.elapsed - last < 0.85) return;
  G.procT.set(id, G.elapsed);
  const sc = worldToScreen(s.pos);
  if (!sc.behind) ui.popup(sc.x, sc.y - 58, `${u.icon} ${u.proc.text}`, { size: 27, color: u.proc.color });
  audio.pip(true);
  ui.flash(0.15);
  shake(0.1);
  haptic(14);
  particles.confetti(_procAt.copy(s.pos).setY(s.pos.y + 0.7), 14);
}
const _procAt = new THREE.Vector3();

// No mode chrome on screen: the drag itself says which shot this is, and the
// previz colours itself to match.
function setThrowMode(mode) {
  G.throwMode = mode;
}

// ------------------------------------------------------------------ skimmer events -> juice
function onSkimmerEvent(type, data) {
  const s = data.skimmer;
  const mine = s.isPlayer;

  // an equipped upgrade earning its shells — its own little celebration
  if (type === "proc") {
    if (data.id === "grudge" && mine) G.throwCooldown = 0; // the throw really is free
    procUpgrade(s, data.id);
    return;
  }

  // reactive faces — swap the flat-eye expression on splashy moments, easing
  // back to the rock's base expression after the given duration
  const rk = s.rock;
  if (rk?.react) {
    switch (type) {
      case "throw": rk.react("determined", 0.8); break;
      case "skip": rk.react(data.n >= 5 ? "excited" : "happy", 0.9); break;
      case "boing": rk.react("surprised", 0.9); break;
      case "duckHit": rk.react("excited", 1.0); break;
      case "clonk": rk.react("dizzy", 1.1); break;
      case "blast": rk.react("dizzy", 1.3); break;
      case "beach": case "island": rk.react("worried", 1.0); break;
      case "sink": rk.react("sad", 1.6); break;
      case "flag": rk.react("excited", 3.0); break;
      case "splashHit":
        rk.react("angry", 0.9);
        data.victim?.rock?.react?.("surprised", 1.0);
        break;
    }
  }

  // networked play: relay events for every skimmer we own (self + host's bots)
  if (NET.mode !== "solo" && NET.started && !s.isRemote) netSendEvent(s, type, data);

  // log splashy moments onto the race tape so the killcam can re-fire them
  if (G.state === "race" && !G.replay && G.raceTape.length) {
    if (type === "skip" || type === "boing" || type === "blast" || type === "sink" || type === "duckHit") {
      G.raceTapeEvents.push({ frame: G.raceTape.length - 1, type, x: data.at.x, y: data.at.y, z: data.at.z, who: s });
    } else if (type === "throw") {
      G.raceTapeEvents.push({ frame: G.raceTape.length - 1, type, who: s });
    }
  }

  switch (type) {
    case "skip": {
      particles.skipSplash(data.at, s.vel, Math.min(1, data.speed / 20));
      audio.skip(data.n, Math.min(1, data.speed / 20));
      world.scareDucks(data.at);
      if (mine) {
        const sc = worldToScreen(data.at);
        if (!sc.behind) ui.comboPopup(sc.x, sc.y - 20, data.n);
        if (data.n >= 4) shake(0.08 + data.n * 0.015);
        if (data.n === 5) {
          hitstop(0.06, 0.85);
          fovKick(2);
          if (!sc.behind) ui.popup(sc.x, sc.y - 64, "ON FIRE!", { size: 30, color: "#ff8a3d" });
        }
        if (data.n === 8) { hitstop(0.09, 0.9); ui.banner("SKIP GOD", "", 1.0); }
        haptic(8);
        // drama: last hop racing toward the flag
        if (!G.slowmoUsed && s.distToFlag(currentFlagV3()) < 13 && data.n >= 2) {
          G.slowmoUsed = true;
          slowmo(0.8, 0.35);
        }
      }
      break;
    }
    case "settle": {
      particles.idleRipple(s.pos);
      audio.settle();
      if (mine) {
        cam.mode = "aim";
        G.throwCooldown = 0.4;
        resetAim();
        if (s.skips >= 3) {
          const sc = worldToScreen(s.pos);
          if (!sc.behind) ui.popup(sc.x, sc.y - 40, `${s.skips} skips!`, { size: 26, color: "#aef4ff" });
        }
      }
      break;
    }
    case "sink": {
      // a stone coming in perpendicular punches a column; a shallow one slurps
      const steep = data.steep ?? 0.4;
      particles.sinkSplash(data.at, 0.9 + steep * 0.8);
      audio.sink();
      world.scareDucks(data.at);
      const sc = worldToScreen(data.at);
      if (!sc.behind) ui.popup(sc.x, sc.y, mine ? "GLUB!" : "glub", { size: mine ? 34 : 18, color: "#37c8e0" });
      if (mine) {
        shake(0.2 + steep * 0.15);
        haptic([20, 40, 20]);
      }
      break;
    }
    case "blast": {
      particles.blast(data.at);
      audio.blast();
      const caught = (data.victims ?? 0) > 0;
      shake(mine ? (caught ? 0.35 : 0.16) : 0.15);
      if (mine && caught) { hitstop(0.07, 0.85); ui.flash(0.25); }
      world.scareDucks(data.at);
      break;
    }
    case "duckHit": {
      // The owning simulation already launched its duck; remote/replay views
      // use the event position to launch their local matching duck.
      world.hitDuck(data.at, s.vel);
      particles.featherBurst(data.at, s.vel);
      const sc = worldToScreen(data.at);
      if (mine) {
        shake(0.2);
        hitstop(0.055, 0.72);
        fovKick(3);
        haptic([18, 25, 18]);
        if (!sc.behind) ui.popup(sc.x, sc.y - 30, "FEATHER BOOST!", { size: 32, color: "#fff3bd" });
      } else if (!sc.behind) {
        ui.popup(sc.x, sc.y, "QUACK!", { size: 18, color: "#fff3bd" });
      }
      break;
    }
    case "splashHit": {
      const victim = data.victim;
      if (!victim) break;
      // we detected the hit on a remote stone — tell their client to sink it
      if (!s.isRemote && victim.isRemote && NET.mode !== "solo") {
        const msg = { t: "knock", victim: victim.netId, from: [s.pos.x, s.pos.z] };
        if (NET.mode === "host") {
          if (victim.netId >= BOT_ID_BASE) NET.byId.get(victim.netId)?.applyKnock(s.pos);
          else net.sendTo(victim.netId, msg);
        } else net.send(msg);
      }
      const sc = worldToScreen(victim.pos);
      if (!sc.behind) ui.popup(sc.x, sc.y - 10, victim.isPlayer ? "YOU GOT SPLASHED!" : "SPLASHED!", {
        size: victim.isPlayer ? 34 : 24, color: "#ff5470",
      });
      audio.splashed();
      if (victim.isPlayer) { shake(0.4); ui.flash(0.3); haptic([30, 50, 30]); }
      if (mine) ui.banner("DIRECT HIT!", `${victim.name} is going for a swim`, 1.4);
      break;
    }
    case "boing": {
      audio.boing(data.n);
      particles.skipSplash(data.at, s.vel, 0.5);
      world.scareDucks(data.at);
      const sc = worldToScreen(data.at);
      if (mine) {
        shake(0.16);
        hitstop(0.04, 0.7);
        fovKick(2);
        if (!sc.behind) ui.popup(sc.x, sc.y - 20, `BOING ×${data.n}!`, { size: 30, color: "#ffd24a" });
        haptic(15);
      } else if (!sc.behind) {
        ui.popup(sc.x, sc.y, "boing", { size: 16, color: "#ffd24a" });
      }
      break;
    }
    case "boatThunk": {
      audio.thunk();
      particles.skipSplash(data.at, s.vel, 0.4);
      if (mine) {
        shake(0.18);
        const sc = worldToScreen(data.at);
        if (!sc.behind) ui.popup(sc.x, sc.y, "THUNK", { size: 24, color: "#ffd24a" });
      }
      break;
    }
    case "deckLand": {
      audio.deckLand();
      if (mine) {
        ui.banner("FERRY RIDE!", `the ${FERRY_NAMES[data.boatType] || "boat"} carries your stone`, 2.2);
        cam.mode = "aim";
        G.throwCooldown = 0.4;
        resetAim();
        shake(0.1);
      } else {
        const sc = worldToScreen(data.at);
        if (!sc.behind) ui.popup(sc.x, sc.y, `${s.name} hitched a ride!`, { size: 16, color: "#fff" });
      }
      break;
    }
    case "clonk": {
      audio.thunk();
      particles.grindChips(data.at);
      particles.skipSplash(data.at, s.vel, 0.3);
      const sc = worldToScreen(data.at);
      if (mine) {
        shake(0.3);
        hitstop(0.05, 0.8);
        if (!sc.behind) ui.popup(sc.x, sc.y - 10, "CLONK!", { size: 30, color: "#c8d2d8" });
        haptic([25, 30]);
      } else if (!sc.behind) {
        ui.popup(sc.x, sc.y, "clonk", { size: 16, color: "#c8d2d8" });
      }
      break;
    }
    case "island": {
      audio.deckLand();
      particles.grindChips(data.at);
      const sc = worldToScreen(data.at);
      if (mine) {
        if (!sc.behind) ui.popup(sc.x, sc.y - 20, "ISLAND STOP!", { size: 28, color: "#6fe07a" });
        ui.banner("SAFE ON SAND", "no fishing on dry land", 1.6);
        cam.mode = "aim";
        G.throwCooldown = 0.4;
        resetAim();
        shake(0.08);
      } else if (!sc.behind) {
        ui.popup(sc.x, sc.y, `${s.name} island-hopped`, { size: 15, color: "#6fe07a" });
      }
      break;
    }
    case "beach": {
      audio.thunk();
      if (mine) {
        const sc = worldToScreen(data.at);
        if (!sc.behind) ui.popup(sc.x, sc.y, "BEACHED", { size: 26, color: "#eed9a4" });
        cam.mode = "aim";
        G.throwCooldown = 0.4;
        resetAim();
      }
      break;
    }
    case "flag": {
      // the whirlpool takes it: foam where it got caught, glub as it goes under
      particles.sinkSplash(data.at, 1.1);
      audio.sink();
      if (NET.mode === "guest") {
        // netSendEvent shipped our tape to the host — the host places us
        if (s.isPlayer) s.finished = true;
      } else {
        declareHoledOut(s);
      }
      break;
    }
    case "throw": {
      if (!mine && Math.random() < 0.5) audio.throwWhoosh(data.power * 0.5);
      break;
    }
  }
}

// ------------------------------------------------------------------ hole scoring
/** authoritative placing call (solo + host). Guests receive `holed` messages. */
function declareHoledOut(s, tapeOverride = null) {
  if (G.holeOver || G.holeFinishers.includes(s)) return;
  if (tapeOverride?.tape) {
    s.tape = tapeOverride.tape;
    s.tapeSkips = tapeOverride.skips ?? [];
  }
  const place = G.holeFinishers.length + 1;
  if (place === 1) G.holeTime = FINAL_STRETCH; // the first one in starts the clock
  if (NET.mode === "host") {
    net.broadcast({
      t: "holed", id: s.netId, place, throws: s.throws, best: s.bestCombo,
      ht: +G.holeTime.toFixed(1), tape: s.tape, skips: s.tapeSkips,
    });
  }
  holedOut(s, place);
  // Nothing left worth waiting for once the people are in: the field that beat
  // them keeps its places and the stones still out there score nothing. Bots
  // never hold a hole open on their own.
  const people = humanRacers();
  if (G.holeFinishers.length >= G.racers.length) endHole("allIn");
  else if (people.length && people.every((h) => h.finished)) endHole("playersIn");
}

/**
 * The stones with a person behind them — everyone in G.racers that isn't a bot.
 * Only the host runs BotBrains, so G.bots is empty on a guest and can't be the
 * whole test; net ids identify the host's bots from any seat.
 */
function humanRacers() {
  return G.racers.filter((s) => s.netId < BOT_ID_BASE && !G.bots.some((b) => b.s === s));
}

/** one stone drops into the whirlpool: bookkeeping plus the noise it deserves */
function holedOut(s, place) {
  s.finished = true;
  G.holeFinishers.push(s);
  const flag = currentFlagV3();
  audio.holeWin(s.isPlayer);

  if (place === 1) {
    G.holeWinner = s;
    particles.confetti(new THREE.Vector3(flag.x, 2, flag.z), 90);
    for (let i = 0; i < 6; i++) {
      after(0.25 + i * 0.35, () => {
        particles.firework(
          new THREE.Vector3(flag.x + (Math.random() - 0.5) * 14, 9 + Math.random() * 7, flag.z + (Math.random() - 0.5) * 14)
        );
      });
    }
  } else {
    particles.confetti(new THREE.Vector3(flag.x, 2, flag.z), 26);
  }

  // the running order reads off the board in the corner, so no splash text here
  ui.addFinisher(place, s.name, s.tint, s.isPlayer);

  if (s.isPlayer) {
    // done throwing this hole: park over the whirlpool and watch the rest arrive
    if (fishing.active) fishing.cancel();
    cam.mode = "closeup";
    cam.pos.set(flag.x + 10, 7, flag.z + 10);
    cam.look.set(flag.x, 1.5, flag.z);
    slowmo(1.0, 0.35);
    shake(0.2);
    ui.flash(0.3);
  }
}

/**
 * Call the hole. `reason` is "playersIn" (everyone with a person behind them is
 * home), "allIn" (the bots made it too) or "time" (the final stretch, or the
 * hole's own clock, ran out). Points go out by finishing order; anyone still on
 * the water gets nothing.
 */
function endHole(reason) {
  if (G.holeOver) return;
  G.holeOver = true;
  ui.setHoleTimer(null);
  if (fishing.active) fishing.cancel();

  // nobody found the whirlpool all hole — the closest stone still takes it
  const blank = G.holeFinishers.length === 0;
  if (blank) {
    const flag = currentFlagV3();
    let best = null, bestD = Infinity;
    for (const s of G.racers) {
      const d = s.distToFlag(flag);
      if (d < bestD) { bestD = d; best = s; }
    }
    if (best) { G.holeWinner = best; G.holeFinishers.push(best); }
  }

  const awards = G.holeFinishers.map((s, i) => {
    const pts = holePoints(i + 1);
    s.points += pts;
    if (i === 0) s.holesWon++;
    return [s.netId, pts];
  });
  if (NET.mode === "host") net.broadcast({ t: "holeEnd", awards, reason, blank });
  presentHoleEnd(reason, blank);
}

/** the banner, the spectate angle and the killcam that close out a hole */
function presentHoleEnd(reason, blank) {
  const flag = currentFlagV3();
  const place = G.holeFinishers.indexOf(G.player) + 1;
  const w = G.holeWinner;
  const summary = blank
    ? ["TIME!", `${w?.isPlayer ? "you were" : (w?.name ?? "nobody") + " was"} closest to the flag`]
    : place
      ? [`HOLE ${G.hole + 1} DONE`, `you finished ${ordinal(place)} — +${holePoints(place)} pts`]
      : ["TIME!", "you never made the hole — no points"];
  ui.banner(...summary, 2.4);

  cam.mode = "closeup";
  cam.pos.set(flag.x + 10, 7, flag.z + 10);
  cam.look.set(flag.x, 1.5, flag.z);

  // the killcam only holds the last few seconds of tape, so it's worth rolling
  // when the hole closed on a stone dropping in, not when the clock ran out
  const last = G.holeFinishers[G.holeFinishers.length - 1];
  if (reason !== "time" && last && G.raceTape.length >= 40) after(2.0, () => startReplay(last));
  else after(3.0, nextHoleOrResults);
}

// ------------------------------------------------------------------ killcam
// (team scrap: ring-buffer-killcam-replay) — replay the winning throw from a
// cinematic side angle, letterboxed, splashes and plinks re-fired from the tape.
const letterboxEl = document.getElementById("letterbox");

function startReplay(s) {
  // full-scene replay: every racer's transform comes off the rolling race
  // tape, starting at the winner's final throw
  const racers = [...G.racers];
  const wIdx = racers.indexOf(s);
  let throwFrame = 0;
  for (let i = G.raceTapeEvents.length - 1; i >= 0; i--) {
    const e = G.raceTapeEvents[i];
    if (e.type === "throw" && e.who === s) { throwFrame = e.frame; break; }
  }
  // lead in ~0.5s before the throw, and never replay less than ~1.7s of tape
  // (short putt wins otherwise blink past)
  const startIdx = Math.max(0, Math.min(throwFrame - 30, G.raceTape.length - 100));
  const frames = G.raceTape.slice(startIdx);
  if (frames.length < 30 || wIdx < 0 || frames[0].length < racers.length * TAPE_STRIDE) {
    after(1.2, nextHoleOrResults);
    return;
  }
  const events = G.raceTapeEvents
    .filter((e) => e.frame >= startIdx && e.type !== "throw")
    .map((e) => ({ ...e, frame: e.frame - startIdx }));
  const f0 = frames[0], fl = frames[frames.length - 1];
  const w0 = wIdx * TAPE_STRIDE;
  const dir = new THREE.Vector3(fl[w0] - f0[w0], 0, fl[w0 + 2] - f0[w0 + 2]);
  if (dir.lengthSq() < 0.01) dir.set(1, 0, 0);
  dir.normalize();
  G.replay = {
    active: true, skimmer: s, racers, wIdx, frames, events, i: 0, speed: 0.55,
    side: new THREE.Vector3(-dir.z, 0, dir.x),
    pos: new THREE.Vector3(f0[w0], f0[w0 + 1], f0[w0 + 2]),
  };
  letterboxEl.classList.add("on");
  ui.els.raceHud.classList.add("hidden"); // clean cinematic frame
  cam.mode = "replay";
  // hard cut to the replay angle
  camRig.position.copy(G.replay.pos).addScaledVector(G.replay.side, 9).add(new THREE.Vector3(0, 2.4, 0));
  cam.lookCur.copy(G.replay.pos);
}

function updateReplay(dt) {
  const r = G.replay;
  const prev = Math.floor(r.i);
  r.i += dt * 60 * r.speed;
  const idx = Math.floor(r.i);
  // re-fire the splashy moments we passed this frame
  for (const e of r.events) {
    if (e.frame > prev && e.frame <= Math.min(idx, r.frames.length - 1)) {
      const at = new THREE.Vector3(e.x, e.y, e.z);
      let kick = 0;
      if (e.type === "skip" || e.type === "boing") {
        particles.skipSplash(at, new THREE.Vector3(0, 0, 0.01), 0.8);
        audio.skip(3, 0.7);
        kick = 2;
      } else if (e.type === "blast") {
        particles.blast(at);
        audio.blast();
        kick = 2.2;
      } else if (e.type === "sink") {
        particles.sinkSplash(at, 1);
        audio.sink();
        kick = 1.5;
      } else if (e.type === "duckHit") {
        particles.featherBurst(at, new THREE.Vector3(0, 0, 0.01));
        kick = 2.5;
      }
      if (kick) e.who?.rock?.kickEyes?.(kick); // pupils jolt on the replayed hit too
    }
  }
  if (idx >= r.frames.length - 1) { endReplay(); return; }
  const fa = r.frames[idx], fb = r.frames[idx + 1];
  const t = r.i - idx;
  // every rock plays back, not just the winner's
  r.racers.forEach((s, ri) => {
    const o = ri * TAPE_STRIDE;
    if (o + 4 >= fa.length || o + 4 >= fb.length) return; // roster changed mid-tape
    const m = s.mesh;
    m.position.set(
      lerp(fa[o], fb[o], t),
      lerp(fa[o + 1], fb[o + 1], t),
      lerp(fa[o + 2], fb[o + 2], t)
    );
    m.rotation.y = lerp(fa[o + 3], fb[o + 3], t);
    // the face comes off the tape as well, so a rock wears the same expression
    // it had at that instant instead of whatever it has settled into by now
    s.rock?.setPlaybackExpression?.(EYE_EXPRESSIONS[fa[o + 4]] ?? null);
    s.rock.update(dt); // eyes keep tracking, squash springs keep settling
  });
  const w0 = r.wIdx * TAPE_STRIDE;
  r.pos.set(
    lerp(fa[w0], fb[w0], t),
    lerp(fa[w0 + 1], fb[w0 + 1], t),
    lerp(fa[w0 + 2], fb[w0 + 2], t)
  );
}

function endReplay() {
  const r = G.replay;
  if (!r) return;
  // hand every mesh (and face) back to the live sim
  for (const s of r.racers) {
    s.mesh.position.copy(s.pos);
    s.rock?.setPlaybackExpression?.(null);
  }
  G.replay = null;
  letterboxEl.classList.remove("on");
  if (G.state === "race") ui.els.raceHud.classList.remove("hidden");
  // a host decision may have arrived mid-replay
  if (G.pendingHole != null) {
    const h = G.pendingHole;
    G.pendingHole = null;
    ui.wipe(() => setupHole(h));
    return;
  }
  if (G.pendingEnd) {
    const rows = G.pendingEnd;
    G.pendingEnd = null;
    endMatch(rows);
    return;
  }
  const flag = currentFlagV3();
  cam.mode = "closeup";
  cam.pos.set(flag.x + 10, 7, flag.z + 10);
  cam.look.set(flag.x, 1.5, flag.z);
  after(0.8, nextHoleOrResults);
}

function holeTimeout() {
  if (NET.mode === "guest") return; // the host calls the hole
  endHole("time");
}

function gotoHole(idx) {
  if (G.replay) { G.pendingHole = idx; return; }
  ui.wipe(() => setupHole(idx));
}

function standingsRows() {
  return [...G.racers]
    .sort((a, b) => b.points - a.points || b.holesWon - a.holesWon || a.totalThrows - b.totalThrows)
    .map((s) => ({
      name: s.name, color: s.tint, points: s.points, holes: s.holesWon,
      throws: s.totalThrows, id: s.netId, me: s.isPlayer,
    }));
}

function nextHoleOrResults() {
  if (NET.mode === "guest") return; // host drives hole transitions
  if (G.hole + 1 < COURSE.length) {
    if (NET.mode === "host") net.broadcast({ t: "nextHole", idx: G.hole + 1 });
    gotoHole(G.hole + 1);
  } else {
    const rows = standingsRows();
    if (NET.mode === "host") net.broadcast({ t: "end", rows });
    endMatch(rows);
  }
}

function endMatch(rowsIn = null) {
  G.state = "results";
  if (fishing.active) fishing.cancel();
  clearGaze();
  rivalLines.hideAll();
  ui.els.raceHud.classList.add("hidden");
  hidePreview();
  const rows = (rowsIn ?? standingsRows()).map((r) => ({
    ...r,
    me: NET.mode === "solo" ? r.me : r.id === NET.myId,
  }));
  const playerWon = rows[0]?.me;
  track("race_end", { mode: NET.mode, won: !!playerWon, place: rows.findIndex((r) => r.me) + 1 });
  if (IS_PLAYABLE_SKIP) {
    // Hand off to the ad's end-card CTA (defined in the playable entry html).
    if (playerWon) { audio.win(); } else { audio.lose(); }
    cam.mode = "orbit";
    try { window.__playableEnd__ && window.__playableEnd__(!!playerWon); } catch (e) { /* never break the ad */ }
    return;
  }
  ui.showResults(rows, playerWon);
  if (NET.mode === "solo") awardCareer(rows, playerWon);
  nextCupBtn.classList.toggle("hidden", NET.mode !== "solo");
  if (playerWon) {
    audio.win();
    // fireworks everywhere
    for (let i = 0; i < 10; i++) {
      after(i * 0.4, () => {
        particles.firework(new THREE.Vector3((Math.random() - 0.5) * 60, 12 + Math.random() * 10, (Math.random() - 0.5) * 60));
      });
    }
  } else {
    audio.lose();
  }
  cam.mode = "orbit";
}

// ------------------------------------------------------------------ career payout
/**
 * Cash the cup in. The tally itemises itself under the podium and the shell
 * counter runs up to meet it, because a number that just changes while you
 * weren't looking isn't a reward.
 */
function awardCareer(rows, playerWon) {
  const me = rows.find((r) => r.me);
  const place = rows.findIndex((r) => r.me) + 1;
  if (place <= 0) return;
  const before = shells();
  const cleanSweep = (me?.holes ?? 0) >= COURSE.length;
  const firstClear = playerWon && cupRecord(G.cup.id, G.tier.id) !== 1;
  const purse = payoutFor({
    place, racers: rows.length,
    points: me?.points ?? 0, holesWon: me?.holes ?? 0,
    tier: G.tier, firstClear, cleanSweep,
  });
  addShells(purse.total);
  recordCup(G.cup.id, G.tier.id, place, playerWon);
  metaui.showShellHud(true);
  metaui.showPayout(purse, before);
  track("cup_end", {
    cup: G.cup.id, tier: G.tier.id, place, won: playerWon, shells: purse.total,
  });
}

// ------------------------------------------------------------------ back out of a race
const nextCupBtn = document.getElementById("next-cup-btn");

/** strike the race set. The player's stone survives only if we're going again. */
function teardownRace({ keepPlayerRock = false } = {}) {
  for (const s of G.racers) {
    if (s.rock && s.rock !== G.playerRock) s.rock.dispose();
  }
  G.racers = [];
  G.bots = [];
  G.player = null;
  G.holeFinishers = [];
  G.holeWinner = null;
  G.holeOver = false;
  G.replay = null;
  G.effects.length = 0; // pending fireworks from a hole we've left
  letterboxEl.classList.remove("on");
  fishing.hideBuoy();
  if (fishing.active) fishing.cancel();
  rivalLines.hideAll();
  hidePreview();
  ui.els.raceHud.classList.add("hidden");
  ui.hideResults();
  metaui.hidePayout();
  if (!keepPlayerRock) {
    G.playerRock?.dispose();
    G.playerRock = null;
    G.candidates = [];
  }
  COURSE = HOLES; // the open lake behind the bench is not a cup's channel
}

ui.els.againBtn.addEventListener("click", () => {
  if (NET.mode !== "solo") { location.reload(); return; } // a room can't rewind on its own
  audio.pip(true);
  ui.wipe(() => {
    teardownRace();
    enterShelf();
  });
});

// straight back to the cup board with the same stone — the Mario Kart "next cup"
nextCupBtn.addEventListener("click", () => {
  if (NET.mode !== "solo" || !G.playerRock) return;
  audio.pip(true);
  ui.wipe(() => {
    teardownRace({ keepPlayerRock: true });
    metaui.showShellHud(true);
    chooseRace();
  });
});

// ------------------------------------------------------------------ race update
// ------------------------------------------------------------------ gaze
// Stones are nosy. A resting rock eyes up whichever rival is nearest, everyone
// turns to watch a stone that's mid-flight (and the winner once a hole is
// decided), and a flying rock stares down its own line. With nothing worth
// watching the pupils fall back to the camera.
const GAZE_RANGE = 22;      // how far a stone bothers looking
const _gazeAt = new THREE.Vector3();

function nearestOf(s, list) {
  let best = null, bestD = Infinity;
  for (const o of list) {
    const d = o.mesh.position.distanceToSquared(s.mesh.position);
    if (d < bestD) { bestD = d; best = o; }
  }
  return best;
}

function pickGazeTarget(s) {
  if (G.holeOver && G.holeWinner && G.holeWinner !== s) return G.holeWinner; // all eyes on the winner
  const flying = G.racers.filter((o) => o !== s && o.state === "flying");
  if (flying.length) return nearestOf(s, flying);
  if (Math.random() < 0.25) return null; // …or straight down the lens
  const near = G.racers.filter(
    (o) => o !== s && o.mesh.position.distanceToSquared(s.mesh.position) < GAZE_RANGE * GAZE_RANGE
  );
  return near.length ? nearestOf(s, near) : null;
}

function updateGaze(dt) {
  for (const s of G.racers) {
    const rk = s.rock;
    if (!rk) continue;
    // mid-throw it watches where it's going, not the neighbours
    if (s.state === "flying" && !G.replay) {
      _gazeAt.copy(s.mesh.position).addScaledVector(s.vel, 0.4);
      rk.lookAt(_gazeAt);
      s.gazeT = 0;
      continue;
    }
    s.gazeT -= dt;
    if (s.gazeT <= 0) {
      s.gazeAt = pickGazeTarget(s);
      s.gazeT = 1.1 + Math.random() * 1.6; // glance again in a moment
    }
    // read the live mesh, so gaze follows tape positions during the killcam too
    if (s.gazeAt) rk.lookAt(_gazeAt.copy(s.gazeAt.mesh.position).setY(s.gazeAt.mesh.position.y + 0.3));
    else rk.lookAt(null);
  }
}

/** hand every stone's gaze back to the camera (hole change, results screen) */
function clearGaze() {
  for (const s of G.racers) {
    s.gazeAt = null;
    s.gazeT = 0;
    s.rock?.lookAt(null);
  }
}

function updateRace(dt) {
  const flag = currentFlagV3();
  const ctx = {
    dt, elapsed: G.elapsed, water, boats,
    others: G.racers, flagPos: flag, captureR: CAPTURE_R,
    islands: COURSE[G.hole].islands, path: COURSE[G.hole].path, rocks: COURSE[G.hole].rocks,
    hitDuck: (pos, vel) => world.hitDuck(pos, vel),
    onBotRecover: (s) => {
      particles.sinkSplash(s.pos, 0.7);
    },
  };

  // timer (host/solo authoritative; guests track + resync from clock messages).
  // Once a stone is in, the readout comes up: that's the final stretch running.
  if (!G.holeOver) {
    G.holeTime -= dt;
    if (G.holeFinishers.length) ui.setHoleTimer(Math.max(0, G.holeTime));
    if (G.holeTime <= 0) holeTimeout();
  }
  if (NET.mode === "host" && NET.started && !G.holeOver) {
    NET.clockAccum += dt;
    if (NET.clockAccum >= 2) {
      NET.clockAccum = 0;
      net.broadcast({ t: "clock", ht: +G.holeTime.toFixed(1), boats: boats.boats.map((b) => +b.t.toFixed(2)) });
    }
  }

  G.throwCooldown = Math.max(0, G.throwCooldown - dt);

  // the stone can leave your hand mid-drag (a rival's splash can shunt it off a
  // resting lie), so drop the aim the moment it stops being yours to swing
  if (drag.active && !canAim()) {
    if (pointer.down) pointer.voided = true;
    drag.active = false;
    drag.power = 0;
    drag.elev = FLAT_ELEV;
    hidePreview();
  }

  // physics for everyone (remote stones interpolate toward their snapshots)
  for (const s of G.racers) {
    if (G.replay?.active) break; // the killcam tape owns every mesh right now
    if (s.isRemote) {
      if (s.netTarget) {
        s.pos.x = damp(s.pos.x, s.netTarget[0], 12, dt);
        s.pos.y = damp(s.pos.y, s.netTarget[1], 12, dt);
        s.pos.z = damp(s.pos.z, s.netTarget[2], 12, dt);
        s.mesh.position.copy(s.pos);
        s.mesh.rotation.y += (s.netTarget[3] - s.mesh.rotation.y) * Math.min(1, 10 * dt);
      }
      s.rock.update(dt);
    } else if (s.state === "fishing" && s.isPlayer) { /* frozen while minigame runs */ }
    else s.step(ctx);

    // flight trails — a long enough chain still overrides everything with fire
    if (s.state === "flying") {
      if (s.skips >= s.mods.fireAt) particles.fireTrail(s.pos);
      else if (s.isPlayer && G.loadout && G.loadout.trail !== "none") {
        emitTrail(particles, G.loadout.trail, s.pos, 0xbfe8ff);
      } else if (Math.random() < 0.7) {
        particles.trail(s.pos, s.isPlayer ? 0xbfe8ff : s.tint);
      }
    }
  }

  // stream snapshots for the stones we own
  if (NET.mode !== "solo" && NET.started) {
    NET.snapAccum += dt;
    if (NET.snapAccum >= 0.1) {
      NET.snapAccum = 0;
      for (const s of G.racers) {
        if (s.isRemote) continue;
        if (!s.isPlayer && NET.mode !== "host") continue;
        const msg = {
          t: "s", id: s.netId,
          p: [+s.pos.x.toFixed(2), +s.pos.y.toFixed(2), +s.pos.z.toFixed(2)],
          ry: +s.mesh.rotation.y.toFixed(2),
          st: s.state, sk: s.skips,
        };
        if (NET.mode === "host") net.broadcast(msg);
        else net.send(msg);
      }
    }
  }

  // player sink -> dive underwater and fish it back. How long the stone is under
  // first is the entry angle's business (physics.js): a steep plunge is a short
  // wait, a shallow glug wallows.
  const p = G.player;
  if (p.state === "sinking" && p.sinkT > p.sinkDelay && !fishing.active) {
    p.state = "fishing";
    const spot = p.pos.clone();
    spot.y = 0;
    cam.mode = "fishing";
    fishing.start(spot, p.rock, (clean, hits) => {
      // every fish bump drifts you back toward the tee — Tugboat softens it
      const penalty = hits * 1.2 * p.mods.driftMul;
      const tee = holeTee();
      const back = new THREE.Vector3(tee.x - spot.x, 0, tee.z - spot.z);
      back.y = 0;
      if (back.lengthSq() > 0.1) back.normalize();
      p.placeAt(spot.x + back.x * penalty, spot.z + back.z * penalty);
      // the buoy parks under the new lie and the rock nestles into the ring
      fishing.parkBuoy(p.pos.x, p.pos.z);
      p.restY = BUOY_REST;
      particles.sinkSplash(p.pos, 0.8);
      audio.settle();
      const sc = worldToScreen(p.pos);
      if (!sc.behind) ui.popup(sc.x, sc.y - 30, clean ? "CLEAN CATCH!" : "got it back...", { size: 28, color: "#6fe07a" });
      cam.mode = "aim";
      G.throwCooldown = 0.4;
      resetAim();
      p.rock.kickEyes(1.5);
    }, COURSE[G.hole]?.rocks ?? [], p.mods); // spires the dive camera has to see around
  }

  // bots think (each stops once its own stone is in; all stop when the hole is called)
  if (!G.holeOver) {
    for (const b of G.bots) b.update(ctx);
  }

  // camera follows the action
  if (cam.mode !== "intro" && !G.replay) {
    if (p.state === "flying") cam.mode = "flight";
    else if (p.state === "fishing" && fishing.active) cam.mode = "fishing";
    else if (p.state === "sinking") {
      if (cam.mode !== "closeup") cam.mode = "flight"; // hover where it went down
    } else if (!G.holeOver && !p.finished && cam.mode !== "aim") {
      cam.mode = "aim";
    }
  }

  // who's eyeing whom
  updateGaze(dt);

  // rival fishing lines — watch who's paying the price
  rivalLines.update(dt, G.elapsed, water, G.racers, G.player);

  // roll the full-scene killcam tape — and freeze it the moment the hole is
  // decided, so the frozen post-win seconds don't flush the flight out of
  // the ring buffer (that made replays end on a motionless rock)
  if (!G.replay && !G.holeOver) recordTapeFrame();

  minimapTick(dt);

  // gentle idle ripples around resting stones
  if (Math.random() < dt * 2.5) {
    const rest = G.racers.filter((s) => s.state === "resting");
    if (rest.length) particles.idleRipple(rest[(Math.random() * rest.length) | 0].pos);
  }
}

let mmAccum = 0;
function minimapTick(dt) {
  mmAccum += dt;
  if (mmAccum < 0.08) return;
  minimap.update(mmAccum, G.racers, boats, G.player);
  mmAccum = 0;
}

// ------------------------------------------------------------------ main loop
let last = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  let rawDt = Math.min(0.05, (now - last) / 1000);
  if (!Number.isFinite(rawDt) || rawDt < 0) rawDt = 1 / 60;
  last = now;
  const dt = updateTime(rawDt); // hitstop-scaled game time
  G.elapsed += dt;

  // delayed one-shots
  for (let i = G.effects.length - 1; i >= 0; i--) {
    G.effects[i].t -= dt;
    if (G.effects[i].t <= 0) {
      const fn = G.effects[i].fn;
      G.effects.splice(i, 1);
      fn();
    }
  }

  water.update(dt, G.elapsed);
  world.update(dt, G.elapsed, water);
  boats.update(dt, G.elapsed, water, particles);
  particles.update(dt);
  updateSinkers(dt);
  cel.update(dt);
  audio.update(rawDt);
  fishing.update(rawDt, G.elapsed, pointer.x / window.innerWidth);
  if (G.replay?.active) updateReplay(rawDt);

  switch (G.state) {
    case "shelf": updateShelf(dt); break;
    case "name":
      // lazy turntable while the player types
      G.playerRock.group.rotation.y += dt * 0.5;
      G.playerRock.update(dt);
      break;
    case "find":
      // hover-bob the picked candidate
      G.candidates.forEach((r) => {
        const picked = r.group.userData.picked;
        const targetY = shoreHeight(r.group.position.x, r.group.position.z) + (picked ? 0.9 : 0.16);
        r.group.position.y = damp(r.group.position.y, targetY, 6, dt);
        if (picked) r.group.rotation.y += dt * 1.2;
        r.update(dt);
      });
      break;
    case "shape": updateShape(dt); G.playerRock.update(dt); break;
    case "paint": updatePaint(dt); G.playerRock.update(dt); break;
    case "netlobby":
      G.playerRock.group.rotation.y += dt * 0.8;
      G.playerRock.update(dt);
      break;
    case "race": updateRace(dt); break;
  }

  camUpdate(rawDt); // camera on real time so slow-mo still feels smooth
  applyShake(shakeRig, rawDt, G.elapsed);
  camera.getWorldPosition(_wsPos);
  camera.getWorldQuaternion(_wsQuat);
  setEyeTarget(_wsPos, _wsQuat); // pupils track the camera; face billboards to it

  // submerged? dark-blue grade + wobble filter on the canvas
  const under = camRig.position.y < -0.15;
  // fade rock outcrops that wedge between a submerged camera and what it's watching
  world.course.updateOcclusion(_wsPos, cam.lookCur, under, rawDt);
  if (under !== G._underwater) {
    G._underwater = under;
    document.body.classList.toggle("underwater", under);
  }

  renderer.render(scene, camera);
}

if (IS_PLAYABLE_SKIP) {
  // Skip all the prep chrome — hand the player a ready flat stone and go.
  startPlayable();
} else if (IS_PLAYABLE_CRAFT) {
  // Drop straight onto the beach to make a rock: find -> shape -> paint.
  startCraftPlayable();
} else {
  // analytics + attribution: safe no-ops without keys (see src/analytics.js).
  loadMeta(); // the career, read through once before anything asks for shells
  initAnalytics();
  track("session_start");
  // AppsFlyer is native-only; dynamic-import so the web bundle never pulls it in.
  void import("./appsflyer.js").then((m) => m.initAppsFlyer()).catch(() => {});
  enterTitle();
}
requestAnimationFrame(frame);

// Playable slice bootstrap: a pre-shaped, flat, freshly-painted stone straight
// into the race. No title, no find/shape/paint.
function startPlayable() {
  ui.els.title.classList.add("hidden");
  const rock = new Rock({
    seed: 7, lumpAmp: 0.09, thickness: 0.4, size: 0.6,
    color: "#37c8e0", pattern: "flame",
  });
  scene.add(rock.group);
  G.playerRock = rock;
  startRace();
}

// Craft slice bootstrap: no title, no race — set the open-lake backdrop the
// title screen would normally lay down, then walk onto the beach to pick,
// shape and paint a stone. The paint "Done!" button ends into the ad card.
function startCraftPlayable() {
  ui.els.title.classList.add("hidden");
  water.setPath(null); // full open lake, not a hole's channel
  water.setVortex(); // no whirlpool cut into it
  world.setHole(null); // radial disc ground/grass to match the open lake
  enterFind();
}

// The stone is shaped and painted: show it off, then hand to the ad end card
// (the entry html's __playableEnd__ swaps in craft-flavoured copy + the CTA).
function finishCraftPlayable() {
  audio.win();
  ui.hidePhase();
  G.playerRock?.react?.("excited", 2);
  G.playerRock?.kickEyes?.(1.4);
  try { window.__playableEnd__ && window.__playableEnd__(true); } catch (e) { /* never break the ad */ }
}

// tiny hook for automated smoke tests (harmless in normal play)
window.__skimmers = {
  G, selectCandidate, worldToScreen, cam, camRig, camera, THREE, HOLES, boats, fishing,
  startPlayable, startCraftPlayable, setupHole, bench, enterShelf, pickSlot, confirmName, endMatch,
  // career hooks, so a test can hand itself a pile of shells or wipe the save
  meta: { loadMeta, shells, addShells, resetMeta, loadoutFor },
  get course() { return COURSE; },
};

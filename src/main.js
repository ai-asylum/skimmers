/**
 * Skippidy Skip — main loop and state machine.
 *
 * TITLE -> FIND (pick a rock) -> SHAPE (grind it) -> PAINT -> RACE (3 holes
 * vs 7 bot rivals, all through the same Skimmer physics) -> RESULTS.
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
import { Water, WATER_Y, LAKE_R } from "./water.js";
import { World, shoreHeight, RivalLines, PONTOON_DECK } from "./world.js";
import { Boats } from "./boats.js";
import { Rock, ROCK_COLORS, ROCK_PATTERNS, rockName, randomBotRock, setEyeTarget } from "./rock.js";
import { Skimmer, simulateThrow, BLAST_R } from "./physics.js";
import { BotBrain, BOT_PERSONAS } from "./bots.js";
import { Fishing, BUOY_REST } from "./fishing.js";
import { Minimap } from "./minimap.js";
import { Net, matchCode } from "./net.js";
import * as ui from "./ui.js";
import { initAnalytics, track } from "./analytics.js";

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
const minimap = new Minimap();
const cel = new CelShader(scene, { steps: 4, floor: 0.42, rescanSec: 1.0 });

// ------------------------------------------------------------------ match config
// Each hole is a fairway path (tee = first point, flag = last) with island
// rest stops on the bends — land on one and you throw from dry sand, no fishing.
const HOLES = [
  {
    // gentle S through one island; spires wall off the straight shot
    time: 90,
    path: [
      { x: 0, z: 46 }, { x: -18, z: 28 }, { x: -27, z: 6 },
      { x: -14, z: -16 }, { x: 0, z: -38 },
    ],
    islands: [{ x: -27, z: 6, r: 3.4 }],
    rocks: [
      { x: 4, z: 6, r: 5.5, h: 9 }, { x: 12, z: 22, r: 4.5, h: 8 },
      { x: -3, z: -13, r: 4.2, h: 7 }, { x: 9, z: 14, r: 4, h: 8 },
      { x: 5, z: -26, r: 4, h: 8 }, { x: 18, z: 30, r: 4, h: 7 },
    ],
  },
  {
    // double dogleg around the east shore, two islands
    time: 100,
    path: [
      { x: -40, z: -22 }, { x: -14, z: -37 }, { x: 12, z: -34 },
      { x: 34, z: -16 }, { x: 40, z: 6 }, { x: 28, z: 24 }, { x: 12, z: 34 },
    ],
    islands: [{ x: 12, z: -34, r: 3.2 }, { x: 40, z: 6, r: 3.6 }],
    rocks: [
      { x: -14, z: 2, r: 6, h: 9 }, { x: 2, z: 11, r: 5, h: 8 },
      { x: -3, z: -11, r: 4.5, h: 7 }, { x: -26, z: -8, r: 4.5, h: 8 },
      { x: -4, z: 22, r: 4.5, h: 8 }, { x: 10, z: 0, r: 4, h: 7 },
    ],
  },
  {
    // full zigzag, three islands
    time: 110,
    path: [
      { x: 40, z: -30 }, { x: 14, z: -41 }, { x: -14, z: -35 },
      { x: -36, z: -14 }, { x: -38, z: 12 }, { x: -16, z: 29 },
      { x: 8, z: 37 }, { x: 28, z: 26 },
    ],
    islands: [{ x: 14, z: -41, r: 3 }, { x: -36, z: -14, r: 3.4 }, { x: -16, z: 29, r: 3 }],
    rocks: [
      { x: 34, z: -2, r: 5.5, h: 9 }, { x: 25, z: 11, r: 4.5, h: 8 },
      { x: 15, z: -13, r: 4.5, h: 7 }, { x: 0, z: 4, r: 5, h: 8 },
      { x: 25, z: -9, r: 4.5, h: 8 }, { x: 8, z: -3, r: 4, h: 7.5 },
      { x: 12, z: 14, r: 4, h: 7 },
    ],
  },
];
const CAPTURE_R = 4.2;

// PLAYABLE-AD slice (built with playable-kit, __PLAYABLE__ define). Trims the
// game to its core skip-and-chain loop: skip title/find/shape/paint, drop
// straight onto one short, obstacle-light hole with the flag within a throw or
// two, one rival for life. Win => the ad's end-card CTA (wired in the playable
// entry html). `typeof` guard keeps the token inert in normal web/Android builds.
const IS_PLAYABLE = typeof __PLAYABLE__ !== "undefined" && !!__PLAYABLE__;
if (IS_PLAYABLE) {
  HOLES.length = 0;
  HOLES.push({
    time: 60,
    path: [{ x: 0, z: 34 }, { x: 0, z: 4 }, { x: 0, z: -30 }],
    islands: [],
    rocks: [{ x: 12, z: 9, r: 3, h: 6 }, { x: -12, z: -11, r: 3, h: 6 }],
  });
}

const holeTee = (idx = G.hole) => HOLES[idx].path[0];
const holeFlag = (idx = G.hole) => HOLES[idx].path[HOLES[idx].path.length - 1];
function holeLength(idx) {
  const p = HOLES[idx].path;
  let d = 0;
  for (let i = 1; i < p.length; i++) d += Math.hypot(p[i].x - p[i - 1].x, p[i].z - p[i - 1].z);
  return d;
}

// ------------------------------------------------------------------ game state
const G = {
  state: "title", // title | find | shape | paint | race | holeEnd | results
  elapsed: 0,
  hole: 0,
  holeTime: 0,
  holeWinner: null,
  player: null, // Skimmer
  playerRock: null, // Rock (chosen in FIND)
  bots: [], // BotBrain[]
  racers: [], // all Skimmers
  candidates: [], // FIND-phase rocks
  candidateIdx: -1,
  grinding: false,
  throwMode: "skip",
  throwCooldown: 0,
  slowmoUsed: false,
  aimDir: new THREE.Vector3(0, 0, -1), // camera-following aim direction
  paintDrag: { mode: null, lastX: 0, lastY: 0, spinVel: 0 }, // paint-phase grab & spin
  raceTape: [], // rolling frames of EVERY racer's transform, for the killcam
  raceTapeEvents: [], // { frame, type, x, y, z, who } splashes etc, re-fired in replay
  effects: [], // { t, fn } delayed one-shots on game time
};
const TAPE_MAX = 200; // ~3.3s of full-scene replay

function recordTapeFrame() {
  const n = G.racers.length;
  const frame = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    const m = G.racers[i].mesh;
    frame[i * 4] = m.position.x;
    frame[i * 4 + 1] = m.position.y;
    frame[i * 4 + 2] = m.position.z;
    frame[i * 4 + 3] = m.rotation.y;
  }
  G.raceTape.push(frame);
  if (G.raceTape.length > TAPE_MAX) {
    G.raceTape.shift();
    for (const e of G.raceTapeEvents) e.frame--;
    G.raceTapeEvents = G.raceTapeEvents.filter((e) => e.frame >= 0);
  }
}

/** point the aim (and thus the camera) from the player's lie toward the flag */
function resetAim() {
  const p = G.player;
  if (!p) return;
  const f = holeFlag();
  G.aimDir.set(f.x - p.pos.x, 0, f.z - p.pos.z);
  if (G.aimDir.lengthSq() < 0.01) G.aimDir.set(0, 0, -1);
  G.aimDir.normalize();
}

function after(sec, fn) { G.effects.push({ t: sec, fn }); }

// ------------------------------------------------------------------ input
const pointer = {
  down: false, dragging: false,
  startX: 0, startY: 0, x: 0, y: 0,
};
const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();

canvas.addEventListener("pointerdown", (e) => {
  pointer.down = true;
  pointer.dragging = false;
  pointer.startX = pointer.x = e.clientX;
  pointer.startY = pointer.y = e.clientY;
  onPointerDown(e);
});
window.addEventListener("pointermove", (e) => {
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

function raycastFrom(e, objects) {
  ndc.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  return raycaster.intersectObjects(objects, true);
}

const _wsPos = new THREE.Vector3();
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
  mode: "orbit", // orbit | aim | flight | closeup
  baseFov: 58,
};

function camUpdate(dt) {
  let targetPos = cam.pos, targetLook = cam.look;
  const p = G.player;

  if (cam.mode === "orbit") {
    const a = G.elapsed * 0.06;
    targetPos = new THREE.Vector3(Math.cos(a) * 70, 30, Math.sin(a) * 70);
    targetLook = new THREE.Vector3(0, -4, 0);
  } else if (cam.mode === "intro" && p) {
    // hole-intro flyover: sweep from the flag back to your stone
    G.introT += dt;
    const flag = currentFlagV3();
    const t = clamp01(G.introT / 2.6);
    const e = t * t * (3 - 2 * t);
    const dir = new THREE.Vector3().subVectors(flag, p.pos);
    dir.y = 0;
    if (dir.lengthSq() < 0.01) dir.set(0, 0, -1);
    dir.normalize();
    const start = flag.clone().addScaledVector(dir, -13).add(new THREE.Vector3(0, 7, 0));
    const endPos = p.pos.clone().addScaledVector(dir, -6.5).add(new THREE.Vector3(0, 3.4, 0));
    targetPos = start.lerp(endPos, e);
    const lookStart = flag.clone().setY(3.5);
    const lookEnd = p.pos.clone().addScaledVector(dir, 10).add(new THREE.Vector3(0, 1.2, 0));
    targetLook = lookStart.lerp(lookEnd, e);
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
  } else if (cam.mode === "closeup") {
    // set explicitly by phase code via cam.pos/cam.look
    targetPos = cam.pos;
    targetLook = cam.look;
  }

  // snappier orbit while actively dragging so the previz tracks the pointer
  const l = cam.mode === "flight" ? 6.5
    : cam.mode === "intro" ? 8
    : cam.mode === "replay" ? 6
    : cam.mode === "aim" && drag.active ? 6.5
    : 3.6;
  camRig.position.x = damp(camRig.position.x, targetPos.x, l, dt);
  camRig.position.y = damp(camRig.position.y, targetPos.y, l, dt);
  camRig.position.z = damp(camRig.position.z, targetPos.z, l, dt);
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
const drag = { active: false, power: 0, dir: new THREE.Vector3(0, 0, -1) };

function updateDragAim() {
  const p = G.player;
  if (!p) return;
  const dx = pointer.x - pointer.startX;
  const dy = pointer.y - pointer.startY;
  const len = Math.hypot(dx, dy);
  drag.power = clamp01(len / (Math.min(window.innerWidth, window.innerHeight) * 0.38));

  // base direction: rock -> flag, rotated by horizontal drag
  const flag = currentFlagV3();
  const base = new THREE.Vector3().subVectors(flag, p.pos);
  base.y = 0;
  if (base.lengthSq() < 0.01) base.set(0, 0, -1);
  base.normalize();
  const ang = -dx * 0.005;
  const cos = Math.cos(ang), sin = Math.sin(ang);
  drag.dir.set(base.x * cos - base.z * sin, 0, base.x * sin + base.z * cos);
  G.aimDir.copy(drag.dir); // camera orbits to keep the previz centered

  // preview via the real sim
  previewMat.color.setHex(G.throwMode === "splash" ? 0xff9aac : 0xffffff);
  const sim = simulateThrow(p.pos, drag.dir, drag.power, G.throwMode, p.rock, water, G.elapsed, 6, HOLES[G.hole].islands, HOLES[G.hole].rocks);
  const step = Math.max(1, Math.floor(sim.points.length / previewDots.length));
  let di = 0;
  for (let i = 0; i < sim.points.length && di < previewDots.length; i += step) {
    const d = previewDots[di++];
    d.position.copy(sim.points[i]);
    d.visible = true;
    d.scale.setScalar(1 - (di / previewDots.length) * 0.6);
  }
  for (; di < previewDots.length; di++) previewDots[di].visible = false;
  if (G.throwMode === "splash" && sim.points.length) {
    blastRing.visible = true;
    const endP = sim.points[sim.points.length - 1];
    blastRing.position.set(endP.x, WATER_Y + 0.05, endP.z);
  } else {
    blastRing.visible = false;
  }
}

function tryPlayerThrow() {
  const p = G.player;
  if (!p || G.state !== "race" || G.holeWinner || cam.mode === "intro") return;
  if (p.finished || G.throwCooldown > 0) return;
  if (p.state !== "resting" && p.state !== "beached" && p.state !== "onboat") return;
  if (drag.power < 0.08) return; // tap, not a throw
  const power = drag.power;

  // invisible aim assist (team scrap: invisible-driving-assist-layer):
  // if the throw would land near the flag line, nudge it a touch truer
  if (G.throwMode === "skip") {
    const sim = simulateThrow(p.pos, drag.dir, power, "skip", p.rock, water, G.elapsed, 6, HOLES[G.hole].islands, HOLES[G.hole].rocks);
    const end = sim.points[sim.points.length - 1];
    if (end) {
      const flag = currentFlagV3();
      const dEnd = Math.hypot(end.x - flag.x, end.z - flag.z);
      if (dEnd < 8) {
        const ideal = new THREE.Vector3(flag.x - p.pos.x, 0, flag.z - p.pos.z).normalize();
        drag.dir.lerp(ideal, 0.25 * (1 - dEnd / 8)).normalize();
      }
    }
  }
  if (p.throwRock(drag.dir, power, G.throwMode)) {
    fishing.hideBuoy(); // leaving the buoy lie (no-op otherwise)
    cam.mode = "flight";
    G.slowmoUsed = false;
    audio.throwWhoosh(power);
    fovKick(3 + power * 5);
    shake(0.12 * power);
    haptic(18);
    G.throwCooldown = 0.5;
  }
}

// ------------------------------------------------------------------ pointer handlers per state
function onPointerDown(e) {
  if (G.state === "find") {
    const hits = raycastFrom(e, G.candidates.map((r) => r.group));
    if (hits.length) {
      // walk up to whichever candidate group owns the hit mesh
      let o = hits[0].object;
      while (o && !G.candidates.some((r) => r.group === o)) o = o.parent;
      const idx = G.candidates.findIndex((r) => r.group === o);
      if (idx >= 0) selectCandidate(idx);
    }
  } else if (G.state === "shape") {
    // drag ON the stone grinds; drag anywhere else grabs and spins it
    const hits = raycastFrom(e, [G.playerRock.mesh]);
    if (hits.length) {
      G.grinding = true;
    } else {
      G.paintDrag.mode = "rotate";
      G.paintDrag.lastX = e.clientX;
      G.paintDrag.lastY = e.clientY;
    }
  } else if (G.state === "paint") {
    // drag ON the stone paints; drag anywhere else grabs and spins it
    const hits = raycastFrom(e, [G.playerRock.mesh]);
    G.paintDrag.mode = hits.length ? "paint" : "rotate";
    G.paintDrag.lastX = e.clientX;
    G.paintDrag.lastY = e.clientY;
  }
}

function onPointerMove(e) {
  if (G.state === "race" && pointer.down && pointer.dragging) {
    if (!drag.active) drag.active = true;
    updateDragAim();
  }
}

function onPointerUp() {
  if (G.state === "race" && drag.active) {
    updateDragAim();
    tryPlayerThrow();
    drag.active = false;
    drag.power = 0;
    hidePreview();
  }
  drag.active = false;
  if (G.state === "shape") G.grinding = false;
  G.paintDrag.mode = null;
}

// ------------------------------------------------------------------ phase: TITLE
function enterTitle() {
  G.state = "title";
  cam.mode = "orbit";
  ui.els.title.classList.remove("hidden");
}

ui.els.playBtn.addEventListener("click", () => {
  audio.pip(true);
  ui.els.title.classList.add("hidden");
  ui.wipe(() => enterFind());
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
const tintFor = (id) => (id >= 100 ? null : PLAYER_TINTS[id % PLAYER_TINTS.length]);

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

function rockCfg(rock) {
  const lumpLeft = rock.groups.reduce((s, g) => s + g.lump, 0) / rock.initialLumpSum;
  return {
    seed: rock.seed, size: rock.size, thickness: rock.thickness,
    lumpAmp: rock.lumpAmp * lumpLeft, color: rock.color, pattern: rock.pattern,
    strokes: rock.strokesDataURL(), name: rockName(rock.seed),
  };
}

function rockFromCfg(c) {
  const r = new Rock({
    seed: c.seed, lumpAmp: c.lumpAmp, thickness: c.thickness,
    size: c.size, color: c.color, pattern: c.pattern,
  });
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
function startMatchmaking(cap) {
  NET.mode = "solo";
  NET.capacity = cap;
  NET.players.clear();
  matchmaking = { cap, idx: 1, helloTimer: null };
  lobbyEls.findBtn.classList.add("hidden");
  lobbyEls.mpBack.classList.add("hidden");
  lobbyEls.mpCancel.classList.remove("hidden");
  attachNetHandlers();
  tryMatchSlot();
}

function cancelMatchmaking() {
  if (!matchmaking) return;
  clearTimeout(matchmaking.helloTimer);
  matchmaking = null;
  net.close();
  NET.mode = "solo";
  NET.players.clear();
  lobbyEls.findBtn.classList.remove("hidden");
  lobbyEls.mpBack.classList.remove("hidden");
  lobbyEls.mpCancel.classList.add("hidden");
  netStatus("");
}

function tryMatchSlot() {
  if (!matchmaking) return;
  const { cap, idx } = matchmaking;
  if (idx > 40) { netStatus("all rooms are busy — try again in a bit"); cancelMatchmaking(); return; }
  netStatus(cap === 0 ? "finding an open room…" : `finding a ${capacityNum(cap)}-player room…`);
  const code = matchCode(cap, idx);
  net.close(); // drop any peer from the previous slot attempt
  attachNetHandlers();
  net.joinRoom(code, (err) => {
    if (!matchmaking) { net.close(); return; }
    if (err) {
      if (err.type === "peer-unavailable") becomeMatchHost(code); // empty slot -> host it
      else setTimeout(() => { if (matchmaking) tryMatchSlot(); }, 400); // transient -> retry
      return;
    }
    NET.mode = "guest";
    net.send({ t: "hello" });
    // if the host never answers (mid-start, flaky), roll to the next slot
    matchmaking.helloTimer = setTimeout(() => {
      if (matchmaking) { matchmaking.idx++; tryMatchSlot(); }
    }, 4500);
  });
}

function becomeMatchHost(code) {
  if (!matchmaking) return;
  net.close();
  attachNetHandlers();
  net.hostRoom(code, (err) => {
    if (!matchmaking) return;
    if (err) { // someone grabbed the slot first — go back to joining it
      net.close();
      setTimeout(() => { if (matchmaking) tryMatchSlot(); }, 250);
      return;
    }
    NET.mode = "host";
    NET.myId = 0;
    NET.players.clear();
    NET.players.set(0, { id: 0, name: "You", ready: false, cfg: null });
    settleIntoRoom();
  });
}

// We've landed in a room (as host or guest); leave the title and start prepping.
function settleIntoRoom() {
  if (matchmaking) clearTimeout(matchmaking.helloTimer);
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
  ui.wipe(() => enterFind());
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
        if (s) declareHoleWon(s, { tape: msg.d?.tape, skips: msg.d?.skips });
      }
      net.broadcast(msg, from);
      break;
    case "knock": {
      const victimId = msg.victim;
      if (victimId === 0) G.player?.applyKnock(new THREE.Vector3(msg.from[0], 0, msg.from[1]));
      else if (victimId >= 100) NET.byId.get(victimId)?.applyKnock(new THREE.Vector3(msg.from[0], 0, msg.from[1]));
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
        clearTimeout(matchmaking.helloTimer);
        net.close();
        matchmaking.idx++;
        tryMatchSlot();
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
    case "holeWon": {
      const s = NET.byId.get(msg.id);
      if (!s || G.holeWinner) return;
      s.throws = msg.throws ?? s.throws;
      s.bestCombo = msg.best ?? s.bestCombo;
      s.tape = msg.tape ?? [];
      s.tapeSkips = msg.skips ?? [];
      s.finished = true;
      holeWon(s);
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
  if (msg.type === "flag") { s.finished = true; return; } // host declares the win
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

// ------------------------------------------------------------------ phase: FIND
const beachSpot = (() => {
  // a nice patch of sand on the south shore
  const a = Math.PI / 2; // +z side
  const r = LAKE_R + 5;
  return new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r);
})();

function enterFind() {
  G.state = "find";
  ui.showPhase("FIND YOUR ROCK", "five contenders washed ashore");
  ui.els.phaseNext.textContent = "Shape it →";

  // scatter candidates on the beach
  for (let i = 0; i < 5; i++) {
    const rock = new Rock({
      seed: (Math.random() * 1e6) | 0,
      lumpAmp: 0.12 + Math.random() * 0.26,
      thickness: 0.38 + Math.random() * 0.28,
      size: 0.5 + Math.random() * 0.18,
      color: "#8f9aa3",
      pattern: "plain",
    });
    const ox = (i - 2) * 1.9 + (Math.random() - 0.5) * 0.6;
    const oz = (Math.random() - 0.5) * 2.2 - i % 2;
    const x = beachSpot.x + ox, z = beachSpot.z + 2 + oz;
    rock.group.position.set(x, shoreHeight(x, z) + 0.16, z);
    rock.group.rotation.y = Math.random() * Math.PI * 2;
    scene.add(rock.group);
    G.candidates.push(rock);
  }
  // camera floats over the water's edge looking back at the beach
  cam.mode = "closeup";
  cam.pos.set(beachSpot.x, 3.4, LAKE_R - 4.5);
  cam.look.set(beachSpot.x, 1.1, beachSpot.z + 2.5);
}

function selectCandidate(idx) {
  G.candidateIdx = idx;
  audio.pickRock();
  const rock = G.candidates[idx];
  ui.showStats(rock.flat, rock.heft, rock.grit);
  ui.els.phaseNext.classList.remove("hidden");
  ui.setHint(`"${rockName(rock.seed)}" — flat ones skip, hefty ones carry`);
  // lift the chosen one, drop the rest
  G.candidates.forEach((r, i) => {
    r.group.userData.picked = i === idx;
  });
  const s = worldToScreen(rock.group.position);
  ui.popup(s.x, s.y - 30, "this one!", { size: 22, color: "#ffd24a" });
}

ui.els.phaseNext.addEventListener("click", () => {
  audio.pip(true);
  if (G.state === "find" && G.candidateIdx >= 0) enterShape();
  else if (G.state === "shape") enterPaint();
  else if (G.state === "paint") {
    if (NET.mode === "solo") startRace();
    else enterNetReady();
  }
});

// ------------------------------------------------------------------ net ready + start
function enterNetReady() {
  G.state = "netlobby";
  ui.showPhase("READY!", "waiting for the other skippers…");
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
    id: 100 + i, name: persona.name, color: persona.color, seed: 1000 + i * 77,
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

  ui.wipe(() => {
    G.state = "race";
    NET.byId.clear();
    G.racers = [];
    G.bots = [];

    const myName = rockName(G.playerRock.seed);
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
function enterShape() {
  G.state = "shape";
  // keep the chosen rock, remove the rest
  G.playerRock = G.candidates[G.candidateIdx];
  G.candidates.forEach((r, i) => {
    if (i !== G.candidateIdx) scene.remove(r.group);
  });
  G.candidates = [G.playerRock];

  ui.showPhase("SHAPE IT", "flat skips far · thin sinks fast");
  ui.els.phaseNext.textContent = "Paint it →";
  ui.els.phaseNext.classList.remove("hidden");
  ui.showStats(G.playerRock.flat, G.playerRock.heft, G.playerRock.grit);

  // hoist the rock up over the shallows for grinding
  const r = G.playerRock.group;
  r.position.set(beachSpot.x, 2.6, LAKE_R - 7);
  cam.mode = "closeup";
  cam.pos.set(beachSpot.x, 3.2, r.position.z - 3.6);
  cam.look.copy(r.position);
}

function updateShape(dt) {
  const rock = G.playerRock;
  const pd = G.paintDrag;
  if (pointer.down && pd.mode === "rotate") {
    // grab & spin to reach every lump — yaw free, tilt clamped
    const dx = pointer.x - pd.lastX;
    const dy = pointer.y - pd.lastY;
    rock.group.rotation.y += dx * 0.009;
    rock.group.rotation.x = clamp(rock.group.rotation.x + dy * 0.006, -1.2, 1.2);
    pd.spinVel = clamp(dx * 0.009 / Math.max(dt, 1 / 240), -7, 7);
    pd.lastX = pointer.x;
    pd.lastY = pointer.y;
  } else if (G.grinding) {
    rock.group.rotation.y += dt * 0.5; // slow turn under the grindstone
  } else {
    pd.spinVel = damp(pd.spinVel, 0.6, 2.2, dt);
    rock.group.rotation.y += pd.spinVel * dt;
  }
  if (G.grinding) {
    const hits = raycastFrom({ clientX: pointer.x, clientY: pointer.y }, [rock.mesh]);
    if (hits.length) {
      const removed = rock.grindAt(hits[0].point, 0.55, dt * 2.4);
      if (removed > 0.002) {
        particles.grindChips(hits[0].point);
        if (Math.random() < 0.35) audio.grind();
        ui.showStats(rock.flat, rock.heft, rock.grit);
        shake(0.015);
      }
    }
  }
}

// ------------------------------------------------------------------ phase: PAINT
function enterPaint() {
  G.state = "paint";
  G.brushColor = ROCK_COLORS[1];
  G.paintDrag.spinVel = 0.5;
  ui.showPhase("PAINT IT", "make it yours — the lake will judge you");
  ui.els.phaseNext.textContent = "To the lake! →";
  ui.els.rockStats.classList.add("hidden");
  ui.buildPaintUI(
    ROCK_COLORS,
    ["dunk", ...ROCK_PATTERNS, "wash"],
    (c) => {
      G.brushColor = c;
      audio.pip(true);
    },
    (p) => {
      if (p === "dunk") G.playerRock.repaint(G.brushColor, null);
      else if (p === "wash") G.playerRock.clearStrokes();
      else G.playerRock.repaint(null, p);
      audio.paintDab();
      particles.paintPuff(G.playerRock.group.position, p === "wash" ? "#bfe8ff" : G.brushColor);
      G.playerRock.kickEyes(1);
    }
  );
}

function updatePaint(dt) {
  const rock = G.playerRock;
  const pd = G.paintDrag;

  if (pointer.down && pd.mode === "paint") {
    const hits = raycastFrom({ clientX: pointer.x, clientY: pointer.y }, [rock.mesh]);
    if (hits.length && hits[0].uv) {
      rock.paintDab(hits[0].uv, G.brushColor);
      if (Math.random() < 0.2) audio.paintDab();
      if (Math.random() < 0.12) particles.paintPuff(hits[0].point, G.brushColor);
    }
  } else if (pointer.down && pd.mode === "rotate") {
    // grab & spin: yaw with horizontal drag, tilt with vertical (clamped)
    const dx = pointer.x - pd.lastX;
    const dy = pointer.y - pd.lastY;
    rock.group.rotation.y += dx * 0.009;
    rock.group.rotation.x = clamp(rock.group.rotation.x + dy * 0.006, -0.85, 0.85);
    pd.spinVel = clamp(dx * 0.009 / Math.max(dt, 1 / 240), -7, 7);
    pd.lastX = pointer.x;
    pd.lastY = pointer.y;
  } else {
    // released: spin inertia bleeds off into a lazy pottery-wheel turn
    pd.spinVel = damp(pd.spinVel, 0.5, 2.2, dt);
    rock.group.rotation.y += pd.spinVel * dt;
  }
}

// ------------------------------------------------------------------ phase: RACE
function startRace() {
  track("race_start", { mode: NET.mode, racers: NET.mode === "solo" ? 8 : NET.players.size });
  ui.hidePhase();
  ui.wipe(() => {
    G.state = "race";
    G.hole = 0;

    // player skimmer
    const pName = rockName(G.playerRock.seed);
    G.player = new Skimmer(G.playerRock, pName, true, "#ffd24a");
    addOutline(G.playerRock.mesh, 0x16324a, { thickness: 0.05 });
    G.playerRock.group.rotation.set(0, 0, 0);

    // bots — a full fleet on web, just one rival for life in the playable slice
    G.racers = [G.player];
    (IS_PLAYABLE ? BOT_PERSONAS.slice(0, 1) : BOT_PERSONAS).forEach((persona, i) => {
      const rock = randomBotRock(1000 + i * 77);
      scene.add(rock.group);
      const s = new Skimmer(rock, persona.name, false, persona.color);
      G.racers.push(s);
      G.bots.push(new BotBrain(s, persona));
    });
    for (const s of G.racers) s.onEvent = onSkimmerEvent;

    ui.els.raceHud.classList.remove("hidden");
    setThrowMode("skip");
    setupHole(0);
  });
}

function setupHole(idx) {
  G.hole = idx;
  G.holeTime = HOLES[idx].time;
  G.holeWinner = null;
  G.slowmoUsed = false;
  G.raceTape = [];
  G.raceTapeEvents = [];
  const tee = holeTee(idx), flag = holeFlag(idx);
  world.flag.setPosition(flag.x, flag.z);
  world.pontoon.setPose(tee.x, tee.z, Math.atan2(flag.z - tee.z, flag.x - tee.x));
  world.course.setHole(HOLES[idx].path, HOLES[idx].islands, HOLES[idx].rocks);
  minimap.bake(HOLES[idx].path, HOLES[idx].islands, HOLES[idx].rocks);
  for (const s of G.racers) {
    s.resetHole(tee.x, tee.z, 4);
    s.restY = PONTOON_DECK + 0.85; // opening lie is up on the pontoon deck
  }
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
    const flagV = new THREE.Vector3(flag.x, 0, flag.z);
    const dir = new THREE.Vector3(flag.x - tee.x, 0, flag.z - tee.z).normalize();
    camRig.position.copy(flagV).addScaledVector(dir, -13).add(new THREE.Vector3(0, 7, 0));
    cam.lookCur.set(flag.x, 3.5, flag.z);
  }
  const nIsl = HOLES[idx].islands.length;
  ui.banner(
    `HOLE ${idx + 1}`,
    `${Math.round(holeLength(idx))}m of fairway · ${nIsl} island${nIsl === 1 ? "" : "s"} — follow the buoys!`
  );
  audio.pip(true);
}

function setThrowMode(mode) {
  G.throwMode = mode;
  ui.els.throwHint.classList.toggle("splash", mode === "splash");
  ui.setThrowHint(mode === "skip" ? "SKIP" : "SPLASH");
}
// the hint pill doubles as the mode toggle (touch-friendly, no chrome)
ui.els.throwHint.addEventListener("pointerdown", (e) => {
  e.stopPropagation();
  audio.pip(G.throwMode === "splash");
  setThrowMode(G.throwMode === "skip" ? "splash" : "skip");
});

// ------------------------------------------------------------------ skimmer events -> juice
function onSkimmerEvent(type, data) {
  const s = data.skimmer;
  const mine = s.isPlayer;

  // networked play: relay events for every skimmer we own (self + host's bots)
  if (NET.mode !== "solo" && NET.started && !s.isRemote) netSendEvent(s, type, data);

  // log splashy moments onto the race tape so the killcam can re-fire them
  if (G.state === "race" && !G.replay && G.raceTape.length) {
    if (type === "skip" || type === "boing" || type === "blast" || type === "sink" || type === "duckHit") {
      G.raceTapeEvents.push({ frame: G.raceTape.length - 1, type, x: data.at.x, y: data.at.y, z: data.at.z });
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
      particles.sinkSplash(data.at, 1.2);
      audio.sink();
      world.scareDucks(data.at);
      const sc = worldToScreen(data.at);
      if (!sc.behind) ui.popup(sc.x, sc.y, mine ? "GLUB!" : "glub", { size: mine ? 34 : 18, color: "#37c8e0" });
      if (mine) {
        shake(0.25);
        haptic([20, 40, 20]);
      }
      break;
    }
    case "blast": {
      particles.blast(data.at);
      audio.blast();
      shake(mine ? 0.35 : 0.15);
      if (mine) { hitstop(0.07, 0.85); ui.flash(0.25); }
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
          if (victim.netId >= 100) NET.byId.get(victim.netId)?.applyKnock(s.pos);
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
        ui.banner("FERRY RIDE!", "the rowboat carries your stone", 2.2);
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
      if (NET.mode === "guest") {
        // netSendEvent shipped our tape to the host — the host declares
        if (s.isPlayer) s.finished = true;
      } else if (!G.holeWinner) {
        declareHoleWon(s);
      }
      break;
    }
    case "throw": {
      if (!mine && Math.random() < 0.5) audio.throwWhoosh(data.power * 0.5);
      break;
    }
  }
}

// ------------------------------------------------------------------ hole win / end
/** authoritative win call (solo + host). Guests receive holeWon messages. */
function declareHoleWon(s, tapeOverride = null) {
  if (G.holeWinner) return;
  if (tapeOverride?.tape) {
    s.tape = tapeOverride.tape;
    s.tapeSkips = tapeOverride.skips ?? [];
  }
  if (NET.mode === "host") {
    net.broadcast({
      t: "holeWon", id: s.netId, throws: s.throws, best: s.bestCombo,
      tape: s.tape, skips: s.tapeSkips,
    });
  }
  holeWon(s);
}

function holeWon(s) {
  G.holeWinner = s;
  s.holesWon++;
  const flag = currentFlagV3();
  audio.holeWin(s.isPlayer);
  particles.confetti(new THREE.Vector3(flag.x, 2, flag.z), 90);
  for (let i = 0; i < 6; i++) {
    after(0.25 + i * 0.35, () => {
      particles.firework(
        new THREE.Vector3(flag.x + (Math.random() - 0.5) * 14, 9 + Math.random() * 7, flag.z + (Math.random() - 0.5) * 14)
      );
    });
  }
  if (s.isPlayer) {
    ui.banner("HOLE WON!", `${s.throws} throws — best chain ×${s.bestCombo}`, 2.4);
    slowmo(1.0, 0.35);
    shake(0.2);
    ui.flash(0.3);
  } else {
    ui.banner(`${s.name} takes the hole`, `${s.throws} throws`, 2.2);
  }
  // spectate the flag
  cam.mode = "closeup";
  cam.pos.set(flag.x + 10, 7, flag.z + 10);
  cam.look.set(flag.x, 1.5, flag.z);

  if (fishing.active) fishing.cancel();
  if (G.raceTape.length >= 40) after(2.0, () => startReplay(s));
  else after(3.2, nextHoleOrResults);
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
  if (frames.length < 30 || wIdx < 0 || frames[0].length < racers.length * 4) {
    after(1.2, nextHoleOrResults);
    return;
  }
  const events = G.raceTapeEvents
    .filter((e) => e.frame >= startIdx && e.type !== "throw")
    .map((e) => ({ ...e, frame: e.frame - startIdx }));
  const f0 = frames[0], fl = frames[frames.length - 1];
  const dir = new THREE.Vector3(fl[wIdx * 4] - f0[wIdx * 4], 0, fl[wIdx * 4 + 2] - f0[wIdx * 4 + 2]);
  if (dir.lengthSq() < 0.01) dir.set(1, 0, 0);
  dir.normalize();
  G.replay = {
    active: true, skimmer: s, racers, wIdx, frames, events, i: 0, speed: 0.55,
    side: new THREE.Vector3(-dir.z, 0, dir.x),
    pos: new THREE.Vector3(f0[wIdx * 4], f0[wIdx * 4 + 1], f0[wIdx * 4 + 2]),
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
      if (e.type === "skip" || e.type === "boing") {
        particles.skipSplash(at, new THREE.Vector3(0, 0, 0.01), 0.8);
        audio.skip(3, 0.7);
      } else if (e.type === "blast") {
        particles.blast(at);
        audio.blast();
      } else if (e.type === "sink") {
        particles.sinkSplash(at, 1);
        audio.sink();
      } else if (e.type === "duckHit") {
        particles.featherBurst(at, new THREE.Vector3(0, 0, 0.01));
      }
    }
  }
  if (idx >= r.frames.length - 1) { endReplay(); return; }
  const fa = r.frames[idx], fb = r.frames[idx + 1];
  const t = r.i - idx;
  // every rock plays back, not just the winner's
  r.racers.forEach((s, ri) => {
    if (ri * 4 + 3 >= fa.length || ri * 4 + 3 >= fb.length) return; // roster changed mid-tape
    const m = s.mesh;
    m.position.set(
      lerp(fa[ri * 4], fb[ri * 4], t),
      lerp(fa[ri * 4 + 1], fb[ri * 4 + 1], t),
      lerp(fa[ri * 4 + 2], fb[ri * 4 + 2], t)
    );
    m.rotation.y = lerp(fa[ri * 4 + 3], fb[ri * 4 + 3], t);
    s.rock.update(dt); // eyes keep tracking, squash springs keep settling
  });
  r.pos.set(
    lerp(fa[r.wIdx * 4], fb[r.wIdx * 4], t),
    lerp(fa[r.wIdx * 4 + 1], fb[r.wIdx * 4 + 1], t),
    lerp(fa[r.wIdx * 4 + 2], fb[r.wIdx * 4 + 2], t)
  );
}

function endReplay() {
  const r = G.replay;
  if (!r) return;
  // hand every mesh back to the live sim
  for (const s of r.racers) s.mesh.position.copy(s.pos);
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
  if (NET.mode === "guest") return; // host calls it
  // closest stone takes it
  let best = null, bestD = Infinity;
  const flag = currentFlagV3();
  for (const s of G.racers) {
    const d = s.finished ? -1 : s.distToFlag(flag);
    if (d < bestD) { bestD = d; best = s; }
  }
  if (best && !G.holeWinner) {
    if (fishing.active) fishing.cancel();
    if (NET.mode === "host") {
      net.broadcast({ t: "holeWon", id: best.netId, throws: best.throws, best: best.bestCombo, tape: [], skips: [] });
    }
    G.holeWinner = best;
    best.holesWon++;
    ui.banner("TIME!", `${best.isPlayer ? "you were" : best.name + " was"} closest to the flag`, 2.2);
    audio.holeWin(best.isPlayer);
    after(2.6, nextHoleOrResults);
  }
}

function gotoHole(idx) {
  if (G.replay) { G.pendingHole = idx; return; }
  ui.wipe(() => setupHole(idx));
}

function standingsRows() {
  return [...G.racers]
    .sort((a, b) => b.holesWon - a.holesWon || a.totalThrows - b.totalThrows)
    .map((s) => ({ name: s.name, color: s.tint, holes: s.holesWon, throws: s.totalThrows, id: s.netId, me: s.isPlayer }));
}

function nextHoleOrResults() {
  if (NET.mode === "guest") return; // host drives hole transitions
  if (G.hole + 1 < HOLES.length) {
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
  rivalLines.hideAll();
  ui.els.raceHud.classList.add("hidden");
  hidePreview();
  const rows = (rowsIn ?? standingsRows()).map((r) => ({
    ...r,
    me: NET.mode === "solo" ? r.me : r.id === NET.myId,
  }));
  const playerWon = rows[0]?.me;
  track("race_end", { mode: NET.mode, won: !!playerWon, place: rows.findIndex((r) => r.me) + 1 });
  if (IS_PLAYABLE) {
    // Hand off to the ad's end-card CTA (defined in the playable entry html).
    if (playerWon) { audio.win(); } else { audio.lose(); }
    cam.mode = "orbit";
    try { window.__playableEnd__ && window.__playableEnd__(!!playerWon); } catch (e) { /* never break the ad */ }
    return;
  }
  ui.showResults(rows, playerWon);
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

ui.els.againBtn.addEventListener("click", () => location.reload());

// ------------------------------------------------------------------ race update
function updateRace(dt) {
  const flag = currentFlagV3();
  const ctx = {
    dt, elapsed: G.elapsed, water, boats,
    others: G.racers, flagPos: flag, captureR: CAPTURE_R,
    islands: HOLES[G.hole].islands, path: HOLES[G.hole].path, rocks: HOLES[G.hole].rocks,
    hitDuck: (pos, vel) => world.hitDuck(pos, vel),
    onBotRecover: (s) => {
      particles.sinkSplash(s.pos, 0.7);
    },
  };

  // timer (host/solo authoritative; guests track + resync from clock messages)
  if (!G.holeWinner) {
    G.holeTime -= dt;
    if (G.holeTime <= 0) holeTimeout();
  }
  if (NET.mode === "host" && NET.started && !G.holeWinner) {
    NET.clockAccum += dt;
    if (NET.clockAccum >= 2) {
      NET.clockAccum = 0;
      net.broadcast({ t: "clock", ht: +G.holeTime.toFixed(1), boats: boats.boats.map((b) => +b.t.toFixed(2)) });
    }
  }

  G.throwCooldown = Math.max(0, G.throwCooldown - dt);

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

    // flight trails — rocks on a 5+ chain catch fire
    if (s.state === "flying") {
      if (s.skips >= 5) particles.fireTrail(s.pos);
      else if (Math.random() < 0.7) particles.trail(s.pos, s.isPlayer ? 0xbfe8ff : s.tint);
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

  // player sink -> dive underwater and fish it back
  const p = G.player;
  if (p.state === "sinking" && p.sinkT > 0.85 && !fishing.active) {
    p.state = "fishing";
    const spot = p.pos.clone();
    spot.y = 0;
    cam.mode = "fishing";
    fishing.start(spot, p.rock, (clean, hits) => {
      const penalty = hits * 1.2; // every fish bump drifts you back toward the tee
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
    });
  }

  // bots think (they stop once someone wins)
  if (!G.holeWinner) {
    for (const b of G.bots) b.update(ctx);
  }

  // camera follows the action
  if (cam.mode !== "intro" && !G.replay) {
    if (p.state === "flying") cam.mode = "flight";
    else if (p.state === "fishing" && fishing.active) cam.mode = "fishing";
    else if (p.state === "sinking") {
      if (cam.mode !== "closeup") cam.mode = "flight"; // hover where it went down
    } else if (!G.holeWinner && cam.mode !== "aim") {
      cam.mode = "aim";
    }
  }

  // rival fishing lines — watch who's paying the price
  rivalLines.update(dt, G.elapsed, water, G.racers, G.player);

  // roll the full-scene killcam tape — and freeze it the moment the hole is
  // decided, so the frozen post-win seconds don't flush the flight out of
  // the ring buffer (that made replays end on a motionless rock)
  if (!G.replay && !G.holeWinner) recordTapeFrame();

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
  cel.update(dt);
  audio.update(rawDt);
  fishing.update(rawDt, G.elapsed, pointer.x / window.innerWidth);
  if (G.replay?.active) updateReplay(rawDt);

  switch (G.state) {
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
  setEyeTarget(_wsPos); // googly pupils track the camera

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

if (IS_PLAYABLE) {
  // Skip all the prep chrome — hand the player a ready flat stone and go.
  startPlayable();
} else {
  // analytics + attribution: safe no-ops without keys (see src/analytics.js).
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

// tiny hook for automated smoke tests (harmless in normal play)
window.__skimmers = { G, selectCandidate, worldToScreen, cam, camRig, camera, THREE, HOLES, boats, fishing };

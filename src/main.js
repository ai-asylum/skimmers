/**
 * SKIMMERS — main loop and state machine.
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
import { World, shoreHeight } from "./world.js";
import { Boats } from "./boats.js";
import { Rock, ROCK_COLORS, ROCK_PATTERNS, rockName, randomBotRock } from "./rock.js";
import { Skimmer, simulateThrow, BLAST_R } from "./physics.js";
import { BotBrain, BOT_PERSONAS } from "./bots.js";
import { Fishing } from "./fishing.js";
import { Minimap } from "./minimap.js";
import * as ui from "./ui.js";

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
const fishing = new Fishing();
const minimap = new Minimap();
const cel = new CelShader(scene, { steps: 4, floor: 0.42, rescanSec: 1.0 });

// ------------------------------------------------------------------ match config
// Each hole is a fairway path (tee = first point, flag = last) with island
// rest stops on the bends — land on one and you throw from dry sand, no fishing.
const HOLES = [
  {
    // gentle S through one island
    time: 90,
    path: [
      { x: 0, z: 46 }, { x: -18, z: 28 }, { x: -27, z: 6 },
      { x: -14, z: -16 }, { x: 0, z: -38 },
    ],
    islands: [{ x: -27, z: 6, r: 3.4 }],
  },
  {
    // double dogleg around the east shore, two islands
    time: 100,
    path: [
      { x: -40, z: -22 }, { x: -14, z: -37 }, { x: 12, z: -34 },
      { x: 34, z: -16 }, { x: 40, z: 6 }, { x: 28, z: 24 }, { x: 12, z: 34 },
    ],
    islands: [{ x: 12, z: -34, r: 3.2 }, { x: 40, z: 6, r: 3.6 }],
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
  },
];
const CAPTURE_R = 4.2;
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
  effects: [], // { t, fn } delayed one-shots on game time
};

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
    const flag = currentFlagV3();
    const dir = new THREE.Vector3().subVectors(flag, p.pos);
    dir.y = 0;
    if (dir.lengthSq() < 0.01) dir.set(0, 0, -1);
    dir.normalize();
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
  } else if (cam.mode === "replay" && G.replay) {
    targetPos = G.replay.pos.clone().addScaledVector(G.replay.side, 9).add(new THREE.Vector3(0, 2.4, 0));
    targetLook = G.replay.pos;
  } else if (cam.mode === "closeup") {
    // set explicitly by phase code via cam.pos/cam.look
    targetPos = cam.pos;
    targetLook = cam.look;
  }

  const l = cam.mode === "flight" ? 6.5 : cam.mode === "intro" ? 8 : cam.mode === "replay" ? 6 : 3.6;
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

  // preview via the real sim
  previewMat.color.setHex(G.throwMode === "splash" ? 0xff9aac : 0xffffff);
  const sim = simulateThrow(p.pos, drag.dir, drag.power, G.throwMode, p.rock, water, G.elapsed, 6, HOLES[G.hole].islands);
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
    const sim = simulateThrow(p.pos, drag.dir, power, "skip", p.rock, water, G.elapsed, 6, HOLES[G.hole].islands);
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
    G.grinding = true;
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
  ui.els.muter.textContent = audio.muted ? "🔇" : "🔊";
});

// ------------------------------------------------------------------ phase: FIND
const beachSpot = (() => {
  // a nice patch of sand on the south shore
  const a = Math.PI / 2; // +z side
  const r = LAKE_R + 5;
  return new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r);
})();

function enterFind() {
  G.state = "find";
  ui.showPhase("FIND YOUR ROCK", "click a rock to size it up");
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
  else if (G.state === "paint") startRace();
});

// ------------------------------------------------------------------ phase: SHAPE
function enterShape() {
  G.state = "shape";
  // keep the chosen rock, remove the rest
  G.playerRock = G.candidates[G.candidateIdx];
  G.candidates.forEach((r, i) => {
    if (i !== G.candidateIdx) scene.remove(r.group);
  });
  G.candidates = [G.playerRock];

  ui.showPhase("SHAPE IT", "hold & rub the stone to grind it flat — thinner skips better, but sinks easier");
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
  rock.group.rotation.y += dt * (G.grinding ? 1.6 : 0.5);
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
  ui.showPhase("PAINT IT", "pick a color & drag on the stone to paint — DUNK dips the whole rock");
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
  // pottery-wheel painting: the stone keeps slowly turning under your brush
  rock.group.rotation.y += dt * (pointer.down ? 0.25 : 0.8);
  if (pointer.down) {
    const hits = raycastFrom({ clientX: pointer.x, clientY: pointer.y }, [rock.mesh]);
    if (hits.length && hits[0].uv) {
      rock.paintDab(hits[0].uv, G.brushColor);
      if (Math.random() < 0.2) audio.paintDab();
      if (Math.random() < 0.12) particles.paintPuff(hits[0].point, G.brushColor);
    }
  }
}

// ------------------------------------------------------------------ phase: RACE
function startRace() {
  ui.hidePhase();
  ui.wipe(() => {
    G.state = "race";
    G.hole = 0;

    // player skimmer
    const pName = rockName(G.playerRock.seed);
    G.player = new Skimmer(G.playerRock, pName, true, "#ffd24a");
    addOutline(G.playerRock.mesh, 0x16324a, { thickness: 0.05 });
    G.playerRock.group.rotation.set(0, 0, 0);

    // bots
    G.racers = [G.player];
    BOT_PERSONAS.forEach((persona, i) => {
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
  const tee = holeTee(idx), flag = holeFlag(idx);
  world.flag.setPosition(flag.x, flag.z);
  world.course.setHole(HOLES[idx].path, HOLES[idx].islands);
  minimap.bake(HOLES[idx].path, HOLES[idx].islands);
  for (const s of G.racers) s.resetHole(tee.x, tee.z, 4);
  for (const b of G.bots) {
    b.cooldown = 3.2 + Math.random() * 3.5; // let the intro flyover breathe
    b.fishAt = null;
  }
  cam.mode = "intro";
  G.introT = 0;
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
  ui.els.modeSkip.classList.toggle("sel", mode === "skip");
  ui.els.modeSplash.classList.toggle("sel", mode === "splash");
  ui.setThrowHint(mode === "skip"
    ? "drag back & release — flat + fast chains hops"
    : "lob it at a rival stone — knock 'em under! (X to switch)");
}
ui.els.modeSkip.addEventListener("click", () => { audio.pip(true); setThrowMode("skip"); });
ui.els.modeSplash.addEventListener("click", () => { audio.pip(false); setThrowMode("splash"); });

// ------------------------------------------------------------------ skimmer events -> juice
function onSkimmerEvent(type, data) {
  const s = data.skimmer;
  const mine = s.isPlayer;

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
          if (!sc.behind) ui.popup(sc.x, sc.y - 64, "🔥 ON FIRE!", { size: 30, color: "#ff8a3d" });
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
    case "splashHit": {
      const victim = data.victim;
      const sc = worldToScreen(victim.pos);
      if (!sc.behind) ui.popup(sc.x, sc.y - 10, victim.isPlayer ? "YOU GOT SPLASHED!" : "SPLASHED!", {
        size: victim.isPlayer ? 34 : 24, color: "#ff5470",
      });
      audio.splashed();
      if (victim.isPlayer) { shake(0.4); ui.flash(0.3); haptic([30, 50, 30]); }
      if (mine) ui.banner("DIRECT HIT!", `${victim.name} is going for a swim`, 1.4);
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
        ui.banner("FERRY RIDE!", "the rowboat carries your stone — throw when ready", 2.2);
        cam.mode = "aim";
        G.throwCooldown = 0.4;
        shake(0.1);
      } else {
        const sc = worldToScreen(data.at);
        if (!sc.behind) ui.popup(sc.x, sc.y, `${s.name} hitched a ride!`, { size: 16, color: "#fff" });
      }
      break;
    }
    case "island": {
      audio.deckLand();
      particles.grindChips(data.at);
      const sc = worldToScreen(data.at);
      if (mine) {
        if (!sc.behind) ui.popup(sc.x, sc.y - 20, "🏝 ISLAND STOP!", { size: 28, color: "#6fe07a" });
        ui.banner("SAFE ON SAND", "dry land — throw again whenever, no fishing here", 1.6);
        cam.mode = "aim";
        G.throwCooldown = 0.4;
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
      }
      break;
    }
    case "flag": {
      if (!G.holeWinner) holeWon(s);
      break;
    }
    case "throw": {
      if (!mine && Math.random() < 0.5) audio.throwWhoosh(data.power * 0.5);
      break;
    }
  }
}

// ------------------------------------------------------------------ hole win / end
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
    ui.banner("HOLE WON! 🏆", `${s.throws} throws — best chain ×${s.bestCombo}`, 2.4);
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
  if (s.tape && s.tape.length >= 40) after(2.0, () => startReplay(s));
  else after(3.2, nextHoleOrResults);
}

// ------------------------------------------------------------------ killcam
// (team scrap: ring-buffer-killcam-replay) — replay the winning throw from a
// cinematic side angle, letterboxed, splashes and plinks re-fired from the tape.
const letterboxEl = document.getElementById("letterbox");

function startReplay(s) {
  const tape = s.tape.slice();
  const skips = new Set(s.tapeSkips);
  const first = tape[0], lastF = tape[tape.length - 1];
  const dir = new THREE.Vector3(lastF.x - first.x, 0, lastF.z - first.z);
  if (dir.lengthSq() < 0.01) dir.set(1, 0, 0);
  dir.normalize();
  G.replay = {
    active: true, skimmer: s, tape, skips, i: 0, speed: 0.55,
    side: new THREE.Vector3(-dir.z, 0, dir.x),
    savedPos: s.mesh.position.clone(),
    savedRotY: s.mesh.rotation.y,
    pos: new THREE.Vector3(first.x, first.y, first.z),
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
  // re-fire recorded skip splashes we passed this frame
  for (let k = prev + 1; k <= Math.min(idx, r.tape.length - 1); k++) {
    if (r.skips.has(k)) {
      const f = r.tape[k];
      const f2 = r.tape[Math.min(k + 3, r.tape.length - 1)];
      particles.skipSplash(
        new THREE.Vector3(f.x, f.y, f.z),
        new THREE.Vector3((f2.x - f.x) * 20, 0, (f2.z - f.z) * 20),
        0.8
      );
      audio.skip(3, 0.7);
    }
  }
  if (idx >= r.tape.length - 1) { endReplay(); return; }
  const f0 = r.tape[idx], f1 = r.tape[idx + 1];
  const t = r.i - idx;
  r.pos.set(lerp(f0.x, f1.x, t), lerp(f0.y, f1.y, t), lerp(f0.z, f1.z, t));
  const m = r.skimmer.mesh;
  m.position.copy(r.pos);
  m.rotation.y = lerp(f0.ry, f1.ry, t);
}

function endReplay() {
  const r = G.replay;
  if (!r) return;
  r.skimmer.mesh.position.copy(r.savedPos);
  r.skimmer.mesh.rotation.y = r.savedRotY;
  G.replay = null;
  letterboxEl.classList.remove("on");
  if (G.state === "race") ui.els.raceHud.classList.remove("hidden");
  const flag = currentFlagV3();
  cam.mode = "closeup";
  cam.pos.set(flag.x + 10, 7, flag.z + 10);
  cam.look.set(flag.x, 1.5, flag.z);
  after(0.8, nextHoleOrResults);
}

function holeTimeout() {
  // closest stone takes it
  let best = null, bestD = Infinity;
  const flag = currentFlagV3();
  for (const s of G.racers) {
    const d = s.finished ? -1 : s.distToFlag(flag);
    if (d < bestD) { bestD = d; best = s; }
  }
  if (best && !G.holeWinner) {
    if (fishing.active) fishing.cancel();
    G.holeWinner = best;
    best.holesWon++;
    ui.banner("TIME!", `${best.isPlayer ? "you were" : best.name + " was"} closest to the flag`, 2.2);
    audio.holeWin(best.isPlayer);
    after(2.6, nextHoleOrResults);
  }
}

function nextHoleOrResults() {
  if (G.hole + 1 < HOLES.length) {
    ui.wipe(() => setupHole(G.hole + 1));
  } else {
    endMatch();
  }
}

function endMatch() {
  G.state = "results";
  if (fishing.active) fishing.cancel();
  ui.els.raceHud.classList.add("hidden");
  hidePreview();
  const rows = [...G.racers]
    .sort((a, b) => b.holesWon - a.holesWon || a.totalThrows - b.totalThrows)
    .map((s) => ({ name: s.name, color: s.tint, holes: s.holesWon, throws: s.totalThrows, me: s.isPlayer }));
  const playerWon = rows[0]?.me;
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
    islands: HOLES[G.hole].islands, path: HOLES[G.hole].path,
    onBotRecover: (s) => {
      particles.sinkSplash(s.pos, 0.7);
    },
  };

  // timer
  if (!G.holeWinner) {
    G.holeTime -= dt;
    if (G.holeTime <= 0) holeTimeout();
  }

  G.throwCooldown = Math.max(0, G.throwCooldown - dt);

  // physics for everyone
  for (const s of G.racers) {
    if (G.replay?.active && s === G.replay.skimmer) continue; // killcam owns this mesh
    if (s.state === "fishing" && s.isPlayer) { /* frozen while minigame runs */ }
    else s.step(ctx);

    // flight trails — rocks on a 5+ chain catch fire
    if (s.state === "flying") {
      if (s.skips >= 5) particles.fireTrail(s.pos);
      else if (Math.random() < 0.7) particles.trail(s.pos, s.isPlayer ? 0xbfe8ff : s.tint);
    }
  }

  // player sink -> fishing minigame
  const p = G.player;
  if (p.state === "sinking" && p.sinkT > 0.85 && !fishing.active) {
    p.state = "fishing";
    const spot = p.pos.clone();
    fishing.start((clean, tries) => {
      const penalty = tries * 1.5; // sloppier reeling drifts you backward
      const tee = holeTee();
      const back = new THREE.Vector3(tee.x - spot.x, 0, tee.z - spot.z);
      back.y = 0;
      if (back.lengthSq() > 0.1) back.normalize();
      p.placeAt(spot.x + back.x * penalty, spot.z + back.z * penalty);
      particles.sinkSplash(p.pos, 0.8);
      audio.settle();
      const sc = worldToScreen(p.pos);
      ui.popup(sc.x, sc.y - 30, clean ? "GOT IT!" : "finally...", { size: 28, color: "#6fe07a" });
      cam.mode = "aim";
      G.throwCooldown = 0.4;
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
    else if (p.state === "sinking" || p.state === "fishing") {
      if (cam.mode !== "closeup") cam.mode = "flight"; // hover where it went down
    } else if (!G.holeWinner && cam.mode !== "aim") {
      cam.mode = "aim";
    }
  }

  // HUD
  ui.setHud(G.hole + 1, HOLES.length, p.throws, G.holeTime);
  scoreboardTick(dt);
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

let sbAccum = 0;
function scoreboardTick(dt) {
  sbAccum += dt;
  if (sbAccum < 0.25) return;
  sbAccum = 0;
  const flag = currentFlagV3();
  const rows = [...G.racers]
    .map((s) => ({
      name: s.name, color: s.tint, me: s.isPlayer,
      dist: s.distToFlag(flag), holes: s.holesWon,
      busy: s.state === "fishing" || s.state === "sinking",
      finished: s.finished,
      sort: s.finished ? -1 : s.distToFlag(flag),
    }))
    .sort((a, b) => a.sort - b.sort);
  ui.renderScoreboard(rows);
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
  fishing.update(rawDt);
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
    case "race": updateRace(dt); break;
  }

  camUpdate(rawDt); // camera on real time so slow-mo still feels smooth
  applyShake(shakeRig, rawDt, G.elapsed);
  renderer.render(scene, camera);
}

enterTitle();
requestAnimationFrame(frame);

// tiny hook for automated smoke tests (harmless in normal play)
window.__skimmers = { G, selectCandidate, worldToScreen, cam, camRig, camera, THREE, HOLES };

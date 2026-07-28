// Boat contact check: stones that come DOWN onto a boat must land on deck and
// ride it, while flat shots into the side must still BOING off the hull.
// Run with `node scripts/deck-landing-check.mjs`.
import * as THREE from "three";
import { Boats } from "../src/boats.js";
import { GRAVITY } from "../src/physics.js";

const scene = new THREE.Scene();
const boats = new Boats(scene);
boats.update(1 / 60, 0, { heightAt: () => 0 }, null);
scene.updateMatrixWorld(true);

const R = 0.45;
const DT = 1 / 60;

/**
 * Fly a stone until it touches a boat; returns the hit type (or how it escaped).
 * Pass `only` to test one boat in isolation, so a neighbour on the flight path
 * can't intercept the shot.
 */
function fly(pos, vel, steps = 400, only = null) {
  pos = pos.clone();
  vel = vel.clone();
  const prev = new THREE.Vector3();
  for (let i = 0; i < steps; i++) {
    prev.copy(pos);
    vel.y -= GRAVITY * DT;
    pos.addScaledVector(vel, DT);
    const hit = only ? only.collideLocal(pos, vel, R, prev) : boats.collide(pos, vel, R, prev);
    if (hit) return { ...hit, at: pos.clone() };
    if (pos.y < -3) return { type: "fell through" };
  }
  return { type: "no contact" };
}

let fails = 0;
const expect = (label, got, want) => {
  if (got === want) return;
  fails++;
  console.log(`FAIL ${label}: ${got} (want ${want})`);
};

// 1. straight drops from every height/speed, over the middle and the gunwales
for (const b of boats.boats) {
  const { len, wid } = b.dims;
  for (const h of [0.4, 2, 6, 15, 40]) {
    for (const vy of [0, -6, -20]) {
      for (const oz of [0, wid / 2 - 0.1, wid / 2 + 0.15]) {
        for (const ox of [0, -len / 2 + 0.3, len / 2 - 0.3]) {
          if (b.type === "steam" && ox > 0.3 && ox < 1.5) continue; // smokestack, see 3.
          // start clear of the tallest deck so the drop is a real fall onto it
          const p = b.group.localToWorld(new THREE.Vector3(ox, b.decks[0].y, oz));
          const hit = fly(new THREE.Vector3(p.x, p.y + h, p.z), new THREE.Vector3(0, vy, 0));
          expect(`${b.type} drop h=${h} vy=${vy} x=${ox.toFixed(1)} z=${oz.toFixed(1)}`, hit.type, "deck");
          if (hit.local) {
            const onDeck = b.decks.some((d) => Math.abs(d.y + 0.15 - hit.local.y) < 1e-6 &&
              hit.local.x >= d.x0 && hit.local.x <= d.x1 && Math.abs(hit.local.z) <= wid / 2);
            if (!onDeck) {
              fails++;
              console.log(`FAIL ${b.type}: landing spot off the deck ${hit.local.toArray()}`);
            }
          }
        }
      }
    }
  }
}

// 2. lobbed arcs falling onto the boat from every compass direction
for (const b of boats.boats) {
  const top = b.decks[0]; // tallest deck — aim at open sky, not a cabin wall
  const deckWorld = b.group.localToWorld(new THREE.Vector3((top.x0 + top.x1) / 2, top.y, 0));
  for (let a = 0; a < 8; a++) {
    const ang = (a / 8) * Math.PI * 2;
    for (const [dist, up] of [[8, 10], [14, 16], [20, 6]]) {
      const from = new THREE.Vector3(
        deckWorld.x + Math.cos(ang) * dist, deckWorld.y + 0.4, deckWorld.z + Math.sin(ang) * dist);
      // solve the flat-ish ballistic that lands on the deck centre
      const flight = (2 * up) / GRAVITY;
      const vel = new THREE.Vector3(
        (deckWorld.x - from.x) / flight, up, (deckWorld.z - from.z) / flight);
      expect(`${b.type} lob a=${a} d=${dist}`, fly(from, vel, 400, b).type, "deck");
    }
  }
}

// 3. flat skimming shots into the flank, and the tug's smokestack, still boing
for (const b of boats.boats) {
  for (const side of [1, -1]) {
    const from = b.group.localToWorld(new THREE.Vector3(0, 0.25, side * 7));
    const to = b.group.localToWorld(new THREE.Vector3(0, 0.25, 0));
    const flight = from.distanceTo(to) / 18;
    const vel = to.clone().sub(from).divideScalar(flight);
    vel.y = (GRAVITY * flight) / 2; // arrive back at skim height, like a real hop
    expect(`${b.type} flank skim ${side}`, fly(from, vel).type, "hull");
  }
}
{
  const tug = boats.boats.find((b) => b.type === "steam");
  const p = tug.group.localToWorld(new THREE.Vector3(0.9, 0, 0));
  expect("tug smokestack clang", fly(new THREE.Vector3(p.x, p.y + 8, p.z), new THREE.Vector3(0, -4, 0)).type, "hull");
}

// 4. stones sailing clear over the top must not be captured
for (const b of boats.boats) {
  const over = b.group.localToWorld(new THREE.Vector3(0, 6, 0));
  const from = new THREE.Vector3(over.x, over.y, over.z - 9);
  expect(`${b.type} fly-over`, fly(from, new THREE.Vector3(0, 6.2, 22), 22).type, "no contact");
}

console.log(fails === 0 ? "boat contact: all cases pass" : `${fails} case(s) failed`);
process.exit(fails === 0 ? 0 : 1);

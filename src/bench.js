/**
 * The park bench up on the shore: where your stones wait between races.
 *
 * Three slots along the seat, each with the same lifebuoy the fishing minigame
 * ties its line to (lifebuoy.js), shrunk to bench size. A full slot bobs its
 * stone gently in the ring; an empty ring is left plain and the pointing finger
 * (ui.setTapHand, parked on `slotHandPoint`) does the inviting.
 *
 * Built from flat-shaded boxes like the rest of the props (see world.js), with
 * the legs stretched down to whatever the ground is doing under them — the
 * shoreline wobbles, so a bench with fixed legs would float or sink.
 */
import * as THREE from "three";
import { terrainHeightAt } from "./terrain.js";
import { SHELF_SLOTS } from "./shelf.js";
import { makeLifebuoy, BUOY_R, BUOY_TUBE } from "./lifebuoy.js";
import { paintFloater } from "./cosmetics.js";

const SEAT_Y = 0.95;      // seat top above the bench's own ground plane
const SEAT_HALF_D = 0.95; // seat depth, front (+z) to back (-z)
const LEN = 6.4;          // along the seat (+x)
const SLOT_GAP = 2.05;    // between floater centres
const RING_R = 0.68;      // floater ring radius — a shade tighter than a stone,
                          // so the rock sits proud of it instead of inside a donut
const RING_SCALE = RING_R / BUOY_R; // the lake buoy is built full size; shrink it to fit
const RING_TUBE = BUOY_TUBE * RING_SCALE;

/** How high a rock's centre rides above its ring: enough that the stone's belly
 *  dips into the hole and the rest of it shows. Stones vary a lot in thickness,
 *  so this follows the rock rather than being one height for all of them. */
export const rockLift = (rock) => 0.14 + rock.size * (rock.baseThickness + rock.lumpAmp) * 0.62;

export class RockBench {
  constructor(scene) {
    this.group = new THREE.Group();
    this.group.visible = false;

    const wood = new THREE.MeshStandardMaterial({ color: 0xc98a45, flatShading: true });
    const woodDark = new THREE.MeshStandardMaterial({ color: 0x9c6329, flatShading: true });
    const iron = new THREE.MeshStandardMaterial({ color: 0x3c4b57, flatShading: true });

    const box = (w, h, d, mat, x, y, z) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
      m.position.set(x, y, z);
      this.group.add(m);
      return m;
    };

    // cast-iron end frames — legs plus the arm they hold up
    this.legs = [];
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        // unit-height legs: place() stretches each one down to its own ground
        const leg = new THREE.Mesh(new THREE.BoxGeometry(0.26, 1, 0.26), iron);
        leg.userData.px = sx * (LEN / 2 - 0.45);
        leg.userData.pz = sz * (SEAT_HALF_D - 0.28);
        this.group.add(leg);
        this.legs.push(leg);
      }
      // armrest + its upright
      box(0.22, 0.14, SEAT_HALF_D * 1.7, iron, sx * (LEN / 2 - 0.1), SEAT_Y + 0.52, 0.06);
      box(0.18, 0.6, 0.18, iron, sx * (LEN / 2 - 0.1), SEAT_Y + 0.25, SEAT_HALF_D * 0.72);
      // back upright
      const post = box(0.2, 1.5, 0.2, iron, sx * (LEN / 2 - 0.35), SEAT_Y + 0.62, -SEAT_HALF_D + 0.12);
      post.rotation.x = 0.14;
    }

    // seat slats, front to back, with hairline gaps between them
    for (let i = 0; i < 4; i++) {
      const z = -SEAT_HALF_D + 0.28 + i * 0.48;
      box(LEN, 0.15, 0.4, i % 2 ? wood : woodDark, 0, SEAT_Y - 0.075, z);
    }

    // backrest slats, leaning back a touch
    for (let i = 0; i < 3; i++) {
      const s = box(LEN, 0.32, 0.14, i % 2 ? woodDark : wood, 0, SEAT_Y + 0.38 + i * 0.44, -SEAT_HALF_D + 0.02 - i * 0.06);
      s.rotation.x = 0.14;
    }

    // ---- the slots: a floater ring and an invisible hit box
    this.slots = [];
    for (let i = 0; i < SHELF_SLOTS; i++) {
      const x = (i - (SHELF_SLOTS - 1) / 2) * SLOT_GAP;
      const slot = new THREE.Group();
      slot.position.set(x, SEAT_Y + RING_TUBE * 0.8, 0.06);
      this.group.add(slot);

      const buoy = makeLifebuoy();
      const ring = buoy.group;
      ring.scale.setScalar(RING_SCALE);
      slot.add(ring);

      // clicking anywhere over the slot counts, rock or no rock
      const hit = new THREE.Mesh(
        new THREE.BoxGeometry(SLOT_GAP * 0.96, 2.0, 2.0),
        new THREE.MeshBasicMaterial({ visible: false }),
      );
      hit.position.y = 0.5;
      hit.userData.slot = i;
      slot.add(hit);

      this.slots.push({ group: slot, ring, buoy, hit, filled: false, phase: i * 1.7 });
    }

    this.picks = this.slots.map((s) => s.hit);
    scene.add(this.group);
  }

  /** stand the bench at (x, z) with its front (+z) pointing along (fx, fz) */
  place(x, z, fx, fz) {
    const yaw = Math.atan2(fx, fz);
    this.group.rotation.set(0, yaw, 0);
    this.group.position.set(x, 0, z);
    this.group.updateMatrixWorld(true);

    // sit the seat on the highest foot, then reach every other leg down to its
    // own patch of ground so nothing hangs in the air on a slope
    const w = new THREE.Vector3();
    let top = -Infinity;
    const grounds = this.legs.map((leg) => {
      w.set(leg.userData.px, 0, leg.userData.pz);
      this.group.localToWorld(w);
      const g = terrainHeightAt(w.x, w.z);
      if (g > top) top = g;
      return g;
    });
    this.group.position.y = top;
    this.legs.forEach((leg, i) => {
      const len = Math.max(0.35, top - grounds[i] + SEAT_Y - 0.15);
      leg.scale.y = len;
      leg.position.set(leg.userData.px, SEAT_Y - 0.15 - len / 2, leg.userData.pz);
    });
    this.group.visible = true;
  }

  /** world point at the middle of slot `i`'s floater ring */
  slotPoint(i, out = new THREE.Vector3()) {
    out.set(0, 0, 0);
    this.slots[i].group.localToWorld(out);
    return out;
  }

  /** just over an empty ring's hole: where the pointing finger goes */
  slotHandPoint(i, out = new THREE.Vector3()) {
    this.slotPoint(i, out);
    out.y += 0.42;
    return out;
  }

  setSlotFilled(i, filled) {
    this.slots[i].filled = filled;
  }

  /** dress slot `i`'s floater in a bought ring (cosmetics.js FLOATERS) */
  setSlotFloater(i, id) {
    paintFloater(this.slots[i].buoy, id);
  }

  update(dt, elapsed) {
    if (!this.group.visible) return;
    for (const s of this.slots) {
      // floaters loll about on their own little air cushion
      s.group.rotation.z = Math.sin(elapsed * 0.8 + s.phase) * 0.045;
      s.group.rotation.x = Math.cos(elapsed * 0.62 + s.phase) * 0.035;
    }
  }
}

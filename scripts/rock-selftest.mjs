// Headless check on the voxel stone in src/rock.js: that a fresh rock meshes
// into a sane closed solid, that holding the drill on one spot eventually
// breaks through without tearing the shell, that the dense middle is slow going
// rather than a wall, that nothing is ever left floating off the stone, and that
// the carve log a peer receives rebuilds exactly the same stone.
// Run with `node scripts/rock-selftest.mjs`.

// --- the thinnest possible canvas so rock.js can paint its skin in node ---
const noopCtx = new Proxy({}, {
  get: (_, k) => {
    if (k === "createRadialGradient" || k === "createLinearGradient") {
      return () => ({ addColorStop() {} });
    }
    if (k === "canvas") return { width: 256, height: 256 };
    return () => {};
  },
  set: () => true,
});
globalThis.document = {
  createElement: () => ({ width: 0, height: 0, getContext: () => noopCtx, toDataURL: () => "" }),
};
globalThis.Image = class { set src(_v) {} };

const THREE = await import("three");
const { Rock } = await import("../src/rock.js");

let fails = 0;
const check = (ok, msg) => {
  if (!ok) { fails++; console.log("FAIL:", msg); }
  else console.log("ok  :", msg);
};

// ---- helpers -------------------------------------------------------------
function surface(rock) {
  const n = rock.geo.drawRange.count;
  const p = rock.geo.attributes.position.array;
  const key = (j) => `${Math.round(p[j * 3] * 1e5)},${Math.round(p[j * 3 + 1] * 1e5)},${Math.round(p[j * 3 + 2] * 1e5)}`;
  const edges = new Map();
  let vol = 0;
  for (let t = 0; t < n; t += 3) {
    const k = [key(t), key(t + 1), key(t + 2)];
    for (let e = 0; e < 3; e++) {
      const a = k[e], b = k[(e + 1) % 3];
      if (a !== b) edges.set(`${a}|${b}`, (edges.get(`${a}|${b}`) ?? 0) + 1);
    }
    const i = t * 3;
    const ux = p[i + 3] - p[i], uy = p[i + 4] - p[i + 1], uz = p[i + 5] - p[i + 2];
    const vx = p[i + 6] - p[i], vy = p[i + 7] - p[i + 1], vz = p[i + 8] - p[i + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    vol += (p[i] * nx + p[i + 1] * ny + p[i + 2] * nz) / 6;
  }
  let open = 0;
  for (const [k, c] of edges) {
    const [a, b] = k.split("|");
    if ((edges.get(`${b}|${a}`) ?? 0) !== c) open++;
  }
  return { tris: n / 3, vol, open };
}

const rockOpts = { seed: 4242, lumpAmp: 0.18, thickness: 0.5, size: 0.55, color: "#8f9aa3" };

// ---- a fresh stone -------------------------------------------------------
const rock = new Rock(rockOpts);
const fresh = surface(rock);
check(fresh.tris > 500, `fresh stone meshes into ${fresh.tris} triangles`);
check(fresh.open === 0, `fresh stone is closed (${fresh.open} unmatched edges)`);
const ideal = (4 / 3) * Math.PI * 0.5; // flattened unit ellipsoid, before lumps
check(fresh.vol > ideal && fresh.vol < ideal * 1.7, `volume ${fresh.vol.toFixed(3)} sits above the bare ellipsoid ${ideal.toFixed(3)} (lumps) but not wildly`);
check(rock.flat > 0 && rock.flat < 1, `flat reads ${rock.flat.toFixed(3)}`);
check(rock.heft > 0 && rock.heft < 1, `heft reads ${rock.heft.toFixed(3)}`);
check(Math.abs(rock.holeFrac) < 1e-6, `nothing hollowed out yet (holeFrac ${rock.holeFrac})`);

// ---- hold the drill on one spot -----------------------------------------
const CARVE_R = 0.36, CARVE_RATE = 0.7, dt = 1 / 60;
function drillFor(target, from, maxSeconds = 12) {
  const ray = new THREE.Ray(from, target.clone().sub(from).normalize());
  let punchedAt = -1, frames = 0, missed = 0, hard = 0, blocked = 0;
  for (let t = 0; t < maxSeconds; t += dt) {
    frames++;
    const r = target.owner.carve(ray, CARVE_R, dt * CARVE_RATE);
    if (!r.hit) missed++;
    if (r.hard > hard) hard = r.hard;
    if (r.blocked) blocked++;
    if (r.punched && punchedAt < 0) punchedAt = t;
    if (punchedAt >= 0 && t > punchedAt + 0.5) break;
  }
  return { punchedAt, frames, missed, hard, blocked };
}

// Through the flat face (the thin way), a little off the middle, where the stone
// is still soft enough to cut at close to full speed. Aiming is in world units,
// and the mesh is `size` across a unit field.
const off = 0.42 * rockOpts.size;
const offMid = new THREE.Vector3(off, 0, 0);
offMid.owner = rock;
const thruFace = drillFor(offMid, new THREE.Vector3(off, 3, 0));
check(thruFace.punchedAt > 0.2, `drilling down through the flat face breaks out after ${thruFace.punchedAt.toFixed(2)}s`);
check(thruFace.missed === 0, `every frame of that drag found stone to bite (${thruFace.missed} misses)`);
check(thruFace.blocked === 0, `a plain bore is never refused a bite (${thruFace.blocked} blocked)`);

const holed = surface(rock);
check(holed.open === 0, `stone with a hole in it is still closed (${holed.open} unmatched edges)`);
check(holed.vol < fresh.vol * 0.95, `volume dropped ${(100 * (1 - holed.vol / fresh.vol)).toFixed(1)}% with the tunnel bored`);
check(rock.holeFrac > 0, `holeFrac now reads ${rock.holeFrac.toFixed(3)}`);
check(rock.heft < 1, `heft dropped to ${rock.heft.toFixed(3)}`);

// keep the drill on the open hole: it should ream wider, not stall
const volBefore = surface(rock).vol;
const ream = drillFor(offMid, new THREE.Vector3(off, 3, 0), 0.5);
const volAfter = surface(rock).vol;
check(volAfter < volBefore, `holding on an open hole reams it wider (${volBefore.toFixed(3)} -> ${volAfter.toFixed(3)})`);
check(ream.missed === 0, `reaming registers as a hit every frame (${ream.missed} misses)`);

// ---- the dense middle ----------------------------------------------------
// Nothing in there is off limits: the stone just packs tighter the further in
// you go, so a bore dead through the centre gets all the way through — it only
// takes a lot longer than one that skirts the middle.
const dense = new Rock(rockOpts);
const thick = rockOpts.thickness;
check(Math.abs(dense.density(0, 0, 0) - 1) < 1e-9, "density reads 1 at the dead centre");
check(dense.density(0, thick, 0) < 1e-9 && dense.density(1, 0, 0) < 1e-9, "...and 0 out at the skin, top and rim alike");
check(dense.density(0.4, 0, 0) > dense.density(0.8, 0, 0), "...and climbs the whole way in");
const middle = new THREE.Vector3(0, 0, 0);
middle.owner = dense;
const thruCore = drillFor(middle, new THREE.Vector3(0, 3, 0), 20);
check(thruCore.punchedAt > 0, `drilling dead centre does break through, after ${thruCore.punchedAt.toFixed(2)}s`);
check(thruCore.punchedAt > thruFace.punchedAt * 1.5, `...and the middle made it ${(thruCore.punchedAt / thruFace.punchedAt).toFixed(1)}x the grind of the bore that skirted it`);
check(thruCore.hard > 0.6, `the bit reported the stone fighting back (peak hard ${thruCore.hard.toFixed(2)})`);
check(surface(dense).open === 0, `a stone bored through its middle is still closed (${surface(dense).open} unmatched edges)`);

// ---- the bridge the drill won't cut --------------------------------------
// Cut the stone back to two halves joined by one small post — the shape a bore
// coming round on itself leaves — and then lean on the post. Every bite that
// would part the halves is refused, so the drill whittles the post down and
// then stops dead: you can grind a stone hollow, but you can never come away
// holding two of them.
function cutToTwoHalves(r) {
  const g = r.grid;
  for (let iy = 0; iy < g.ny; iy++) {
    const y = -g.hy + iy * g.dy;
    for (let iz = 0; iz < g.nz; iz++) {
      const z = -g.hx + iz * g.dz;
      for (let ix = 0; ix < g.nx; ix++) {
        const x = -g.hx + ix * g.dx;
        if (Math.abs(x) > 0.15) continue;                       // outside the gap
        if (Math.abs(y) < 0.12 && Math.abs(z) < 0.12) continue;  // the post itself
        r.field[ix + iz * g.nx + iy * g.nx * g.nz] = -0.2;
      }
    }
  }
  r.rebuild();
}
const bridge = new Rock(rockOpts);
cutToTwoHalves(bridge);
check(bridge._connected(), "the two halves start out joined by the post");
const post = new THREE.Vector3(0, 0, 0);
post.owner = bridge;
// the post sits at the dead centre, the densest stone there is, so whittling it
// down to the thread the drill won't cut takes a while
const onPost = drillFor(post, new THREE.Vector3(0, 3, 0), 8);
check(onPost.punchedAt < 0, "drilling the post never breaks anything off");
check(onPost.blocked > 0, `the bite that would have parted them was refused (${onPost.blocked} of ${onPost.frames} frames)`);
check(bridge._connected(), "...so the stone is still all one piece");
const held = surface(bridge);
check(held.open === 0, `...and still a closed shell (${held.open} unmatched edges)`);
const again = drillFor(post, new THREE.Vector3(0, 3, 0), 1);
check(again.blocked === again.frames, `leaning on it longer is refused every frame (${again.blocked} of ${again.frames})`);
check(Math.abs(surface(bridge).vol - held.vol) < 1e-9, "...and takes nothing more off the post");
// the drill isn't jammed, it just won't cut *there*
const half = new THREE.Vector3(0.62 * rockOpts.size, 0, 0);
half.owner = bridge;
const offBridge = drillFor(half, new THREE.Vector3(0.62 * rockOpts.size, 3, 0), 1);
check(offBridge.blocked === 0 && surface(bridge).vol < held.vol, "and the same drill still cuts one of the halves fine");

// A refused bite is never logged, so all those refusals are invisible on the
// wire: replaying the log (the way applySculptData does) rebuilds the same stone
// even though this one spent hundreds of frames being told no.
const peer = new Rock(rockOpts);
cutToTwoHalves(peer);
for (const p of bridge.dabs) peer._dab(p.x, p.y, p.z, p.r, p.a);
peer.rebuild();
const rebuilt = surface(peer), lived = surface(bridge);
check(rebuilt.tris === lived.tris, `a peer replaying those ${bridge.dabs.length} logged bites gets the same ${lived.tris} triangles (${rebuilt.tris})`);
// (bites land in one go on the peer instead of a frame at a time, so the two
// fields agree to float32 rounding rather than to the bit)
check(Math.abs(rebuilt.vol - lived.vol) < 1e-6, `...and the same stone (${rebuilt.vol.toFixed(9)} vs ${lived.vol.toFixed(9)})`);

// ---- the wire ------------------------------------------------------------
const payload = rock.sculptData();
const copy = new Rock(rockOpts);
copy.applySculptData(payload);
const orig = surface(rock), clone = surface(copy);
check(payload.length < 4000, `carve log is ${payload.length} base64 chars for ${rock.dabs.length} bites`);
check(clone.tris === orig.tris, `peer's copy has the same ${clone.tris} triangles`);
check(Math.abs(clone.vol - orig.vol) < 1e-4, `peer's copy has the same volume (${clone.vol.toFixed(5)} vs ${orig.vol.toFixed(5)})`);
check(Math.abs(copy.flat - rock.flat) < 1e-6 && Math.abs(copy.heft - rock.heft) < 1e-6, "peer's copy scores identically");

// ---- reset ---------------------------------------------------------------
rock.resetShape();
const reset = surface(rock);
check(Math.abs(reset.vol - fresh.vol) < 1e-6, `reset puts the stone back exactly (${reset.vol.toFixed(5)} vs ${fresh.vol.toFixed(5)})`);

// ---- a ray that misses entirely ------------------------------------------
const miss = rock.carve(new THREE.Ray(new THREE.Vector3(0, 3, 0), new THREE.Vector3(0, 1, 0)), CARVE_R, 0.01);
check(!miss.hit && surface(rock).vol === reset.vol, "a ray pointed away from the stone carves nothing");

// ---- how long a frame of carving costs -----------------------------------
const bench = new Rock(rockOpts);
const bray = new THREE.Ray(new THREE.Vector3(0, 3, 0), new THREE.Vector3(0, -1, 0));
for (let i = 0; i < 60; i++) bench.carve(bray, CARVE_R, dt * CARVE_RATE);
const t0 = process.hrtime.bigint();
for (let i = 0; i < 300; i++) bench.carve(bray, CARVE_R, dt * CARVE_RATE);
const t1 = process.hrtime.bigint();
console.log(`      carve + remesh + measure: ${(Number(t1 - t0) / 1e6 / 300).toFixed(3)} ms/frame`);
const t2 = process.hrtime.bigint();
for (let i = 0; i < 20; i++) new Rock({ ...rockOpts, seed: 100 + i });
const t3 = process.hrtime.bigint();
console.log(`      birthing a rock from scratch: ${(Number(t3 - t2) / 1e6 / 20).toFixed(3)} ms`);

process.exit(fails ? 1 : 0);

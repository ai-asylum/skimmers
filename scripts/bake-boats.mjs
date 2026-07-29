#!/usr/bin/env node
/**
 * BAKE THE BOAT MODELS — assets/models/{Wood_BoatV1,Wood_BoatV2,Fisher_Boat,KayakPaddle}.fbx
 * -> src/boatdata.js
 *
 *   node scripts/bake-boats.mjs
 *
 * Same deal as bake-fish.mjs: the game ships (next to) no runtime-fetched assets (see
 * scripts/build-playable-*.mjs), so these are turned into plain arrays that live in
 * the bundle and rebuild into a BufferGeometry instantly (src/boats.js).
 *
 * COLOUR. All four models are one mesh with one material pointing at a shared
 * atlas, PolyPackBoats.png, which did not come with the FBX files. It does not
 * need to: every triangle's three UVs are identical, so the atlas is a palette
 * and each triangle just picks one flat colour out of it. The bake reads each
 * triangle's UV, looks the swatch up in SWATCH below, and writes a per-triangle
 * palette index — one draw call, no texture, and the flat-shaded look the rest of
 * the game already has. SWATCH is our reading of that palette: hand-authored,
 * since the atlas itself is missing. Swatches shared between models (the two
 * wooden boats share a hull) therefore stay in step by construction.
 *
 * GEOMETRY. Per model:
 *  - rotates the authored axes (bow +z, up +y) into the game's boat convention:
 *    bow +x, up +y, beam +z — the frame src/boats.js does its collision maths in
 *  - centres on the bounding box in x and z and drops y so 0 is the model's
 *    lowest point, then normalises to unit length along x, so src/boats.js sizes
 *    a boat purely by scale and its deck table reads as fractions of length
 *  - drops the normals: everything here is flat-shaded, so they are derived
 *    per-face at render time anyway
 *
 * Positions are quantised to int16 in units of 1/POS_SCALE and base64'd.
 */
import * as THREE from "three";
import { FBXLoader } from "three/examples/jsm/loaders/FBXLoader.js";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const POS_SCALE = 16384; // int16 quantisation: ~6e-5 of a boat length

// game-facing name -> source file
const MODELS = {
  rowboat: "Wood_BoatV1",
  outboard: "Wood_BoatV2",
  trawler: "Fisher_Boat",
  paddle: "KayakPaddle",
};

/**
 * The PolyPackBoats palette as we read it, keyed by the atlas UV each triangle
 * samples. Comments name the part the swatch covers (measured off the models:
 * y runs from the keel up, x from stern to bow, both in boat lengths).
 */
const SWATCH = {
  // ---- wooden rowboat, shared by Wood_BoatV1 and Wood_BoatV2 ----
  "0.85156,0.03534": 0xa9682f, // hull planking, inside and out
  "0.72656,0.02662": 0x6f4520, // flat bottom, under the floorboards
  "0.77344,0.03437": 0xc08a4a, // rubbing strake along the gunwale
  "0.90625,0.03437": 0x8a5526, // thwarts

  // ---- Wood_BoatV2's outboard ----
  "0.41406,0.00532": 0x39424a, // motor cowling and leg
  "0.35156,0.00532": 0x2a3238, // tiller arm
  "0.44531,0.04308": 0xb44a3a, // tiller grip

  // ---- Fisher_Boat ----
  "0.09969,0.05715": 0xe8ecee, // topsides, above the boot stripe
  "0.31082,0.04332": 0x2c3f52, // boot stripe at the waterline
  "0.43582,0.00460": 0x9c3f30, // bottom paint
  "0.43582,0.00466": 0x9c3f30, // …and one stray triangle of it at the stern
  "0.54615,0.05715": 0xd3d8da, // bulwarks, seen from inboard
  "0.05301,0.00363": 0xb98a52, // foredeck planking
  "0.44955,0.02763": 0x7a5230, // fish-hold floor, aft
  "0.34128,0.00323": 0xa8adb0, // fish-hold sides
  "0.33426,0.00266": 0xf4efe2, // wheelhouse
  "0.95437,0.05450": 0x3c454a, // wheelhouse roof
  "0.78691,0.05683": 0x2b3a45, // wheelhouse glass
  "0.89676,0.05833": 0x2b3a45, // wheelhouse window frames
  "0.91500,0.05877": 0x2b3a45, // …front
  "0.78738,0.05784": 0x2b3a45, // …aft
  "0.42019,0.00653": 0x6b7378, // rudder, shaft and screw
  "0.79519,0.03364": 0x3c454a, // mast
  "0.88894,0.03558": 0x6b7378, // mast collar
  "0.02957,0.00314": 0x4a5259, // exhaust stack
  "0.27176,0.00605": 0x8a5526, // deck crate
  "0.28738,0.00266": 0x4a5259, // crate fittings
  "0.28738,0.00411": 0x9aa0a4, // hold bulkhead
  "0.29519,0.00581": 0x9aa0a4, // …forward of the wheelhouse
  "0.45145,0.00556": 0x2a3238, // deck cleats
  "0.41238,0.04913": 0x4a5259, // winch
  "0.34988,0.05833": 0x4a5259, // winch drum
  "0.93582,0.05784": 0x4a5259, // winch handle
  "0.42019,0.00508": 0x6b7378, // rail stanchion
  "0.43582,0.04889": 0x4a5259, // deck hatch

  // ---- kayak paddle (the rowboat's paddler swings one) ----
  "0.19132,0.57943": 0xdcb377, // blades and grip
  "0.62599,0.10105": 0x9c6a34, // shaft
};

const FALLBACK = 0x9aa0a4; // an unmapped swatch shows up as neutral grey, not a crash

// FBXLoader reaches for a couple of browser globals while parsing, and builds a
// texture for the atlas the material points at even though we never sample it
globalThis.self ??= globalThis;
globalThis.document ??= {
  createElementNS: () => ({ style: {}, addEventListener() {}, removeEventListener() {}, setAttribute() {} }),
};

const loader = new FBXLoader();

/** the single skinless mesh each of these files contains */
function meshOf(group) {
  let found = null;
  group.traverse((o) => {
    if (o.isMesh && !found) found = o;
  });
  if (!found) throw new Error("no mesh in FBX");
  return found;
}

const unmapped = new Set();

function bake(name, file) {
  const buf = fs.readFileSync(path.join(root, "assets/models", `${file}.fbx`));
  const group = loader.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), "");
  const mesh = meshOf(group);
  mesh.updateWorldMatrix(true, false);

  const geo = mesh.geometry.clone().applyMatrix4(mesh.matrixWorld);
  const src = geo.attributes.position;
  const uv = geo.attributes.uv;
  const triCount = src.count / 3;
  if (triCount % 1) throw new Error(`${file}: not triangulated`);
  if (geo.index) throw new Error(`${file}: expected a non-indexed mesh`);

  // authored axes -> game axes: bow (+z) becomes +x, beam (x) becomes -z. A
  // rotation about y, so winding order survives untouched.
  const pos = new Float32Array(src.count * 3);
  for (let i = 0; i < src.count; i++) {
    pos[i * 3] = src.getZ(i);
    pos[i * 3 + 1] = src.getY(i);
    pos[i * 3 + 2] = -src.getX(i);
  }

  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < pos.length; i++) {
    const k = i % 3;
    if (pos[i] < min[k]) min[k] = pos[i];
    if (pos[i] > max[k]) max[k] = pos[i];
  }
  const scale = 1 / (max[0] - min[0]); // unit stern-to-bow
  // centred on the beam and the length, keel at y = 0
  const origin = [(min[0] + max[0]) / 2, min[1], (min[2] + max[2]) / 2];

  const quant = new Int16Array(pos.length);
  for (let i = 0; i < pos.length; i++) {
    const v = (pos[i] - origin[i % 3]) * scale;
    quant[i] = Math.round(THREE.MathUtils.clamp(v, -2, 2) * POS_SCALE);
  }

  // one palette index per triangle, off the atlas swatch its UVs point at
  const palette = [];
  const tri = new Uint8Array(triCount);
  for (let t = 0; t < triCount; t++) {
    const key = `${uv.getX(t * 3).toFixed(5)},${uv.getY(t * 3).toFixed(5)}`;
    let hex = SWATCH[key];
    if (hex === undefined) {
      unmapped.add(`${file} ${key}`);
      hex = FALLBACK;
    }
    let idx = palette.indexOf(hex);
    if (idx < 0) idx = palette.push(hex) - 1;
    tri[t] = idx;
  }

  return {
    name,
    file,
    tris: triCount,
    palette: palette.map((h) => `0x${h.toString(16).padStart(6, "0")}`),
    size: [1, (max[1] - min[1]) * scale, (max[2] - min[2]) * scale],
    pos: Buffer.from(quant.buffer).toString("base64"),
    tri: Buffer.from(tri.buffer).toString("base64"),
  };
}

const baked = Object.entries(MODELS).map(([name, file]) => bake(name, file));

const body = baked
  .map(
    (b) => `  ${b.name}: {
    // ${b.file}.fbx — ${b.tris} triangles, ${b.size.map((v) => v.toFixed(3)).join(" x ")} (length x height x beam)
    palette: [${b.palette.join(", ")}],
    size: [${b.size.map((v) => +v.toFixed(4)).join(", ")}],
    pos: "${b.pos}",
    tri: "${b.tri}",
  },`
  )
  .join("\n");

const out = `/**
 * GENERATED by scripts/bake-boats.mjs from assets/models/*.fbx.
 * Do not edit by hand — re-run the script instead.
 *
 * Each entry is one flat-shaded boat (or oar), non-indexed and texture-free:
 * \`pos\` is a base64 int16 vertex stream in units of 1/POS_SCALE, normalised to
 * unit length with the bow at +x, the beam along z and the keel at y = 0, and
 * \`tri\` is one \`palette\` index per triangle. \`size\` is the model's bounding box
 * in those same units, so a boat's world footprint is size * its length.
 * src/boats.js expands all of it into a BufferGeometry with vertex colours.
 */
export const POS_SCALE = ${POS_SCALE};

export const BOAT_MODELS = {
${body}
};
`;

const dest = path.join(root, "src/boatdata.js");
fs.writeFileSync(dest, out);
const kb = (n) => `${(n / 1024).toFixed(1)} kB`;
console.log(`wrote src/boatdata.js (${kb(out.length)})`);
for (const b of baked) {
  console.log(
    `  ${b.name.padEnd(9)} ${String(b.tris).padStart(4)} tris  ${b.palette.length} colours  ` +
    `${b.size.map((v) => v.toFixed(3)).join(" x ")}`
  );
}
if (unmapped.size) {
  console.log(`\n${unmapped.size} unmapped swatch(es) fell back to grey — add them to SWATCH:`);
  for (const u of [...unmapped].sort()) console.log(`  ${u}`);
}

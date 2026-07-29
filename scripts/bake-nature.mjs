#!/usr/bin/env node
/**
 * BAKE THE NATURE PROPS — assets/models/nature/*.obj -> src/naturedata.js
 *
 *   node scripts/bake-nature.mjs
 *
 * Same deal as bake-fish.mjs: the game fetches (next to) nothing at runtime (see
 * the playable builds under scripts/build-playable-*.mjs), so the trees and undergrowth can't be loaded with
 * OBJLoader at boot. This offline step turns each model into plain arrays that
 * live in the bundle and rebuild into a BufferGeometry instantly (src/foliage.js).
 *
 * Source models are Quaternius' Ultimate Nature Pack (CC0, see the LICENSE file
 * next to them). They are flat-colour low-poly: every material is a bare Kd, no
 * textures, so a material becomes one palette entry and each vertex carries the
 * index of the palette entry it belongs to.
 *
 * What it does per model:
 *  - merges the OBJ's per-material draw groups into ONE geometry, welding
 *    vertices that share a position AND a material. The pack's meshes are hard-
 *    edged boxes and cones, so this roughly halves the vertex count; the game
 *    flat-shades everything from screen-space derivatives anyway, which is why
 *    authored normals are dropped rather than kept (they'd cost more than the
 *    positions do).
 *  - drops the model onto y = 0 and normalises it to unit height, so src/foliage.js
 *    plants a prop by writing the world height it wants straight into the scale
 *  - quantises positions to a 1/POS_SCALE grid, then stores both the positions
 *    and the triangle indices as zigzagged deltas before base64ing them. Both
 *    streams run in near-order, so the deltas are small numbers with a lot of
 *    repetition and gzip roughly halves what it manages on the raw values —
 *    worth the four lines it costs src/foliage.js to undo.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC = path.join(root, "assets/models/nature");
const POS_SCALE = 2048; // quantisation grid: half a millimetre on a metre-tall prop

// Every model we ship, in the order src/foliage.js expects to find them.
const MODELS = [
  "CommonTree_1", "CommonTree_4", "PineTree_3", "PineTree_5", "BirchTree_3", "Willow_3",
  "Bush_1", "Bush_2", "BushBerries_1", "Plant_3", "Plant_5", "Flowers",
  "Rock_Moss_1", "Rock_Moss_3", "TreeStump_Moss", "WoodLog_Moss",
];

/** material name -> sRGB hex, off the .mtl's Kd (which Blender wrote as linear) */
function parseMtl(file) {
  const out = new Map();
  let name = null;
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const p = line.trim().split(/\s+/);
    if (p[0] === "newmtl") name = p[1];
    else if (p[0] === "Kd" && name) out.set(name, [+p[1], +p[2], +p[3]].map(linearToSRGB));
  }
  return out;
}

function linearToSRGB(c) {
  return c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
}

const hex = (rgb) =>
  "0x" + rgb.map((c) => Math.round(Math.min(1, Math.max(0, c)) * 255).toString(16).padStart(2, "0")).join("");

/**
 * Minimal OBJ reader: positions, `usemtl` runs, and faces fanned into triangles.
 * These files carry nothing else we want — no UVs are used, and the normals are
 * thrown away — so this is cheaper and more predictable than pulling OBJLoader
 * in and unpicking its per-group geometry afterwards.
 */
function parseObj(file) {
  const verts = [];
  const faces = []; // [ [vertIndex, ...], materialName ]
  let mtl = null;
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const p = line.trim().split(/\s+/);
    if (p[0] === "v") verts.push([+p[1], +p[2], +p[3]]);
    else if (p[0] === "usemtl") mtl = p[1];
    else if (p[0] === "f") {
      // "f v/vt/vn ..." — 1-based, and negative indices count back from the end
      const ring = p.slice(1).map((tok) => {
        const i = parseInt(tok.split("/")[0], 10);
        return i > 0 ? i - 1 : verts.length + i;
      });
      for (let k = 2; k < ring.length; k++) faces.push([[ring[0], ring[k - 1], ring[k]], mtl]);
    }
  }
  return { verts, faces };
}

function bake(name) {
  const { verts, faces } = parseObj(path.join(SRC, `${name}.obj`));
  const colors = parseMtl(path.join(SRC, `${name}.mtl`));

  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const v of verts) {
    for (let k = 0; k < 3; k++) {
      if (v[k] < min[k]) min[k] = v[k];
      if (v[k] > max[k]) max[k] = v[k];
    }
  }
  const authoredH = max[1] - min[1];
  const scale = 1 / authoredH; // unit height; the base lands on y = 0
  const place = (v) => [v[0] * scale, (v[1] - min[1]) * scale, v[2] * scale];

  // Palette slots in first-seen order, so a model's slot 0 is its dominant
  // material and a stray accent never lands at the front of the list.
  const slots = [];
  const slotOf = (m) => {
    let i = slots.indexOf(m);
    if (i < 0) { i = slots.length; slots.push(m); }
    return i;
  };

  // Weld on position + palette slot: welding across a material boundary would
  // force one of the two colours onto the shared vertex and bleed it along the
  // seam (a trunk vertex going green where the canopy meets it).
  const lookup = new Map();
  const pos = [];
  const vmat = [];
  const idx = [];
  for (const [ring, mtl] of faces) {
    const slot = slotOf(mtl);
    for (const vi of ring) {
      const q = place(verts[vi]).map((v) => Math.round(v * POS_SCALE));
      const key = `${q[0]},${q[1]},${q[2]},${slot}`;
      let at = lookup.get(key);
      if (at === undefined) {
        at = pos.length / 3;
        lookup.set(key, at);
        pos.push(q[0], q[1], q[2]);
        vmat.push(slot);
      }
      idx.push(at);
    }
  }
  if (pos.length / 3 > 65536) throw new Error(`${name}: too many vertices for uint16 indices`);

  // Positions delta against the previous vertex component-wise, indices against
  // the previous index; zigzag so the negatives stay small unsigned numbers.
  const zigzag = (v) => {
    const z = (v << 1) ^ (v >> 31);
    if (z > 65535) throw new Error(`${name}: delta ${v} does not fit a uint16`);
    return z;
  };
  const dpos = pos.map((v, i) => zigzag(i < 3 ? v : v - pos[i - 3]));
  const didx = idx.map((v, i) => zigzag(i === 0 ? v : v - idx[i - 1]));

  const b64 = (Type, arr) => Buffer.from(new Type(arr).buffer).toString("base64");
  return {
    name,
    authoredH,
    size: [max[0] - min[0], 1, max[2] - min[2]].map((v, k) => (k === 1 ? 1 : v * scale)),
    tris: idx.length / 3,
    verts: pos.length / 3,
    palette: slots.map((m) => hex(colors.get(m) ?? [1, 0, 1])),
    pos: b64(Uint16Array, dpos),
    idx: b64(Uint16Array, didx),
    vmat: b64(Uint8Array, vmat),
  };
}

const baked = MODELS.map(bake);

const body = baked
  .map(
    (b) => `  ${b.name}: {
    // ${b.tris} triangles, ${b.verts} vertices, ${b.authoredH.toFixed(2)}u tall as authored
    palette: [${b.palette.join(", ")}],
    size: [${b.size.map((v) => v.toFixed(3)).join(", ")}],
    pos: "${b.pos}",
    idx: "${b.idx}",
    vmat: "${b.vmat}",
  },`
  )
  .join("\n");

const out = `/**
 * GENERATED by scripts/bake-nature.mjs from assets/models/nature/*.obj.
 * Do not edit by hand — re-run the script instead.
 *
 * Quaternius' Ultimate Nature Pack (CC0), baked flat and normalised to unit
 * height with the base on y = 0 and the trunk on the origin.
 *
 *   pos   base64 uint16, zigzagged deltas of the vertex positions (component-
 *         wise against the previous vertex) in units of 1/POS_SCALE
 *   idx   base64 uint16, zigzagged deltas of the triangle index stream
 *   vmat  base64 uint8, one \`palette\` slot per vertex
 *   size  bounding box at the normalised scale (width, 1, depth)
 *
 * src/foliage.js undoes the deltas and expands all of it into a vertex-coloured
 * BufferGeometry.
 */
export const POS_SCALE = ${POS_SCALE};

export const NATURE_MODELS = {
${body}
};
`;

const dest = path.join(root, "src/naturedata.js");
fs.writeFileSync(dest, out);
const kb = (n) => `${(n / 1024).toFixed(1)} kB`;
console.log(`wrote src/naturedata.js (${kb(out.length)})`);
for (const b of baked) {
  console.log(
    `  ${b.name.padEnd(16)} ${String(b.tris).padStart(5)} tris ${String(b.verts).padStart(5)} verts` +
      `  ${b.authoredH.toFixed(2)}u  palette ${b.palette.join(" ")}`
  );
}

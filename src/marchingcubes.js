/**
 * Marching cubes over a scalar field — positive is solid, negative is air, and
 * the mesh is the surface where the two meet.
 *
 * The 256-entry triangle table isn't typed in by hand; it's derived at load
 * time from the cube's six faces. Each face pairs up its own cut edges into
 * directed segments (plain marching squares), every cut edge is shared by
 * exactly two faces, so the segments always chain into closed loops around the
 * cube — fan those and you have the patch. The one ambiguous case (a face cut
 * on all four edges) is resolved geometrically, "keep the two solid corners
 * apart", which depends only on the four corner signs. The cube on the far side
 * of that face reads the same signs and makes the same call, so neighbouring
 * patches always meet edge to edge and the surface stays watertight.
 */

// Standard marching-cubes corner numbering: 0-3 walk the bottom face, 4-7 the
// top face directly above them.
const CORNER = [
  [0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1],
  [0, 1, 0], [1, 1, 0], [1, 1, 1], [0, 1, 1],
];

const EDGE_CORNERS = [
  [0, 1], [1, 2], [2, 3], [3, 0],
  [4, 5], [5, 6], [6, 7], [7, 4],
  [0, 4], [1, 5], [2, 6], [3, 7],
];

// The six faces, corners listed counter-clockwise as seen from OUTSIDE the
// cube. That shared orientation is what makes every edge run one way on one of
// its faces and the other way on the other, which is what lets the segments
// chain up into loops.
const FACES = [
  [0, 1, 2, 3], // -y
  [4, 7, 6, 5], // +y
  [4, 5, 1, 0], // -z
  [3, 2, 6, 7], // +z
  [0, 3, 7, 4], // -x
  [1, 5, 6, 2], // +x
];

const edgeOf = (a, b) =>
  EDGE_CORNERS.findIndex(([p, q]) => (p === a && q === b) || (p === b && q === a));

const TRI_TABLE = [];
const EDGE_MASK = new Uint16Array(256);

for (let cube = 0; cube < 256; cube++) {
  const solid = (c) => (cube >> c) & 1;
  // next[e] = where the surface segment starting on edge e ends up. Walking a
  // face the counter-clockwise way, the segment runs from the edge where the
  // corners enter the solid to the edge where they leave it; that direction is
  // what makes the finished triangles face out of the stone.
  const next = new Int8Array(12).fill(-1);

  for (const f of FACES) {
    const cuts = [];
    for (let i = 0; i < 4; i++) {
      const a = f[i], b = f[(i + 1) % 4];
      if (solid(a) !== solid(b)) cuts.push({ e: edgeOf(a, b), leaving: solid(a) === 1 });
    }
    if (cuts.length === 2) {
      const entering = cuts[0].leaving ? cuts[1] : cuts[0];
      const leaving = cuts[0].leaving ? cuts[0] : cuts[1];
      next[entering.e] = leaving.e;
    } else if (cuts.length === 4) {
      // all four edges cut means the two solid corners sit diagonally opposite;
      // fence each of them off on its own
      for (let i = 0; i < 4; i++) {
        if (!solid(f[i])) continue;
        next[edgeOf(f[(i + 3) % 4], f[i])] = edgeOf(f[i], f[(i + 1) % 4]);
      }
    }
  }

  const tris = [];
  const seen = new Uint8Array(12);
  for (let e = 0; e < 12; e++) {
    if (next[e] < 0 || seen[e]) continue;
    const loop = [];
    for (let c = e; c >= 0 && !seen[c]; c = next[c]) {
      seen[c] = 1;
      loop.push(c);
    }
    for (let i = 1; i + 1 < loop.length; i++) tris.push(loop[0], loop[i], loop[i + 1]);
  }

  TRI_TABLE[cube] = Int8Array.from(tris);
  let mask = 0;
  for (const e of tris) mask |= 1 << e;
  EDGE_MASK[cube] = mask;
}

// scratch, reused across calls so meshing allocates nothing
const CV = new Float32Array(8);
const EX = new Float32Array(12);
const EY = new Float32Array(12);
const EZ = new Float32Array(12);

/**
 * Mesh the zero-crossing of `field` (laid out x fastest, then z, then y).
 *
 * `out.positions` is a growable Float32Array of triangle vertices; it is
 * replaced with a bigger one when the surface outgrows it, so callers must
 * re-read it after every call. Returns the vertex count.
 */
export function marchCubes(field, nx, ny, nz, minX, minY, minZ, dx, dy, dz, iso, out) {
  const sx = 1, sz = nx, sy = nx * nz;
  const dcorner = new Int32Array(8);
  for (let c = 0; c < 8; c++) {
    dcorner[c] = CORNER[c][0] * sx + CORNER[c][1] * sy + CORNER[c][2] * sz;
  }
  let pos = out.positions;
  let n = 0; // vertices written

  for (let iy = 0; iy < ny - 1; iy++) {
    const y0 = minY + iy * dy, y1 = y0 + dy;
    for (let iz = 0; iz < nz - 1; iz++) {
      const z0 = minZ + iz * dz, z1 = z0 + dz;
      let base = iz * sz + iy * sy;
      for (let ix = 0; ix < nx - 1; ix++, base++) {
        CV[0] = field[base];
        CV[1] = field[base + dcorner[1]];
        CV[2] = field[base + dcorner[2]];
        CV[3] = field[base + dcorner[3]];
        CV[4] = field[base + dcorner[4]];
        CV[5] = field[base + dcorner[5]];
        CV[6] = field[base + dcorner[6]];
        CV[7] = field[base + dcorner[7]];

        let cube = 0;
        if (CV[0] > iso) cube |= 1;
        if (CV[1] > iso) cube |= 2;
        if (CV[2] > iso) cube |= 4;
        if (CV[3] > iso) cube |= 8;
        if (CV[4] > iso) cube |= 16;
        if (CV[5] > iso) cube |= 32;
        if (CV[6] > iso) cube |= 64;
        if (CV[7] > iso) cube |= 128;
        if (cube === 0 || cube === 255) continue;

        const mask = EDGE_MASK[cube];
        const x0 = minX + ix * dx, x1 = x0 + dx;
        for (let e = 0; e < 12; e++) {
          if (!(mask & (1 << e))) continue;
          const a = EDGE_CORNERS[e][0], b = EDGE_CORNERS[e][1];
          const va = CV[a], vb = CV[b];
          const t = Math.abs(vb - va) < 1e-9 ? 0.5 : (iso - va) / (vb - va);
          const ca = CORNER[a], cb = CORNER[b];
          const ax = ca[0] ? x1 : x0, ay = ca[1] ? y1 : y0, az = ca[2] ? z1 : z0;
          const bx = cb[0] ? x1 : x0, by = cb[1] ? y1 : y0, bz = cb[2] ? z1 : z0;
          EX[e] = ax + (bx - ax) * t;
          EY[e] = ay + (by - ay) * t;
          EZ[e] = az + (bz - az) * t;
        }

        const tris = TRI_TABLE[cube];
        if (n * 3 + tris.length * 3 > pos.length) {
          const bigger = new Float32Array(Math.max(pos.length * 2, (n + tris.length) * 3 + 4096));
          bigger.set(pos.subarray(0, n * 3));
          pos = bigger;
        }
        let w = n * 3;
        for (let i = 0; i < tris.length; i++) {
          const e = tris[i];
          pos[w++] = EX[e];
          pos[w++] = EY[e];
          pos[w++] = EZ[e];
        }
        n += tris.length;
      }
    }
  }

  out.positions = pos;
  return n;
}

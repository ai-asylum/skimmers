/**
 * Course geometry helpers shared by the game, the minimap and the level editor.
 *
 * Buoys are strung along the fairway centreline; spire rocks are arranged to
 * flank those buoys (alternating banks) so they read as slalom gates the player
 * threads while following the buoy line — and, crucially, they land in the
 * water channel rather than stranded on the grass banks.
 */

/** buoy positions every ~9u along the path, skipping any that fall on an island */
export function buoysAlong(path, islands = []) {
  const out = [];
  for (let seg = 0; seg < path.length - 1; seg++) {
    const a = path[seg], b = path[seg + 1];
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    const n = Math.max(1, Math.round(len / 9));
    for (let k = 1; k < n; k++) {
      const t = k / n;
      const x = a.x + (b.x - a.x) * t, z = a.z + (b.z - a.z) * t;
      if (islands.some((isl) => Math.hypot(x - isl.x, z - isl.z) < isl.r + 1.5)) continue;
      out.push({ x, z, seg });
    }
  }
  return out;
}

const round = (v) => Math.round(v * 10) / 10;

/**
 * Reposition `rocks` so they flank the buoys, alternating banks, sitting at the
 * edge of the water channel. Keeps each rock's size/height; only x/z move.
 */
export function arrangeRocksAroundBuoys(rocks, path, width, islands = []) {
  const buoys = buoysAlong(path, islands);
  if (!buoys.length || path.length < 2) return rocks.map((r) => ({ ...r }));
  const off = width * 0.72; // perpendicular offset — inside the waterline
  return rocks.map((rk, i) => {
    const bu = buoys[Math.floor((i * buoys.length) / rocks.length) % buoys.length];
    const a = path[bu.seg], b = path[bu.seg + 1];
    let dx = b.x - a.x, dz = b.z - a.z;
    const L = Math.hypot(dx, dz) || 1; dx /= L; dz /= L;
    const nx = -dz, nz = dx;           // perpendicular to the fairway
    const side = i % 2 === 0 ? 1 : -1; // alternate banks -> slalom gates
    return { ...rk, x: round(bu.x + nx * off * side), z: round(bu.z + nz * off * side) };
  });
}

/**
 * Hold every biome to the "always flashy" line (biomes.js).
 *
 * A hole that comes up muddy is a hole nobody can read, and the two that used
 * to — an overcast Highland and an inky Dusk — got re-graded rather than left
 * for someone to notice on a phone in daylight. This is what stops them, or a
 * new biome, drifting back:
 *
 *   • thin fog — haze is what flattens a scene, so it's capped hard
 *   • a key light that clearly beats the flat fill+ambient, because contrast is
 *     the gap between the lit side and the shadow side, not raw brightness
 *   • a saturated palette, measured across sky, land, water and grass
 *
 * Three tests and no more, because these are the three that actually told the
 * dull biomes apart from the bright ones. Absolute key intensity did not: the
 * old inky Dusk ran a 1.8 key, brighter than Pinewood's, and still looked like
 * mud, because it spent it all again on fill and ambient. Nor did the spread
 * between the darkest and lightest colour: the old grey Highland scored better
 * on that than Autumn does. Both would have been floors that fire on innocent
 * edits and stay silent on the actual regression.
 *
 * The numbers are floors, not targets, and they sit below the current set
 * rather than at it — nothing here asks a biome to look like any of the others.
 * Pinewood is deliberately the palest of the five and runs closest to the
 * saturation floor; that is the intended look, not slack to be taken up.
 *
 * Run with: node scripts/check-biomes.mjs
 */
import { BIOMES, BIOME_IDS, DEFAULT_BIOME } from "../src/biomes.js";

let fail = 0;
const expect = (cond, msg) => {
  console.log(`${cond ? "ok  " : "FAIL"}: ${msg}`);
  if (!cond) fail++;
};

// Floors, with the two cut biomes as the worked examples of failing each one:
// old Highland ran fog 0.0128 / ratio 1.23 / saturation 0.286, and old Dusk
// fog 0.0155 / ratio 1.44 / saturation 0.365.
const FOG_MAX = 0.011;     // FogExp2 density; above this the far bank goes to soup
const KEY_RATIO_MIN = 1.6; // key vs (fill + ambient): how deep the shadow side reads
const SAT_MIN = 0.4;       // mean HSL saturation over the signature palette

const hexToRgb = (hex) => {
  const n = parseInt(hex.replace("#", ""), 16);
  return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255];
};

/** HSL saturation — how far off grey a colour is, independent of how bright */
function saturation(hex) {
  const [r, g, b] = hexToRgb(hex);
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  if (max === min) return 0;
  const l = (max + min) / 2;
  return (max - min) / (l > 0.5 ? 2 - max - min : max + min);
}

/**
 * The colours a player actually looks at, in the proportions they see them.
 * Fog and cloud tint are left out: they are atmosphere over the top of this,
 * and a white cloud would flatter the saturation score without earning it.
 */
const palette = (b) => [
  ...b.sky.map((s) => s.hex),
  ...b.land.map((s) => s.hex),
  b.water.uDeep, b.water.uMid, b.water.uShallow, b.water.uShelf,
  b.grass.color, b.trees.leaf,
];

console.log("\n-- every biome is flashy --");
for (const id of BIOME_IDS) {
  // biomes merge over the default, which is how a partial one is legal
  const b = { ...BIOMES[DEFAULT_BIOME], ...BIOMES[id] };
  const cols = palette(b);
  const sat = cols.reduce((a, c) => a + saturation(c), 0) / cols.length;
  const ratio = b.light.key.i / (b.light.fill.i + b.light.ambient.i);

  const n = (v, d = 3) => v.toFixed(d);
  console.log(`\n  ${id} — ${b.name}`);
  expect(b.fog.density <= FOG_MAX, `${id}: fog stays thin (${n(b.fog.density, 4)} <= ${FOG_MAX})`);
  expect(ratio >= KEY_RATIO_MIN, `${id}: shadows read against the key (${n(ratio, 2)} >= ${KEY_RATIO_MIN})`);
  expect(sat >= SAT_MIN, `${id}: the palette is saturated (${n(sat)} >= ${SAT_MIN})`);
}

console.log(fail ? `\n${fail} FAILED` : "\nall good");
process.exit(fail ? 1 : 0);

#!/usr/bin/env node
/**
 * FIT A CSS FILTER CHAIN TO A TARGET COLOUR.
 *
 *   node scripts/cb-tint.mjs "#ffc837" "#4aa3ff" ...
 *
 * Most of the Casual Blue pack is drawn pure white so it can be coloured at
 * runtime, and the way to colour a white sprite in CSS is a filter chain —
 * darken it so it has somewhere to go, sepia to give it chroma, then push that
 * chroma to the hue you want. The kit ships a set of these; they are tuned for
 * its own shaded sprites and go neon on the flat frames we use, so this fits
 * fresh ones against a colour we actually name.
 *
 * The filter primitives are defined as fixed matrices in the Filter Effects
 * spec, so the result is computable rather than a thing to eyeball: apply the
 * chain to white, compare to the target, and search the three free parameters.
 * A coarse sweep followed by a local refine is plenty — the space is small and
 * smooth, and being a shade out does not matter.
 */

const clamp = (v) => Math.min(1, Math.max(0, v));
const mul = (m, c) => [
  m[0] * c[0] + m[1] * c[1] + m[2] * c[2],
  m[3] * c[0] + m[4] * c[1] + m[5] * c[2],
  m[6] * c[0] + m[7] * c[1] + m[8] * c[2],
];

const SEPIA = [0.393, 0.769, 0.189, 0.349, 0.686, 0.168, 0.272, 0.534, 0.131];

const saturate = (s) => [
  0.213 + 0.787 * s, 0.715 - 0.715 * s, 0.072 - 0.072 * s,
  0.213 - 0.213 * s, 0.715 + 0.285 * s, 0.072 - 0.072 * s,
  0.213 - 0.213 * s, 0.715 - 0.715 * s, 0.072 + 0.928 * s,
];

const hueRotate = (deg) => {
  const a = (deg * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
  return [
    0.213 + c * 0.787 - s * 0.213, 0.715 - c * 0.715 - s * 0.715, 0.072 - c * 0.072 + s * 0.928,
    0.213 - c * 0.213 + s * 0.143, 0.715 + c * 0.285 + s * 0.140, 0.072 - c * 0.072 - s * 0.283,
    0.213 - c * 0.213 - s * 0.787, 0.715 - c * 0.715 + s * 0.715, 0.072 + c * 0.928 + s * 0.072,
  ];
};

/** the chain the kit uses, applied to white */
function chain(hue, light, sat, dark = 0.72) {
  let c = [dark, dark, dark];
  c = mul(SEPIA, c);
  c = mul(saturate(sat), c);
  c = mul(hueRotate(hue), c);
  return c.map((v) => clamp(v * light));
}

const hex = (c) => "#" + c.map((v) => Math.round(v * 255).toString(16).padStart(2, "0")).join("");
const parse = (h) => {
  const n = parseInt(h.replace("#", ""), 16);
  return [(n >> 16) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
};

/** perceptual-ish distance; plain rgb over-weights green but is close enough here */
const dist = (a, b) => Math.hypot(
  (a[0] - b[0]) * 1.0, (a[1] - b[1]) * 1.2, (a[2] - b[2]) * 0.9,
);

function fit(target) {
  let best = null;
  const consider = (hue, light, sat, dark) => {
    const d = dist(chain(hue, light, sat, dark), target);
    if (!best || d < best.d) best = { d, hue, light, sat, dark };
  };
  for (let hue = -60; hue <= 300; hue += 5)
    for (let light = 0.3; light <= 2.0; light += 0.05)
      for (let sat = 0; sat <= 9; sat += 0.5)
        for (let dark = 0.3; dark <= 1.0; dark += 0.1) consider(hue, light, sat, dark);
  for (let i = 0; i < 6; i++) {
    const { hue, light, sat, dark } = best, k = 0.5 ** i;
    for (let dh = -5 * k; dh <= 5 * k; dh += 1 * k)
      for (let dl = -0.05 * k; dl <= 0.05 * k; dl += 0.01 * k)
        for (let ds = -0.5 * k; ds <= 0.5 * k; ds += 0.1 * k)
          for (let dd = -0.1 * k; dd <= 0.1 * k; dd += 0.02 * k)
            consider(hue + dh, Math.max(0, light + dl), Math.max(0, sat + ds), Math.max(0.05, dark + dd));
  }
  return best;
}

for (const arg of process.argv.slice(2)) {
  const target = parse(arg);
  const b = fit(target);
  const got = chain(b.hue, b.light, b.sat, b.dark);
  console.log(
    `${arg} -> ${hex(got)}  (off by ${(b.d * 255).toFixed(1)}/255)\n` +
    `  brightness(${b.dark.toFixed(2)}) sepia(1) saturate(${b.sat.toFixed(2)}) ` +
    `hue-rotate(${b.hue.toFixed(0)}deg) brightness(${b.light.toFixed(2)})\n`
  );
}

#!/usr/bin/env node
/**
 * PULL THE CASUAL BLUE CHROME IN FROM THE KIT.
 *
 *   npm run cb:sync
 *
 * The UI is skinned with LayerLab's "GUI - Casual Blue" pack, which the team
 * owns through the private ai-asylum/casual-blue-ui repo. That pack's licence
 * lets us ship the art inside a product but not redistribute the raw files, and
 * its NOTICE is blunt about repositories: the art does not go in a public one.
 * This repo is public. So `public/cb/` is git-ignored and lives only on the
 * machine that builds the game — this script is how it gets there.
 *
 * What is committed is everything derived from the art but not the art itself:
 * the manifest (ids and pixel sizes) and the stylesheet (urls, slice numbers,
 * border widths). Those are numbers we wrote, not pixels LayerLab drew, and
 * keeping them in git means a clone type-checks, lints and diffs normally — it
 * just renders untextured chrome until someone with kit access runs the sync.
 *
 * Only the sprites listed in SPRITES come across. That is not tidiness: the
 * playable ads inline every asset into one file under a hard 5 MB cap, so the
 * chrome has to stay a curated set rather than the pack's full 964 files.
 *
 * The kit is found at ../casual-blue-ui, or wherever $CB_KIT points.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const KIT = process.env.CB_KIT || path.resolve(ROOT, "..", "casual-blue-ui");
const SRC = path.join(KIT, "public", "cb");
const OUT = path.join(ROOT, "public", "cb");

/** Source px → logical px. The pack is drawn for a 720-wide canvas and we
 *  render it at half that, which lands each sprite on whole device pixels on a
 *  2× screen. Going above 0.5 is what makes this art look soft. */
const S = 0.5;

/**
 * The chrome we actually use, by role. Nine-sliced sprites carry their insets
 * in SOURCE px (from the kit's src/assets/slices.ts — longest-prefix families
 * there, spelled out per sprite here so this file is readable on its own).
 * Anything without `slice` is a fixed-size sprite and comes out as an icon
 * class at half size.
 *
 * `as` is a short class alias for the sprites the markup names constantly —
 * `cb-btn85-blue` reads better in a class list than the full path does. Without
 * one, a sprite's class is its id with the separators swapped for dashes.
 */
const BTN_85 = [16, 18, 20, 18];
const BTN_109 = [18, 20, 22, 20];
const POPUP = [20, 20, 24, 20];
const sq = (n) => [n, n, n, n];

const SPRITES = [
  // ---------------------------------------------------------------- panels
  { id: "popup/popup01-03_bg", slice: POPUP, as: "popup" },
  { id: "popup/popup01-03_bg_top", slice: POPUP, as: "popup-top" },
  { id: "popup/popup01-03_border", slice: POPUP, as: "popup-border", ring: true },

  // ---------------------------------------------------------------- buttons
  ...["blue", "yellow", "green", "red", "gray", "white_bg", "offwhite"].map((c) => ({
    id: `button/button01_85_${c}`, slice: BTN_85, as: `btn85-${c.replace("_bg", "")}`,
  })),
  ...["blue", "yellow", "green", "red", "gray", "white_bg"].map((c) => ({
    id: `button/button01_109_${c}`, slice: BTN_109, as: `btn-${c.replace("_bg", "")}`,
  })),
  { id: "button/button_round01_blue", slice: BTN_109 },
  { id: "button/button_round01_white", slice: BTN_109 },
  { id: "button/button_square01" },
  { id: "button/button_circle_53" },
  { id: "button/button_circle_60" },

  // ------------------------------------------------------------ cards/frames
  { id: "frame/itemframe03_round_10_bg", slice: sq(12), as: "card" },
  { id: "frame/itemframe03_round_10_border", slice: sq(12), as: "card-border", ring: true },
  { id: "frame/itemframe03_round_10_focus", slice: sq(12), as: "card-focus", ring: true },
  { id: "frame/itemframe04_round_12_bg", slice: sq(12), as: "slot" },
  { id: "frame/itemframe04_round_12_focusglow", slice: sq(12), as: "slot-glow", ring: true },
  { id: "frame/basicframe_round_12", slice: sq(13) },
  { id: "frame/borderframe_round_12_white_bg", slice: sq(13) },
  { id: "frame/borderframe_round_12_white_border", slice: sq(13), ring: true },
  { id: "frame/listframe01_round_12_bg", slice: sq(12) },
  { id: "frame/listframe01_round_12_focus", slice: sq(12), ring: true },

  // ------------------------------------------------------------ labels/titles
  ...["blue", "yellow", "green", "red", "white_bg", "gray"].map((c) => ({
    id: `label/label_rectangle_${c}`, slice: sq(6),
  })),
  { id: "label/title_ribbon01_bg_blue", slice: [26, 40, 30, 40] },
  { id: "label/title_ribbon01_bg_yellow", slice: [26, 40, 30, 40] },
  { id: "label/title_oval_48_bg", slice: sq(23) },
  { id: "label/title_oval_48_border", slice: sq(23), ring: true },
  { id: "label/title_line_divider01_left" },
  { id: "label/title_line_divider01_right" },

  // ---------------------------------------------------------------- bars
  { id: "slider/slider_parallelogram_21_bg", slice: sq(9) },
  { id: "slider/slider_parallelogram_21_fill_yellow", slice: sq(9) },
  { id: "slider/slider_parallelogram_21_fill_sky", slice: sq(9) },
  { id: "slider/slider_parallelogram_21_fill_red", slice: sq(9) },

  // ------------------------------------------------------------ resource bar
  { id: "ui_etc/resourcebar_bg_white_bg", slice: [18, 7, 18, 7], as: "pill" },
  { id: "ui_etc/resourcebar_bg_white_border", slice: [18, 7, 18, 7], as: "pill-border", ring: true },

  // ---------------------------------------------------------------- icons
  ...[
    "icon_close01", "icon_close02_s", "icon_add", "icon_check01",
    "icon_lock01_s", "icon_lock01_l",
    "icon_arrow01_back", "icon_arrow01_next", "icon_arrow_play",
    "icon_sound_btn", "icon_music", "icon_pause", "icon_home",
    "icon_info_s", "icon_trophy", "icon_gem01", "icon_coin01_s",
  ].map((n) => ({ id: `iconmisc/${n}` })),
  ...["itemicon_medal_gold", "itemicon_medal_silver", "itemicon_medal_bronze", "itemicon_setting"]
    .map((n) => ({ id: `item/${n}` })),
];

// ---------------------------------------------------------------------------

/** width/height straight out of the PNG's IHDR, which is always the first chunk */
function pngSize(file) {
  const b = readFileSync(file);
  if (b.readUInt32BE(0) !== 0x89504e47) throw new Error(`not a png: ${file}`);
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
}

/**
 * Shrink insets that don't fit their own sprite (the kit's sliceFor does the
 * same). These sprites are tiny — itemframe03's background is 24px square — so
 * a nominal 12px inset on each side eats the entire image and leaves a
 * zero-width middle. border-image then has nothing to stretch and nothing to
 * fill with, and the frame renders as an empty outline. Leave at least 2px of
 * middle in each axis and scale both sides to keep the corners square.
 */
function fit([top, right, bottom, left], w, h) {
  const kx = Math.min(1, (w - 2) / (left + right));
  const ky = Math.min(1, (h - 2) / (top + bottom));
  if (kx >= 1 && ky >= 1) return [top, right, bottom, left];
  return [
    Math.max(1, Math.floor(top * ky)), Math.max(1, Math.floor(right * kx)),
    Math.max(1, Math.floor(bottom * ky)), Math.max(1, Math.floor(left * kx)),
  ];
}

if (!existsSync(SRC)) {
  console.error(
    `no Casual Blue kit at ${SRC}\n\n` +
    `  git clone git@github.com:ai-asylum/casual-blue-ui.git ${path.resolve(ROOT, "..", "casual-blue-ui")}\n\n` +
    `or point CB_KIT at an existing clone. The art is licensed and deliberately\n` +
    `not in this repo — see NOTICE-casual-blue.md.`
  );
  process.exit(1);
}

// start clean so a sprite dropped from SPRITES actually leaves the tree
if (existsSync(OUT)) rmSync(OUT, { recursive: true });

const manifest = {};
const missing = [];
for (const { id, slice, as, ring } of SPRITES) {
  const from = path.join(SRC, `${id}.png`);
  if (!existsSync(from)) { missing.push(id); continue; }
  const to = path.join(OUT, `${id}.png`);
  mkdirSync(path.dirname(to), { recursive: true });
  copyFileSync(from, to);
  const { w, h } = pngSize(from);
  manifest[id] = {
    w, h,
    ...(slice ? { slice: fit(slice, w, h) } : {}),
    ...(as ? { as } : {}),
    ...(ring ? { ring: true } : {}),
  };
}

if (missing.length) {
  console.error(`not in the kit:\n  ${missing.join("\n  ")}`);
  process.exit(1);
}

const ids = Object.keys(manifest).sort();
const cls = (id) => `cb-${manifest[id].as ?? id.replace(/[/_]/g, "-")}`;

const dupes = ids.map(cls).filter((c, i, a) => a.indexOf(c) !== i);
if (dupes.length) {
  console.error(`two sprites want the same class: ${[...new Set(dupes)].join(", ")}`);
  process.exit(1);
}

// ---------------------------------------------------------------- manifest.js
writeFileSync(path.join(ROOT, "src", "cb", "manifest.js"),
  `// GENERATED by scripts/sync-cb.mjs — do not edit.\n` +
  `//\n` +
  `// Sizes and nine-slice insets for the Casual Blue chrome, in SOURCE px. The\n` +
  `// art these describe is git-ignored (see NOTICE-casual-blue.md); this file is\n` +
  `// committed so the code around it stays readable and diffable without it.\n\n` +
  `/** source px → logical px; the pack is drawn at 2× the size we render it */\n` +
  `export const S = ${S};\n\n` +
  `export const CB = ${JSON.stringify(
    Object.fromEntries(ids.map((id) => [id, manifest[id]])), null, 2
  )};\n\n` +
  `/** the css class sync-cb.mjs emitted for a sprite id */\n` +
  `export const cbClass = (id) => \`cb-\${CB[id]?.as ?? id.replace(/[/_]/g, "-")}\`;\n`
);

// ---------------------------------------------------------------- cb.css
const nine = ids.filter((id) => manifest[id].slice);
const flat = ids.filter((id) => !manifest[id].slice);

const rules = [
  `/* GENERATED by scripts/sync-cb.mjs — do not edit.\n` +
  `   Casual Blue chrome. The png urls resolve to public/cb/, which is git-ignored\n` +
  `   and filled in by \`npm run cb:sync\` — see NOTICE-casual-blue.md. */`,
  ``,
  `/* Each nine-slice is published as three custom properties rather than as`,
  `   finished border rules, because where the sprite gets painted depends on the`,
  `   caller: .cb-face puts it on the element, .cb-plate puts it on a backdrop`,
  `   layer underneath. That second one exists so a sprite can be tinted — most of`,
  `   this pack is drawn white to be coloured at runtime, and a filter applies to`,
  `   an element's whole subtree, so tinting in place would drag the text with it.`,
  `   Both live in src/cb/theme.css.`,
  ``,
  `   Slices carry \`fill\` unless the sprite is a ring meant to layer over another.`,
  `   Border widths are whole pixels — fractional ones rasterise seam lines. */`,
  ``,
];

for (const id of nine) {
  const [t, r, b, l] = manifest[id].slice;
  const px = (n) => Math.max(1, Math.round(n * S));
  const slice = `${t} ${r} ${b} ${l}${manifest[id].ring ? "" : " fill"}`;
  const width = `${px(t)}px ${px(r)}px ${px(b)}px ${px(l)}px`;
  rules.push(
    `.${cls(id)} {`,
    `  --plate: url("/cb/${id}.png");`,
    `  --plate-slice: ${slice};`,
    `  --plate-w: ${width};`,
    `}`,
  );
  // A ring is drawn over a plate, so it needs its own set of properties to sit
  // in alongside one — hence the second class rather than a second --plate.
  if (manifest[id].ring) {
    rules.push(
      `.${cls(id).replace(/^cb-/, "cb-ring-")} {`,
      `  --ring: url("/cb/${id}.png");`,
      `  --ring-slice: ${slice};`,
      `  --ring-w: ${width};`,
      `}`,
    );
  }
}

rules.push(``, `/* fixed-size sprites, at the 0.5× the pack is drawn for */`);
for (const id of flat) {
  const { w, h } = manifest[id];
  rules.push(
    `.${cls(id)} {`,
    `  background: url("/cb/${id}.png") center/100% 100% no-repeat;`,
    `  width: ${Math.round(w * S)}px; height: ${Math.round(h * S)}px;`,
    `}`,
  );
}

writeFileSync(path.join(ROOT, "src", "cb", "cb.css"), `${rules.join("\n")}\n`);

const bytes = (d) => readdirSync(d, { withFileTypes: true }).reduce((a, e) => {
  const p = path.join(d, e.name);
  return a + (e.isDirectory() ? bytes(p) : readFileSync(p).length);
}, 0);

console.log(
  `${ids.length} sprites → public/cb/ (${(bytes(OUT) / 1024).toFixed(0)} KB)\n` +
  `  ${nine.length} nine-sliced, ${flat.length} fixed\n` +
  `wrote src/cb/manifest.js and src/cb/cb.css`
);

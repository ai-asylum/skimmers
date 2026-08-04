/**
 * Keep the UI emoji-free and its drawn glyphs wired up.
 *
 * Every pictograph in the game is now an inline SVG out of src/icons.js. Emoji
 * were never really assets: the shell, the top hat and the medals each came out
 * a different shape on every platform, none matched the game's own flat art,
 * and the ones with no glyph in the Android system font shipped as tofu. Text
 * that arrives from outside — a player's stone name — is not our problem and is
 * not checked; this is only about what the game itself draws.
 *
 * Typographic marks are deliberately left alone. The arrows on the phase
 * buttons, the ★ on a cup record, the ● in the admin brand and the ✓ on the
 * craft playable's last button are punctuation in the UI font, not pictures,
 * and they render identically everywhere.
 *
 * Three checks:
 *
 *   • no emoji in anything the game renders, the two ad shells included —
 *     they carry their own copy of the markup and drift apart easily
 *   • every `data-icon` in that markup names a real icon, because a typo there
 *     is not an error anywhere, just a glyph that quietly never appears
 *   • every icon is one self-contained `currentColor` SVG, so it takes the
 *     colour and size of whatever it is dropped into
 *
 * Run with: node scripts/check-icons.mjs
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { ICONS } from "../src/icons.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

let fail = 0;
const expect = (cond, msg) => {
  console.log(`${cond ? "ok  " : "FAIL"}: ${msg}`);
  if (!cond) fail++;
};

// what the player's browser actually renders, ad shells and all
const ROOTS = [
  "src", "index.html", "admin.html",
  "ads/playable-skip-src/index.html", "ads/playable-craft-src/index.html",
];

const files = [];
const walk = (p) => {
  const s = statSync(p);
  if (s.isDirectory()) {
    for (const f of readdirSync(p)) walk(path.join(p, f));
    return;
  }
  if (/\.(js|html|css)$/.test(p)) files.push(p);
};
for (const r of ROOTS) walk(path.join(ROOT, r));

const rel = (f) => path.relative(ROOT, f);

console.log("\n-- nothing the game draws is an emoji --");
const EMOJI = /\p{Extended_Pictographic}/u;
const strays = [];
for (const f of files) {
  readFileSync(f, "utf8").split("\n").forEach((line, i) => {
    const hit = line.match(EMOJI);
    if (hit) strays.push(`${rel(f)}:${i + 1} ${hit[0]}`);
  });
}
expect(strays.length === 0, `no emoji across ${files.length} files${strays.length ? `\n      ${strays.join("\n      ")}` : ""}`);

console.log("\n-- every glyph the markup asks for exists --");
const asked = new Map(); // name -> where it was asked for
for (const f of files.filter((f) => f.endsWith(".html"))) {
  for (const m of readFileSync(f, "utf8").matchAll(/data-icon="([^"]*)"/g)) {
    if (!asked.has(m[1])) asked.set(m[1], []);
    asked.get(m[1]).push(rel(f));
  }
}
const missing = [...asked].filter(([name]) => !ICONS[name]);
expect(asked.size > 0, `the markup asks for glyphs at all (${[...asked.keys()].join(", ") || "none"})`);
expect(missing.length === 0,
  `every one of them is drawn${missing.length ? ` (no such icon: ${missing.map(([n, w]) => `${n} in ${w}`).join("; ")})` : ""}`);

console.log("\n-- and each is a tintable, self-contained svg --");
for (const [name, markup] of Object.entries(ICONS)) {
  const ok = markup.startsWith("<svg") && markup.endsWith("</svg>")
    && markup.includes('viewBox="0 0 24 24"')
    && markup.includes("currentColor")
    && !/https?:|<image|url\(/.test(markup);
  expect(ok, `${name}: one 24×24 currentColor svg, no outside references`);
}

console.log(fail ? `\n${fail} FAILED` : "\nall good");
process.exit(fail ? 1 : 0);

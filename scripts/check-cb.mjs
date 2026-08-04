#!/usr/bin/env node
/**
 * GUARD THE CASUAL BLUE SKIN.
 *
 *   node scripts/check-cb.mjs
 *
 * The chrome fails quietly. Its art is git-ignored (NOTICE-casual-blue.md), the
 * sprite classes only set custom properties, and a class nobody generated just
 * resolves to nothing — so a missing sync or a typo'd class name costs you an
 * untextured panel and no error anywhere. This is the error.
 *
 * It checks four things:
 *   1. every sprite the manifest claims is actually on disk
 *   2. every cb-* class the UI names was actually generated
 *   3. the generated files match a fresh sync, so nobody hand-edited them
 *   4. nine-slice insets fit inside their own sprite, which is the failure that
 *      cost the most to find: a 24px sprite given 12px insets has no middle
 *      left to stretch or fill, and the frame renders as an empty outline
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const problems = [];

const { CB, cbClass } = await import(path.join(ROOT, "src", "cb", "manifest.js"));
const css = readFileSync(path.join(ROOT, "src", "cb", "cb.css"), "utf8");

// ---------------------------------------------------------------- 1. the art
const haveArt = existsSync(path.join(ROOT, "public", "cb"));
if (!haveArt) {
  console.log(
    "no Casual Blue art in public/cb/ — the UI will render untextured.\n" +
    "  npm run cb:sync   (needs a clone of the private kit; NOTICE-casual-blue.md)\n" +
    "skipping the art checks."
  );
} else {
  for (const id of Object.keys(CB)) {
    if (!existsSync(path.join(ROOT, "public", "cb", `${id}.png`))) problems.push(`missing sprite: ${id}.png`);
  }
}

// -------------------------------------------------------- 2. classes the UI names
const declared = new Set([...css.matchAll(/^\.(cb-[\w-]+)/gm)].map((m) => m[1]));
// hand-written helpers in theme.css, not sprites
for (const c of ["cb-face", "cb-plate", "cb-ringed", "cb-ico", "cb-title", "cb-press", "cb-btn", "cb-scrim"]) {
  declared.add(c);
}

const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
  const p = path.join(dir, e.name);
  if (e.isDirectory()) return e.name === "cb" && dir.endsWith("src") ? [] : walk(p);
  return /\.(js|html)$/.test(e.name) ? [p] : [];
});
const sources = [
  ...walk(path.join(ROOT, "src")),
  path.join(ROOT, "index.html"),
  path.join(ROOT, "ads", "playable-skip-src", "index.html"),
  path.join(ROOT, "ads", "playable-craft-src", "index.html"),
].filter((f) => existsSync(f) && statSync(f).isFile());

/* Only class lists, not free text — prose about `cb-btn85-*` is not a usage,
   and reading it as one made this check cry wolf about its own comments. */
const CLASS_SITES = [
  /\bclass="([^"]*)"/g,                  // html
  /\bclassName\s*=\s*[`"']([^`"']*)/g,   // el.className = "..."
  /\bclassList\.(?:add|toggle|remove)\(([^)]*)\)/g,
];
for (const file of sources) {
  const text = readFileSync(file, "utf8");
  for (const re of CLASS_SITES) {
    for (const m of text.matchAll(re)) {
      for (const c of m[1].match(/cb-[a-z0-9-]+/g) ?? []) {
        if (!declared.has(c)) problems.push(`${path.relative(ROOT, file)}: no such sprite class \`${c}\``);
      }
    }
  }
}

// -------------------------------------------------- 3. generated files are generated
if (haveArt) {
  const before = ["src/cb/manifest.js", "src/cb/cb.css"].map((f) => readFileSync(path.join(ROOT, f), "utf8"));
  execFileSync("node", [path.join(ROOT, "scripts", "sync-cb.mjs")], { cwd: ROOT, stdio: "ignore" });
  const after = ["src/cb/manifest.js", "src/cb/cb.css"].map((f) => readFileSync(path.join(ROOT, f), "utf8"));
  for (const [i, f] of ["src/cb/manifest.js", "src/cb/cb.css"].entries()) {
    if (before[i] !== after[i]) problems.push(`${f} is stale or hand-edited — run \`npm run cb:sync\` and commit`);
  }
}

// ------------------------------------------------------- 4. insets fit their sprite
for (const [id, a] of Object.entries(CB)) {
  if (!a.slice) continue;
  const [t, r, b, l] = a.slice;
  if (l + r > a.w - 2 || t + b > a.h - 2) {
    problems.push(`${id}: insets ${t} ${r} ${b} ${l} leave no middle in a ${a.w}x${a.h} sprite`);
  }
  if (cbClass(id).length < 4) problems.push(`${id}: empty class alias`);
}

if (problems.length) {
  console.error(`casual blue: ${problems.length} problem(s)\n  ${problems.join("\n  ")}`);
  process.exit(1);
}
console.log(`casual blue ok — ${Object.keys(CB).length} sprites${haveArt ? "" : " (art absent)"}`);

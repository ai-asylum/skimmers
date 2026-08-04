/**
 * Generate the class picker's four water portraits through the Scenario API.
 *
 * A class is a mood before it is a set of numbers — Calm is a millpond and
 * Maelstrom is a hole in the lake — and four cards reading "50cc / 100cc /
 * 150cc / 200cc" down a column told you none of that. Each class gets a thumb
 * of the water it actually puts you on, keyed by tier id so metaui.js can find
 * it the way cup cards find theirs.
 *
 * The style tail is the store screenshots (Desktop/skippidyskip-play): the
 * game's own cel-shaded low-poly lake, not the flat vector the upgrade icons
 * use — these sit beside the painted cup art, not beside the garage grid. Art
 * is a build input, not a build step: run by hand, and the files are committed.
 *
 *   node scripts/gen-class-art.mjs           # only what's missing
 *   node scripts/gen-class-art.mjs --force   # redraw everything
 *   node scripts/gen-class-art.mjs calm      # redraw one class
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { TIERS } from "../src/cups.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = path.join(ROOT, "public", "classes");
const GENERATOR = path.join(homedir(), ".claude", "skills", "scenario", "scripts", "generate.py");

// The look of the game itself, so a class thumb sits next to the cup art
// without either one looking borrowed. Viewed from above and filling the frame
// because these are read at 54px: at that size a horizon line is one grey pixel
// row and the water has to be the whole picture.
const STYLE =
  "Stylised low-poly cel-shaded 3D mobile game art, viewed looking down at the water from above. " +
  "Bold saturated colour, faceted geometric surfaces, crisp dark outlines, chunky simplified shapes, " +
  "bright cartoon lighting. Water fills the entire frame edge to edge. " +
  "No text, no lettering, no UI, no frame, no border, no horizon, no sky.";

/** what each class does to the lake, as one picture */
const SUBJECTS = {
  calm:
    "A glassy flat mint-green and turquoise lake on a still sunny day. Wide lazy concentric " +
    "ripple rings spreading gently outward, a few soft white foam dots, warm sunlight glinting " +
    "off a mirror-smooth surface. Peaceful, open, unhurried.",
  swell:
    "A bright cyan and blue lake rolling with a steady swell. Long smooth rounded wave crests " +
    "marching across the frame, white foam streaks along their tops, faceted low-poly water " +
    "planes catching the light. Moving water, but even and readable.",
  breaker:
    "Choppy dark blue water seen from directly overhead, breaking into whitecaps. Sharp angular " +
    "wave peaks tipped with thick white foam, spray flying off the crests, hot orange sunset " +
    "light flooding the whole picture, wave faces burning orange and amber, foam glowing hot " +
    "gold. Overall colour is orange, not blue. Rough, fast, aggressive. " +
    "Every part of the picture is water.",
  maelstrom:
    "A huge black and crimson whirlpool tearing a spiral hole in storm-dark water. Violent " +
    "curved rings of churning current spinning into a deep central vortex, white foam whipped " +
    "into the spiral arms, angry red storm light on the wave faces. Terrifying and enormous.",
};

/** run the scenario skill's generator for one class */
function generate(t) {
  const out = path.join(OUT_DIR, `${t.id}.jpg`);
  const args = [
    GENERATOR,
    "--name", `${t.cc} ${t.name}`,
    "--description", `${SUBJECTS[t.id]} ${STYLE}`,
    "--output", out,
    "--width", "512",
    "--height", "512",
  ];
  return new Promise((resolve) => {
    const child = spawn("python3", args, { cwd: ROOT, stdio: ["ignore", "ignore", "pipe"] });
    let err = "";
    child.stderr.on("data", (d) => { err += d; });
    child.on("close", (code) => {
      const ok = code === 0 && existsSync(out);
      console.log(`${ok ? "ok  " : "FAIL"} ${t.id}${ok ? "" : `\n${err.trim().split("\n").slice(-3).join("\n")}`}`);
      resolve(ok);
    });
  });
}

const argv = process.argv.slice(2);
const force = argv.includes("--force");
const only = new Set(argv.filter((a) => !a.startsWith("--")));

const missing = TIERS.filter((t) => !SUBJECTS[t.id]).map((t) => t.id);
if (missing.length) {
  console.error(`no subject written for: ${missing.join(", ")}`);
  process.exit(1);
}

mkdirSync(OUT_DIR, { recursive: true });
const todo = TIERS.filter((t) => {
  if (only.size) return only.has(t.id);
  return force || !existsSync(path.join(OUT_DIR, `${t.id}.jpg`));
});

if (!todo.length) {
  console.log("nothing to draw — every class already has art");
  process.exit(0);
}

console.log(`drawing ${todo.length} class thumbs`);
const results = await Promise.all(todo.map(generate));
const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} drawn into public/classes/`);
process.exit(failed ? 1 : 0);

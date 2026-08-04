/**
 * Generate the garage's upgrade illustrations through the Scenario API.
 *
 * The cards used to be one emoji each, which reads as a placeholder next to the
 * 3D cosmetic previews sitting beside them. Every upgrade gets a painted icon
 * instead, keyed by upgrade id so metaui.js can find it without a lookup table.
 *
 * SUBJECTS below is the only hand-written part: the shared prompt tail pins the
 * style so thirty separate generations still look like one set. Art is a build
 * input, not a build step — this is run by hand and the PNGs are committed.
 *
 *   node scripts/gen-upgrade-art.mjs              # only what's missing
 *   node scripts/gen-upgrade-art.mjs --force      # redraw everything
 *   node scripts/gen-upgrade-art.mjs hotarm gyro  # redraw named upgrades
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { UPGRADES } from "../src/upgrades.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = path.join(ROOT, "public", "upgrades");
const GENERATOR = path.join(homedir(), ".claude", "skills", "scenario", "scripts", "generate.py");

// how many generations to keep in flight; the queue is the slow part, not us
const CONCURRENCY = 6;

// Held in common by all thirty so the set hangs together on one screen. Flat
// colour blocks rather than rendered shading, because the cards sit next to the
// game's own cel-shaded 3D previews and a painted icon fights them. The lake
// background is what makes thirty unrelated objects read as one set, and the
// diagonal is what keeps a static object from looking like clip art.
const STYLE =
  "Flat vector illustration in bold flat colour blocks — no gradients, no soft shading, " +
  "no texture, no photorealism. Thick clean dark outlines, high-contrast saturated palette. " +
  "Dynamic action composition: strong diagonal, exaggerated motion, speed lines and flying " +
  "spray. Background is stylised flat blue lake water with simple white ripple and foam " +
  "shapes. Single subject filling the frame, no text, no lettering, no UI frame, no border.";

/** what to draw for each upgrade — its effect made into one readable object */
const SUBJECTS = {
  hotarm: "a single muscular forearm and clenched fist wreathed in bright orange flame, flinging a flat grey skipping stone",
  cannonball: "a black iron cannonball blasting out of a short brass cannon in a burst of yellow fire",
  heavyhand: "a giant armoured gauntlet fist slamming down into the lake, huge shockwave rings",
  gyro: "a grey skipping stone spinning fast inside a glowing cyan gyroscope ring, motion blur arcs",
  farsight: "a large stylised cartoon eye with a bright blue iris, watching a long dotted trajectory arc curve across the lake",
  quickdraw: "a grey skipping stone streaking sideways trailed by a bright yellow lightning bolt",

  longskip: "a flat grey stone skimming a long chain of low bounces across bright blue water, wide spray trail",
  polished: "a glossy polished flat grey stone with a brilliant white diamond sparkle on its surface",
  lowrider: "a flat grey stone skimming so low it cuts a groove in the water surface, green speed streaks",
  ricochet: "a grey stone rebounding steeply off the water in a sharp orange V-shaped bounce arc",
  chainreaction: "three glowing orange chain links exploding apart in a burst of sparks above blue water",
  everburn: "a grey skipping stone completely engulfed in roaring orange and yellow flame, ember trail",
  skimluck: "a green four-leaf clover with golden sparkles resting on a flat grey skipping stone",

  quicksink: "a heavy grey stone plunging straight down through deep blue water leaving a bubble column",
  corkstone: "a grey stone popping buoyantly up out of the water wearing a bright orange cork ring",
  deepglide: "a grey stone gliding forward underwater through teal depths, long streamlined wake trail",

  repellent: "a cartoon fish recoiling away from a glowing green repellent bubble shield, stink lines",
  greasedline: "a fishing hook plummeting fast down a taut line slick with glistening golden grease",
  widenet: "a wide open fishing net spread in a big arc scooping up a small grey stone",
  slipperyhook: "a shiny silver fishing hook with a fish sliding helplessly off it, blue slip streaks",
  tugboat: "a chunky red and white cartoon tugboat straining forward against a taut rope, water churn",

  bumperstone: "a grey stone ringed by a fat red rubber bumper ricocheting off a stone spire in a spark burst",
  rubberhull: "a grey stone bouncing hard off the green rubber hull of a rowing boat, springy impact lines",
  duckwhisper: "a startled yellow cartoon duck flapping in panic, launching a grey stone off in a burst of feathers",
  islandhop: "a small tropical island with one palm tree catching a grey stone in a puff of sand",

  bigsplash: "an enormous white and blue water splash crown erupting upward, wide radiating ripple rings",
  depthcharge: "a red barrel depth charge detonating underwater in a violent orange and white blast",
  bulwark: "a sturdy steel and gold shield deflecting an incoming wave of water, blue impact sparks",
  grudge: "two crossed cartoon swords over a grey skipping stone in bright daylight, angry red spark burst behind them",

  lodestone: "a red and grey horseshoe magnet dragging a grey stone into a swirling blue whirlpool",
};

/** run the scenario skill's generator for one upgrade */
function generate(u) {
  const out = path.join(OUT_DIR, `${u.id}.png`);
  const args = [
    GENERATOR,
    "--name", u.name,
    "--description", `${SUBJECTS[u.id]}. ${STYLE}`,
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
      console.log(`${ok ? "ok  " : "FAIL"} ${u.id}${ok ? "" : `\n${err.trim().split("\n").slice(-3).join("\n")}`}`);
      resolve(ok);
    });
  });
}

/** fixed-size worker pool: the API queue is the bottleneck, so keep it fed */
async function runPool(items, worker, width) {
  const queue = [...items];
  const results = [];
  await Promise.all(
    Array.from({ length: Math.min(width, queue.length) }, async () => {
      while (queue.length) results.push(await worker(queue.shift()));
    })
  );
  return results;
}

const argv = process.argv.slice(2);
const force = argv.includes("--force");
const only = new Set(argv.filter((a) => !a.startsWith("--")));

const missingSubject = UPGRADES.filter((u) => !SUBJECTS[u.id]).map((u) => u.id);
if (missingSubject.length) {
  console.error(`no subject written for: ${missingSubject.join(", ")}`);
  process.exit(1);
}

mkdirSync(OUT_DIR, { recursive: true });
const todo = UPGRADES.filter((u) => {
  if (only.size) return only.has(u.id);
  return force || !existsSync(path.join(OUT_DIR, `${u.id}.png`));
});

if (!todo.length) {
  console.log("nothing to draw — every upgrade already has art");
  process.exit(0);
}

console.log(`drawing ${todo.length} upgrade icons, ${CONCURRENCY} at a time`);
const results = await runPool(todo, generate, CONCURRENCY);
const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} drawn into public/upgrades/`);
process.exit(failed ? 1 : 0);

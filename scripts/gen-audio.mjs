/**
 * Generate the game's sound effects and music through the Scenario API.
 *
 * Audio used to be synthesised at runtime out of filtered noise and oscillator
 * envelopes (see src/audioproc.js, still the fallback). That reads as a
 * prototype next to painted upgrade art and cel-shaded 3D, so every cue is a
 * recorded sample now, keyed by the id src/audio.js looks up.
 *
 * What to generate lives in src/audiocues.json and the work happens in
 * scripts/audiolib.mjs; this file is only the terminal front end. The same
 * pipeline is driven interactively from the admin panel's Audio Lab, which is
 * the easier way to iterate on a single cue — this one is for bulk runs.
 *
 * Audio is a build input, not a build step: run by hand, mp3s committed.
 *
 *   node scripts/gen-audio.mjs                 # only what's missing
 *   node scripts/gen-audio.mjs --force         # regenerate everything
 *   node scripts/gen-audio.mjs skip sink       # regenerate named cues
 *   node scripts/gen-audio.mjs --only=music    # sfx | music
 *   node scripts/gen-audio.mjs --normalize     # re-level what's on disk, no API calls
 */
import { existsSync } from "node:fs";

import { DUD_MEAN, PEAK_TARGET, fileFor, generateCue, loadCues, normalize } from "./audiolib.mjs";

// how many generations to keep in flight; the queue is the slow part, not us.
// Music jobs are far heavier than effects, so they get a narrower pool.
const SFX_CONCURRENCY = 6;
const MUSIC_CONCURRENCY = 2;

const cues = loadCues();

/** fixed-size worker pool: keep the queue fed without hammering it */
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

const job = (kind) => async (id) => {
  try {
    const { dud, mean } = await generateCue(kind, id, cues[kind][id], cues.sfxStyle);
    console.log(`ok   ${id}`);
    if (dud) console.warn(`     ^ ${mean.toFixed(1)} dB mean after levelling — probably a dud, roll it again`);
    return true;
  } catch (e) {
    console.log(`FAIL ${id}: ${e.message}`);
    return false;
  }
};

// --- cli ---

const argv = process.argv.slice(2);
const force = argv.includes("--force");
const levelOnly = argv.includes("--normalize");
const onlyKind = argv.find((a) => a.startsWith("--only="))?.slice("--only=".length);
const named = new Set(argv.filter((a) => !a.startsWith("--")));

const unknown = [...named].filter((id) => !(id in cues.sfx) && !(id in cues.music));
if (unknown.length) {
  console.error(`unknown cue: ${unknown.join(", ")}`);
  process.exit(1);
}

const wanted = (kind) =>
  Object.keys(cues[kind]).filter((id) => {
    if (onlyKind && onlyKind !== kind) return false;
    if (named.size) return named.has(id);
    return force || !existsSync(fileFor(kind, id));
  });

// re-level what is already on disk, without spending a generation on it
if (levelOnly) {
  let n = 0;
  for (const kind of ["sfx", "music"]) {
    for (const id of Object.keys(cues[kind])) {
      const file = fileFor(kind, id);
      if (!existsSync(file)) continue;
      const { dud, mean } = normalize(file);
      if (dud) console.warn(`${id}: ${mean.toFixed(1)} dB mean — below ${DUD_MEAN}, probably a dud`);
      n++;
    }
  }
  console.log(`levelled ${n} files to ${PEAK_TARGET} dBFS peak`);
  process.exit(0);
}

const sfxTodo = wanted("sfx");
const musicTodo = wanted("music");

if (!sfxTodo.length && !musicTodo.length) {
  console.log("nothing to generate — every cue already has audio");
  process.exit(0);
}

const results = [];
if (sfxTodo.length) {
  console.log(`generating ${sfxTodo.length} sound effects, ${SFX_CONCURRENCY} at a time`);
  results.push(...(await runPool(sfxTodo, job("sfx"), SFX_CONCURRENCY)));
}
if (musicTodo.length) {
  console.log(`generating ${musicTodo.length} music tracks, ${MUSIC_CONCURRENCY} at a time`);
  results.push(...(await runPool(musicTodo, job("music"), MUSIC_CONCURRENCY)));
}

const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} written into public/audio/`);
process.exit(failed ? 1 : 0);

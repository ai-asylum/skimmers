/**
 * The audio pipeline, minus any opinion about who is driving it.
 *
 * Two things call in here: scripts/gen-audio.mjs from a terminal, and the
 * /api/audio routes the admin panel's Audio Lab talks to (vite.audio-lab.js).
 * Both need the same three abilities — read and write the cue table, run a
 * Scenario generation, and level the result — so none of it lives in the CLI.
 *
 * Every cue's prompt, duration, guidance and mix level is in src/audiocues.json,
 * which the game reads too. That file is the source of truth; regenerating a
 * cue never invents parameters of its own.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const CUES_PATH = path.join(ROOT, "src", "audiocues.json");
export const OUT_DIR = path.join(ROOT, "public", "audio");

const API = "https://api.cloud.scenario.com/v1";
const SFX_MODEL = "model_elevenlabs-sound-effects-v2";
const MUSIC_MODEL = "model_elevenlabs-music-v2";

// Short cues stacked at runtime; 96kbps keeps the folder small without anything
// audible on top of the game's own mix.
const BITRATE = "96k";

export const PEAK_TARGET = -1; // dBFS every file is levelled to
export const DUD_MEAN = -35;   // mean below which a levelled clip is near-empty

// --- cue table ---

export function loadCues() {
  return JSON.parse(readFileSync(CUES_PATH, "utf8"));
}

export function saveCues(cues) {
  writeFileSync(CUES_PATH, `${JSON.stringify(cues, null, 2)}\n`);
}

export const fileFor = (kind, id) => path.join(OUT_DIR, kind, `${id}.mp3`);

// --- scenario ---

/** ~/.claude/.env first, then .env files walking up from the repo. */
function loadEnv() {
  const candidates = [path.join(homedir(), ".claude", ".env")];
  let d = ROOT;
  for (let i = 0; i < 10; i++) {
    candidates.push(path.join(d, ".env"));
    const parent = path.dirname(d);
    if (parent === d) break;
    d = parent;
  }
  const env = {};
  for (const file of candidates) {
    if (!existsSync(file)) continue;
    for (const line of readFileSync(file, "utf8").split("\n")) {
      const s = line.trim();
      if (!s || s.startsWith("#") || !s.includes("=")) continue;
      const [k, ...rest] = s.split("=");
      if (!(k.trim() in env)) env[k.trim()] = rest.join("=").trim();
    }
  }
  return { ...env, ...process.env };
}

/** Basic auth header, or null when the machine has no Scenario credentials. */
export function auth() {
  const env = loadEnv();
  const key = env.SCENARIO_API_KEY || env.VITE_SCENARIO_API_KEY;
  const secret = env.SCENARIO_API_SECRET || env.VITE_SCENARIO_API_SECRET;
  if (!key || !secret) return null;
  return {
    Authorization: `Basic ${Buffer.from(`${key}:${secret}`).toString("base64")}`,
    "Content-Type": "application/json",
  };
}

async function api(headers, url, { body, method = "GET" } = {}) {
  const res = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined });
  if (!res.ok) throw new Error(`HTTP ${res.status} on ${method} ${url}: ${(await res.text()).slice(0, 400)}`);
  return res.json();
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** The request body a cue turns into, which is also what the lab previews. */
export function bodyFor(kind, cue) {
  return kind === "music"
    ? {
      prompt: cue.prompt,
      durationSeconds: cue.duration,
      forceInstrumental: true,
      outputFormat: `mp3_44100_${BITRATE.replace("k", "")}`,
    }
    : {
      text: cue.text,
      durationSeconds: cue.duration,
      promptInfluence: cue.influence,
      loop: !!cue.loop,
      outputFormat: `mp3_44100_${BITRATE.replace("k", "")}`,
    };
}

/**
 * Generate one cue and write it to public/audio/<kind>/<id>.mp3, levelled.
 * `style` is the shared prompt tail; music doesn't take one.
 */
export async function generateCue(kind, id, cue, style = "") {
  const headers = auth();
  if (!headers) throw new Error("SCENARIO_API_KEY / SCENARIO_API_SECRET not found in ~/.claude/.env or a project .env");

  const model = kind === "music" ? MUSIC_MODEL : SFX_MODEL;
  const body = bodyFor(kind, cue);
  if (kind === "sfx" && style) body.text = `${body.text}. ${style}`;

  const started = await api(headers, `${API}/generate/custom/${model}`, { body, method: "POST" });
  const jobId = (started.job || started).jobId || (started.job || started).id;
  if (!jobId) throw new Error(`no job id in response: ${JSON.stringify(started).slice(0, 300)}`);

  let assetIds = null;
  for (let attempt = 0; attempt < 150 && !assetIds; attempt++) {
    await sleep(4000);
    const job = (await api(headers, `${API}/jobs/${jobId}`)).job || {};
    if (["success", "succeeded"].includes(job.status)) {
      assetIds = job.metadata?.assetIds || job.assetIds || [];
    } else if (["failure", "failed", "cancelled", "canceled"].includes(job.status)) {
      throw new Error(`job ${job.status}: ${JSON.stringify(job.error || job).slice(0, 300)}`);
    }
  }
  if (!assetIds?.length) throw new Error("timed out or finished with no assets");

  const asset = (await api(headers, `${API}/assets/${assetIds[0]}`)).asset || {};
  const url = asset.url || asset.metadata?.url;
  if (!url) throw new Error(`no download url on asset ${assetIds[0]}`);

  const res = await fetch(url);
  if (!res.ok) throw new Error(`download HTTP ${res.status}`);

  const out = fileFor(kind, id);
  mkdirSync(path.dirname(out), { recursive: true });
  writeFileSync(out, Buffer.from(await res.arrayBuffer()));
  return normalize(out);
}

// --- levelling ---

let ffmpegMissing = false;

/** duration, peak and mean for one file; nulls when ffmpeg isn't installed */
export function levels(file) {
  const empty = { duration: null, peak: null, mean: null };
  if (ffmpegMissing || !existsSync(file)) return empty;
  try {
    const probe = execFileSync("sh", ["-c", `ffmpeg -i '${file}' -af volumedetect -f null - 2>&1`]).toString();
    return {
      duration: Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file]).toString().trim()),
      peak: parseFloat(probe.match(/max_volume:\s*(\S+)/)?.[1]),
      mean: parseFloat(probe.match(/mean_volume:\s*(\S+)/)?.[1]),
    };
  } catch {
    ffmpegMissing = true;
    return empty;
  }
}

/**
 * Bring one file up to a fixed peak, and say whether it looks like a dud.
 *
 * Generations come back anywhere between full scale and 30 dB down for no
 * reason the prompt can control, which makes the trims in audiocues.json
 * unpredictable — they can only balance the mix if what they multiply is
 * consistent. Peak rather than loudness normalisation, because these are mostly
 * one-shot transients and loudnorm would pump the quiet tail of a splash up to
 * meet the crack at the front of it.
 *
 * A clip still very quiet once its peak is at the top is mostly empty: the model
 * put a whisper into a padded clip. That's reported as `dud` so both the CLI and
 * the lab can say "roll again" rather than shipping silence.
 */
export function normalize(file) {
  let l = levels(file);
  if (!Number.isFinite(l.peak)) return { ...l, dud: false, levelled: false };

  const gain = PEAK_TARGET - l.peak;
  let levelled = false;
  if (Math.abs(gain) >= 0.5) {
    const tmp = `${file}.norm.mp3`;
    execFileSync("sh", [
      "-c",
      `ffmpeg -y -v error -i '${file}' -af 'volume=${gain.toFixed(1)}dB' -codec:a libmp3lame -b:a ${BITRATE} '${tmp}'`,
    ]);
    renameSync(tmp, file);
    l = levels(file);
    levelled = true;
  }
  return { ...l, levelled, dud: Number.isFinite(l.mean) && l.mean < DUD_MEAN };
}

// --- trimming ---

/** A couple of milliseconds of ramp, so a cut mid-waveform doesn't click. */
const FADE = 0.004;

/** Under this much from an edge, that edge isn't really being cut. */
const EDGE = 0.005;

/**
 * Cut a file down to [start, end] in place, permanently.
 *
 * The game applies an effect's clip at playback for free, so baking is not
 * required to hear a trim — it's how you stop shipping the part you cut. A
 * twenty-second ambience bed auditioned down to eight is twelve seconds of
 * silence in everyone's download, and for music, which streams rather than
 * being decoded into a buffer, cutting the file is the only way a trim reaches
 * the game at all.
 *
 * Re-encoding rather than stream-copying: an mp3 can only be cut on a frame
 * boundary, so a copy would land the edit up to 26ms from where the waveform
 * said it was, and there'd be nowhere to put the de-click fades.
 *
 * Those fades go only on edges actually being cut. A one-shot's whole character
 * is a transient in its first few milliseconds, and a fade-in laid over an
 * untouched head walks straight over it — it cost a skip 4 dB of attack before
 * this was conditional. `-ss` ahead of `-i` for the same reason it looks odd
 * to: seeking on the input restarts the clock at the cut, so the fade-out's
 * timestamp is relative to the piece being kept. As an output option the filter
 * would still be reading the original timeline and would fade out before the
 * segment even began.
 */
export function trimFile(file, start, end) {
  if (!existsSync(file)) throw new Error(`no file at ${file}`);
  const span = end - start;
  if (!(span > 0.05)) throw new Error(`refusing to bake a ${span.toFixed(3)}s clip`);

  const before = levels(file);
  if (!Number.isFinite(before.duration)) throw new Error("ffmpeg is not installed, so nothing can be baked");

  const fade = Math.min(FADE, span / 4);
  const fades = [];
  if (start > EDGE) fades.push(`afade=t=in:st=0:d=${fade.toFixed(4)}`);
  if (end < before.duration - EDGE) fades.push(`afade=t=out:st=${(span - fade).toFixed(4)}:d=${fade.toFixed(4)}`);

  const tmp = `${file}.trim.mp3`;
  execFileSync("sh", [
    "-c",
    `ffmpeg -y -v error -ss ${start.toFixed(3)} -t ${span.toFixed(3)} -i '${file}' ` +
    (fades.length ? `-af '${fades.join(",")}' ` : "") +
    `-codec:a libmp3lame -b:a ${BITRATE} '${tmp}'`,
  ]);
  renameSync(tmp, file);
  return { before, after: levels(file) };
}

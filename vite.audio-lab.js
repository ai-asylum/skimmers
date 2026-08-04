/**
 * Dev-server API behind the admin panel's Audio Lab.
 *
 * Regenerating a cue can't happen in the browser: the Scenario key lives in a
 * .env the page must never see, and the result has to land in public/audio/ as
 * a committed file rather than in a blob URL that dies with the tab. So the lab
 * is a thin client over these three routes, and all the actual work stays in
 * scripts/audiolib.mjs, shared with the gen-audio.mjs CLI.
 *
 *   GET  /api/audio/cues            the cue table plus each file's size and level
 *   POST /api/audio/cue             save edited prompt/duration/guidance/level/clip
 *   POST /api/audio/generate        regenerate one cue from the saved parameters
 *   POST /api/audio/bake            cut the saved clip into the mp3 for good
 *
 * `apply: "serve"` — this never exists in a build. The admin page degrades to
 * read-only when the routes aren't there, which is what happens on the deployed
 * copy at /admin.
 */
import { statSync } from "node:fs";

import { fileFor, generateCue, levels, loadCues, saveCues, trimFile } from "./scripts/audiolib.mjs";

const KINDS = ["sfx", "music"];

const json = (res, code, body) => {
  res.statusCode = code;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
};

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (c) => { raw += c; });
    req.on("end", () => {
      try { resolve(raw ? JSON.parse(raw) : {}); } catch (e) { reject(e); }
    });
    req.on("error", reject);
  });
}

/** what's actually on disk for a cue, so the lab can show duds and staleness */
function fileInfo(kind, id) {
  const file = fileFor(kind, id);
  try {
    const { size, mtimeMs } = statSync(file);
    return { exists: true, bytes: size, mtime: mtimeMs, ...levels(file) };
  } catch {
    return { exists: false };
  }
}

/** Only the fields the lab is allowed to write; `label` and `use` stay authored. */
const EDITABLE = ["text", "prompt", "duration", "influence", "loop", "level", "clip"];

/**
 * A clip is [start, end] in seconds, or null to play the file whole. Stored
 * rounded: the panel hands over whatever a pixel of waveform worked out to, and
 * sub-millisecond cut points are noise in a diff nobody can hear.
 */
function cleanClip(clip) {
  if (clip == null) return null;
  if (!Array.isArray(clip) || clip.length !== 2) throw new Error("clip must be [start, end]");
  const [a, b] = clip.map(Number);
  if (!Number.isFinite(a) || !Number.isFinite(b)) throw new Error("clip bounds must be numbers");
  if (a < 0 || b <= a) throw new Error(`clip [${a}, ${b}] is not a forward span`);
  return [+a.toFixed(3), +b.toFixed(3)];
}

export function audioLab() {
  return {
    name: "audio-lab-api",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use("/api/audio", async (req, res, next) => {
        const route = req.url.split("?")[0].replace(/\/$/, "");
        try {
          if (route === "/cues" && req.method === "GET") {
            const cues = loadCues();
            for (const kind of KINDS) {
              for (const [id, cue] of Object.entries(cues[kind])) cue.file = fileInfo(kind, id);
            }
            return json(res, 200, cues);
          }

          if (route === "/cue" && req.method === "POST") {
            const { kind, id, patch } = await readBody(req);
            if (!KINDS.includes(kind)) return json(res, 400, { error: `unknown kind ${kind}` });
            const cues = loadCues();
            if (!cues[kind][id]) return json(res, 404, { error: `unknown cue ${id}` });
            for (const k of EDITABLE) {
              if (!(k in (patch || {}))) continue;
              if (k === "clip") {
                const clip = cleanClip(patch.clip);
                if (clip) cues[kind][id].clip = clip;
                else delete cues[kind][id].clip; // untrimmed cues carry no key at all
              } else {
                cues[kind][id][k] = patch[k];
              }
            }
            saveCues(cues);
            return json(res, 200, { cue: cues[kind][id] });
          }

          if (route === "/generate" && req.method === "POST") {
            const { kind, id } = await readBody(req);
            if (!KINDS.includes(kind)) return json(res, 400, { error: `unknown kind ${kind}` });
            const cues = loadCues();
            const cue = cues[kind][id];
            if (!cue) return json(res, 404, { error: `unknown cue ${id}` });
            // cut points belong to the take that was cut, not to the cue
            delete cue.clip;
            saveCues(cues);
            const result = await generateCue(kind, id, cue, cues.sfxStyle);
            return json(res, 200, { file: { exists: true, ...fileInfo(kind, id) }, ...result });
          }

          if (route === "/bake" && req.method === "POST") {
            const { kind, id } = await readBody(req);
            if (!KINDS.includes(kind)) return json(res, 400, { error: `unknown kind ${kind}` });
            const cues = loadCues();
            const cue = cues[kind]?.[id];
            if (!cue) return json(res, 404, { error: `unknown cue ${id}` });
            const clip = cleanClip(cue.clip);
            if (!clip) return json(res, 400, { error: "save a trim before baking one" });

            const { before, after } = trimFile(fileFor(kind, id), clip[0], clip[1]);
            // the file is the trim now, so the cue goes back to playing all of it
            delete cue.clip;
            saveCues(cues);
            return json(res, 200, { file: fileInfo(kind, id), before, after });
          }
        } catch (e) {
          return json(res, 500, { error: String(e.message || e) });
        }
        return next();
      });
    },
  };
}

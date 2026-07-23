#!/usr/bin/env node
/**
 * BUILD THE PLAYABLE AD — one self-contained HTML <= 5 MB.
 *
 *   npm run build:playable   ->   ads/playable/index.html
 *
 * All shared mechanics (vite single-file build, base64 embedding, ?ad=1
 * forcing, budget enforcement) live in playable-kit. This file is only the
 * per-game ASSET MANIFEST.
 *
 * Skippidy Skip is fully procedural — geometry, textures, and audio are all
 * generated at runtime (three.js + canvas skins + Web Audio), so there are NO
 * runtime-fetched assets to embed. The only image in the trimmed slice is the
 * end-card logo, referenced by the entry html and inlined by vite/singlefile.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildPlayable } from "playable-kit/build";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

buildPlayable({
  root,
  config: "vite.playable.config.js",
  entry: "ads/playable-src/index.html",
  out: "ads/playable/index.html",
  assets: [], // procedural game: nothing fetched at runtime
  // Ad networks host the file at arbitrary paths; force the ad flag at boot in
  // case any future code path wants to detect it.
  forceQuery: { ad: "1" },
});

#!/usr/bin/env node
/**
 * BUILD THE SKIP-RACE PLAYABLE — one self-contained HTML <= 5 MB.
 *
 *   npm run build:playable:skip   ->   ads/playable-skip/index.html
 *
 * Skippidy Skip is almost entirely procedural — geometry, most textures and all
 * audio are generated at runtime. The one runtime-fetched asset that matters is
 * the eyes sheet (the rocks' faces); it's embedded here and resolved through
 * playable-kit's assetUrl() shim (see src/flateyes.js). The logo is inlined by
 * vite via the config's assetsInlineLimit.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildPlayable } from "playable-kit/build";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

buildPlayable({
  root,
  config: "vite.playable-skip.config.js",
  entry: "ads/playable-skip-src/index.html",
  out: "ads/playable-skip/index.html",
  outDir: "dist-playable-skip",
  assets: [
    // the rocks' faces — flateyes.js requests "rock-eyes-grid.png?v=2"
    { file: "public/rock-eyes-grid.png", key: "rock-eyes-grid.png?v=2" },
  ],
  forceQuery: { ad: "1" },
});

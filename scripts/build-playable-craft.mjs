#!/usr/bin/env node
/**
 * BUILD THE MAKE-A-ROCK PLAYABLE — one self-contained HTML <= 5 MB.
 *
 *   npm run build:playable:craft   ->   ads/playable-craft/index.html
 *
 * Skippidy Skip is almost entirely procedural — geometry, most textures and all
 * audio are generated at runtime. The one runtime-fetched asset that matters is
 * the eyes sheet (the rock's face — the whole point of this crafting demo); it's
 * embedded here and resolved through playable-kit's assetUrl() shim (see
 * src/flateyes.js). The logo is inlined by vite via assetsInlineLimit.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildPlayable } from "playable-kit/build";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

buildPlayable({
  root,
  config: "vite.playable-craft.config.js",
  entry: "ads/playable-craft-src/index.html",
  out: "ads/playable-craft/index.html",
  outDir: "dist-playable-craft",
  assets: [
    // the rock's face — flateyes.js requests "rock-eyes-grid.png?v=2"
    { file: "public/rock-eyes-grid.png", key: "rock-eyes-grid.png?v=2" },
  ],
  forceQuery: { ad: "1" },
});

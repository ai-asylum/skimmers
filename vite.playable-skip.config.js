import { playableConfig } from "playable-kit/vite";
import { devEntry } from "./vite.playable-entry.js";
import { inlineCasualBlue } from "./vite.cb-inline.js";

// PLAYABLE-AD build — the SKIP RACE slice. Trims main.js (via __PLAYABLE_SKIP__)
// to: no title/find/shape/paint, straight onto the five short teaching holes in
// src/playable-levels.js against a few nerfed rivals (bots.js AIM_NERF). The
// self-contained artifact is assembled by scripts/build-playable-skip.mjs.
const ENTRY = "ads/playable-skip-src/index.html";
const config = playableConfig({
  entry: ENTRY,
  define: { __PLAYABLE_SKIP__: "true" },
  outDir: "dist-playable-skip",
  plugins: [devEntry(ENTRY), inlineCasualBlue(import.meta.dirname)], // `vite dev` on / serves the ad shell, not the game's
});

// Inline every referenced image (the logo) into the single file so the ad makes
// no external requests beyond the allowed mraid.js + Google Fonts.
config.build.assetsInlineLimit = 100 * 1024 * 1024;

export default config;

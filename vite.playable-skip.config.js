import { playableConfig } from "playable-kit/vite";

// PLAYABLE-AD build — the SKIP RACE slice. Trims main.js (via __PLAYABLE_SKIP__)
// to: no title/find/shape/paint, straight onto one short hole against a few
// nerfed rivals (bots.js AIM_NERF). The self-contained artifact is assembled by
// scripts/build-playable-skip.mjs.
const config = playableConfig({
  entry: "ads/playable-skip-src/index.html",
  define: { __PLAYABLE_SKIP__: "true" },
  outDir: "dist-playable-skip",
});

// Inline every referenced image (the logo) into the single file so the ad makes
// no external requests beyond the allowed mraid.js + Google Fonts.
config.build.assetsInlineLimit = 100 * 1024 * 1024;

export default config;

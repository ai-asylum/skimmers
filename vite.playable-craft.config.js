import { playableConfig } from "playable-kit/vite";

// PLAYABLE-AD build — the MAKE-A-ROCK slice. Trims main.js (via __PLAYABLE_CRAFT__)
// to the crafting loop: find -> shape -> paint, then the ad end card. No racing.
// The self-contained artifact is assembled by scripts/build-playable-craft.mjs.
const config = playableConfig({
  entry: "ads/playable-craft-src/index.html",
  define: { __PLAYABLE_CRAFT__: "true" },
  outDir: "dist-playable-craft",
});

// Inline every referenced image (the logo) into the single file so the ad makes
// no external requests beyond the allowed mraid.js + Google Fonts.
config.build.assetsInlineLimit = 100 * 1024 * 1024;

export default config;

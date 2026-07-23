import { playableConfig } from "playable-kit/vite";

// PLAYABLE-AD build. All shared mechanics (single-file inlining, es2020 target,
// base, outDir) live in playable-kit; this file only declares the entry and the
// __PLAYABLE__ define that trims main.js to its skip-and-chain slice. The final
// self-contained artifact is assembled by scripts/build-playable.mjs.
export default playableConfig({
  entry: "ads/playable-src/index.html",
  define: { __PLAYABLE__: "true" },
});

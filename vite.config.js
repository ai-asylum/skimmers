import { defineConfig } from "vite";

// Skippidy Skip is a plain ES-module three.js game. Vite just bundles the
// bare imports (three, peerjs, posthog-js) that used to come from a CDN
// importmap, and emits a static dist/ that both Vercel and the Capacitor
// Android shell serve. base: "./" keeps asset URLs relative so they resolve
// under Capacitor's local WebView scheme as well as on the web.
export default defineConfig({
  base: "./",
  build: {
    target: "es2020",
    outDir: "dist",
    assetsInlineLimit: 0, // keep pngs as files (Capacitor + PWA icons)
  },
  server: { port: 8741 },
});

import { readFileSync } from "node:fs";
import path from "node:path";

const MIME = { ".png": "image/png", ".woff2": "font/woff2" };

/**
 * Bake the Casual Blue chrome into a playable ad's single file.
 *
 * The skin's sprites live in `public/cb/` and its display face in
 * `public/fonts/`, and the stylesheet points at both by url. That is right for
 * the game — the browser fetches them once and caches them — and wrong for an
 * ad, which has to be one self-contained html making no external requests
 * beyond mraid.js. Vite copies `public/` verbatim and never inlines any of it,
 * `assetsInlineLimit` included, because it deliberately doesn't process those
 * files at all.
 *
 * So rewrite the urls to data uris after the css is generated but before it is
 * written, and drop the copies vite made so the artifact doesn't carry them
 * twice. The curated sprite set plus one font weight is a rounding error
 * against the ad's 5 MB budget, even after base64 adds its third.
 *
 * Worth inlining the font rather than adding it to the Google Fonts link the
 * ads already use for Baloo 2: the display face carries every title and button
 * in the ad, and a network round trip before it arrives means the first thing a
 * player sees is the fallback.
 */
export function inlineCasualBlue(root) {
  return {
    name: "cb-inline",
    apply: "build",
    enforce: "post",
    generateBundle(_options, bundle) {
      let inlined = 0;
      let bytes = 0;
      for (const [name, chunk] of Object.entries(bundle)) {
        // the copies would otherwise ride along unreferenced
        if (chunk.type === "asset" && /^(cb\/.*\.png|fonts\/lilita[^/]*\.woff2)$/.test(name)) {
          delete bundle[name];
          continue;
        }
        if (chunk.type !== "asset" || !name.endsWith(".css")) continue;
        chunk.source = String(chunk.source).replace(
          /url\(\s*["']?\.?\/?((?:cb|fonts)\/[^"')]+\.(?:png|woff2))["']?\s*\)/g,
          (whole, rel) => {
            const file = path.join(root, "public", rel);
            let data;
            try {
              data = readFileSync(file);
            } catch {
              // Loud: an ad that silently ships without its chrome looks broken
              // to whoever reviews it and fine to whoever built it.
              this.error(
                `casual blue asset missing: ${rel}\n` +
                `run \`npm run cb:sync\` (see NOTICE-casual-blue.md)`
              );
              return whole;
            }
            inlined++;
            bytes += data.length;
            return `url(data:${MIME[path.extname(rel)]};base64,${data.toString("base64")})`;
          }
        );
      }
      if (inlined) {
        console.log(`  cb: inlined ${inlined} assets (${(bytes / 1024).toFixed(0)} KB raw)`);
      }
    },
  };
}

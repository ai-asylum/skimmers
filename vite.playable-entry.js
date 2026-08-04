/**
 * Serve a playable's own entry html at `/` during `vite dev`.
 *
 * `playableConfig({ entry })` only points the *build* at the ad shell — a dev
 * server still hands out the project root's index.html, which is the full game's
 * markup. The bundle is still the trimmed playable, so the ad appears to run
 * fine, right up until it reaches for a piece of chrome that only the ad shell
 * carries (the install end card) and silently finds nothing there. Rewriting the
 * root means the URL you'd naturally open is the one that's actually shipping.
 */
export function devEntry(entry) {
  return {
    name: "playable-dev-entry",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use((req, _res, next) => {
        const [path, query] = req.url.split("?");
        if (path === "/" || path === "/index.html") {
          req.url = `/${entry}${query ? `?${query}` : ""}`;
        }
        next();
      });
    },
  };
}

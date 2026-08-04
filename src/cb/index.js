/**
 * The Casual Blue skin, as one import.
 *
 * The chrome is almost entirely CSS: `cb.css` turns each sprite into a class,
 * `theme.css` carries the palette, tints and display face. So a screen skins
 * itself by naming classes in the markup it already builds — there is no
 * component layer to route the UI through, which matters here because the
 * game's UI is innerHTML strings and direct DOM, not a render tree.
 *
 * What lives here is the handful of things a class can't express: joining a
 * sprite id to its class name, and reporting whether the art is actually on
 * disk (it's git-ignored — see NOTICE-casual-blue.md).
 */
import "./theme.css";
import "./cb.css";

import { CB, S, cbClass } from "./manifest.js";

export { CB, S, cbClass };

/**
 * Is the art actually here? Nothing throws when it isn't — the sprite classes
 * still resolve, they just point at 404s, so the UI quietly renders as bare
 * boxes. Boot checks this and says so (main.js), because "the menus look wrong"
 * is a miserable way to discover you never ran `npm run cb:sync`.
 *
 * Loads one sprite rather than reading CSS: the classes only set custom
 * properties now, and those resolve whether or not the png behind them exists.
 */
export function chromeMissing() {
  return new Promise((resolve) => {
    const probe = new Image();
    probe.onload = () => resolve(false);
    probe.onerror = () => resolve(true);
    probe.src = CB["popup/popup01-03_bg"] ? "/cb/popup/popup01-03_bg.png" : "";
  });
}

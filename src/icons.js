/**
 * The UI's glyphs, as inline SVG.
 *
 * These used to be emoji, which is a font's opinion rather than an asset: the
 * shell, the top hat and the medals all came out a different shape on every
 * platform, none of them matched the game's own flat art, and a couple rendered
 * as tofu on the Android shell. Drawn here they are one shape everywhere.
 *
 * Everything is a single `viewBox="0 0 24 24"` path family in `currentColor`,
 * so an icon takes the colour and the size of whatever it sits in — the same
 * deal as the padlock the cup picker already used (metaui.js LOCK).
 *
 * Static markup asks for one with `data-icon="<name>"` and `paintIcons()` fills
 * it in; anything building HTML from a string can pull the markup straight out
 * of `ICONS`.
 */

const svg = (body, cls = "ico-svg") =>
  `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true">${body}</svg>`;

export const ICONS = {
  // The career currency: a scallop, hinge down, fanning up and out. The five
  // bumps along the top edge are the whole icon — a smooth fan with ribs
  // radiating from a point is a brilliant-cut diamond, which is what the first
  // two attempts at this looked like at counter size.
  shell: svg(
    '<path d="M12 21 1.4 12.8a5.4 5.4 0 0 1 6.8-5.4 4.4 4.4 0 0 1 7.6 0 ' +
    '5.4 5.4 0 0 1 6.8 5.4Z" fill="currentColor"/>' +
    '<rect x="9.9" y="19.8" width="4.2" height="2" rx="1" fill="currentColor"/>' +
    '<path d="M12 19.6V9M12 19.6 7.4 11.2M12 19.6l4.6-8.4" fill="none" ' +
    'stroke="#000" stroke-opacity="0.18" stroke-width="1.1" stroke-linecap="round"/>'
  ),
  // upgrades: a spanner, open jaw up the left, handle down the right
  wrench: svg(
    '<path d="M15.8 2.2a6.2 6.2 0 0 0-5.6 8.8l-7.4 7.4a2.3 2.3 0 0 0 3.2 3.2l7.4-7.4a6.2 6.2 0 0 0 7.8-8.1l-3.4 3.4-3-.8-.8-3 3.4-3.4a6.2 6.2 0 0 0-1.6-.1Z" fill="currentColor"/>'
  ),
  // Hats: a topper. The gap above the brim is the hatband, and it is doing real
  // work — without it the crown and brim fuse into a head and shoulders.
  hat: svg(
    '<rect x="7.1" y="2.9" width="9.8" height="7.3" rx="1.1" fill="currentColor"/>' +
    '<rect x="7.1" y="11.9" width="9.8" height="1.7" fill="currentColor"/>' +
    '<rect x="2.3" y="13.5" width="19.4" height="3.3" rx="1.6" fill="currentColor"/>'
  ),
  // floaters: a lifebuoy, holed so it cannot read as a coin
  ring: svg(
    '<path fill-rule="evenodd" clip-rule="evenodd" d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm0 6.2a3.8 3.8 0 1 1 0 7.6 3.8 3.8 0 0 1 0-7.6Z" fill="currentColor"/>'
  ),
  // trails: a four-point sparkle with the long axis vertical
  sparkle: svg(
    '<path d="M12 1.4 14.3 9.7 22.6 12 14.3 14.3 12 22.6 9.7 14.3 1.4 12 9.7 9.7Z" fill="currentColor"/>'
  ),
};

/**
 * Fill every `data-icon` holder under `root`. Called once for the static
 * chrome; anything rendered later builds its own markup from ICONS directly.
 */
export function paintIcons(root = document) {
  for (const el of root.querySelectorAll("[data-icon]")) {
    const markup = ICONS[el.dataset.icon];
    if (markup) el.innerHTML = markup;
  }
}

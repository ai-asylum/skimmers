/**
 * The coaching hand — a cursor sprite miming the gesture a phase wants, parked
 * on the thing it wants you to touch.
 *
 * This exists for the playable ads. An ad gets a couple of seconds to teach a
 * control scheme it never gets to explain in words, and a stone sitting still
 * on a lake looks like a screenshot rather than a game you can touch. So each
 * playable phase puts a hand on screen doing exactly what the player should be
 * doing, and takes it away the instant they start doing it themselves.
 *
 * The whole thing — layer, stylesheet, sprites — is built from here, because
 * the three entry HTMLs (the game's own index.html and the two ad shells) would
 * otherwise all need the same markup kept in sync by hand.
 */

import handPoint from "./assets/cursors/hand_point.svg?raw";
import handClosed from "./assets/cursors/hand_closed.svg?raw";
import toolPickaxe from "./assets/cursors/tool_pickaxe.svg?raw";
import drawingBrush from "./assets/cursors/drawing_brush.svg?raw";

// Kenney's cursor pack (CC0 — see assets/cursors/KENNEY-LICENSE.txt). Every
// sprite carries the hotspot it points with, as a fraction of its own 32×32 box,
// so a hint lands the brush's bristles on the stone rather than the middle of
// the picture of a brush.
const CURSORS = {
  point: { svg: handPoint, hot: [0.23, 0.11] },
  grab: { svg: handClosed, hot: [0.45, 0.36] },
  carve: { svg: toolPickaxe, hot: [0.11, 0.77] },
  brush: { svg: drawingBrush, hot: [0.14, 0.58] },
};

// The sprites come in as source text (?raw) and go out as data URIs. A playable
// is one self-contained HTML with no network of its own, and text folded into
// the bundle is inlined by every build without an entry in the asset manifest —
// which is exactly how the old tap-hand.png came to be a broken image in both ads.
const dataUri = (svg) => `data:image/svg+xml,${encodeURIComponent(svg)}`;

const CSS = `
#hint-layer { position: fixed; inset: 0; z-index: 33; pointer-events: none; overflow: hidden; }
#hint-layer.off { display: none; }
/* the anchor: everything inside is laid out from the point being pointed at */
#hint { position: absolute; left: 0; top: 0; --size: 74px; --dx: 0px; --dy: 0px; }

/* the road the gesture travels, drawn from the anchor along the vector. Pale
   glass with a dark keyline, since it has to read over both lake and sand, and
   thinned towards the ends so it reads as a swipe rather than as a pole. */
#hint-track {
  position: absolute; left: 0; top: 0; height: 9px; margin-top: -4.5px; border-radius: 5px;
  box-shadow: 0 0 0 1.5px rgba(10,26,40,0.32), 0 2px 8px rgba(0,0,0,0.3);
  transform-origin: 0 50%;
  opacity: 0;
}
#hint[data-gesture="drag"] #hint-track {
  opacity: 1;
  background: linear-gradient(to right, rgba(253,246,227,0.12), rgba(253,246,227,0.55));
}
#hint[data-gesture="rub"] #hint-track {
  opacity: 1;
  background: linear-gradient(to right,
    rgba(253,246,227,0.12), rgba(253,246,227,0.5), rgba(253,246,227,0.12));
}

/* the target ring for a tap, pulsing under the fingertip */
#hint-ring {
  position: absolute; left: 0; top: 0; width: 46px; height: 46px; border-radius: 50%;
  margin: -23px 0 0 -23px; border: 3px solid rgba(255,210,74,0.95);
  box-shadow: 0 0 0 1.5px rgba(10,26,40,0.45), inset 0 0 0 1.5px rgba(10,26,40,0.3);
  opacity: 0;
}
#hint[data-gesture="tap"] #hint-ring { opacity: 1; animation: hintRing 1.5s ease-out infinite; }

/* the sprite travels; the image inside it only ever mirrors */
#hint-cursor-wrap { position: absolute; left: 0; top: 0; width: 0; height: 0; }
#hint[data-gesture="tap"] #hint-cursor-wrap { animation: hintTap 1.5s ease-in-out infinite; }
#hint[data-gesture="drag"] #hint-cursor-wrap { animation: hintDrag 1.9s cubic-bezier(0.4,0,0.2,1) infinite; }
#hint[data-gesture="rub"] #hint-cursor-wrap { animation: hintRub 1.5s ease-in-out infinite; }
#hint-cursor {
  position: absolute; width: var(--size); height: auto;
  left: calc(var(--size) * -1 * var(--hx));
  top: calc(var(--size) * -1 * var(--hy));
  /* mirroring about the hotspot column keeps the fingertip on the target and
     folds the rest of the hand back onto the screen */
  transform-origin: calc(var(--size) * var(--hx)) 50%;
  transform: scaleX(var(--flip, 1));
  filter: drop-shadow(0 5px 7px rgba(0,0,0,0.5));
}

/* the caption clears the whole gesture rather than sitting on top of it */
#hint-label {
  position: absolute; left: 0; top: 0; white-space: nowrap;
  transform: translate(calc(-50% + var(--label-x, 0px)), var(--label-y));
  padding: 6px 16px 7px; border-radius: 999px;
  background: rgba(10,42,61,0.72); color: var(--paper, #fdf6e3);
  font-weight: 900; font-size: clamp(13px, 2.6vw, 17px); letter-spacing: 0.04em;
  text-shadow: 0 2px 4px rgba(0,0,0,0.6);
  box-shadow: 0 3px 0 rgba(6,20,34,0.45), 0 8px 16px rgba(0,0,0,0.35);
  animation: hintLabel 0.32s cubic-bezier(0.18,1.5,0.4,1) both;
}

@keyframes hintRing {
  0%   { transform: scale(0.55); opacity: 0.95; }
  70%  { transform: scale(1.25); opacity: 0; }
  100% { transform: scale(1.25); opacity: 0; }
}
@keyframes hintTap {
  0%, 62%, 100% { transform: translate(0, 0) scale(1); }
  76%           { transform: translate(calc(var(--size) * 0.09), calc(var(--size) * 0.11)) scale(0.9); }
}
@keyframes hintDrag {
  0%   { transform: translate(0, 0) scale(1.04); opacity: 0; }
  10%  { transform: translate(0, 0) scale(0.94); opacity: 1; }
  62%  { transform: translate(var(--dx), var(--dy)) scale(0.94); opacity: 1; }
  76%  { transform: translate(var(--dx), var(--dy)) scale(1.1); opacity: 1; }
  100% { transform: translate(var(--dx), var(--dy)) scale(1.1); opacity: 0; }
}
@keyframes hintRub {
  0%, 100% { transform: translate(calc(var(--dx) * -0.5), calc(var(--dy) * -0.5)) scale(1); }
  50%      { transform: translate(calc(var(--dx) *  0.5), calc(var(--dy) *  0.5)) scale(0.95); }
}
@keyframes hintLabel {
  from { transform: translate(calc(-50% + var(--label-x, 0px)), var(--label-y)) scale(0.6); opacity: 0; }
}
`;

let layer = null;
let box = null;
let cursorImg = null;
let trackEl = null;
let labelEl = null;
// what's on screen right now: the animation only restarts when one of these
// changes, so a hint that follows a moving stone doesn't stutter every frame
let cur = { id: null, gesture: null, cursor: null, label: null };
// measured once per caption rather than per frame — reading offsetWidth after
// every reposition would mean a layout pass on every frame the hand is up
let labelW = { w: 0, at: 0 };

function mount() {
  if (layer) return;
  const style = document.createElement("style");
  style.textContent = CSS;
  document.head.appendChild(style);

  layer = document.createElement("div");
  layer.id = "hint-layer";
  layer.className = "off";
  layer.innerHTML =
    `<div id="hint">` +
    `<div id="hint-track"></div>` +
    `<div id="hint-ring"></div>` +
    `<div id="hint-cursor-wrap"><img id="hint-cursor" alt="" draggable="false"></div>` +
    `<div id="hint-label"></div>` +
    `</div>`;
  document.body.appendChild(layer);
  box = layer.firstChild;
  trackEl = document.getElementById("hint-track");
  cursorImg = document.getElementById("hint-cursor");
  labelEl = document.getElementById("hint-label");
}

/**
 * Put the hand up.
 *
 * `id` names the hint so callers can shout the same one every frame without it
 * flickering, and so `hide(id)` only takes down the hint it meant to.
 * `gesture` is tap (poke in place), drag (travel once along dx/dy and let go)
 * or rub (scrub back and forth across dx/dy). dx/dy are in pixels.
 */
export function show({
  id, gesture = "tap", cursor = "point", label = "",
  x, y, dx = 0, dy = 0, size = null, track = true,
}) {
  mount();
  layer.classList.remove("off");

  const c = CURSORS[cursor] ?? CURSORS.point;
  if (cur.cursor !== cursor) {
    cursorImg.src = dataUri(c.svg);
    box.style.setProperty("--hx", String(c.hot[0]));
    box.style.setProperty("--hy", String(c.hot[1]));
  }
  // the gesture attribute picks the keyframes, so writing it restarts them —
  // only touch it when the gesture really changed, or a hint tracking a moving
  // stone would twitch back to the start of its loop every frame
  if (cur.gesture !== gesture) box.dataset.gesture = gesture;
  if (cur.label !== label || labelW.at !== window.innerWidth) {
    labelEl.textContent = label;
    labelEl.style.display = label ? "" : "none";
    // replay the pop-in, which otherwise only ever runs once per page load
    labelEl.style.animation = "none";
    labelW = { w: labelEl.offsetWidth, at: window.innerWidth }; // also forces the reflow
    labelEl.style.animation = "";
  }
  cur = { id, gesture, cursor, label };

  const short = Math.min(window.innerWidth, window.innerHeight);
  const px = size ?? Math.round(Math.min(88, Math.max(52, short * 0.13)));
  box.style.setProperty("--size", `${px}px`);
  box.style.setProperty("--dx", `${Math.round(dx)}px`);
  box.style.setProperty("--dy", `${Math.round(dy)}px`);
  box.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;

  // A sprite points down and to its right, so one aimed at anything hugging the
  // right-hand edge — the hue strip, say — hangs its whole body off the screen.
  // Mirror it there and the same fingertip points back inboard.
  box.style.setProperty("--flip", x > window.innerWidth - px * (1 - c.hot[0]) - 8 ? "-1" : "1");

  // the caption clears whichever way the gesture travels, and never rides up
  // off the top of a rub centred on something near the ceiling
  const reach = gesture === "rub" ? Math.abs(dy) * 0.5 : Math.max(0, dy);
  box.style.setProperty("--label-y", `${Math.round(reach + px * 0.72 + 16)}px`);
  // it's centred on the anchor until that would walk it off an edge
  const half = labelW.w / 2;
  const nudge = Math.min(0, window.innerWidth - 10 - (x + half)) + Math.max(0, 10 - (x - half));
  box.style.setProperty("--label-x", `${Math.round(nudge)}px`);

  const len = track ? Math.hypot(dx, dy) : 0;
  if (len > 1) {
    const ang = (Math.atan2(dy, dx) * 180) / Math.PI;
    // A drag leaves the anchor, so its road can sit on the line it travels. A
    // rub crosses back and forth over the anchor, and a road down that line runs
    // through the middle of the sprite, where it reads as a rod skewering the
    // hand — so that one is centred on the anchor and stood off to the side.
    const back = gesture === "rub" ? -len / 2 : 0;
    const off = gesture === "rub" ? px * 0.46 : 0;
    trackEl.style.width = `${Math.round(len)}px`;
    trackEl.style.transform =
      `rotate(${ang.toFixed(1)}deg) translate(${Math.round(back)}px, ${Math.round(off)}px)`;
  } else {
    trackEl.style.width = "0px";
  }
}

/** Take it down. With an id, only if that's the hint currently up. */
export function hide(id = null) {
  if (!layer) return;
  if (id != null && cur.id !== id) return;
  layer.classList.add("off");
  cur = { id: null, gesture: null, cursor: null, label: null };
}

/** Screen point of a DOM element's middle — for hints that point at buttons. */
export function centerOf(el) {
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

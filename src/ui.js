/**
 * DOM-side juice: floating combo popups, springy banners, screen flash,
 * phase chrome (find/shape/paint), podium.
 */

const $ = (id) => document.getElementById(id);

export const els = {
  raceHud: $("race-hud"),
  startSignal: $("start-signal"),
  startLamps: [...document.querySelectorAll("#start-signal .lamp")],
  finishers: $("finishers"),
  holeTimer: $("hole-timer"),
  holeTimerVal: $("hole-timer-val"),
  popups: $("popups"),
  banner: $("banner"),
  flash: $("flash"),
  title: $("title-screen"),
  playBtn: $("play-btn"),
  phaseUi: $("phase-ui"),
  phaseTitle: $("phase-title"),
  phaseNext: $("phase-next"),
  phaseBack: $("phase-back"),
  paintUi: $("paint-ui"),
  patterns: $("patterns"),
  colorBar: $("color-bar"),
  colorKnob: $("color-knob"),
  sizeBar: $("size-bar"),
  sizeKnob: $("size-knob"),
  shelfTags: $("shelf-tags"),
  shelfRelease: $("shelf-release"),
  tapHand: $("tap-hand"),
  nameUi: $("name-ui"),
  nameInput: $("name-input"),
  nameOk: $("name-ok"),
  results: $("results-ui"),
  resultsTitle: $("results-title"),
  resultsList: $("results-list"),
  againBtn: $("again-btn"),
  wipe: $("wipe"),
  muter: $("muter"),
};

// ---------------------------------------------------------------- popups
const COMBO_COLORS = ["#ffffff", "#aef4ff", "#ffd24a", "#ff8a3d", "#ff5470", "#9d7cf4"];

export function popup(x, y, text, { size = 24, color = "#fff", rot = null } = {}) {
  const el = document.createElement("div");
  el.className = "popup";
  el.textContent = text;
  el.style.left = `${x}px`;
  el.style.top = `${y}px`;
  el.style.fontSize = `${size}px`;
  el.style.color = color;
  el.style.setProperty("--rot", `${rot ?? (Math.random() * 14 - 7)}deg`);
  els.popups.appendChild(el);
  setTimeout(() => el.remove(), 1200);
}

export function comboPopup(x, y, n) {
  const idx = Math.min(COMBO_COLORS.length - 1, Math.floor(n / 2));
  const size = Math.min(64, 20 + n * 4.5);
  const label = n < 3 ? `skip ×${n}` : n < 5 ? `SKIP ×${n}!` : n < 8 ? `MEGA ×${n}!!` : `UNREAL ×${n}!!!`;
  popup(x, y, label, { size, color: COMBO_COLORS[idx] });
}

// ---------------------------------------------------------------- banner
let bannerTimeout = null;
export function banner(text, sub = "", dur = 1.8) {
  clearTimeout(bannerTimeout);
  els.banner.innerHTML =
    `<div class="banner-text">${text}</div>` +
    (sub ? `<div class="banner-sub">${sub}</div>` : "");
  bannerTimeout = setTimeout(() => {
    for (const c of els.banner.children) c.classList.add("banner-out");
    setTimeout(() => (els.banner.innerHTML = ""), 320);
  }, dur * 1000);
}

// ---------------------------------------------------------------- flash
export function flash(strength = 0.5) {
  els.flash.style.transition = "none";
  els.flash.style.opacity = String(strength);
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      els.flash.style.transition = "opacity 0.3s ease-out";
      els.flash.style.opacity = "0";
    })
  );
}

// ---------------------------------------------------------------- finishers board
// The running order of stones that made the hole, medals down from gold. Rows
// are appended as they land so only the new name animates in.
// The top three wear gold, silver and bronze as a tint on the placing itself,
// the same way a finished cup does on the picker (metaui.js PLACE_TINT). A
// medal glyph would have been a different shape on every platform and is worse
// at the one job here, which is telling you at a glance which place is yours.
const MEDAL_TINT = ["#ffd24a", "#e3ebf2", "#e0a06b"];
const ORDINAL = (n) => `${n}${["th", "st", "nd", "rd"][n > 3 ? 0 : n]}`; // a field never reaches 21st

export function addFinisher(place, name, color, me = false) {
  els.finishers.classList.remove("hidden");
  const row = document.createElement("div");
  row.className = "fin-row" + (me ? " me" : "");
  const medal = document.createElement("span");
  medal.className = "medal" + (place <= 3 ? " top" : "");
  medal.textContent = ORDINAL(place);
  // your own row is already gold, and gold-on-gold is no colour at all
  if (!me && MEDAL_TINT[place - 1]) medal.style.color = MEDAL_TINT[place - 1];
  const dot = document.createElement("span");
  dot.className = "dot";
  dot.style.background = color;
  const nm = document.createElement("span");
  nm.textContent = me ? `YOU · ${name}` : name;
  row.append(medal, dot, nm);
  els.finishers.appendChild(row);
}

export function clearFinishers() {
  els.finishers.innerHTML = "";
  els.finishers.classList.add("hidden");
}

/** the final-stretch countdown; pass null to take it back down */
export function setHoleTimer(seconds) {
  if (seconds == null) {
    els.holeTimer.classList.add("hidden");
    return;
  }
  const s = Math.max(0, Math.ceil(seconds));
  els.holeTimer.classList.remove("hidden");
  els.holeTimer.classList.toggle("urgent", s <= 10);
  els.holeTimerVal.textContent = `${(s / 60) | 0}:${String(s % 60).padStart(2, "0")}`;
}

// ---------------------------------------------------------------- start signal
// The count that opens a hole, in the top-left corner. main.js owns the clock
// (LIGHTS_STEP) and calls in a stage at a time; all that happens here is a
// class, with the pop, the breathing and the bloom left to CSS keyframes.
let signalDown = null;

/** 0 all dark, 1 red, 2 orange, 3 green; null takes it off the screen. The
 *  green shows itself out a beat after the go — by then the hole is running
 *  and a lit corner is just something else to look past. */
export function setStartLights(stage) {
  clearTimeout(signalDown);
  els.startSignal.classList.toggle("up", stage != null);
  for (let i = 0; i < els.startLamps.length; i++) {
    els.startLamps[i].classList.toggle("on", stage === i + 1);
  }
  if (stage === els.startLamps.length) {
    signalDown = setTimeout(() => els.startSignal.classList.remove("up"), 950);
  }
}

// ---------------------------------------------------------------- phases
export function showPhase(title) {
  els.phaseUi.classList.remove("hidden");
  els.phaseTitle.textContent = title;
}
export function hidePhase() {
  els.phaseUi.classList.add("hidden");
  els.paintUi.classList.add("hidden");
  els.phaseNext.classList.add("hidden");
  els.phaseBack.classList.add("hidden");
  hideNameUI();
  clearShelfTags();
}

// ---------------------------------------------------------------- rock shelf
// The chosen stone wears a name plate over its floater, in screen space. The
// plate is clickable as well as the slot itself, so a fat thumb aiming at the
// name picks the rock it was aiming at. Unpicked and empty floaters get no
// plate — the pointing finger (setTapHand) does that job.
let shelfPick = null;

/**
 * @param items {{slot:number,x:number,y:number,behind:boolean,name:string,sel:boolean}[]}
 * @param release screen point under the chosen stone for the release button, or null
 */
export function updateShelfTags(items, onPick, release = null) {
  shelfPick = onPick ?? shelfPick;
  while (els.shelfTags.children.length < items.length) {
    const tag = document.createElement("div");
    tag.className = "rock-tag";
    tag.onclick = () => shelfPick?.(+tag.dataset.slot);
    tag.innerHTML = `<span class="nm"></span>`;
    els.shelfTags.appendChild(tag);
  }
  for (let i = 0; i < els.shelfTags.children.length; i++) {
    const tag = els.shelfTags.children[i];
    const it = items[i];
    tag.classList.toggle("hidden", !it || it.behind);
    if (!it) continue;
    tag.dataset.slot = it.slot;
    tag.classList.toggle("sel", !!it.sel);
    tag.style.left = `${Math.round(it.x)}px`;
    tag.style.top = `${Math.round(it.y)}px`;
    tag.querySelector(".nm").textContent = it.name;
  }
  // the release button belongs to the chosen stone, so it sits under it
  const anchored = release && !release.behind;
  if (anchored) {
    els.shelfRelease.style.left = `${Math.round(release.x)}px`;
    els.shelfRelease.style.top = `${Math.round(release.y)}px`;
  }
  els.shelfRelease.classList.toggle("no-anchor", !anchored);
}

/** park the pointing finger on a screen point, or pass nothing to put it away */
export function setTapHand(pt) {
  if (!pt) {
    els.tapHand.classList.add("hidden");
    return;
  }
  els.tapHand.classList.remove("hidden");
  els.tapHand.style.left = `${Math.round(pt.x)}px`;
  els.tapHand.style.top = `${Math.round(pt.y)}px`;
}

export function clearShelfTags() {
  els.shelfTags.innerHTML = "";
  els.shelfRelease.classList.add("hidden");
  setTapHand(null);
}

// ---------------------------------------------------------------- naming
// The suggested name is already good enough to keep, so the box starts unfocused:
// on a phone, focusing it here would throw the keyboard over the stone you just
// painted. Tapping the box is the opt-in.
export function showNameUI(suggestion) {
  els.nameUi.classList.remove("hidden");
  els.nameInput.value = suggestion;
  els.nameInput.blur();
}
export function hideNameUI() {
  els.nameUi.classList.add("hidden");
}
// tapping in wipes the suggestion in one go instead of asking for 20 backspaces
els.nameInput.addEventListener("focus", () => els.nameInput.select());
/** whatever's in the box, trimmed, or the suggestion it started with */
export function nameValue(fallback) {
  return els.nameInput.value.trim().slice(0, 20) || fallback;
}

/** The hue strip runs white at the top, black at the foot, spectrum between.
 *  One stop table feeds both the CSS gradient and the sampled colour, so the
 *  paint you load is exactly the pixel you put your thumb on. */
const HUE_STOPS = [
  [0.00, [255, 255, 255]],
  [0.07, [255, 255, 255]],
  [0.15, [255, 59, 48]],
  [0.24, [255, 149, 0]],
  [0.32, [255, 214, 10]],
  [0.41, [52, 199, 89]],
  [0.50, [0, 199, 190]],
  [0.59, [50, 173, 230]],
  [0.68, [10, 88, 255]],
  [0.77, [125, 59, 237]],
  [0.85, [255, 45, 146]],
  [0.92, [123, 20, 69]],
  [0.97, [0, 0, 0]],
  [1.00, [0, 0, 0]],
];
const HUE_START = 0.15; // the brush arrives loaded with red
const clamp01 = (v) => Math.min(1, Math.max(0, v));
const hex = (rgb) => "#" + rgb.map((v) => v.toString(16).padStart(2, "0")).join("");

function sampleHue(t) {
  t = clamp01(t);
  for (let i = 1; i < HUE_STOPS.length; i++) {
    const [t1, c1] = HUE_STOPS[i];
    if (t > t1) continue;
    const [t0, c0] = HUE_STOPS[i - 1];
    const k = t1 === t0 ? 0 : (t - t0) / (t1 - t0);
    return hex(c1.map((v, j) => Math.round(c0[j] + (v - c0[j]) * k)));
  }
  return hex(HUE_STOPS[HUE_STOPS.length - 1][1]);
}

const HUE_GRADIENT =
  "linear-gradient(to bottom, " +
  HUE_STOPS.map(([t, c]) => `${hex(c)} ${(t * 100).toFixed(1)}%`).join(", ") +
  ")";

/** press or drag anywhere along an edge strip, or arrow-key it: reports 0 at
 *  the top of the strip and 1 at its foot. Returns a setter for the caller's
 *  own starting value. */
function dragStrip(bar, onFrac) {
  let frac = 0;
  const set = (f) => {
    frac = clamp01(f);
    onFrac(frac);
  };
  const fracAt = (y) => {
    const r = bar.getBoundingClientRect();
    return (y - r.top) / r.height;
  };
  bar.onpointerdown = (e) => {
    e.preventDefault();
    bar.setPointerCapture(e.pointerId);
    bar.classList.add("grab");
    set(fracAt(e.clientY));
  };
  bar.onpointermove = (e) => {
    if (bar.hasPointerCapture(e.pointerId)) set(fracAt(e.clientY));
  };
  const release = (e) => {
    if (bar.hasPointerCapture(e.pointerId)) bar.releasePointerCapture(e.pointerId);
    bar.classList.remove("grab");
  };
  bar.onpointerup = release;
  bar.onpointercancel = release;
  bar.onkeydown = (e) => {
    const step = { ArrowUp: -0.04, ArrowDown: 0.04, PageUp: -0.15, PageDown: 0.15, Home: -1, End: 1 }[e.key];
    if (step === undefined) return;
    e.preventDefault();
    set(frac + step);
  };
  return set;
}

export function buildPaintUI({ patterns, brush, onColor, onPattern, onSize }) {
  els.paintUi.classList.remove("hidden");
  els.colorBar.style.background = HUE_GRADIENT;

  els.patterns.innerHTML = "";
  patterns.forEach((p, i) => {
    const b = document.createElement("div");
    b.className = "pattern-chip" + (i === 0 ? " sel" : "");
    b.textContent = p;
    b.onclick = () => {
      els.patterns.querySelectorAll(".pattern-chip").forEach((x) => x.classList.remove("sel"));
      b.classList.add("sel");
      onPattern(p);
    };
    els.patterns.appendChild(b);
  });

  // both knobs wear the loaded paint, so the thickness wedge doubles as a
  // preview of the dab you are about to leave
  const setColor = dragStrip(els.colorBar, (f) => {
    const c = sampleHue(f);
    els.colorBar.setAttribute("aria-valuenow", String(Math.round(f * 100)));
    els.colorKnob.style.top = `${f * 100}%`;
    els.colorKnob.style.background = c;
    els.sizeKnob.style.background = c;
    onColor(c);
  });

  const span = brush.max - brush.min;
  const setSize = dragStrip(els.sizeBar, (f) => {
    const r = Math.round(brush.max - f * span); // fat end of the wedge is up
    els.sizeBar.setAttribute("aria-valuenow", String(r));
    els.sizeKnob.style.top = `${f * 100}%`;
    const px = 9 + Math.round(((r - brush.min) / span) * 25);
    els.sizeKnob.style.width = els.sizeKnob.style.height = `${px}px`;
    onSize(r);
  });

  setColor(HUE_START);
  setSize((brush.max - brush.value) / span);
}

// ---------------------------------------------------------------- results
export function showResults(rows, playerWon) {
  els.results.classList.remove("hidden");
  els.resultsTitle.textContent = playerWon ? "YOU WIN!" : "RESULTS";
  els.resultsList.innerHTML = "";
  const medals = ["1st", "2nd", "3rd"];
  rows.forEach((r, i) => {
    const div = document.createElement("div");
    div.className = "result-row" + (i === 0 ? " first" : "");
    div.style.animationDelay = `${i * 0.12}s`;
    div.innerHTML =
      `<span class="place">${medals[i] ?? i + 1 + "th"}</span>` +
      `<span class="dot" style="background:${r.color}"></span>` +
      `<span class="rname">${r.me ? "YOU · " : ""}${r.name}</span>` +
      `<span class="pts">${r.points ?? 0} pts</span>` +
      `<span>${"★".repeat(r.holes)}</span>` +
      `<span style="opacity:0.6;font-size:12px">&nbsp;${r.throws} throws</span>`;
    els.resultsList.appendChild(div);
  });
}
export function hideResults() {
  els.results.classList.add("hidden");
}

// ---------------------------------------------------------------- wipe
export function wipe(cb, holdMs = 350) {
  els.wipe.classList.add("on");
  setTimeout(() => {
    cb?.();
    setTimeout(() => els.wipe.classList.remove("on"), 120);
  }, holdMs);
}

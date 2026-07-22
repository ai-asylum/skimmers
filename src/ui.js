/**
 * DOM-side juice: floating combo popups, springy banners, the HUD strip,
 * live scoreboard, screen flash, phase chrome (find/shape/paint), podium.
 */

const $ = (id) => document.getElementById(id);

export const els = {
  raceHud: $("race-hud"),
  hole: $("hud-hole"),
  throws: $("hud-throws"),
  timer: $("hud-timer"),
  popups: $("popups"),
  banner: $("banner"),
  flash: $("flash"),
  title: $("title-screen"),
  playBtn: $("play-btn"),
  phaseUi: $("phase-ui"),
  phaseTitle: $("phase-title"),
  phaseHint: $("phase-hint"),
  phaseNext: $("phase-next"),
  rockStats: $("rock-stats"),
  statFlat: $("stat-flat"),
  statHeft: $("stat-heft"),
  statGrit: $("stat-grit"),
  paintUi: $("paint-ui"),
  swatches: $("swatches"),
  patterns: $("patterns"),
  results: $("results-ui"),
  resultsTitle: $("results-title"),
  resultsList: $("results-list"),
  againBtn: $("again-btn"),
  throwHint: $("throw-hint"),
  throwUi: $("throw-ui"),
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

// ---------------------------------------------------------------- HUD
export function setHud(hole, totalHoles, throws, timeLeft) {
  els.hole.textContent = `HOLE ${hole}/${totalHoles}`;
  els.throws.textContent = `THROWS ${throws}`;
  const m = Math.floor(Math.max(0, timeLeft) / 60);
  const s = Math.floor(Math.max(0, timeLeft) % 60);
  els.timer.textContent = `${m}:${String(s).padStart(2, "0")}`;
  els.timer.classList.toggle("low", timeLeft < 12);
}

export function setThrowHint(text) {
  els.throwHint.textContent = text;
}

// ---------------------------------------------------------------- phases
export function showPhase(title, hint) {
  els.phaseUi.classList.remove("hidden");
  els.phaseTitle.textContent = title;
  els.phaseHint.textContent = hint;
}
export function hidePhase() {
  els.phaseUi.classList.add("hidden");
  els.rockStats.classList.add("hidden");
  els.paintUi.classList.add("hidden");
  els.phaseNext.classList.add("hidden");
}
export function setHint(hint) {
  els.phaseHint.textContent = hint;
}
export function showStats(flat, heft, grit) {
  els.rockStats.classList.remove("hidden");
  els.statFlat.style.width = `${Math.round(flat * 100)}%`;
  els.statHeft.style.width = `${Math.round(heft * 100)}%`;
  els.statGrit.style.width = `${Math.round(grit * 100)}%`;
}

export function buildPaintUI(colors, patterns, onColor, onPattern) {
  els.paintUi.classList.remove("hidden");
  els.swatches.innerHTML = "";
  els.patterns.innerHTML = "";
  colors.forEach((c, i) => {
    const b = document.createElement("div");
    b.className = "swatch" + (i === 0 ? " sel" : "");
    b.style.background = c;
    b.onclick = () => {
      els.swatches.querySelectorAll(".swatch").forEach((x) => x.classList.remove("sel"));
      b.classList.add("sel");
      onColor(c);
    };
    els.swatches.appendChild(b);
  });
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

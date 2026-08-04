/**
 * The career screens: the shell counter, the garage (two upgrade sockets plus
 * the dressing-up box) and the cup/class picker.
 *
 * Same house rules as ui.js — plain DOM over the canvas, `.layer` for the
 * overlay, `.hidden` to put it away — but everything inside is built from data
 * so adding a 31st upgrade or an eleventh hat is a line in upgrades.js or
 * cosmetics.js and nothing here.
 *
 * The garage never closes over the 3D scene: it hands equip decisions straight
 * back through callbacks so the stone on the bench puts the hat on while you're
 * still looking at the card you tapped.
 */
import { audio } from "./audio.js";
import { UPGRADES, UPGRADE_BY_ID, TAG_LABELS } from "./upgrades.js";
import { HATS, FLOATERS, TRAILS } from "./cosmetics.js";
import {
  UPGRADE_SLOTS, shells, hasUpgrade, unlockUpgrade, ownsCosmetic, buyCosmetic,
  loadoutFor, toggleUpgrade, equipCosmetic, cupRecord,
} from "./meta.js";
import { CUPS, TIERS, cupUnlocked, tierUnlocked, cupLockHint, tierLockHint } from "./cups.js";
import { syncPreviews, stopPreviews } from "./cosmeticpreview.js";
import { ICONS, paintIcons } from "./icons.js";

const $ = (id) => document.getElementById(id);

// the static chrome (shell counter, garage button) asks for its glyphs in the
// markup; fill them once, here, rather than from three different callers
paintIcons();

const els = {
  shellHud: $("shell-hud"),
  shellCount: $("shell-count"),
  garage: $("garage-ui"),
  garageRock: $("garage-rock"),
  garageSockets: $("garage-sockets"),
  garageTabs: $("garage-tabs"),
  garageGrid: $("garage-grid"),
  garageClose: $("garage-close"),
  cup: $("cup-ui"),
  cupTitle: $("cup-title"),
  cupSteps: $("cup-steps"),
  cupBody: $("cup-body"),
  cupList: $("cup-list"),
  tierList: $("tier-list"),
  cupSummary: $("cup-summary"),
  cupGo: $("cup-go"),
  cupBack: $("cup-back"),
  cupClose: $("cup-close"),
  payout: $("payout"),
};

// ---------------------------------------------------------------- shell counter
export function syncShells({ punch = false } = {}) {
  els.shellCount.textContent = shells().toLocaleString("en-US");
  if (!punch) return;
  els.shellHud.classList.remove("punch");
  void els.shellHud.offsetWidth; // restart the keyframes
  els.shellHud.classList.add("punch");
}

export function showShellHud(on) {
  els.shellHud.classList.toggle("hidden", !on);
  if (on) syncShells();
}

/** count the pile up over a beat or two, so a big payout feels like one */
export function countShellsTo(target, dur = 1.1) {
  const from = Number(els.shellCount.textContent.replace(/\D/g, "")) || 0;
  if (target === from) return;
  const t0 = performance.now();
  const tick = (now) => {
    const k = Math.min(1, (now - t0) / (dur * 1000));
    const eased = 1 - (1 - k) ** 3;
    els.shellCount.textContent = Math.round(from + (target - from) * eased).toLocaleString("en-US");
    if (k < 1) requestAnimationFrame(tick);
    else syncShells({ punch: true });
  };
  requestAnimationFrame(tick);
}

/** the "you can't afford that" wobble */
function refuse(card) {
  audio.pip(false);
  card.classList.remove("poor");
  void card.offsetWidth;
  card.classList.add("poor");
}

function bought(card) {
  audio.catchRock();
  card.classList.remove("bought");
  void card.offsetWidth;
  card.classList.add("bought");
  syncShells({ punch: true });
}

// ---------------------------------------------------------------- the garage
let garage = null; // { slot, rock, tab, hooks }

const TABS = [
  { id: "up", label: "Upgrades", icon: ICONS.wrench },
  { id: "hat", label: "Hats", icon: ICONS.hat },
  { id: "floater", label: "Floaters", icon: ICONS.ring },
  { id: "trail", label: "Trails", icon: ICONS.sparkle },
];

/** the shelf an unbought item's price sits on, shells and all */
const price = (n) => `<span class="cost">${ICONS.shell}${n}</span>`;

/**
 * @param slot  bench slot the stone lives in — loadouts are keyed by slot
 * @param rock  the live Rock, for the name in the header
 * @param hooks { onHat, onFloater, onTrail, onUpgrades, onClose }
 */
export function openGarage(slot, rock, hooks = {}) {
  garage = { slot, rock, tab: "up", hooks };
  els.garage.classList.remove("hidden");
  els.garageRock.textContent = rock?.label ?? "your stone";
  renderTabs();
  renderGarage();
}

export function closeGarage() {
  els.garage.classList.add("hidden");
  stopPreviews();
  garage = null;
}

export const garageOpen = () => !!garage;

function renderTabs() {
  els.garageTabs.innerHTML = "";
  for (const t of TABS) {
    const b = document.createElement("button");
    const sel = t.id === garage.tab;
    // the small button plate: blue for the tab you're on, white for the rest
    b.className = `meta-tab cb-face ${sel ? "sel cb-btn85-blue" : "cb-btn85-white"}`;
    b.innerHTML = `<span class="ico">${t.icon}</span>${t.label}`;
    b.onclick = () => {
      if (garage.tab === t.id) return;
      garage.tab = t.id;
      audio.pip(true);
      renderTabs();
      renderGarage();
    };
    els.garageTabs.appendChild(b);
  }
}

function renderGarage() {
  renderSockets();
  els.garageGrid.innerHTML = "";
  if (garage.tab === "up") {
    renderUpgrades();
    stopPreviews();
  } else {
    renderCosmetics(garage.tab);
    // the cards are in the document now, so the 3D pass can find its slots
    syncPreviews(els.garageGrid);
  }
}

/**
 * A card is the pack's item frame: a tinted plate with an untinted ring over
 * it. State picks both — the tint in CSS, the ring here, since a fitted item
 * gets the focus ring where the others get the plain border.
 */
const cardClass = (state) =>
  `card ${state} cb-plate cb-ringed cb-card ` +
  (state === "equipped" ? "cb-ring-card-focus" : "cb-ring-card-border");

/** the two sockets across the top: what this stone is actually carrying */
function renderSockets() {
  const l = loadoutFor(garage.slot);
  els.garageSockets.innerHTML = "";
  els.garageSockets.classList.toggle("hidden", garage.tab !== "up");
  for (let i = 0; i < UPGRADE_SLOTS; i++) {
    const id = l.up[i];
    const u = id ? UPGRADE_BY_ID.get(id) : null;
    const box = document.createElement("div");
    // a fitted socket wears the pack's item-slot plate with its focus glow
    box.className = "socket" + (u ? " full cb-plate cb-ringed cb-slot cb-ring-slot-glow" : "");
    // a fitted socket wears the same painted art as the card it came from, so
    // what you bought and what you are carrying are recognisably one thing
    box.innerHTML = u
      ? `<span class="ico art" style="--art: url(upgrades/${u.id}.png)"></span>` +
        `<span class="nm">${u.name}</span><span class="rm">tap to remove</span>`
      : `<span class="ico">＋</span><span class="nm">Empty socket</span><span class="rm">pick one below</span>`;
    if (u) {
      box.onclick = () => {
        toggleUpgrade(garage.slot, u.id);
        audio.pip(false);
        garage.hooks.onUpgrades?.();
        renderGarage();
      };
    }
    els.garageSockets.appendChild(box);
  }
}

function renderUpgrades() {
  const l = loadoutFor(garage.slot);
  const byTag = new Map();
  for (const u of UPGRADES) {
    if (!byTag.has(u.tag)) byTag.set(u.tag, []);
    byTag.get(u.tag).push(u);
  }
  for (const [tag, list] of byTag) {
    const h = document.createElement("div");
    h.className = "meta-group";
    h.textContent = TAG_LABELS[tag] ?? tag;
    els.garageGrid.appendChild(h);
    const row = document.createElement("div");
    row.className = "meta-cards";
    for (const u of list) row.appendChild(upgradeCard(u, l));
    els.garageGrid.appendChild(row);
  }
}

function upgradeCard(u, l) {
  const owned = hasUpgrade(u.id);
  const equipped = l.up.includes(u.id);
  const card = document.createElement("button");
  card.className = cardClass(equipped ? "equipped" : owned ? "owned" : "locked");
  // Painted upgrade art (public/upgrades/<id>.png, drawn by scripts/gen-upgrade-art.mjs)
  // in a display box the same size as the cosmetics' 3D one, so the two tabs of
  // the garage don't read as one finished shop and one placeholder. The emoji is
  // still the upgrade's shorthand everywhere it has to sit inline — the socket
  // chips above, and the shout when it fires mid-race.
  card.innerHTML =
    `<span class="card-art" style="--art: url(upgrades/${u.id}.png)"></span>` +
    `<span class="card-nm">${u.name}</span>` +
    `<span class="card-blurb">${u.blurb}</span>` +
    `<span class="card-foot">${equipped ? "EQUIPPED" : owned ? "Tap to fit" : price(u.cost)}</span>`;
  card.onclick = () => {
    if (!hasUpgrade(u.id)) {
      if (!unlockUpgrade(u.id, u.cost)) { refuse(card); return; }
      bought(card);
      // a fresh unlock goes straight into a socket — nobody buys a part to leave
      // it in the box
      toggleUpgrade(garage.slot, u.id);
    } else {
      audio.pip(!l.up.includes(u.id));
      toggleUpgrade(garage.slot, u.id);
    }
    garage.hooks.onUpgrades?.();
    renderGarage();
  };
  return card;
}

const COSMETIC_SETS = { hat: HATS, floater: FLOATERS, trail: TRAILS };
// what sits in the display box until the 3D pass claims it — the kind's own
// glyph, greyed, rather than a per-item picture: this is a placeholder for one
// frame on a good machine, and the whole card only on a browser with no WebGL
const COSMETIC_FALLBACK = { hat: ICONS.hat, floater: ICONS.ring, trail: ICONS.sparkle };

function renderCosmetics(kind) {
  const l = loadoutFor(garage.slot);
  const row = document.createElement("div");
  row.className = "meta-cards";
  for (const item of COSMETIC_SETS[kind]) {
    const owned = ownsCosmetic(kind, item.id);
    const worn = l[kind] === item.id;
    const card = document.createElement("button");
    card.className = cardClass(worn ? "equipped" : owned ? "owned" : "locked");
    // the glyph sits inside the display box as the no-WebGL fallback: the 3D
    // pass hides it the moment it claims the slot (cosmeticpreview.js), and
    // greys the box over if the item is still for sale
    card.innerHTML =
      `<span class="card-shot" data-preview="${kind}:${item.id}"${owned ? "" : " data-locked"}>` +
      `<span class="shot-ghost">${COSMETIC_FALLBACK[kind]}</span></span>` +
      `<span class="card-nm">${item.name}</span>` +
      `<span class="card-blurb">${item.blurb}</span>` +
      `<span class="card-foot">${worn ? "WEARING" : owned ? "Tap to wear" : price(item.cost)}</span>`;
    card.onclick = () => {
      if (!ownsCosmetic(kind, item.id)) {
        if (!buyCosmetic(kind, item.id, item.cost)) { refuse(card); return; }
        bought(card);
      } else {
        audio.pip(true);
      }
      equipCosmetic(garage.slot, kind, item.id);
      const hook = { hat: "onHat", floater: "onFloater", trail: "onTrail" }[kind];
      garage.hooks[hook]?.(item.id);
      renderGarage();
    };
    row.appendChild(card);
  }
  els.garageGrid.appendChild(row);
}

els.garageClose.addEventListener("click", () => {
  audio.pip(true);
  const hooks = garage?.hooks;
  closeGarage();
  hooks?.onClose?.();
});

// ---------------------------------------------------------------- cup select
/**
 * Three steps, one question at a time: the cup, the class, then the plate you
 * actually press. Seven cup cards, four class cards and a start button never
 * fitted down a phone in one column — and splitting them buys each card the
 * room for the blurb and the lock hint it never had.
 *
 * Picking moves you on, because on every step but the last the pick *is* the
 * answer to the question; the step bar stays put so a change of mind is one tap
 * back rather than a restart.
 */
let picker = null; // { cupIdx, tierIdx, step, onStart, onBack }

const STEPS = [
  { label: "Cup", title: "Pick your cup" },
  { label: "Class", title: "Pick your class" },
  { label: "Go", title: "On the line" },
];

export function openCupSelect({ cupIdx = 0, tierIdx = 0, onStart, onBack } = {}) {
  // never open on something the player hasn't earned yet
  while (cupIdx > 0 && !cupUnlocked(cupIdx)) cupIdx--;
  while (tierIdx > 0 && !tierUnlocked(tierIdx)) tierIdx--;
  picker = { cupIdx, tierIdx, step: 0, onStart, onBack };
  els.cup.classList.remove("hidden");
  renderPicker();
}

export function closeCupSelect() {
  els.cup.classList.add("hidden");
  picker = null;
}

export const cupSelectOpen = () => !!picker;

/** redraw the cards in place — for when something outside changed the unlocks */
export function refreshCupSelect() {
  if (picker) renderPicker();
}

// a shackle and a body, drawn once and tinted by whatever it sits in
const LOCK = '<svg class="ico-lock" viewBox="0 0 20 20" aria-hidden="true">' +
  '<path d="M6.2 9V6.6a3.8 3.8 0 0 1 7.6 0V9" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>' +
  '<rect x="3.9" y="8.6" width="12.2" height="8.6" rx="2.4" fill="currentColor"/></svg>';

/** a finished cup wears its placing, not a medal glyph */
const PLACES = ["", "1st", "2nd", "3rd"];
const PLACE_TINT = ["", "#ffd24a", "#dfe6ee", "#e5a06b"];

/** how a cup's record reads on a card, for the class you're looking at */
const recordFoot = (rec) =>
  PLACES[rec]
    ? `<i class="place-pip" style="--pip:${PLACE_TINT[rec]}"></i>${PLACES[rec]}`
    : "unraced";

/** move the pane along; `quiet` is for a step the pick's own sound announced */
function goStep(step, { quiet = false } = {}) {
  picker.step = Math.max(0, Math.min(STEPS.length - 1, step));
  if (!quiet) audio.pip(step > 0);
  renderPicker();
  els.cupBody.scrollTop = 0;
}

function renderPicker() {
  const { cupIdx, tierIdx, step } = picker;

  els.cupTitle.textContent = STEPS[step].title;
  renderSteps();
  // only the pane on screen is built; every step change comes back through here
  if (step === 0) renderCups();
  else if (step === 1) renderTiers();
  else renderGo();

  els.cupList.classList.toggle("hidden", step !== 0);
  els.tierList.classList.toggle("hidden", step !== 1);
  els.cupSummary.classList.toggle("hidden", step !== 2);

  els.cupBack.classList.toggle("hidden", step === 0);
  els.cupBack.textContent = `← ${STEPS[Math.max(0, step - 1)].label}`;

  const ready = cupUnlocked(cupIdx) && tierUnlocked(tierIdx);
  const last = step === STEPS.length - 1;
  // the last step is the button, so it takes the big plate and the whole row
  els.cupGo.className = "btn" + (last ? " go-big" : " blue");
  els.cupGo.textContent = last ? (ready ? "Race! →" : "Locked") : "Next →";
  els.cupGo.disabled = last && !ready;
}

/** the step bar, which is also the receipt for the steps behind you */
function renderSteps() {
  const { cupIdx, tierIdx, step } = picker;
  const values = [CUPS[cupIdx].name, `${TIERS[tierIdx].cc} ${TIERS[tierIdx].name}`, "Race!"];
  els.cupSteps.innerHTML = "";
  STEPS.forEach((s, i) => {
    const b = document.createElement("button");
    const sel = i === step;
    b.className = `step-chip cb-face ${sel ? "sel cb-btn85-blue" : "cb-btn85-white"}`;
    b.innerHTML = `<span class="step-n">${i + 1}. ${s.label}</span>` +
      `<span class="step-val">${values[i]}</span>`;
    b.onclick = () => { if (i !== picker.step) goStep(i); };
    els.cupSteps.appendChild(b);
  });
}

function renderCups() {
  const { cupIdx, tierIdx } = picker;
  const tier = TIERS[tierIdx];
  els.cupList.innerHTML = "";
  CUPS.forEach((c, i) => {
    const open = cupUnlocked(i);
    const b = document.createElement("button");
    b.className = "pick cup" + (i === cupIdx ? " sel" : "") + (open ? "" : " locked");
    b.style.setProperty("--art", `url(${c.art})`);
    b.innerHTML =
      `<span class="pick-nm">${c.name}</span>` +
      `<span class="pick-sub">${open ? recordFoot(cupRecord(c.id, tier.id)) : `${LOCK}locked`}</span>`;
    b.title = open ? c.blurb : cupLockHint(i);
    b.onclick = () => {
      if (!open) { refuse(b); return; }
      picker.cupIdx = i;
      audio.pickRock();
      goStep(1, { quiet: true });
    };
    els.cupList.appendChild(b);
  });
}

function renderTiers() {
  const { tierIdx } = picker;
  els.tierList.innerHTML = "";
  TIERS.forEach((t, i) => {
    const open = tierUnlocked(i);
    const b = document.createElement("button");
    b.className = "pick tier" + (i === tierIdx ? " sel" : "") + (open ? "" : " locked");
    b.style.setProperty("--tier", t.color);
    // One row per class: the water it puts you on, the cc and its name, the
    // line about it, and the two numbers you actually weigh — laid across
    // rather than stacked, so all four rungs of the ladder fit on a phone at
    // once. A locked class still shows its cc and its water: what you're
    // climbing towards should be visible from the bottom rung.
    b.innerHTML =
      `<span class="tier-art" style="--art: url(${t.art})"></span>` +
      `<span class="tier-text">` +
        `<span class="tier-head">` +
          `<span class="pick-nm">${t.cc}</span>` +
          `<span class="pick-sub">${open ? t.name : `${LOCK}locked`}</span>` +
        `</span>` +
        `<span class="pick-blurb">${open ? t.blurb : tierLockHint(i)}</span>` +
      `</span>` +
      `<span class="tier-nums">` +
        `<span class="tier-num"><b>${t.botCount}</b><i>rivals</i></span>` +
        `<span class="tier-num"><b>×${t.payout}</b><i>shells</i></span>` +
      `</span>`;
    b.onclick = () => {
      if (!open) { refuse(b); return; }
      picker.tierIdx = i;
      audio.pip(true);
      goStep(2, { quiet: true });
    };
    els.tierList.appendChild(b);
  });
}

/** the start line: what you picked, and what it's going to ask of you */
function renderGo() {
  const cup = CUPS[picker.cupIdx];
  const tier = TIERS[picker.tierIdx];
  const rec = cupRecord(cup.id, tier.id);
  const stat = (k, v) => `<div class="go-stat"><span class="k">${k}</span><span class="v">${v}</span></div>`;
  els.cupSummary.innerHTML =
    `<div class="go-art" style="--art: url(${cup.art}); --tier: ${tier.color}">` +
      `<span class="go-cup">${cup.name}</span>` +
      `<span class="go-class">${tier.cc} ${tier.name}</span>` +
    `</div>` +
    // everything but the art in one block, so a wide window can set the two
    // side by side and a phone can stack them
    `<div class="go-side">` +
      `<div class="go-blurb">${cup.blurb}</div>` +
      `<div class="go-stats">` +
        stat("Holes", cup.tracks.length) +
        stat("Rivals", tier.botCount) +
        stat("Shells", `×${tier.payout}`) +
        stat("Best", recordFoot(rec)) +
      `</div>` +
      (tier.mirror ? `<div class="go-warn">Every course mirrored again</div>` : "") +
      `<ol class="go-tracks">` +
        cup.tracks.map((t, i) => `<li class="go-track"><span class="n">${i + 1}</span>${t.name}</li>`).join("") +
      `</ol>` +
    `</div>`;
}

els.cupGo.addEventListener("click", () => {
  if (!picker || els.cupGo.disabled) return;
  if (picker.step < STEPS.length - 1) { goStep(picker.step + 1); return; }
  const { cupIdx, tierIdx, onStart } = picker;
  audio.pip(true);
  closeCupSelect();
  onStart?.(CUPS[cupIdx], TIERS[tierIdx], { cupIdx, tierIdx });
});

els.cupBack.addEventListener("click", () => {
  if (!picker || picker.step === 0) return;
  audio.pip(false);
  goStep(picker.step - 1);
});

els.cupClose.addEventListener("click", () => {
  if (!picker) return;
  const back = picker.onBack;
  audio.pip(false);
  closeCupSelect();
  back?.();
});

// ---------------------------------------------------------------- payout
/** the shell tally under the podium, one line dropping in at a time */
export function showPayout({ lines, total }, before) {
  els.payout.classList.remove("hidden");
  // the shells are already banked; hold the counter at the old number so it has
  // somewhere to run up from once the last line has landed
  els.shellCount.textContent = before.toLocaleString("en-US");
  els.payout.innerHTML =
    lines.map((l, i) =>
      `<div class="pay-row" style="animation-delay:${0.35 + i * 0.16}s">` +
      `<span>${l.label}</span><span class="amt">${l.amount >= 0 ? "+" : ""}${l.amount}</span></div>`
    ).join("") +
    `<div class="pay-row total" style="animation-delay:${0.35 + lines.length * 0.16}s">` +
    `<span>Earned</span><span class="amt shells">${ICONS.shell}${total}</span></div>`;

  // the counter runs up as the last line lands
  setTimeout(() => countShellsTo(before + total, 1.2), (0.45 + lines.length * 0.16) * 1000);
}

export function hidePayout() {
  els.payout.classList.add("hidden");
  els.payout.innerHTML = "";
}

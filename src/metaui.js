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
import { CUPS, TIERS, cupUnlocked, tierUnlocked } from "./cups.js";
import { syncPreviews, stopPreviews } from "./cosmeticpreview.js";

const $ = (id) => document.getElementById(id);

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
  cupList: $("cup-list"),
  tierList: $("tier-list"),
  cupGo: $("cup-go"),
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
  { id: "up", label: "Upgrades", icon: "🔧" },
  { id: "hat", label: "Hats", icon: "🎩" },
  { id: "floater", label: "Floaters", icon: "🛟" },
  { id: "trail", label: "Trails", icon: "✨" },
];

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
    b.className = "meta-tab" + (t.id === garage.tab ? " sel" : "");
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

/** the two sockets across the top: what this stone is actually carrying */
function renderSockets() {
  const l = loadoutFor(garage.slot);
  els.garageSockets.innerHTML = "";
  els.garageSockets.classList.toggle("hidden", garage.tab !== "up");
  for (let i = 0; i < UPGRADE_SLOTS; i++) {
    const id = l.up[i];
    const u = id ? UPGRADE_BY_ID.get(id) : null;
    const box = document.createElement("div");
    box.className = "socket" + (u ? " full" : "");
    box.innerHTML = u
      ? `<span class="ico">${u.icon}</span><span class="nm">${u.name}</span><span class="rm">tap to remove</span>`
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
  card.className = "card" + (equipped ? " equipped" : owned ? " owned" : " locked");
  card.innerHTML =
    `<span class="card-ico">${u.icon}</span>` +
    `<span class="card-nm">${u.name}</span>` +
    `<span class="card-blurb">${u.blurb}</span>` +
    `<span class="card-foot">${equipped ? "EQUIPPED" : owned ? "Tap to fit" : `🐚 ${u.cost}`}</span>`;
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

function renderCosmetics(kind) {
  const l = loadoutFor(garage.slot);
  const row = document.createElement("div");
  row.className = "meta-cards";
  for (const item of COSMETIC_SETS[kind]) {
    const owned = ownsCosmetic(kind, item.id);
    const worn = l[kind] === item.id;
    const card = document.createElement("button");
    card.className = "card" + (worn ? " equipped" : owned ? " owned" : " locked");
    // the emoji sits inside the display box as the no-WebGL fallback: the 3D
    // pass hides it the moment it claims the slot (cosmeticpreview.js)
    card.innerHTML =
      `<span class="card-shot" data-preview="${kind}:${item.id}">${item.icon}</span>` +
      `<span class="card-nm">${item.name}</span>` +
      `<span class="card-blurb">${item.blurb}</span>` +
      `<span class="card-foot">${worn ? "WEARING" : owned ? "Tap to wear" : `🐚 ${item.cost}`}</span>`;
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
let picker = null; // { cupIdx, tierIdx, onStart, onBack }

export function openCupSelect({ cupIdx = 0, tierIdx = 0, onStart, onBack } = {}) {
  // never open on something the player hasn't earned yet
  while (cupIdx > 0 && !cupUnlocked(cupIdx)) cupIdx--;
  while (tierIdx > 0 && !tierUnlocked(tierIdx)) tierIdx--;
  picker = { cupIdx, tierIdx, onStart, onBack };
  els.cup.classList.remove("hidden");
  renderPicker();
}

export function closeCupSelect() {
  els.cup.classList.add("hidden");
  picker = null;
}

export const cupSelectOpen = () => !!picker;

// a shackle and a body, drawn once and tinted by whatever it sits in
const LOCK = '<svg class="ico-lock" viewBox="0 0 20 20" aria-hidden="true">' +
  '<path d="M6.2 9V6.6a3.8 3.8 0 0 1 7.6 0V9" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>' +
  '<rect x="3.9" y="8.6" width="12.2" height="8.6" rx="2.4" fill="currentColor"/></svg>';

/** a finished cup wears its placing, not a medal glyph */
const PLACES = ["", "1st", "2nd", "3rd"];
const PLACE_TINT = ["", "#ffd24a", "#dfe6ee", "#e5a06b"];

function renderPicker() {
  const { cupIdx, tierIdx } = picker;
  const tier = TIERS[tierIdx];

  els.cupList.innerHTML = "";
  CUPS.forEach((c, i) => {
    const open = cupUnlocked(i);
    const rec = cupRecord(c.id, tier.id);
    const b = document.createElement("button");
    b.className = "pick cup" + (i === cupIdx ? " sel" : "") + (open ? "" : " locked");
    b.style.setProperty("--art", `url(${c.art})`);
    const foot = !open
      ? `${LOCK}locked`
      : PLACES[rec]
        ? `<i class="place-pip" style="--pip:${PLACE_TINT[rec]}"></i>${PLACES[rec]}`
        : "unraced";
    b.innerHTML =
      `<span class="pick-nm">${c.name}</span>` +
      `<span class="pick-sub">${foot}</span>`;
    b.onclick = () => {
      if (!open) { refuse(b); return; }
      picker.cupIdx = i;
      audio.pickRock();
      renderPicker();
    };
    els.cupList.appendChild(b);
  });

  els.tierList.innerHTML = "";
  TIERS.forEach((t, i) => {
    const open = tierUnlocked(i);
    const b = document.createElement("button");
    b.className = "pick tier" + (i === tierIdx ? " sel" : "") + (open ? "" : " locked");
    b.style.setProperty("--tier", t.color);
    // a locked class still shows its cc: the ladder you're climbing should be
    // visible from the bottom rung
    b.innerHTML =
      `<span class="pick-nm">${t.cc}</span>` +
      `<span class="pick-sub">${open ? t.name : `${LOCK}locked`}</span>`;
    b.onclick = () => {
      if (!open) { refuse(b); return; }
      picker.tierIdx = i;
      audio.pip(true);
      renderPicker();
    };
    els.tierList.appendChild(b);
  });

  const open = cupUnlocked(cupIdx);
  const tierOpen = tierUnlocked(tierIdx);

  els.cupGo.disabled = !(open && tierOpen);
  els.cupGo.textContent = open && tierOpen ? "Race! →" : "Locked";
}

els.cupGo.addEventListener("click", () => {
  if (!picker || els.cupGo.disabled) return;
  const { cupIdx, tierIdx, onStart } = picker;
  audio.pip(true);
  closeCupSelect();
  onStart?.(CUPS[cupIdx], TIERS[tierIdx], { cupIdx, tierIdx });
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
    `<span>Earned</span><span class="amt">🐚 ${total}</span></div>`;

  // the counter runs up as the last line lands
  setTimeout(() => countShellsTo(before + total, 1.2), (0.45 + lines.length * 0.16) * 1000);
}

export function hidePayout() {
  els.payout.classList.add("hidden");
  els.payout.innerHTML = "";
}

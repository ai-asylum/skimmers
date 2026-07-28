/**
 * The career save: everything that outlives a single race.
 *
 * Shells are the currency (you fish them out of the lake, so that's what they
 * are). Upgrades and cosmetics are *unlocked* account-wide with shells and then
 * *equipped* per bench slot, which is the split that makes a bench of three
 * stones worth having: one build for the flat rivers, one for the switchbacks.
 *
 * A loadout is keyed by bench slot rather than by rock, because that's what the
 * shelf can address — toss a rock back and its slot's loadout goes with it.
 *
 * Same try/catch posture as shelf.js: private-browsing windows throw on
 * localStorage, and there the career just doesn't persist rather than the game
 * refusing to start.
 */
import { SHELF_SLOTS } from "./shelf.js";

const STORE = "skippidy.meta.v1";

/** how many upgrades a single stone can carry into a race */
export const UPGRADE_SLOTS = 2;

const blankLoadout = () => ({ up: [null, null], hat: "none", floater: "classic", trail: "none" });

function blank() {
  return {
    v: 1,
    shells: 0,
    upgrades: [], // unlocked upgrade ids
    owned: { hat: ["none"], floater: ["classic"], trail: ["none"] },
    loadouts: Array.from({ length: SHELF_SLOTS }, blankLoadout),
    records: {}, // "cupId|tierId" -> best finishing place (1 = won it)
    lifetime: { races: 0, wins: 0, earned: 0 },
  };
}

let cache = null;

function coerce(raw) {
  const m = blank();
  if (!raw || typeof raw !== "object") return m;
  if (Number.isFinite(raw.shells)) m.shells = Math.max(0, Math.floor(raw.shells));
  if (Array.isArray(raw.upgrades)) m.upgrades = raw.upgrades.filter((s) => typeof s === "string");
  for (const kind of ["hat", "floater", "trail"]) {
    const list = raw.owned?.[kind];
    if (Array.isArray(list)) m.owned[kind] = [...new Set([...m.owned[kind], ...list.filter((s) => typeof s === "string")])];
  }
  if (Array.isArray(raw.loadouts)) {
    for (let i = 0; i < SHELF_SLOTS; i++) {
      const l = raw.loadouts[i];
      if (!l) continue;
      const up = Array.isArray(l.up) ? l.up : [];
      m.loadouts[i] = {
        up: [up[0] ?? null, up[1] ?? null],
        hat: l.hat ?? "none",
        floater: l.floater ?? "classic",
        trail: l.trail ?? "none",
      };
    }
  }
  if (raw.records && typeof raw.records === "object") {
    for (const [k, v] of Object.entries(raw.records)) {
      if (Number.isFinite(v)) m.records[k] = v;
    }
  }
  if (raw.lifetime) {
    for (const k of ["races", "wins", "earned"]) {
      if (Number.isFinite(raw.lifetime[k])) m.lifetime[k] = raw.lifetime[k];
    }
  }
  return m;
}

/** the career, read through once and then held in memory */
export function loadMeta() {
  if (cache) return cache;
  try {
    cache = coerce(JSON.parse(localStorage.getItem(STORE)));
  } catch {
    cache = blank();
  }
  return cache;
}

export function saveMeta() {
  const m = loadMeta();
  try {
    localStorage.setItem(STORE, JSON.stringify(m));
  } catch { /* no storage: the career lives for this session only */ }
  return m;
}

// ---------------------------------------------------------------- shells
export const shells = () => loadMeta().shells;

export function addShells(n) {
  const m = loadMeta();
  const gain = Math.max(0, Math.round(n));
  m.shells += gain;
  m.lifetime.earned += gain;
  saveMeta();
  return m.shells;
}

/** spend if we can afford it; false means the purchase didn't happen */
export function spendShells(n) {
  const m = loadMeta();
  if (m.shells < n) return false;
  m.shells -= n;
  saveMeta();
  return true;
}

// ---------------------------------------------------------------- unlocks
export const hasUpgrade = (id) => loadMeta().upgrades.includes(id);

export function unlockUpgrade(id, cost) {
  if (hasUpgrade(id)) return true;
  if (!spendShells(cost)) return false;
  loadMeta().upgrades.push(id);
  saveMeta();
  return true;
}

export const ownsCosmetic = (kind, id) => loadMeta().owned[kind]?.includes(id) ?? false;

export function buyCosmetic(kind, id, cost) {
  if (ownsCosmetic(kind, id)) return true;
  if (!spendShells(cost)) return false;
  loadMeta().owned[kind].push(id);
  saveMeta();
  return true;
}

// ---------------------------------------------------------------- loadouts
export function loadoutFor(slot) {
  const m = loadMeta();
  if (slot < 0 || slot >= SHELF_SLOTS) return blankLoadout();
  return m.loadouts[slot];
}

/** put an upgrade in one of the stone's two sockets (null clears it) */
export function equipUpgrade(slot, socket, id) {
  const l = loadoutFor(slot);
  if (socket < 0 || socket >= UPGRADE_SLOTS) return l;
  // the same upgrade twice would silently do nothing, so a duplicate swaps
  const other = l.up[1 - socket];
  if (id && other === id) l.up[1 - socket] = l.up[socket];
  l.up[socket] = id;
  saveMeta();
  return l;
}

/** toggle an upgrade into the first free socket, or out of the one it's in */
export function toggleUpgrade(slot, id) {
  const l = loadoutFor(slot);
  const at = l.up.indexOf(id);
  if (at >= 0) l.up[at] = null;
  else {
    const free = l.up.indexOf(null);
    // both sockets full: the oldest one (socket 0) gives way and slides along
    if (free < 0) { l.up[0] = l.up[1]; l.up[1] = id; }
    else l.up[free] = id;
  }
  saveMeta();
  return l;
}

export function equipCosmetic(slot, kind, id) {
  const l = loadoutFor(slot);
  l[kind] = id;
  saveMeta();
  return l;
}

/** a slot got tossed back into the lake: its build goes with it */
export function clearLoadout(slot) {
  const m = loadMeta();
  if (slot < 0 || slot >= SHELF_SLOTS) return;
  m.loadouts[slot] = blankLoadout();
  saveMeta();
}

// ---------------------------------------------------------------- cup records
const recKey = (cupId, tierId) => `${cupId}|${tierId}`;

/** best place ever taken in this cup at this difficulty, or 0 for never raced */
export const cupRecord = (cupId, tierId) => loadMeta().records[recKey(cupId, tierId)] ?? 0;

export function recordCup(cupId, tierId, place, won) {
  const m = loadMeta();
  const k = recKey(cupId, tierId);
  const prev = m.records[k] ?? 99;
  if (place > 0 && place < prev) m.records[k] = place;
  m.lifetime.races++;
  if (won) m.lifetime.wins++;
  saveMeta();
  return m.records[k] ?? 0;
}

/** wipe the career (debug hook, exposed on window.__skimmers) */
export function resetMeta() {
  cache = blank();
  saveMeta();
  return cache;
}

/**
 * The rock shelf: the three stones you keep.
 *
 * A finished rock is a seed plus the log of bites drilled out of it plus its
 * paint — the same payload the wire already carries (main.js `rockCfg`) — so a
 * saved slot is that config, a name you typed, and when it was made. Three
 * slots, no more: the bench only has room for three floaters.
 *
 * Everything is wrapped in try/catch because private-browsing windows throw on
 * localStorage; there the shelf simply doesn't persist rather than breaking the
 * game.
 */
export const SHELF_SLOTS = 3;
const STORE = "skippidy.shelf.v1";

const blank = () => new Array(SHELF_SLOTS).fill(null);

/** the shelf as an array of length SHELF_SLOTS: entry or null per slot */
export function loadShelf() {
  const shelf = blank();
  try {
    const raw = localStorage.getItem(STORE);
    if (!raw) return shelf;
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return shelf;
    for (let i = 0; i < SHELF_SLOTS; i++) {
      const e = arr[i];
      // a slot is only usable if it can actually grow a rock back
      if (e && e.cfg && Number.isFinite(e.cfg.seed)) shelf[i] = e;
    }
  } catch { /* no storage: play on with an empty bench */ }
  return shelf;
}

function write(shelf) {
  try {
    localStorage.setItem(STORE, JSON.stringify(shelf));
  } catch { /* full or blocked: the rock just won't be there next time */ }
}

/** @param entry {{ name: string, cfg: object, born?: number }} */
export function saveSlot(idx, entry) {
  const shelf = loadShelf();
  if (idx < 0 || idx >= SHELF_SLOTS) return shelf;
  shelf[idx] = { born: Date.now(), ...entry };
  write(shelf);
  return shelf;
}

/** back into the lake it goes, freeing the slot */
export function clearSlot(idx) {
  const shelf = loadShelf();
  if (idx < 0 || idx >= SHELF_SLOTS) return shelf;
  shelf[idx] = null;
  write(shelf);
  return shelf;
}

export function firstFreeSlot(shelf) {
  return shelf.findIndex((s) => !s);
}

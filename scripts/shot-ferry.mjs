// Live check of the ferry ride: drop the player's stone straight down onto each
// boat in turn and confirm it lands on deck and gets carried along.
// Usage: node scripts/shot-ferry.mjs [url] [outPngPrefix]
import { chromium } from "playwright";

const url = process.argv[2] || "http://localhost:8742/";
const out = process.argv[3] || "/tmp/ferry";

const browser = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: 1100, height: 620 } });
const logs = [];
page.on("console", (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on("pageerror", (e) => logs.push(`[pageerror] ${e.message}`));

await page.goto(url, { waitUntil: "networkidle" });
await page.waitForTimeout(800);
await page.click("#play-btn");
await page.waitForTimeout(1200);

// Play opens on the bench now. An empty slot starts a new stone, which drops us
// into the old find -> shape -> paint -> name run; then the cup picker stands
// between the bench and the water.
await page.evaluate(() => window.__skimmers.pickSlot(0));
await page.waitForTimeout(1200);
await page.evaluate(() => window.__skimmers.selectCandidate(0));
for (let i = 0; i < 10; i++) {
  await page.waitForTimeout(700);
  const done = await page.evaluate(async () => {
    const { G, confirmName } = window.__skimmers;
    if (G.state === "race") return true;
    if (G.state === "name") { confirmName(); return false; }
    return false;
  });
  if (done) break;
  for (const sel of ["#phase-next:not(.hidden)", "#cup-go:not(:disabled)"]) {
    const btn = await page.$(sel);
    if (btn && (await btn.isVisible())) { await btn.click(); break; }
  }
}
await page.waitForTimeout(2000);

// quiet the race down: no bots winning the hole and no killcam freezing physics
await page.evaluate(() => {
  const { G } = window.__skimmers;
  G.bots.length = 0;
  G.holeTime = 9999;
});

const state = await page.evaluate(() => window.__skimmers.G.state);
if (state !== "race") {
  console.log(`could not reach the race (stuck in "${state}")`);
  console.log(logs.join("\n"));
  await browser.close();
  process.exit(1);
}

// boats loop the whole lake while the channel is carved per hole, so nudge this
// one along its route until it is over open water — otherwise the stone thuds
// into the bank the boat happens to be crossing
// The boat's own centre being wet isn't enough: the channels are narrow enough
// that a stone which lands a metre off the deck skips into the bank and beaches,
// which reads as a ferry failure when it's really a place failure. Ask for a
// clear pool around the boat instead.
const toOpenWater = (i) => page.evaluate(async (idx) => {
  const { boats } = window.__skimmers;
  const { isWaterAt } = await import("/src/water.js");
  const b = boats.boats[idx];
  const clear = (p) => {
    const r = b.halfLen + 8;
    for (let a = 0; a < 8; a++) {
      const th = (a / 8) * Math.PI * 2;
      if (!isWaterAt(p.x + Math.cos(th) * r, p.z + Math.sin(th) * r)) return false;
    }
    return isWaterAt(p.x, p.z);
  };
  let found = false;
  for (let n = 0; n < 200; n++) {
    const p = b.curve.getPointAt(Math.min(0.999999, b.t / b.len));
    if (clear(p)) { found = true; break; }
    b.t = (b.t + b.len / 200) % b.len;
  }
  // Moving `t` only says where the boat is due; the hull is put there by the next
  // frame. Wait for one, or the drop is aimed at the spot it just left — which is
  // often over the bank, and the stone beaches in mid-air.
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  return found;
}, i);

// lobbed from 8m up, keeping pace with the boat — the shot a player would take
const drop = (i) => page.evaluate((idx) => {
  const { G, boats, cam, THREE } = window.__skimmers;
  const b = boats.boats[idx];
  const deck = b.decks[0];
  const u = Math.min(0.999999, Math.max(0, b.t / b.len));
  const along = b.curve.getTangentAt(u).multiplyScalar(b.speed);
  G.player.pos.copy(b.group.localToWorld(new THREE.Vector3((deck.x0 + deck.x1) / 2, deck.y + 8, 0)));
  G.player.vel.set(along.x, -7, along.z);
  G.player.state = "flying";
  G.player.lastThrowMode = "skip";
  G.player.boat = null; // off the last ferry, the way a throw would leave it
  cam.mode = "follow";
  return b.type;
}, i);

// The stone's position and its boat's, together: a ride is the two of them
// moving as one, and reading them a frame apart would fake a slip.
const report = (i) => page.evaluate((idx) => {
  const { G, boats } = window.__skimmers;
  const p = G.player;
  return {
    state: p.state,
    boat: boats.boats.findIndex((b) => b.group === p.boat),
    pos: p.pos.toArray().map((v) => +v.toFixed(3)),
    hull: boats.boats[idx].group.position.toArray().map((v) => +v.toFixed(3)),
  };
}, i);

/**
 * Wait for the stone to stop flying. The budget is in wall-clock seconds but the
 * fall it's waiting on is in sim seconds, and software rendering runs the sim at
 * a small fraction of real time, so this is generous on purpose: a short wait
 * here reports a stone that is merely still in the air as a missed deck.
 */
async function settle(i) {
  for (let n = 0; n < 150; n++) {
    const r = await report(i);
    if (r.state !== "flying") return r;
    await page.waitForTimeout(150);
  }
  return report(i);
}

/**
 * Let the boat get somewhere. Software rendering runs the sim at a fraction of
 * wall-clock speed, so waiting a second and expecting a metre tests the renderer
 * rather than the ferry — wait for the boat to have travelled instead.
 */
async function ride(i, want) {
  const from = await report(i);
  for (let n = 0; n < 120; n++) {
    await page.waitForTimeout(150);
    const now = await report(i);
    const gone = Math.hypot(now.hull[0] - from.hull[0], now.hull[2] - from.hull[2]);
    if (gone >= want || now.state !== "onboat") return { from, now, gone };
  }
  const now = await report(i);
  return { from, now, gone: Math.hypot(now.hull[0] - from.hull[0], now.hull[2] - from.hull[2]) };
}

let fails = 0;
for (let i = 0; i < 4; i++) {
  if (!(await toOpenWater(i))) { console.log(`skip boat ${i}: no open water on its loop this hole`); continue; }
  const type = await drop(i);
  const a = await settle(i);
  const { now: b, gone } = await ride(i, 1.5); // ...and ride
  const carried = Math.hypot(b.pos[0] - a.pos[0], b.pos[2] - a.pos[2]);
  // the stone went where the boat went, give or take the deck rocking under it
  const together = Math.abs(carried - gone) < 0.35;
  const ok = a.state === "onboat" && b.state === "onboat" && b.boat === i && gone > 1 && together;
  if (!ok) fails++;
  console.log(
    `${ok ? "ok  " : "FAIL"} boat ${i} (${type}): ${a.state} -> ${b.state}, aboard #${b.boat}, ` +
    `boat ran ${gone.toFixed(2)}m and carried the stone ${carried.toFixed(2)}m`,
  );
  await page.screenshot({ path: `${out}-${i}-${type}.png` });
}

const noise = logs.filter((l) => !/webgl|vite connect|\[debug\]/i.test(l));
if (noise.length) console.log("LOGS:\n" + noise.join("\n"));
await browser.close();
process.exit(fails ? 1 : 0);

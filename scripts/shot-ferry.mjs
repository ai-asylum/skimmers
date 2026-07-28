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
await page.evaluate(() => window.__skimmers.selectCandidate(0));
for (let i = 0; i < 6; i++) {
  await page.waitForTimeout(700);
  if (await page.evaluate(() => window.__skimmers.G.state === "race")) break;
  const next = await page.$("#phase-next:not(.hidden)");
  if (next) await next.click();
}
await page.waitForTimeout(1500);

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
const toOpenWater = (i) => page.evaluate(async (idx) => {
  const { boats } = window.__skimmers;
  const { isWaterAt } = await import("/src/water.js");
  const b = boats.boats[idx];
  for (let n = 0; n < 200; n++) {
    const p = b.curve.getPointAt(Math.min(0.999999, b.t / b.len));
    if (isWaterAt(p.x, p.z)) return true;
    b.t = (b.t + b.len / 200) % b.len;
  }
  return false;
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
  cam.mode = "follow";
  return b.type;
}, i);

const report = () => page.evaluate(() => {
  const { G, boats } = window.__skimmers;
  const p = G.player;
  return {
    state: p.state,
    boat: boats.boats.findIndex((b) => b.group === p.boat),
    pos: p.pos.toArray().map((v) => +v.toFixed(2)),
  };
});

/** wait for the stone to stop flying */
async function settle() {
  for (let i = 0; i < 40; i++) {
    const r = await report();
    if (r.state !== "flying") return r;
    await page.waitForTimeout(100);
  }
  return report();
}

let fails = 0;
for (let i = 0; i < 4; i++) {
  if (!(await toOpenWater(i))) { console.log(`skip boat ${i}: no open water on its loop this hole`); continue; }
  await page.waitForTimeout(150);
  const type = await drop(i);
  const a = await settle();
  await page.waitForTimeout(1200); // ...and ride
  const b = await report();
  const moved = Math.hypot(b.pos[0] - a.pos[0], b.pos[2] - a.pos[2]);
  const ok = a.state === "onboat" && b.state === "onboat" && b.boat === i && moved > 0.5;
  if (!ok) fails++;
  console.log(`${ok ? "ok  " : "FAIL"} boat ${i} (${type}): ${a.state} -> ${b.state}, aboard #${b.boat}, carried ${moved.toFixed(2)}m`);
  await page.screenshot({ path: `${out}-${i}-${type}.png` });
}

const noise = logs.filter((l) => !/webgl|vite connect|\[debug\]/i.test(l));
if (noise.length) console.log("LOGS:\n" + noise.join("\n"));
await browser.close();
process.exit(fails ? 1 : 0);

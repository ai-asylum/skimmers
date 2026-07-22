import { chromium } from "file:///Users/ruben/GameDev/spellwright/node_modules/playwright/index.mjs";
const OUT = "/private/tmp/claude-501/-Users-ruben-GameDev-RockskipExperiment-B/817fbe77-1db5-4a7e-95d1-baa81d9b84a9/scratchpad";
const errors = [];
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on("pageerror", (e) => errors.push((e.stack || e.message).split("\n").slice(0,2).join(" | ")));
await page.goto("http://localhost:8741/", { waitUntil: "networkidle" });
await page.waitForTimeout(700);
await page.click("#play-btn");
await page.waitForTimeout(900);
await page.evaluate(() => window.__skimmers.selectCandidate(1));
await page.click("#phase-next");
// heavy grind for max flat
await page.mouse.move(640, 380);
await page.mouse.down();
for (let i = 0; i < 55; i++) { await page.mouse.move(580 + Math.random()*130, 330 + Math.random()*110); await page.waitForTimeout(35); }
await page.mouse.up();
await page.click("#phase-next");
await page.waitForTimeout(200);
await page.evaluate(() => document.querySelectorAll("#swatches .swatch")[2]?.click());
await page.click("#phase-next");
await page.waitForTimeout(4200); // intro flyover

const snap = () => page.evaluate(() => {
  const S = window.__skimmers;
  const p = S.G.player;
  return { state: p.state, winner: S.G.holeWinner?.name ?? null, replay: !!S.G.replay,
    fishing: !!document.querySelector("#fishing-ui:not(.hidden)"), skips: p.skips, camMode: S.cam.mode };
});

let fireShot = false, replayShots = 0;
const t0 = Date.now();
while (Date.now() - t0 < 120000) {
  const s = await snap();
  if (s.replay) {
    await page.waitForTimeout(1200);
    await page.screenshot({ path: `${OUT}/r_replay${++replayShots}.png` });
    if (replayShots >= 2) break;
    continue;
  }
  if (s.winner) { await page.waitForTimeout(400); continue; }
  if (s.state === "flying" && s.skips >= 5 && !fireShot) {
    fireShot = true;
    await page.screenshot({ path: `${OUT}/r_fire.png` });
  }
  if (s.fishing) {
    for (let i = 0; i < 200; i++) {
      const hit = await page.evaluate(() => {
        const z = document.getElementById("fishing-zone").getBoundingClientRect();
        const c = document.getElementById("fishing-cursor").getBoundingClientRect();
        return c.left > z.left + 6 && c.right < z.right - 6;
      });
      if (hit) { await page.mouse.click(400, 200); break; }
      await page.waitForTimeout(16);
    }
    await page.waitForTimeout(500);
    continue;
  }
  if (["resting","beached","onboat"].includes(s.state) && s.camMode !== "intro") {
    await page.mouse.move(640, 420);
    await page.mouse.down();
    await page.mouse.move(628 + Math.random()*24, 645, { steps: 8 });
    await page.waitForTimeout(80);
    await page.mouse.up();
    await page.waitForTimeout(300);
  } else await page.waitForTimeout(250);
}
console.log(JSON.stringify({ errors, fireShot, replayShots, final: await snap() }, null, 2));
await browser.close();

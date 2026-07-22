import { chromium } from "file:///Users/ruben/GameDev/spellwright/node_modules/playwright/index.mjs";
const OUT = "/private/tmp/claude-501/-Users-ruben-GameDev-RockskipExperiment-B/817fbe77-1db5-4a7e-95d1-baa81d9b84a9/scratchpad";
const errors = [];
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on("pageerror", (e) => errors.push((e.stack || e.message).split("\n").slice(0,3).join(" | ")));
await page.goto("http://localhost:8741/", { waitUntil: "networkidle" });
await page.waitForTimeout(700);
await page.click("#play-btn");
await page.waitForTimeout(900);
await page.evaluate(() => window.__skimmers.selectCandidate(2));
await page.click("#phase-next");
await page.mouse.move(640, 380);
await page.mouse.down();
for (let i = 0; i < 40; i++) { await page.mouse.move(580 + Math.random()*130, 330 + Math.random()*110); await page.waitForTimeout(35); }
await page.mouse.up();
await page.click("#phase-next"); // paint
await page.waitForTimeout(300);
// pick coral brush, paint strokes on the rock
await page.evaluate(() => document.querySelectorAll("#swatches .swatch")[4]?.click());
await page.mouse.move(600, 390);
await page.mouse.down();
for (let i = 0; i < 30; i++) { await page.mouse.move(560 + i * 5, 370 + Math.sin(i*0.5)*40); await page.waitForTimeout(40); }
await page.mouse.up();
// dip in gold via dunk? no — keep grey base + coral strokes; add star pattern base
await page.evaluate(() => [...document.querySelectorAll("#patterns .pattern-chip")].find(c => c.textContent === "dots")?.click());
await page.waitForTimeout(400);
await page.screenshot({ path: `${OUT}/p_paint.png` });
await page.click("#phase-next"); // race
await page.waitForTimeout(1400);
await page.screenshot({ path: `${OUT}/p_intro.png` });
await page.waitForTimeout(2800);
await page.screenshot({ path: `${OUT}/p_race.png` });

// throw toward first bend a few times, screenshot island landing if it happens
const snap = () => page.evaluate(() => {
  const S = window.__skimmers;
  const p = S.G.player;
  return { state: p.state, winner: S.G.holeWinner?.name ?? null, camMode: S.cam.mode,
    fishing: !!document.querySelector("#fishing-ui:not(.hidden)"), pos: [p.pos.x|0, p.pos.z|0] };
});
let islandShot = false;
const t0 = Date.now();
while (Date.now() - t0 < 90000) {
  const s = await snap();
  if (s.winner) break;
  if (s.state === "beached" && !islandShot) {
    islandShot = true;
    await page.waitForTimeout(600);
    await page.screenshot({ path: `${OUT}/p_island.png` });
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
    // medium power, slight left bias toward the first bend
    await page.mouse.move(640, 420);
    await page.mouse.down();
    await page.mouse.move(660 + Math.random()*40, 590, { steps: 8 });
    await page.waitForTimeout(80);
    await page.mouse.up();
    await page.waitForTimeout(600);
  } else await page.waitForTimeout(300);
}
await page.screenshot({ path: `${OUT}/p_end.png` });
console.log(JSON.stringify({ errors, islandShot, final: await snap() }, null, 2));
await browser.close();

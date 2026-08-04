// Photograph the ` debug menu and drive its level jumper, which is the only way
// to see that the section refreshes against a live race rather than a snapshot.
//
// Usage: node scripts/shot-tweakmenu.mjs [outDir] [port]
import { chromium } from "playwright";

const out = process.argv[2] || "/tmp/tweakmenu";
const port = process.argv[3] || "8751";

const browser = await chromium.launch({
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--ignore-gpu-blocklist"],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const problems = [];
page.on("console", (m) => { if (m.type() === "error") problems.push(m.text()); });
page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));

await page.goto(`http://localhost:${port}/`, { waitUntil: "networkidle" });
await page.waitForTimeout(1500);

const panel = "#tweak-menu";
await page.keyboard.press("`");
await page.waitForTimeout(300);
await page.screenshot({ path: `${out}/1-closed-sections.png` });

// the sections are foldaway, so prove one opens
await page.locator(`${panel} summary`, { hasText: "Water" }).click();
await page.waitForTimeout(200);
await page.screenshot({ path: `${out}/2-water-open.png` });
await page.locator(`${panel} summary`, { hasText: "Water" }).click();

// unlock, then check the save actually says every cup is a win
await page.locator(`${panel} button`, { hasText: "Unlock everything" }).click();
await page.waitForTimeout(200);
const meta = await page.evaluate(() => JSON.parse(localStorage.getItem("skippidy.meta.v1")));
console.log(`records after unlock: ${Object.keys(meta.records).length}`,
  `· all firsts: ${Object.values(meta.records).every((v) => v === 1)}`,
  `· upgrades: ${meta.upgrades.length} · shells: ${meta.shells}`);
await page.screenshot({ path: `${out}/3-unlocked.png` });

// the level list needs a race on, so walk the normal way in (see shot-ferry)
await page.keyboard.press("`");
await page.click("#play-btn");
await page.waitForTimeout(1200);
await page.evaluate(() => window.__skimmers.pickSlot(0));
await page.waitForTimeout(1200);
await page.evaluate(() => window.__skimmers.selectCandidate(0));
for (let i = 0; i < 12; i++) {
  await page.waitForTimeout(700);
  const done = await page.evaluate(() => {
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
const state = await page.evaluate(() => window.__skimmers.G.state);
if (state !== "race") { problems.push(`never reached the race (stuck in "${state}")`); }
await page.evaluate(() => { window.__skimmers.G.bots.length = 0; window.__skimmers.G.holeTime = 9999; });
await page.keyboard.press("`");
await page.waitForTimeout(400);
await page.screenshot({ path: `${out}/4-holes.png` });

// step forward and see the highlight move
await page.locator(`${panel} button`, { hasText: "Next ›" }).click();
await page.waitForTimeout(2200);
await page.screenshot({ path: `${out}/5-next-hole.png` });
const at = await page.evaluate(() => window.__skimmers.G.hole);
console.log(`after Next: hole index ${at}`);

// and jump the race onto a different cup entirely
await page.selectOption(`${panel} select >> nth=0`, { label: "Cataract Cup" });
await page.locator(`${panel} button`, { hasText: "Race this cup" }).click();
await page.waitForTimeout(2500);
await page.screenshot({ path: `${out}/6-other-cup.png` });
const cup = await page.evaluate(() => ({ cup: window.__skimmers.G.cup.id, hole: window.__skimmers.G.hole }));
console.log(`after cup swap: ${cup.cup} hole ${cup.hole}`);

console.log(problems.length ? `CONSOLE ERRORS:\n${[...new Set(problems)].join("\n")}` : "no console errors");
await browser.close();
process.exit(problems.length ? 1 : 0);

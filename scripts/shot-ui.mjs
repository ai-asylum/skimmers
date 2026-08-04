// Photograph the meta screens, which is the only way to check a skin.
//
// Walks a fresh save all the way to a kitted-out stone: make a rock, name it,
// back out to the bench, pick it up, open the garage. That path is long but it
// is the real one — faking the state gets you screens the game never shows.
//
// Usage: node scripts/shot-ui.mjs [outDir] [port] [--poor]
//   --poor  a small purse and nothing owned, so cards show prices and locks
import { chromium } from "playwright";

const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith("--")));
const [out = "/tmp/ui", port = "8752"] = args.filter((a) => !a.startsWith("--"));
const poor = flags.has("--poor");

const browser = await chromium.launch({
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--ignore-gpu-blocklist"],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const problems = [];
page.on("console", (m) => { if (m.type() === "error") problems.push(m.text()); });
page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));

// `animations: "disabled"` is tempting for stable diffs but hangs here: the
// cosmetic previews drive a WebGL pass every frame, so the page never reaches
// the settled state it waits for.
const shot = (n) => page.screenshot({ path: `${out}/${n}.png`, timeout: 15000 });

await page.goto(`http://localhost:${port}/`, { waitUntil: "networkidle" });
await page.waitForTimeout(1600);

// the chrome is git-ignored art; say so plainly rather than shooting bare boxes
const bare = await page.evaluate(async () => (await import("/src/cb/index.js")).chromeMissing());
if (bare) {
  console.error("no Casual Blue art on disk — run `npm run cb:sync` (NOTICE-casual-blue.md)");
  await browser.close();
  process.exit(1);
}

await page.evaluate((rich) => {
  const m = window.__skimmers.meta;
  m.resetMeta();
  m.addShells(rich ? 9999 : 260);
}, !poor);
await page.reload({ waitUntil: "networkidle" });
await page.waitForTimeout(1600);
if (!poor) {
  await page.keyboard.press("`");
  await page.waitForTimeout(300);
  await page.locator("#tweak-menu button", { hasText: "Unlock everything" }).click();
  await page.waitForTimeout(300);
  await page.keyboard.press("`");
  await page.waitForTimeout(300);
} else {
  await page.evaluate(() => window.__skimmers.meta.addShells(260));
}

await shot("0-title");

await page.click("#play-btn");
await page.waitForTimeout(1600);

// no stone on the shelf yet on a fresh save, so make one
await page.evaluate(() => window.__skimmers.pickSlot(0));
await page.waitForTimeout(1500);
await page.evaluate(() => window.__skimmers.selectCandidate(0));
for (let i = 0; i < 16; i++) {
  await page.waitForTimeout(600);
  if (await page.evaluate(() => window.__skimmers.G.state === "name")) break;
  const btn = await page.$("#phase-next:not(.hidden)");
  if (btn && (await btn.isVisible())) await btn.click();
}
await shot("1-phase");

// naming banks it and opens the cup picker; step back to the bench from there
await page.evaluate(() => window.__skimmers.confirmName());
await page.waitForTimeout(1300);
await shot("2-cups");
await page.click("#cup-close");
await page.waitForTimeout(1800);
await page.evaluate(() => window.__skimmers.pickSlot(0));
await page.waitForTimeout(1200);
await shot("3-bench");
await page.locator("#shell-hud").screenshot({ path: `${out}/3b-shells.png` });

await page.click("#garage-btn");
await page.waitForTimeout(1100);
await shot("4-garage");

// fill the sockets; the grid scrolls under them so fire the handler directly
for (const i of [0, 1]) {
  await page.evaluate((n) => document.querySelectorAll("#garage-grid .card")[n].click(), i);
  await page.waitForTimeout(650);
}
await page.waitForTimeout(600);
await shot("5-garage-fitted");
await page.locator("#garage-sockets").screenshot({ path: `${out}/5b-sockets.png` });
await page.locator("#garage-tabs").screenshot({ path: `${out}/5c-tabs.png` });
await page.locator("#garage-grid .card >> nth=0").screenshot({ path: `${out}/5d-card.png` });

for (const [id, label] of [["hat", "Hats"], ["floater", "Floaters"], ["trail", "Trails"]]) {
  await page.locator(".meta-tab", { hasText: label }).click();
  await page.waitForTimeout(1200);
  await shot(`6-${id}`);
}

console.log(problems.length ? `CONSOLE ERRORS:\n${[...new Set(problems)].join("\n")}` : "no console errors");
await browser.close();
process.exit(problems.length ? 1 : 0);

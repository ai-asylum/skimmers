/**
 * Walks the rock-bench flow and grabs a shot at each stop:
 *   1-empty.png  the empty bench you land on from the title
 *   2-find.png   after tapping an empty floater (camera pans to the beach)
 *   3-name.png   the naming step at the end of the paint booth
 *   4-saved.png  a fresh page load: the saved rock waiting in its floater
 *
 * Usage: node scripts/shot-shelf.mjs [outDir] [port]
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const out = process.argv[2] || "/tmp/shelf";
const port = process.argv[3] || "8741";
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: 1100, height: 620 } });
const logs = [];
page.on("console", (m) => logs.push(`${m.type()}: ${m.text()}`));
page.on("pageerror", (e) => logs.push(`pageerror: ${e.message}`));

// No HMR, please: a save in any source file mid-walk reloads the page and throws
// the run back to the title screen.
await page.route("**/@vite/client", (r) => r.abort());

const shot = async (name) => { await page.screenshot({ path: `${out}/${name}.png` }); console.log("shot", name); };
const visible = async (sel) => { const el = await page.$(sel); return !!el && el.isVisible(); };
// the floaters bob, so they never hold still long enough for a selector-based
// click — ask the game where slot `i` is right now and aim the mouse there
const clickSlot = async (i) => {
  const at = await page.evaluate((n) => {
    const S = window.__skimmers;
    const s = S.worldToScreen(S.bench.slotPoint(n));
    return { x: s.x, y: s.y };
  }, i);
  await page.mouse.click(at.x, at.y);
};

await page.goto(`http://localhost:${port}/`, { waitUntil: "networkidle" });
await page.evaluate(() => localStorage.removeItem("skippidy.shelf.v1"));
await page.reload({ waitUntil: "networkidle" });
await page.waitForTimeout(900);

// title -> bench
await (await page.$("#play-btn")).click();
await page.waitForTimeout(2600);
await shot("1-empty");

// tap the middle empty floater -> pan to the beach (software GL runs the pan in
// slow motion, so give it plenty of room to arrive)
await clickSlot(1);
await page.waitForTimeout(14000);
await shot("2-find");

// click one of the candidates where it actually is on screen
const at = await page.evaluate(() => {
  const S = window.__skimmers;
  if (S.G.state !== "find") throw new Error(`expected find, got ${S.G.state}`);
  const r = S.G.candidates[2] ?? S.G.candidates[0];
  const s = S.worldToScreen(r.group.position.clone());
  return { x: s.x, y: s.y };
});
await page.mouse.click(at.x, at.y);
await page.waitForTimeout(500);
if (!(await visible("#phase-next"))) throw new Error("candidate click missed");
await page.click("#phase-next"); // shape
await page.waitForTimeout(1400);
await page.click("#phase-next"); // paint
await page.waitForTimeout(1200);
await page.click("#phase-next"); // name
await page.waitForTimeout(900);
// the box must not steal focus on its own — that pops the phone keyboard up
// over the stone you just painted
if (await page.evaluate(() => document.activeElement?.id === "name-input")) {
  throw new Error("name box autofocused");
}
await page.fill("#name-input", "Chonk McSkip");
await shot("3-name");
await page.click("#name-ok");
await page.waitForTimeout(1200);

const saved = await page.evaluate(() => localStorage.getItem("skippidy.shelf.v1"));
console.log("saved slots:", JSON.parse(saved).map((s) => s && s.name));

// reload: the stone should be sitting on the bench
await page.goto(`http://localhost:${port}/`, { waitUntil: "networkidle" });
await page.waitForTimeout(900);
await (await page.$("#play-btn")).click();
await page.waitForTimeout(2800);
await shot("4-saved");
await page.evaluate(() => document.querySelectorAll("#shelf-tags .rock-tag").length).then((n) => console.log("tags:", n));

await browser.close();
if (logs.length) console.log("--- console ---\n" + logs.join("\n"));

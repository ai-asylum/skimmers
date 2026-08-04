/**
 * Photograph the admin Level Editor on the furnished holes, so the plan-view
 * markers for falls, dams, logs, caves, rapids, ice and weeds can be checked
 * against what props.js actually builds.
 *
 *   node scripts/shot-editor.mjs [url] [outDir]
 */
import { chromium } from "playwright";

const url = process.argv[2] || "http://localhost:8742/admin.html";
const dir = process.argv[3] || "/tmp";
const holes = (process.argv[4] || "10,11,12,13").split(",").map(Number);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 980 } });
const logs = [];
page.on("console", (m) => { if (m.type() === "error") logs.push(`[console] ${m.text()}`); });
page.on("pageerror", (e) => logs.push(`[pageerror] ${e.message}`));

// always start from the shipped holes, not yesterday's draft
await page.addInitScript(() => localStorage.removeItem("skippidy.holes.draft"));
await page.goto(url, { waitUntil: "networkidle" });
await page.waitForSelector(".lvl-stage canvas");

async function goTo(target) {
  await page.evaluate((want) => {
    const label = document.querySelector('[data-el="holeLabel"]');
    const next = document.querySelector('[data-act="next"]');
    const prev = document.querySelector('[data-act="prev"]');
    for (let i = 0; i < 40; i++) {
      const at = +label.textContent.match(/Hole (\d+)/)[1];
      if (at === want) return;
      (at < want ? next : prev).click();
    }
  }, target);
  await page.waitForTimeout(250);
}

for (const n of holes) {
  await goTo(n);
  await page.locator(".lvl-wrap").screenshot({ path: `${dir}/editor-${n}.png` });
  console.log(`hole ${n} → ${dir}/editor-${n}.png`);
}

// and the placing tool open, on its list
await page.click('[data-tool="addProp"]');
await page.waitForTimeout(150);
await page.locator(".lvl-side").screenshot({ path: `${dir}/editor-tools.png` });
console.log(`tools → ${dir}/editor-tools.png`);

// drop a bridge out on the grass, which the rules should object to at once
const box = await page.locator(".lvl-stage canvas").boundingBox();
await page.selectOption('[data-el="propKind"]', "bridges");
await page.mouse.click(box.x + box.width * 0.25, box.y + box.height * 0.25);
await page.waitForTimeout(150);
await page.locator(".lvl-stage").screenshot({ path: `${dir}/editor-warn.png` });
console.log(`warnings → ${dir}/editor-warn.png`);

// And draw a shortcut by hand on a hole that has none: tap the river to fork
// off it, tap out across the inside of its bend, tap the river again to
// rejoin. The two end taps should snap onto the line, and the rules should
// have their say about the result while the tool is still open.
await goTo(7); // The Race: one long bend and no shortcut on it yet
const at = (u, v) => [box.x + box.width * u, box.y + box.height * v];
await page.click('[data-tool="addCut"]');
for (const [u, v] of [[0.344, 0.638], [0.5, 0.555], [0.702, 0.564]]) {
  await page.mouse.click(...at(u, v));
  await page.waitForTimeout(120);
}
await page.locator(".lvl-stage").screenshot({ path: `${dir}/editor-cut.png` });
console.log(`hand-drawn shortcut → ${dir}/editor-cut.png`);

console.log("ERRORS:\n" + (logs.join("\n") || "(none)"));
await browser.close();

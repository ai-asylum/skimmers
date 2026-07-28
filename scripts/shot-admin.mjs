import { chromium } from "playwright";

const url = process.argv[2] || "http://localhost:8742/admin.html";
const out = process.argv[3] || "/tmp/admin-shot.png";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 820 } });
const logs = [];
page.on("console", (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on("pageerror", (e) => logs.push(`[pageerror] ${e.message}`));
page.on("requestfailed", (r) => logs.push(`[requestfailed] ${r.url()} ${r.failure()?.errorText}`));

await page.goto(url, { waitUntil: "networkidle" });
await page.waitForTimeout(1200);
// hover the stage so pupils react
const stage = await page.$("#stage");
if (stage) {
  const b = await stage.boundingBox();
  if (b) await page.mouse.move(b.x + b.width * 0.7, b.y + b.height * 0.4);
}
await page.waitForTimeout(400);
await page.screenshot({ path: out });
console.log("CONSOLE/ERRORS:\n" + (logs.join("\n") || "(none)"));
await browser.close();

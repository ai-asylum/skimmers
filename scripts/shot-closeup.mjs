import { chromium } from "playwright";
const out = process.argv[2] || "/tmp/closeup.png";
const cx = parseFloat(process.argv[3] ?? "0.50");
const cy = parseFloat(process.argv[4] ?? "0.47");
const browser = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: 1100, height: 620 } });
await page.goto("http://localhost:8742/", { waitUntil: "networkidle" });
await page.waitForTimeout(900);
await (await page.$("#play-btn"))?.click();
await page.waitForTimeout(2200);
const c = await page.$("#c");
const b = await c.boundingBox();
const nextVisible = async () => {
  const el = await page.$("#phase-next");
  return el && (await el.isVisible());
};
// scan across the beach line until a candidate rock gets selected
outer: for (const yy of [0.47, 0.44, 0.5, 0.42]) {
  for (let i = 0; i < 9; i++) {
    const xx = 0.3 + i * 0.05;
    await page.mouse.click(b.x + b.width * xx, b.y + b.height * yy);
    await page.waitForTimeout(250);
    if (await nextVisible()) break outer;
  }
}
await page.waitForTimeout(800);
// advance to SHAPE (tight closeup on the chosen rock)
if (await nextVisible()) await (await page.$("#phase-next")).click();
await page.waitForTimeout(2600);
// nudge the mouse so pupils gaze
await page.mouse.move(b.x + b.width * 0.6, b.y + b.height * 0.4);
await page.waitForTimeout(400);
await page.screenshot({ path: out });
await browser.close();
console.log("done", out);

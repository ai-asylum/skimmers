// Open the Eyes Lab on one face with the 3D rock view on, and screenshot it.
//   node scripts/shot-eyeslab.mjs determined /tmp/lab.png [port]
import { chromium } from "playwright";

const face = process.argv[2] || "determined";
const out = process.argv[3] || "/tmp/lab.png";
const port = process.argv[4] || "8741";

const browser = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: 1320, height: 900 } });
const logs = [];
page.on("console", (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on("pageerror", (e) => logs.push(`[pageerror] ${e.message}`));

await page.goto(`http://localhost:${port}/admin.html`, { waitUntil: "networkidle" });
await page.evaluate(() => localStorage.removeItem("skippidy.eyes.tuning")); // baked defaults
await page.reload({ waitUntil: "networkidle" });
await page.waitForTimeout(900);
await page.evaluate(() => document.querySelector('.tab[data-tab="eyes"]')?.click());
await page.waitForTimeout(900);

await page.evaluate((f) => {
  const el = [...document.querySelectorAll(".expr-thumb .lbl")].find((s) => s.textContent === f);
  el?.parentElement.click();
}, face);
await page.waitForTimeout(500);
await page.evaluate(() => {
  const cb = document.getElementById("c-3d");
  if (cb && !cb.checked) { cb.checked = true; cb.dispatchEvent(new Event("change")); }
});
await page.waitForTimeout(2200);
await page.screenshot({ path: out });
console.log("CONSOLE:\n" + (logs.filter((l) => !/vite|WebGL/i.test(l)).join("\n") || "(none)"));
await browser.close();
console.log("done", out);

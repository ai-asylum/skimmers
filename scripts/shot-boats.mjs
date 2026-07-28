// One sheet of every boat with its collision solid drawn on, plus the numbers
// the game derived, so a model swap or a tweak to the TYPES table in
// src/boats.js can be eyeballed. Needs the dev server up.
// Usage: node scripts/shot-boats.mjs [url] [outPng]
import { chromium } from "playwright";

const url = process.argv[2] || "http://localhost:8741/boats.html";
const out = process.argv[3] || "/tmp/boats-preview.png";

const browser = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: 1700, height: 1000 } });
const logs = [];
page.on("console", (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on("pageerror", (e) => logs.push(`[pageerror] ${e.message}`));

await page.goto(url, { waitUntil: "networkidle" });
await page.waitForFunction(() => window.__done === true, null, { timeout: 60000 }).catch(() => {});
await page.waitForTimeout(500);

const report = await page.evaluate(() => window.__report);
console.log(JSON.stringify(report, null, 2));
await page.screenshot({ path: out, fullPage: true });
if (logs.length) console.log("LOGS:\n" + logs.join("\n"));
await browser.close();

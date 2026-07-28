import { chromium } from "playwright";

const url = process.argv[2] || "http://localhost:8742/";
const out = process.argv[3] || "/tmp/game-shot.png";

const browser = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: 1100, height: 620 } });
const logs = [];
page.on("console", (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on("pageerror", (e) => logs.push(`[pageerror] ${e.message}`));

await page.goto(url, { waitUntil: "networkidle" });
await page.waitForTimeout(1000);
// start Solo -> goes to FIND phase where candidate rocks are shown
const solo = await page.$("#play-btn");
if (solo) await solo.click();
await page.waitForTimeout(2500);
await page.screenshot({ path: out });
console.log("LOGS:\n" + logs.filter((l) => !/webgl|vite connect/i.test(l)).join("\n"));
await browser.close();

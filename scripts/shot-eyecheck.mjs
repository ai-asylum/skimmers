// Headless shot of eyecheck.html — every expression with its pupils, to see at
// a glance that each one sits inside its eye white.
//   node scripts/shot-eyecheck.mjs [out.png] [port]
import { chromium } from "playwright";

const out = process.argv[2] || "/tmp/eyecheck.png";
const port = process.argv[3] || "8741";

const browser = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
const logs = [];
page.on("console", (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on("pageerror", (e) => logs.push(`[pageerror] ${e.message}`));
await page.goto(`http://localhost:${port}/eyecheck.html`, { waitUntil: "networkidle" });
await page.waitForTimeout(2500);
await page.screenshot({ path: out });
console.log("CONSOLE:\n" + (logs.filter((l) => !/vite|WebGL/i.test(l)).join("\n") || "(none)"));
await browser.close();
console.log("done", out);

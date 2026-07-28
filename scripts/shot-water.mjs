// Drive the solo flow all the way into a race and capture the two views that
// matter for the water shader: the wide title lake and the in-race channel.
import { chromium } from "playwright";

const url = process.argv[2] || "http://localhost:8791/index.html";
const tag = process.argv[3] || "shot";

const browser = await chromium.launch({
  args: ["--use-angle=metal", "--ignore-gpu-blocklist", "--enable-unsafe-swiftshader"],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 760 } });
const logs = [];
page.on("console", (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on("pageerror", (e) => logs.push(`[pageerror] ${e.message}`));

await page.goto(url, { waitUntil: "networkidle" });
await page.waitForTimeout(2500);
await page.screenshot({ path: `/tmp/${tag}-title.png` });

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
    await page.mouse.click(b.x + b.width * (0.3 + i * 0.05), b.y + b.height * yy);
    await page.waitForTimeout(250);
    if (await nextVisible()) break outer;
  }
}

// FIND -> SHAPE -> PAINT -> RACE
for (let i = 0; i < 3; i++) {
  if (await nextVisible()) await (await page.$("#phase-next")).click();
  await page.waitForTimeout(i === 2 ? 4500 : 2200);
  if (i === 1) await page.screenshot({ path: `/tmp/${tag}-shore.png` });
}
await page.screenshot({ path: `/tmp/${tag}-race.png` });

console.log(`wrote /tmp/${tag}-{title,shore,race}.png`);
const noise = /webgl|vite|analytics|Download the React/i;
const keep = logs.filter((l) => !noise.test(l));
console.log(keep.length ? "LOGS:\n" + keep.join("\n") : "no notable logs");
await browser.close();

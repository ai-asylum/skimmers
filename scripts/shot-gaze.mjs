// Drive a solo match to the race and grab a close shot of the stones on the
// water, to eyeball where the pupils are pointing.
//   node scripts/shot-gaze.mjs [out.png] [port]
import { chromium } from "playwright";

const out = process.argv[2] || "/tmp/gaze.png";
const port = process.argv[3] || "8741";
const browser = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: 1100, height: 620 } });
page.on("pageerror", (e) => console.log("[err]", e.message));
page.on("console", (m) => { if (m.type() === "error") console.log("[console]", m.text()); });

await page.goto(`http://localhost:${port}/`, { waitUntil: "networkidle" });
await page.waitForTimeout(1200);

const phase = async () => page.evaluate(() => {
  const vis = (id) => {
    const el = document.getElementById(id);
    return el ? !el.classList.contains("hidden") && getComputedStyle(el).display !== "none" : "no-el";
  };
  return {
    title: vis("title-screen"), phaseUi: vis("phase-ui"),
    next: vis("phase-next"), hud: vis("race-hud"),
  };
});

await page.evaluate(() => document.getElementById("play-btn")?.click());
await page.waitForTimeout(2500);
console.log("after solo:", await phase());

const c = await page.$("#c");
const b = await c.boundingBox();
// FIND: click along the beach until a candidate is picked, then advance
outer: for (const yy of [0.47, 0.44, 0.52, 0.4]) {
  for (let i = 0; i < 10; i++) {
    await page.mouse.click(b.x + b.width * (0.28 + i * 0.05), b.y + b.height * yy);
    await page.waitForTimeout(220);
    if ((await phase()).next) break outer;
  }
}
console.log("after find:", await phase());

// SHAPE -> PAINT -> RACE, each behind the same Next button
for (let i = 0; i < 3; i++) {
  await page.evaluate(() => document.getElementById("phase-next")?.click());
  await page.waitForTimeout(2200);
  console.log(`next #${i + 1}:`, await phase());
  await page.screenshot({ path: out.replace(/\.png$/, `-step${i + 1}.png`) });
}

await page.waitForTimeout(3500); // let the stones settle and glance around
await page.screenshot({ path: out });
await browser.close();
console.log("done", out);

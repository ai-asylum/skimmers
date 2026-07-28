/**
 * Shots of the garage's dressing-up box, for eyeballing the live 3D card
 * previews (cosmeticpreview.js):
 *   1-hats.png      the hat rack
 *   2-floaters.png  the floater wall
 *   3-trails.png    the trails, mid-flight
 *   4-scrolled.png  the hat rack scrolled, to prove the previews are clipped
 *
 * Every item is bought first so nothing is greyed out. Usage:
 *   node scripts/shot-garage.mjs [outDir] [port]
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const out = process.argv[2] || "/tmp/garage";
const port = process.argv[3] || "8741";
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: 1100, height: 620 } });
const logs = [];
page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") logs.push(`${m.type()}: ${m.text()}`); });
page.on("pageerror", (e) => logs.push(`pageerror: ${e.message}`));
await page.route("**/@vite/client", (r) => r.abort());

const ok = (cond, msg) => console.log(`${cond ? "ok  " : "FAIL"}: ${msg}`);
const shot = async (name) => {
  const panel = await page.$("#garage-ui .meta-panel");
  await (panel ?? page).screenshot({ path: `${out}/${name}.png` });
  console.log("shot", name);
};

await page.goto(`http://localhost:${port}/`, { waitUntil: "networkidle" });
await page.evaluate(() => {
  localStorage.setItem("skippidy.shelf.v1", JSON.stringify([
    { name: "Chonk", cfg: { seed: 4242 }, born: Date.now() }, null, null,
  ]));
  localStorage.removeItem("skippidy.meta.v1");
});
await page.reload({ waitUntil: "networkidle" });
await page.waitForTimeout(900);
await page.evaluate(() => window.__skimmers.meta.addShells(90000));

await page.click("#play-btn");
await page.waitForTimeout(2800);
const slotAt = await page.evaluate((n) => {
  const S = window.__skimmers;
  const s = S.worldToScreen(S.bench.slotPoint(n));
  return { x: s.x, y: s.y };
}, 0);
await page.mouse.click(slotAt.x, slotAt.y);
await page.waitForTimeout(900);
await page.click("#garage-btn");
await page.waitForTimeout(700);
ok(await page.isVisible("#garage-ui"), "garage opened");

const tab = async (re) => {
  await page.evaluate((src) => [...document.querySelectorAll("#garage-tabs .meta-tab")]
    .find((t) => new RegExp(src, "i").test(t.textContent))?.click(), re);
  await page.waitForTimeout(500);
};

/** own the lot, so every card is drawn in its bought state */
const buyAll = async () => {
  for (let i = 0; i < 14; i++) {
    const left = await page.evaluate(() => {
      const c = document.querySelector("#garage-grid .card.locked");
      if (!c) return 0;
      c.click();
      return 1;
    });
    if (!left) break;
    await page.waitForTimeout(160);
  }
};

for (const [n, name] of [[1, "hats"], [2, "floaters"], [3, "trails"]]) {
  await tab(name);
  await buyAll();
  await page.waitForTimeout(1400); // let the trails get airborne
  const live = await page.$$eval("#garage-grid .card-shot.live", (e) => e.length);
  const cards = await page.$$eval("#garage-grid .card", (e) => e.length);
  ok(live === cards, `${name}: every card has a 3D slot (${live}/${cards})`);
  await shot(`${n}-${name}`);
}

// scrolled: the previews must ride along and stop at the edge of the grid
await tab("hats");
await page.evaluate(() => { document.getElementById("garage-grid").scrollTop = 60; });
await page.waitForTimeout(500);
await shot("4-scrolled");

const cost = await page.evaluate(() => {
  const t0 = performance.now();
  return new Promise((res) => {
    let n = 0;
    const tick = () => (++n < 60 ? requestAnimationFrame(tick) : res((performance.now() - t0) / n));
  requestAnimationFrame(tick);
  });
});
console.log(`      ${cost.toFixed(1)} ms/frame with the garage open (swiftshader)`);

await browser.close();
if (logs.length) console.log("--- console ---\n" + logs.join("\n"));

// Photograph the hole that forks (src/holes.js 12, "The Split") in a real
// browser. Everything about a branch that can go wrong goes wrong on the GPU or
// in a terrain rebuild — the water is a shader union of capsules now, and the
// ground is carved against whichever channel is nearest — so none of it can be
// checked headless. This stands the camera at the fork, down each line, and on
// the island that has to exist between them.
//
// Usage: node scripts/shot-fork.mjs [outDir] [port]
import { chromium } from "playwright";

const out = process.argv[2] || "/tmp/fork";
const port = process.argv[3] || "8741";
const HOLE = 12; // "The Split", last rung of the ladder in src/holes.js

const browser = await chromium.launch({
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--ignore-gpu-blocklist"],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const problems = [];
page.on("console", (m) => { if (m.type() === "error") problems.push(m.text()); });
page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));

await page.goto(`http://localhost:${port}/`, { waitUntil: "networkidle" });
await page.waitForTimeout(1200);

const err = await page.evaluate(([h]) => {
  const S = window.__skimmers;
  try { S.setupHole(h); return null; } catch (e) { return String(e); }
}, [HOLE]);
if (err) {
  console.log(`setupHole(${HOLE}) threw: ${err}`);
  await browser.close();
  process.exit(1);
}
await page.waitForTimeout(1000);

const shots = [
  // standing at the fork looking down both lines at once
  ["fork-mouth", [-62, 26, 30], [-30, 2, 26]],
  // high enough to see that they are two rivers with a bank in between
  ["fork-overview", [-16, 92, 34], [-14, 0, 30]],
  // down the gut, past the fallen tree
  ["gut-entry", [-52, 11, 16], [-20, 2, 14]],
  ["gut-run", [-24, 9, 6], [20, 2, 20]],
  // and the long way round, with the white water at the top of the bend
  ["main-bend", [-24, 14, 40], [12, 3, 50]],
  ["rejoin", [66, 16, 6], [40, 2, 26]],
];

for (const [name, eye, at] of shots) {
  await page.evaluate(([e, p]) => {
    const S = window.__skimmers;
    S.cam.mode = "closeup";
    S.cam.pos.set(e[0], e[1], e[2]);
    S.cam.look.set(p[0], p[1], p[2]);
    S.camRig.position.copy(S.cam.pos);
    S.cam.lookCur.copy(S.cam.look);
    S.camRig.lookAt(S.cam.lookCur);
    for (const el of document.body.children) {
      if (el.tagName !== "CANVAS") el.style.visibility = "hidden";
    }
  }, [eye, at]);
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${out}/${name}.png` });
  console.log(`shot ${name}`);
}

// the minimap has to show the fork too, so take it with the HUD back on
await page.evaluate(() => {
  for (const el of document.body.children) el.style.visibility = "";
});
await page.waitForTimeout(400);
await page.screenshot({ path: `${out}/hud.png` });
console.log("shot hud");

console.log(problems.length ? `CONSOLE ERRORS:\n${[...new Set(problems)].join("\n")}` : "no console errors");
await browser.close();
process.exit(problems.length ? 1 : 0);

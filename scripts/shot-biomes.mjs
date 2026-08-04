// Photograph every biome (src/biomes.js) on the same hole, from the same spot,
// so the only thing that changes between the shots is the weather. All of it is
// shader uniforms, lights and rebaked vertex colours, so none of it can be
// checked headless.
//
// Usage: node scripts/shot-biomes.mjs [outDir] [port] [holeIndex]
import { chromium } from "playwright";

const out = process.argv[2] || "/tmp/biomes";
const port = process.argv[3] || "8741";
const hole = Number(process.argv[4] ?? 0);

const browser = await chromium.launch({
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--ignore-gpu-blocklist"],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const problems = [];
page.on("console", (m) => { if (m.type() === "error") problems.push(m.text()); });
page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));

await page.goto(`http://localhost:${port}/`, { waitUntil: "networkidle" });
await page.waitForTimeout(1200);

const ids = await page.evaluate(() => window.__skimmers.BIOME_IDS);
if (!ids) {
  console.log("no window.__skimmers.BIOME_IDS — is main.js exposing the biomes?");
  await browser.close();
  process.exit(1);
}

// down the opening leg of hole 1: sky, treeline, bank and open water in one frame
const eye = [10, 22, 96], at = [-4, 0, 30];

for (const id of ids) {
  const err = await page.evaluate(([h, b, e, p]) => {
    const S = window.__skimmers;
    try {
      S.setupHole(h);
      // setupHole leaves the flyover's haze override armed, holding the fog of
      // the hole's *own* biome; camUpdate pours that back over the next few
      // frames and would repaint the fog we are about to set. Since the fog is
      // most of the horizon, that had every biome photographed in meadow's sky.
      S.cam.introFog = null;
      S.cam.introHaze = 1;
      S.applyBiome(b, { world: S.world, water: S.water });
      S.world.terrain.rebuild();
      S.world.trees.setHole();
      S.world.foliage.setHole();
      S.world.grass.setHole();
      S.cam.mode = "closeup";
      S.cam.pos.set(e[0], e[1], e[2]);
      S.cam.look.set(p[0], p[1], p[2]);
      S.camRig.position.copy(S.cam.pos);
      S.cam.lookCur.copy(S.cam.look);
      S.camRig.lookAt(S.cam.lookCur);
      for (const el of document.body.children) {
        if (el.tagName !== "CANVAS") el.style.visibility = "hidden";
      }
      return null;
    } catch (ex) { return String(ex); }
  }, [hole, id, eye, at]);
  if (err) { problems.push(`${id}: ${err}`); continue; }
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${out}/${id}.png` });
  console.log(`shot ${id} (hole ${hole + 1})`);
}

console.log(problems.length ? `CONSOLE ERRORS:\n${[...new Set(problems)].join("\n")}` : "no console errors");
await browser.close();
process.exit(problems.length ? 1 : 0);

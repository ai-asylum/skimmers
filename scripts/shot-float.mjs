// Check the player's float: the inflatable donut should come out under the
// stone wherever it stops on open water (not just after a fishing catch), and
// it should ride the current downstream with the stone still nestled in it.
//
// Usage: node scripts/shot-float.mjs [outDir] [port]
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const out = process.argv[2] || "/tmp/float";
const port = process.argv[3] || "8741";
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--ignore-gpu-blocklist"],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const problems = [];
// the dev server's HMR socket drops when the page is torn down; that is not a
// fault of the thing under test
page.on("console", (m) => {
  if (m.type() === "error" && !/ERR_CONNECTION_REFUSED/.test(m.text())) problems.push(m.text());
});
page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));

await page.goto(`http://localhost:${port}/`, { waitUntil: "networkidle" });
// a stone already on the bench, so the walk to the start line is two clicks
await page.evaluate(() => {
  localStorage.setItem("skippidy.shelf.v1", JSON.stringify([
    { name: "Chonk", cfg: { seed: 4242 }, born: Date.now() }, null, null,
  ]));
});
await page.reload({ waitUntil: "networkidle" });
await page.waitForTimeout(1200);

await page.click("#play-btn");
await page.waitForTimeout(2800);
await page.evaluate(() => window.__skimmers.pickSlot(0));
await page.waitForTimeout(900);
await page.click("#phase-next");
await page.waitForTimeout(800);
// the picker is three steps — cup, class, start plate — and #cup-go walks them
for (let i = 0; i < 3; i++) { await page.click("#cup-go"); await page.waitForTimeout(200); }
await page.waitForTimeout(3500);

// Park the player mid-channel with a throw on the clock, so this is a lie the
// river has hold of rather than the tee pontoon — and set the hole running
// whichever cup the save happens to open on, since the drift needs a current.
const park = await page.evaluate(async () => {
  const S = window.__skimmers;
  const { setWaterFlow, isWaterAt } = await import("/src/water.js");
  setWaterFlow(4);
  const p = S.G.player;
  p.throws = 1;
  // open water with nothing in shot: walk the centreline and take the point
  // furthest from any island, so the camera isn't staring at a beach
  const hole = S.course[S.G.hole];
  const isles = hole.islands ?? [];
  let best = null;
  for (let i = 0; i < hole.path.length - 1; i++) {
    const a = hole.path[i], b = hole.path[i + 1];
    for (let t = 0; t < 1; t += 0.05) {
      const q = { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t };
      if (!isWaterAt(q.x, q.z)) continue;
      // out in the middle of the hole: not into the cup, not back among the
      // rivals still waiting their turn on the tee pontoon
      const tee = hole.path[0], flag = hole.path.at(-1);
      if (Math.hypot(q.x - flag.x, q.z - flag.z) < 30) continue;
      if (Math.hypot(q.x - tee.x, q.z - tee.z) < 40) continue;
      q.clear = Math.min(999, ...isles.map((o) => Math.hypot(q.x - o.x, q.z - o.z) - o.r));
      if (!best || q.clear > best.clear) best = q;
    }
  }
  p.placeAt(best.x, best.z);
  return { x: best.x, z: best.z };
});

const track = () => page.evaluate(() => {
  const S = window.__skimmers;
  const p = S.G.player;
  const b = S.fishing.buoy;
  return {
    state: p.state, afloat: p.afloat, restY: +p.restY.toFixed(3),
    rock: [+p.pos.x.toFixed(2), +p.pos.y.toFixed(2), +p.pos.z.toFixed(2)],
    out: b.visible, scale: +b.scale.x.toFixed(2),
    buoy: [+b.position.x.toFixed(2), +b.position.y.toFixed(2), +b.position.z.toFixed(2)],
  };
});

console.log(`parked at ${park.x.toFixed(1)}, ${park.z.toFixed(1)}`);
for (let i = 0; i < 6; i++) {
  await page.waitForTimeout(500);
  console.log(JSON.stringify(await track()));
}

const shot = async (name) => {
  await page.evaluate(() => {
    const S = window.__skimmers;
    const p = S.G.player;
    S.G.holeWinner = S.G.player; // pins cam.mode so the race loop stops grabbing it
    S.cam.mode = "closeup";
    S.cam.pos.set(p.pos.x + 2.6, p.pos.y + 1.0, p.pos.z + 2.9);
    S.cam.look.copy(p.pos);
    S.camRig.position.copy(S.cam.pos);
    S.cam.lookCur.copy(S.cam.look);
    S.camRig.lookAt(S.cam.lookCur);
    for (const el of document.body.children) {
      if (el.tagName !== "CANVAS") el.style.visibility = "hidden";
    }
  });
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${out}/${name}.png` });
  console.log("shot", name);
};
await shot("float-drifting");

// and it goes away again the moment the stone is not floating
await page.evaluate(() => {
  const S = window.__skimmers;
  S.G.player.state = "beached";
});
await page.waitForTimeout(400);
console.log("beached:", JSON.stringify(await track()));

console.log(problems.length ? `CONSOLE ERRORS:\n${[...new Set(problems)].join("\n")}` : "no console errors");
await browser.close();
process.exit(problems.length ? 1 : 0);

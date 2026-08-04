// Photograph the furnished holes in a real browser: the waterfall terraces,
// mill wheels, bridges, cave, fallen timber and white water. Anything
// that only exists in a shader or a terrain rebuild can't be checked headless,
// so this drops the camera on each prop in turn and shouts about console
// errors. Hole numbers are indices into the ladder in src/holes.js, so they
// move when a rung is inserted.
//
// Usage: node scripts/shot-props.mjs [outDir] [port]
import { chromium } from "playwright";

const out = process.argv[2] || "/tmp/props";
const port = process.argv[3] || "8741";

const browser = await chromium.launch({
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--ignore-gpu-blocklist"],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const problems = [];
page.on("console", (m) => { if (m.type() === "error") problems.push(m.text()); });
page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));

await page.goto(`http://localhost:${port}/`, { waitUntil: "networkidle" });
await page.waitForTimeout(1200);

// Skip the whole craft-a-stone flow: setupHole is exported on the debug handle,
// so the course can be swapped underneath the running game.
// [name, hole index, camera, look-at] — poses are hand-picked to stand
// downstream of each prop, because the flow direction is what decides which
// side of it is worth looking at
const shots = [
  ["stepwater-first", 1, [56, 12, -62], [45, 3, -52]],
  ["stepwater-middle", 1, [16, 9, -50], [6, 3, -38]],
  ["bridgeworks-trestle", 2, [38, 9, 2], [22, 3, -16]],
  ["cataract-lip", 3, [10, 15, -12], [-1, 8, 12]],
  ["cataract-pool", 3, [-3, 11, -58], [2, 3, -33]],
  ["millrace-wheel", 4, [30, 10, -10], [16, 3, 7]],
  ["millrace-weir", 4, [-40, 11, 44], [-61, 4, 34]],
  ["wheel-closeup", 4, [24, 5, 2], [16, 3, 7]],
  ["undertow-cave", 5, [4, 10, 25], [-20, 4, -3]],
  ["cave-inside", 5, [-8, 3, 12], [-30, 3, -14]],
  ["chute-rapids", 7, [-72, 13, 25], [-48, 3, 46]],
  ["slack-reeds", 8, [48, 13, -62], [24, 2, -46]],
  ["deadfall-first", 9, [-4, 10, -45], [-15, 3, -27]],
  ["deadfall-second", 9, [-25, 9, -6], [-12, 3, 11]],
  ["deadfall-overview", 9, [-58, 78, -6], [-8, 0, -6]],
];

for (const [name, hole, eye, at] of shots) {
  const err = await page.evaluate(([h]) => {
    const S = window.__skimmers;
    try { S.setupHole(h); return null; } catch (e) { return String(e); }
  }, [hole]);
  if (err) { problems.push(`setupHole(${hole}) threw: ${err}`); continue; }
  await page.waitForTimeout(900);
  await page.evaluate(([e, p]) => {
    const S = window.__skimmers;
    // "closeup" is the one mode that just uses whatever pose it is handed, so
    // the title screen's slow orbit doesn't drag the camera back off the prop
    S.cam.mode = "closeup";
    S.cam.pos.set(e[0], e[1], e[2]);
    S.cam.look.set(p[0], p[1], p[2]);
    // the rig eases toward cam.pos over a couple of seconds; snap both ends of
    // the pose so the shot doesn't catch it still travelling
    S.camRig.position.copy(S.cam.pos);
    S.cam.lookCur.copy(S.cam.look);
    S.camRig.lookAt(S.cam.lookCur);
    for (const el of document.body.children) {
      if (el.tagName !== "CANVAS") el.style.visibility = "hidden";
    }
  }, [eye, at]);
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${out}/${name}.png` });
  console.log(`shot ${name} (hole ${hole + 1})`);
}

console.log(problems.length ? `CONSOLE ERRORS:\n${[...new Set(problems)].join("\n")}` : "no console errors");
await browser.close();
process.exit(problems.length ? 1 : 0);

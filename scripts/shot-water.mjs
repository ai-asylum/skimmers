// Photograph the moving-water holes (src/holes.js 9-11) in a real browser: the
// current's flow ribbons, white water in the rapids, the ice sheets, reed beds,
// the beaver dams and the fallen tree. All of it is either shader work or a
// terrain rebuild, so none of it can be checked headless.
//
// Usage: node scripts/shot-water.mjs [outDir] [port]
import { chromium } from "playwright";

const out = process.argv[2] || "/tmp/water";
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

// [name, hole index, camera eye, look-at]
const shots = [
  ["race-rapids", 8, [-12, 14, 58], [-8, 2, 34]],
  ["race-weeds", 8, [-36, 10, 58], [-36, 2, 38]],
  ["race-downstream", 8, [-70, 26, 66], [0, 0, 30]],
  ["coldsnap-ice", 9, [48, 12, 70], [48, 1, 49]],
  ["coldsnap-ice-far", 9, [70, 30, 74], [10, 0, 36]],
  ["coldsnap-edge", 9, [-8, 8, 44], [-24, 1, 28]],
  // from upstream, which is where the player is standing: the notch has to be
  // legible from the tee or it is not a shot, it is a surprise
  ["lodge-dam", 10, [-64, 10, -57], [-46, 3, -45]],
  ["lodge-dam-close", 10, [-56, 5, -51], [-46, 3, -45]],
  ["lodge-dam-below", 10, [-46, 9, -28], [-46, 2, -45]],
  ["lodge-log", 10, [-6, 9, -20], [-9, 2, -40]],
  ["lodge-log-along", 10, [10, 5, -34], [-14, 2, -44]],
  ["lodge-dam2", 10, [24, 8, -14], [24, 2, -32]],
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
  console.log(`shot ${name} (hole ${hole + 1})`);
}

console.log(problems.length ? `CONSOLE ERRORS:\n${[...new Set(problems)].join("\n")}` : "no console errors");
await browser.close();
process.exit(problems.length ? 1 : 0);

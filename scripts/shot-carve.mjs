// Exercise the voxel carve in a real browser: first with a genuine pointer
// drag (proving the input path still reaches the drill), then with a scripted
// drill at a fixed timestep so the resulting hole can be photographed from
// several angles without depending on the headless renderer's frame rate.
// Usage: node scripts/shot-carve.mjs [outDir] [port]
import { chromium } from "playwright";

const out = process.argv[2] || "/tmp";
const port = process.argv[3] || "8741";
const browser = await chromium.launch({
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--ignore-gpu-blocklist"],
});
const page = await browser.newPage({ viewport: { width: 1100, height: 620 } });
const problems = [];
page.on("console", (m) => { if (m.type() === "error") problems.push(m.text()); });
page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));

await page.goto(`http://localhost:${port}/`, { waitUntil: "networkidle" });
await page.waitForTimeout(900);
await (await page.$("#play-btn"))?.click();
await page.waitForTimeout(2200);

const b = await (await page.$("#c")).boundingBox();
const nextVisible = async () => {
  const el = await page.$("#phase-next");
  return el && (await el.isVisible());
};
outer: for (const yy of [0.47, 0.44, 0.5, 0.42]) {
  for (let i = 0; i < 9; i++) {
    await page.mouse.click(b.x + b.width * (0.3 + i * 0.05), b.y + b.height * yy);
    await page.waitForTimeout(220);
    if (await nextVisible()) break outer;
  }
}
if (!(await nextVisible())) throw new Error("never managed to pick a rock");
await (await page.$("#phase-next")).click();
await page.waitForTimeout(2400);

const stats = () => page.evaluate(() => {
  const r = window.__skimmers.G.playerRock;
  return {
    tris: r.geo.drawRange.count / 3,
    dabs: r.dabs.length,
    brokeThrough: r._holed,
    flat: +r.flat.toFixed(3),
    heft: +r.heft.toFixed(3),
    holeFrac: +r.holeFrac.toFixed(3),
    wireChars: r.sculptData().length,
  };
});

console.log("fresh     ", JSON.stringify(await stats()));
await page.screenshot({ path: `${out}/carve-0-before.png` });

// ---- a real drag on the stone -------------------------------------------
await page.mouse.move(b.x + b.width * 0.5, b.y + b.height * 0.52);
await page.mouse.down();
await page.waitForTimeout(2500);
await page.screenshot({ path: `${out}/carve-1-digging.png` });
await page.mouse.up();
const dragged = await stats();
console.log("after drag", JSON.stringify(dragged));
if (dragged.dabs === 0) throw new Error("a drag on the stone carved nothing");

// ---- scripted drill, so the picture doesn't depend on headless framerate --
const drilled = await page.evaluate(() => {
  const S = window.__skimmers, r = S.G.playerRock, THREE = S.THREE;
  r.resetShape();
  r.group.rotation.set(0, 0, 0);
  r.group.updateMatrixWorld(true);
  const from = r.group.position.clone().add(new THREE.Vector3(0.15, 3, 0.1));
  const ray = new THREE.Ray(from, r.group.position.clone().sub(from).normalize());
  let punchedAfter = -1;
  for (let i = 0; i < 400; i++) {
    const res = r.carve(ray, 0.36, (1 / 60) * 1.0);
    if (res.punched && punchedAfter < 0) punchedAfter = +(i / 60).toFixed(2);
    if (punchedAfter >= 0 && i / 60 > punchedAfter + 0.35) break;
  }
  return { punchedAfter, dabs: r.dabs.length, wireChars: r.sculptData().length };
});
console.log("drill down", JSON.stringify(drilled));
console.log("drill down", JSON.stringify(await stats()));

// ---- photograph it ------------------------------------------------------
// The game camera is damped and hemmed in, so the stone is turned to face it
// rather than the other way round.
const views = [
  ["entry", [-1.15, 0]],
  ["threequarter", [-0.6, 0.5]],
  ["edge", [0, 0]],
  ["exit", [1.15, 0]],
];
for (const [name, [rx, ry]] of views) {
  await page.evaluate(([x, y]) => {
    const S = window.__skimmers, r = S.G.playerRock;
    S.G.idleSpinAt = Infinity;
    r.eyes.visible = false;
    r.group.rotation.set(x, y, 0);
    const p = r.group.position;
    S.cam.pos.set(p.x, p.y + 0.25, p.z - 1.5);
    S.cam.look.copy(p);
  }, [rx, ry]);
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${out}/carve-2-${name}.png` });
}
await page.evaluate(() => { window.__skimmers.G.playerRock.eyes.visible = true; });

// ---- paint still lands on the remeshed surface --------------------------
await page.evaluate(() => {
  const S = window.__skimmers, p = S.G.playerRock.group.position;
  S.cam.pos.set(p.x, p.y + 1.6, p.z - 1.1);
  S.cam.look.copy(p);
});
await (await page.$("#phase-next")).click();
await page.waitForTimeout(1800);
const swatches = await page.$$("#paint-colors button, .paint-color, .swatch");
if (swatches[4]) await swatches[4].click();
await page.mouse.move(b.x + b.width * 0.47, b.y + b.height * 0.45);
await page.mouse.down();
await page.mouse.move(b.x + b.width * 0.55, b.y + b.height * 0.55, { steps: 12 });
await page.mouse.up();
await page.waitForTimeout(900);
await page.screenshot({ path: `${out}/carve-3-painted.png` });

console.log(problems.length ? `CONSOLE ERRORS:\n${problems.join("\n")}` : "no console errors");
await browser.close();

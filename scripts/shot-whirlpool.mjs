// Drive into a race, photograph the whirlpool hole from a few angles, then
// exercise the capture rule: a stone that only flies over the vortex must not
// count, a stone that lands in it must get sucked down.
import { chromium } from "playwright";

const url = process.argv[2] || "http://localhost:8742/";
const tag = process.argv[3] || "whirl";

const browser = await chromium.launch({
  args: ["--use-angle=metal", "--ignore-gpu-blocklist", "--enable-unsafe-swiftshader"],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 760 } });
const logs = [];
page.on("console", (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on("pageerror", (e) => logs.push(`[pageerror] ${e.message}`));

await page.goto(url, { waitUntil: "networkidle" });
await page.waitForTimeout(2000);
// the title lake must be unbroken — no hole cut in it before a hole exists
await page.screenshot({ path: `/tmp/${tag}-title.png` });
await (await page.$("#play-btn"))?.click();
await page.waitForTimeout(2000);

const c = await page.$("#c");
const b = await c.boundingBox();
const nextVisible = async () => {
  const el = await page.$("#phase-next");
  return el && (await el.isVisible());
};

// FIND: scan the beach line until a candidate rock gets selected
outer: for (const yy of [0.47, 0.44, 0.5, 0.42]) {
  for (let i = 0; i < 9; i++) {
    await page.mouse.click(b.x + b.width * (0.3 + i * 0.05), b.y + b.height * yy);
    await page.waitForTimeout(220);
    if (await nextVisible()) break outer;
  }
}
// FIND -> SHAPE -> PAINT -> RACE
for (let i = 0; i < 3; i++) {
  if (await nextVisible()) await (await page.$("#phase-next")).click();
  await page.waitForTimeout(i === 2 ? 4500 : 1800);
}

// ---- park the camera on the hole. holeWinner pins cam.mode so the race loop
// stops yanking it back to the aim orbit.
const poses = [
  ["hero", [11, 6.5, 11], [0, 1.2, 0]],
  ["low", [7.5, 1.1, 7.5], [0, -0.2, 0]],
  ["top", [0.6, 15, 6], [0, -1.0, 0]],
  // the height the aim camera actually sits at, which is the view that matters
  ["aim", [6.4, 3.4, 6.4], [0, 0.4, 0]],
];
for (const [name, off, look] of poses) {
  await page.evaluate(([off, look]) => {
    const { G, cam, THREE, HOLES } = window.__skimmers;
    const p = HOLES[G.hole].path;
    const f = p[p.length - 1];
    G.holeWinner = G.player; // freeze the camera mode
    cam.mode = "closeup";
    cam.pos.set(f.x + off[0], off[1], f.z + off[2]);
    cam.look.set(f.x + look[0], look[1], f.z + look[2]);
  }, [off, look]);
  await page.waitForTimeout(2200);
  await page.screenshot({ path: `/tmp/${tag}-${name}.png` });
}

// ---- capture rule ----------------------------------------------------------
const results = await page.evaluate(async () => {
  const { G, THREE, HOLES } = window.__skimmers;
  const p = HOLES[G.hole].path;
  const flag = new THREE.Vector3(p[p.length - 1].x, 0, p[p.length - 1].z);
  const tee = p[0];
  const dir = new THREE.Vector3(flag.x - tee.x, 0, flag.z - tee.z).normalize();
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const s = G.player;
  const out = {};

  // let the game drive again
  G.holeWinner = null;
  G.holeTime = 999;

  // A) sail clean over the top: starts 18u short of the flag, 8u up, flat and
  //    fast, so it is still ~4.5u above the water as it crosses the vortex
  s.finished = false;
  s.state = "flying";
  s.skips = 0;
  s.pos.copy(flag).addScaledVector(dir, -18);
  s.pos.y = 8;
  s.vel.set(dir.x * 26, 0, dir.z * 26);
  let minH = 99, minD = 99;
  for (let i = 0; i < 130; i++) {
    await sleep(16);
    const d = Math.hypot(s.pos.x - flag.x, s.pos.z - flag.z);
    if (d < minD) { minD = d; minH = s.pos.y; }
    if (s.state !== "flying") break;
  }
  out.flyover = {
    closestApproachXZ: +minD.toFixed(2),
    heightThere: +minH.toFixed(2),
    finished: s.finished,
    endedAs: s.state,
  };

  // B) a flat fast skip whose first touchdown lands inside the rim
  G.holeWinner = null;
  s.finished = false;
  s.state = "flying";
  s.skips = 0;
  s.lastThrowMode = "skip";
  // shallow enough to skip whatever flatness the sculpted rock ended up with
  s.pos.copy(flag).addScaledVector(dir, -2.2);
  s.pos.y = 0.55;
  s.vel.set(dir.x * 14, -0.8, dir.z * 14);
  for (let i = 0; i < 60 && s.state === "flying"; i++) await sleep(16);
  out.skippedIn = { stateOnContact: s.state, finished: s.finished };
  return out;
});

// watch the stone get drawn under, from the win camera the game picks itself
await page.waitForTimeout(450);
await page.screenshot({ path: `/tmp/${tag}-caught.png` });
await page.waitForTimeout(1500);
await page.screenshot({ path: `/tmp/${tag}-swallowed.png` });
results.skippedIn.settled = await page.evaluate(() => {
  const { G, THREE, HOLES } = window.__skimmers;
  const p = HOLES[G.hole].path;
  const f = p[p.length - 1];
  const s = G.player;
  return {
    state: s.state,
    distFromCentreXZ: +Math.hypot(s.pos.x - f.x, s.pos.z - f.z).toFixed(2),
    y: +s.pos.y.toFixed(2),
  };
});

console.log(JSON.stringify(results, null, 2));
console.log(`wrote /tmp/${tag}-{hero,low,top,caught,swallowed}.png`);
const noise = /webgl|vite|analytics|Download the React|\[Violation\]/i;
const keep = logs.filter((l) => !noise.test(l));
console.log(keep.length ? "LOGS:\n" + keep.join("\n") : "no notable logs");
await browser.close();

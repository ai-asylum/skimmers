/**
 * Walks the career loop and grabs a shot at each stop:
 *   1-bench.png    the bench with the shell purse up top
 *   2-hats.png     the garage, hat rack
 *   3-upgrades.png the garage, upgrade wall with two sockets filled
 *   4-cups.png     the cup picker, step one
 *   4b-class.png   step two, the classes
 *   4c-go.png      step three, the start plate
 *   5-race.png     the first hole, stone wearing its hat
 *   6-payout.png   the results board counting shells out
 *   7-back.png     back on the bench, purse heavier
 *
 * Usage: node scripts/shot-career.mjs [outDir] [port]
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const out = process.argv[2] || "/tmp/career";
const port = process.argv[3] || "8741";
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: 1100, height: 620 } });
const logs = [];
page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") logs.push(`${m.type()}: ${m.text()}`); });
page.on("pageerror", (e) => logs.push(`pageerror: ${e.message}`));
// This used to abort **/@vite/client to keep HMR quiet. Under Vite 8 the client
// is part of the module graph rather than a side-loaded script, so aborting it
// takes main.js down with it and the page comes up with no window.__skimmers.
// Letting it connect is harmless: nothing edits a file mid-run.

const shot = async (name) => { await page.screenshot({ path: `${out}/${name}.png` }); console.log("shot", name); };
const ok = (cond, msg) => console.log(`${cond ? "ok  " : "FAIL"}: ${msg}`);

await page.goto(`http://localhost:${port}/`, { waitUntil: "networkidle" });
// a stone already on the bench, a wiped career, and a fat purse to shop with
await page.evaluate(() => {
  localStorage.setItem("skippidy.shelf.v1", JSON.stringify([
    { name: "Chonk", cfg: { seed: 4242 }, born: Date.now() }, null, null,
  ]));
  localStorage.removeItem("skippidy.meta.v1");
});
await page.reload({ waitUntil: "networkidle" });
await page.waitForTimeout(900);
await page.evaluate(() => window.__skimmers.meta.addShells(5000));

await page.click("#play-btn");
await page.waitForTimeout(2800);
ok(await page.isVisible("#shell-hud"), "the purse shows on the bench");
ok(!(await page.isVisible("#garage-btn")), "no garage until a stone is picked");
await shot("1-bench");

// pick the stone: the garage kits out whichever one you're holding
const slotAt = await page.evaluate((n) => {
  const S = window.__skimmers;
  const s = S.worldToScreen(S.bench.slotPoint(n));
  return { x: s.x, y: s.y };
}, 0);
await page.mouse.click(slotAt.x, slotAt.y);
await page.waitForTimeout(900);
ok(await page.isVisible("#garage-btn"), "the garage door opens up for it");

// --- garage: hats -----------------------------------------------------------
await page.click("#garage-btn");
await page.waitForTimeout(700);
ok(await page.isVisible("#garage-ui"), "garage opened");
const tabs = await page.$$eval("#garage-tabs .meta-tab", (t) => t.map((x) => x.textContent.trim()));
console.log("      tabs:", tabs.join(" | "));

const buyFirst = async () => {
  const before = await page.evaluate(() => window.__skimmers.meta.shells());
  // "locked" is the class an unbought card wears
  const clicked = await page.evaluate(() => {
    const c = document.querySelector("#garage-grid .card.locked");
    if (!c) return null;
    c.click();
    return c.querySelector(".card-nm")?.textContent ?? "?";
  });
  await page.waitForTimeout(500);
  const after = await page.evaluate(() => window.__skimmers.meta.shells());
  return { clicked, before, after };
};

const tab = async (re) => {
  await page.evaluate((src) => [...document.querySelectorAll("#garage-tabs .meta-tab")]
    .find((t) => new RegExp(src, "i").test(t.textContent))?.click(), re);
  await page.waitForTimeout(450);
};

await tab("hats");
const hat = await buyFirst();
console.log(`      bought hat "${hat.clicked}" for ${hat.before - hat.after}`);
ok(hat.after < hat.before, "buying a hat costs shells");
await page.waitForTimeout(400);
await shot("2-hats");
const wearing = await page.evaluate(() => window.__skimmers.meta.loadoutFor(0).hat);
ok(!!wearing && wearing !== "none", `the stone is wearing it (${wearing})`);

// --- garage: floaters + trails ----------------------------------------------
await tab("floaters");
const ring = await buyFirst();
console.log(`      bought floater "${ring.clicked}" for ${ring.before - ring.after}`);
// the cel shader renders a toon twin of every material, so a recolour that only
// touches the source is invisible — check the colour that actually gets drawn
const ringCol = await page.evaluate(async () => {
  const { celMat } = await import("/src/celshader.js");
  return "#" + celMat(window.__skimmers.bench.slots[0].buoy.ringMat).color.getHexString();
});
ok(ringCol !== "#ff5a3c", `the new ring is on screen, not just in the save (${ringCol})`);
await tab("trails");
const trail = await buyFirst();
console.log(`      bought trail "${trail.clicked}" for ${trail.before - trail.after}`);

// --- garage: upgrades -------------------------------------------------------
await tab("upgrades");
const cards = await page.$$eval("#garage-grid .card", (c) => c.length);
ok(cards === 30, `all 30 upgrades on the wall (${cards})`);

// buy three, to prove the third one is refused: only two sockets per rock
for (let i = 0; i < 3; i++) {
  await page.evaluate(() => document.querySelector("#garage-grid .card.locked").click());
  await page.waitForTimeout(350);
}
const equipped = await page.evaluate(() => window.__skimmers.meta.loadoutFor(0).up.filter(Boolean));
ok(equipped.length === 2, `two sockets, no more (${equipped.join(", ")})`);
await shot("3-upgrades");

await page.click("#garage-close");
await page.waitForTimeout(600);

// --- cup select -------------------------------------------------------------
await page.click("#phase-next"); // the stone is ready -> race
await page.waitForTimeout(700);
/**
 * The picker is three steps — cup, class, start plate — and #cup-go is Next on
 * the first two and the race on the last, so pressing it until the layer goes
 * away is the whole walk, whichever step we came in on.
 */
const walkPicker = async (label) => {
  for (let i = 0; i < 4 && (await page.isVisible("#cup-ui")); i++) {
    if (await page.isDisabled("#cup-go")) break;
    await page.click("#cup-go");
    await page.waitForTimeout(250);
  }
  ok(!(await page.isVisible("#cup-ui")), `the picker walked out to the water (${label})`);
};

ok(await page.isVisible("#cup-ui"), "the cup picker opened");
const cupNames = await page.$$eval("#cup-list .pick", (c) => c.map((x) => x.textContent.trim().slice(0, 24)));
console.log("      cups:", cupNames.join(" | "));
const lockedCups = await page.$$eval("#cup-list .pick.locked", (c) => c.length);
ok(lockedCups > 0, `harder cups start locked (${lockedCups} locked)`);
await shot("4-cups");

// step two: the classes, which only exist in the DOM once their pane is up
await page.click("#cup-go");
await page.waitForTimeout(350);
const lockedTiers = await page.$$eval("#tier-list .pick.locked", (c) => c.length);
ok(lockedTiers > 0, `harder classes start locked (${lockedTiers} locked)`);
await shot("4b-class");

// step three: the start plate, with the picks read back
await page.click("#cup-go");
await page.waitForTimeout(350);
const tracks = await page.$$eval("#cup-summary .go-track", (t) => t.map((x) => x.textContent.trim()));
console.log("      start line:", tracks.join(" | "));
ok(tracks.length === 3, `the three holes are on the start line (${tracks.length})`);
await shot("4c-go");

await walkPicker("first cup");
await page.waitForTimeout(3000);
const st = await page.evaluate(() => window.__skimmers.G.state);
ok(st === "race", `race started (state=${st})`);
const worn = await page.evaluate(() => !!window.__skimmers.G.playerRock?.hat);
ok(worn, "the racing stone kept its hat on");
// only the fields the two fitted parts moved should differ from stock
const mods = await page.evaluate(async () => {
  const { DEFAULT_MODS } = await import("/src/upgrades.js");
  const m = window.__skimmers.G.player.mods;
  return Object.keys(m).filter((k) => m[k] !== DEFAULT_MODS[k]).map((k) => `${k}=${m[k]}`);
});
console.log("      mods on the wire:", mods.join(", ") || "(none!)");
ok(mods.length > 0, "the fitted upgrades reached the physics");
await shot("5-race");

// --- skip to the podium -----------------------------------------------------
const purse = await page.evaluate(() => {
  const S = window.__skimmers;
  // hand the player the cup outright, then call the match
  const me = S.G.racers.find((r) => r.isPlayer);
  me.points = 30; me.holesWon = S.course.length;
  const before = S.meta.shells();
  S.endMatch();
  return { before, after: S.meta.shells() };
});
await page.waitForTimeout(2600);
ok(purse.after > purse.before, `the cup paid out ${purse.after - purse.before} shells`);
ok(await page.isVisible("#payout"), "the tally is on the board");
const lines = await page.$$eval("#payout .pay-row", (r) => r.map((x) => x.textContent.trim()));
console.log("      payout:", lines.join(" / "));
ok(await page.isVisible("#next-cup-btn"), "there's a next cup to go to");
await shot("6-payout");

// --- straight into the next cup, same stone, no reload ----------------------
await page.click("#next-cup-btn");
await page.waitForTimeout(1600);
ok(await page.isVisible("#cup-ui"), "next cup goes straight back to the board");
const secondOpen = await page.$$eval("#cup-list .pick:not(.locked)", (c) => c.length);
ok(secondOpen === 2, `the cup we just won opened the next one (${secondOpen} open)`);
// take the newly opened cup this time — picking one also moves the step along
await page.evaluate(() => document.querySelectorAll("#cup-list .pick")[1].click());
await page.waitForTimeout(300);
await walkPicker("second cup");
await page.waitForTimeout(3200);
const st2 = await page.evaluate(() => window.__skimmers.G.state);
ok(st2 === "race", `second cup started clean (state=${st2})`);
const rocks2 = await page.evaluate(() => {
  const S = window.__skimmers;
  // a stone carried between races must not collect a second outline shell
  const outlines = S.G.playerRock.mesh.children.filter((c) => c.userData?.isOutline
    || c.material?.side === 1).length;
  return { racers: S.G.racers.length, hat: !!S.G.playerRock.hat, outlines };
});
console.log("      second race:", JSON.stringify(rocks2));
ok(rocks2.hat, "the hat came along to the second cup");
ok(rocks2.outlines <= 1, `no stacked outlines on the carried stone (${rocks2.outlines})`);
await page.evaluate(() => window.__skimmers.endMatch());
await page.waitForTimeout(2400);

// --- and back to the bench, no reload ---------------------------------------
await page.click("#again-btn");
await page.waitForTimeout(3200);
const back = await page.evaluate(() => window.__skimmers.G.state);
ok(back === "shelf", `back on the bench without a reload (state=${back})`);
ok(await page.isVisible("#shell-hud"), "purse is back up");
const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("skippidy.meta.v1")));
console.log("      records:", JSON.stringify(saved.records), "lifetime:", JSON.stringify(saved.lifetime));
ok(Object.keys(saved.records).length === 2, "both cup results went into the book");
ok(saved.loadouts[0].hat !== "none", "the hat survived the whole round trip");
// the cup after this one should have opened up now that the first is won
const nowOpen = await page.evaluate(async () => {
  const { cupUnlocked } = await import("/src/cups.js");
  return cupUnlocked(1);
});
ok(nowOpen, "winning the first cup unlocked the second");
await shot("7-back");

await browser.close();
if (logs.length) console.log("--- console ---\n" + logs.join("\n"));

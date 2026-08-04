/**
 * Debug menu, toggled with the backtick (`) key.
 *
 * Two jobs. The first is dialling in the world's look at runtime: a biome
 * picker (biomes.js) for the whole dressing at once, then tree bark & leaf
 * tints, an editable terrain elevation gradient (add / drag / recolour stops),
 * sky hue, rock hue, water surface bands, and fog colour + density (which also
 * bleeds up the sky). Every control writes straight into the live materials /
 * uniforms, and the whole set is persisted to localStorage under `KEY`, so
 * tweaks survive a reload — but note that a hole change reapplies its biome,
 * which writes over all of them.
 *
 * The second is getting at the course: open every cup and class, swap the live
 * race onto any of them, and step hole by hole. That is the section you almost
 * always want, so it is the one that starts expanded and the colour pickers are
 * folded away behind their headings.
 *
 * Only wired up in the normal build, served locally.
 */
import { setTerrainGradient, getTerrainGradient } from "./terrain.js";
import { WATER_COLOR_KEYS, WATER_FX } from "./water.js";
import { CUPS, TIERS } from "./cups.js";
import { BIOMES, BIOME_IDS, DEFAULT_BIOME, applyBiome } from "./biomes.js";
import { UPGRADES } from "./upgrades.js";
import { HATS, FLOATERS, TRAILS } from "./cosmetics.js";
import { unlockAll } from "./meta.js";

const KEY = "rockskip.sceneTweaks";
const WATER_LABELS = {
  uDeep: "Deep", uMid: "Mid", uShallow: "Shallow",
  uShelf: "Shelf", uSheen: "Sheen", uFoam: "Foam",
};

function load() {
  try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; }
}
function save(state) {
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* private mode, ignore */ }
}

// ---- small DOM helpers -------------------------------------------------------
function row(label, control) {
  const wrap = document.createElement("label");
  wrap.style.cssText = "display:flex;align-items:center;justify-content:space-between;gap:10px;margin:5px 0;font-size:12px;";
  const span = document.createElement("span");
  span.textContent = label;
  wrap.append(span, control);
  return wrap;
}
function header(text) {
  const h = document.createElement("div");
  h.textContent = text;
  h.style.cssText = "font-weight:600;font-size:11px;text-transform:uppercase;letter-spacing:0.06em;opacity:0.6;margin:12px 0 4px;";
  return h;
}
/**
 * A foldaway group. `<details>` rather than a click handler and a flag, so the
 * disclosure arrow, the keyboard and find-in-page all behave without help.
 * Returns the body to append into; the caller never touches the wrapper.
 */
function section(panel, title, { open = false } = {}) {
  const d = document.createElement("details");
  d.open = open;
  d.style.cssText = "margin:8px 0 0;border-top:1px solid rgba(255,255,255,0.1);padding-top:6px;";
  const sum = document.createElement("summary");
  sum.textContent = title;
  sum.style.cssText = "cursor:pointer;font-weight:600;font-size:11px;text-transform:uppercase;letter-spacing:0.06em;opacity:0.65;list-style:revert;";
  const body = document.createElement("div");
  body.style.cssText = "padding:2px 0 6px;";
  d.append(sum, body);
  panel.appendChild(d);
  return body;
}
const BTN = "padding:6px;font-size:12px;border-radius:6px;border:1px solid rgba(255,255,255,0.2);"
  + "background:rgba(255,255,255,0.08);color:#eaf4fb;cursor:pointer;";
function button(label, onClick, extra = "") {
  const b = document.createElement("button");
  b.textContent = label;
  b.style.cssText = BTN + extra;
  b.addEventListener("click", onClick);
  return b;
}
/** flash a confirmation on a button and put its label back */
function flash(btn, msg, ms = 1200) {
  const was = btn.textContent;
  btn.textContent = msg;
  setTimeout(() => { btn.textContent = was; }, ms);
}
function select(options, value, onChange) {
  const el = document.createElement("select");
  el.style.cssText = "flex:1;min-width:0;font-size:12px;padding:4px;border-radius:6px;"
    + "border:1px solid rgba(255,255,255,0.2);background:rgba(0,0,0,0.35);color:#eaf4fb;";
  options.forEach((label, i) => {
    const o = document.createElement("option");
    o.value = String(i);
    o.textContent = label;
    el.appendChild(o);
  });
  el.value = String(value);
  el.addEventListener("change", () => onChange(parseInt(el.value, 10)));
  return el;
}
function colorInput(value, onInput) {
  const el = document.createElement("input");
  el.type = "color";
  el.value = value;
  el.style.cssText = "width:44px;height:22px;border:0;background:none;padding:0;cursor:pointer;";
  el.addEventListener("input", () => onInput(el.value));
  return el;
}
function rangeInput(value, min, max, step, onInput) {
  const el = document.createElement("input");
  el.type = "range";
  el.min = min; el.max = max; el.step = step; el.value = value;
  el.style.cssText = "width:120px;";
  el.addEventListener("input", () => onInput(parseFloat(el.value)));
  return el;
}

// ---- gradient editor ---------------------------------------------------------
// A horizontal bar of colour stops. Drag a marker to move it, click a marker to
// recolour it, click the empty bar to add a stop, right-click a marker to drop
// it. `onChange(stops)` fires (with the sorted [{t, hex}] list) on every edit.
function gradientEditor(initial, onChange) {
  let stops = initial.map((s) => ({ t: s.t, hex: s.hex }));
  const markers = new Map(); // stop -> element

  const wrap = document.createElement("div");
  wrap.style.cssText = "position:relative;height:40px;margin:4px 0 2px;";
  const bar = document.createElement("div");
  bar.style.cssText = "position:absolute;top:0;left:0;right:0;height:20px;border-radius:5px;border:1px solid rgba(255,255,255,0.25);cursor:copy;";
  wrap.appendChild(bar);

  const sample = (t) => {
    const s = [...stops].sort((a, b) => a.t - b.t);
    if (t <= s[0].t) return s[0].hex;
    if (t >= s[s.length - 1].t) return s[s.length - 1].hex;
    for (let i = 0; i < s.length - 1; i++) {
      if (t >= s[i].t && t <= s[i + 1].t) {
        const f = (t - s[i].t) / ((s[i + 1].t - s[i].t) || 1);
        const a = parseInt(s[i].hex.slice(1), 16), b = parseInt(s[i + 1].hex.slice(1), 16);
        const mix = (sh) => Math.round(((a >> sh) & 255) + (((b >> sh) & 255) - ((a >> sh) & 255)) * f);
        return "#" + ((1 << 24) + (mix(16) << 16) + (mix(8) << 8) + mix(0)).toString(16).slice(1);
      }
    }
    return s[s.length - 1].hex;
  };

  const emit = () => onChange([...stops].sort((a, b) => a.t - b.t));

  // Only repaints the bar and repositions existing markers — never rebuilds
  // them, so dragging a marker doesn't yank the element out from under itself.
  const paint = () => {
    const s = [...stops].sort((a, b) => a.t - b.t);
    bar.style.background = "linear-gradient(to right," + s.map((x) => `${x.hex} ${(x.t * 100).toFixed(1)}%`).join(",") + ")";
    for (const [st, el] of markers) { el.style.left = (st.t * 100) + "%"; el.style.background = st.hex; }
  };

  const makeMarker = (st) => {
    const m = document.createElement("div");
    m.style.cssText = "position:absolute;top:19px;width:12px;height:12px;border-radius:50%;border:2px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,0.5);cursor:grab;transform:translateX(-50%);touch-action:none;";
    m.style.left = (st.t * 100) + "%";
    m.style.background = st.hex;
    let moved = false, startX = 0;
    m.addEventListener("pointerdown", (e) => {
      e.preventDefault(); e.stopPropagation();
      moved = false; startX = e.clientX;
      m.setPointerCapture(e.pointerId);
      m.style.cursor = "grabbing";
    });
    m.addEventListener("pointermove", (e) => {
      if (!m.hasPointerCapture(e.pointerId)) return;
      if (Math.abs(e.clientX - startX) > 2) moved = true;
      const rect = bar.getBoundingClientRect();
      st.t = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      paint(); emit();
    });
    m.addEventListener("pointerup", (e) => {
      m.releasePointerCapture(e.pointerId);
      m.style.cursor = "grab";
      if (!moved) {
        const picker = colorInput(st.hex, (v) => { st.hex = v; paint(); emit(); });
        picker.style.display = "none";
        document.body.appendChild(picker);
        picker.click();
        picker.addEventListener("change", () => picker.remove());
      }
    });
    m.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      if (stops.length > 2) {
        stops.splice(stops.indexOf(st), 1);
        m.remove(); markers.delete(st);
        paint(); emit();
      }
    });
    markers.set(st, m);
    wrap.appendChild(m);
  };

  bar.addEventListener("pointerdown", (e) => {
    const rect = bar.getBoundingClientRect();
    const t = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const st = { t, hex: sample(t) };
    stops.push(st);
    makeMarker(st);
    paint(); emit();
  });

  for (const st of stops) makeMarker(st);
  paint();
  return wrap;
}

// ---- apply persisted / current state ----------------------------------------
function applyState(state, { scene, world, water }) {
  if (state.tree) world.trees.setColors(state.tree.bark, state.tree.leaf);
  if (state.grass) {
    if (state.grass.color) world.grass.setColor(state.grass.color);
    if (state.grass.wind != null) world.grass.setWind(state.grass.wind);
    if (state.grass.windSpeed != null) world.grass.setWindSpeed(state.grass.windSpeed);
  }
  if (state.terrain) { setTerrainGradient(state.terrain); world.terrain.rebuild(); }
  if (state.skyGrad) world.setSkyGradient(state.skyGrad);
  if (state.rock) world.course.setRockColor(state.rock);
  if (state.fog) world.setFog(state.fog.color, state.fog.density);
  else world.setFog(world.getFog().color, world.getFog().density); // seed sky fog band
  if (state.water) for (const k of WATER_COLOR_KEYS) if (state.water[k]) water.setColor(k, state.water[k]);
  if (state.waterGrad) water.setDepthGradient(state.waterGrad);
  if (state.waterFx) for (const key of Object.values(WATER_FX)) if (key in state.waterFx) water.setFx(key, state.waterFx[key]);
  if (state.waterSpeed != null) water.setSpeed(state.waterSpeed);
}

/**
 * Cups, classes and holes. Everything here needs the running game, which does
 * not exist yet when the menu is built, so the section reads `course`'s
 * accessors instead of values and returns its refresh for the toggle to drive.
 */
function levelSection(panel, course) {
  const body = section(panel, "Levels", { open: true });

  const unlockBtn = button("Unlock everything", () => {
    unlockAll({
      // a cup opens off a podium in the one before it and a class off a win in
      // the one below, so a 1st in every combination is what opens the lot
      records: CUPS.flatMap((c) => TIERS.map((t) => [c.id, t.id])),
      upgrades: UPGRADES.map((u) => u.id),
      cosmetics: { hat: HATS.map((h) => h.id), floater: FLOATERS.map((f) => f.id), trail: TRAILS.map((t) => t.id) },
      purse: 9999,
    });
    course.onUnlock?.();
    flash(unlockBtn, `${CUPS.length} cups open`);
  }, "width:100%;margin:2px 0 8px;");
  body.appendChild(unlockBtn);

  // jump the live race onto any cup at any class
  let cupIdx = 0, tierIdx = 1;
  const pickRow = document.createElement("div");
  pickRow.style.cssText = "display:flex;gap:6px;margin:0 0 6px;";
  pickRow.append(
    select(CUPS.map((c) => c.name), cupIdx, (i) => { cupIdx = i; }),
    select(TIERS.map((t) => `${t.name} · ${t.cc}`), tierIdx, (i) => { tierIdx = i; })
  );
  body.appendChild(pickRow);

  const loadBtn = button("Race this cup from hole 1", () => {
    if (!course.racing()) return flash(loadBtn, "start a race first");
    course.load(cupIdx, tierIdx);
  }, "width:100%;");
  body.appendChild(loadBtn);

  const jump = (i) => { if (course.racing()) course.goto(i); };

  const stepRow = document.createElement("div");
  stepRow.style.cssText = "display:flex;gap:8px;margin:6px 0;";
  stepRow.append(
    button("‹ Prev", () => jump(course.at() - 1), "flex:1;"),
    button("Next ›", () => jump(course.at() + 1), "flex:1;")
  );
  body.appendChild(stepRow);

  const list = document.createElement("div");
  list.style.cssText = "display:flex;flex-direction:column;gap:4px;";
  body.appendChild(list);

  const hint = document.createElement("div");
  hint.style.cssText = "font-size:9.5px;opacity:0.5;margin-top:6px;line-height:1.35;";
  body.appendChild(hint);

  // A jump lands a screen-wipe later, and swapping cups replaces the list
  // wholesale, so rather than guess at the timing the section re-reads the race
  // and redraws when what it is looking at has changed. `refresh` is on a timer
  // while the panel is up, and does nothing at all on the vast majority of ticks.
  let drawn = "";
  function refresh() {
    if (!course.racing()) {
      if (drawn === "idle") return;
      drawn = "idle";
      list.innerHTML = "";
      hint.textContent = "not racing — unlocking works anywhere, but jumping holes needs a race on";
      return;
    }
    const holes = course.holes();
    const here = course.at();
    const sig = `${here}/${holes.length}/${holes.map((h) => h.name).join()}`;
    if (sig === drawn) return;
    drawn = sig;
    list.innerHTML = "";
    hint.textContent = `hole ${here + 1} of ${holes.length} · jumping skips the scoring, so the standings will look odd`;
    holes.forEach((h, i) => {
      // the furniture is the reason to visit a hole, so it goes in the label
      const props = ["falls", "wheels", "bridges", "caves", "dams", "logs"]
        .filter((k) => h[k]?.length).join(" · ");
      list.appendChild(button(
        `${i + 1}. ${h.name ?? `Hole ${i + 1}`}${props ? `  (${props})` : ""}`,
        () => jump(i),
        "text-align:left;font-size:11px;padding:5px 7px;"
        + (i === here ? "background:rgba(255,210,74,0.22);border-color:rgba(255,210,74,0.5);" : "")
      ));
    });
  }
  return refresh;
}

/**
 * Try a biome on the hole that is up (biomes.js). Every hole change reapplies
 * the one the cup asked for, so this is a preview rather than a setting — which
 * is also true of every colour picker below it, since a biome writes over the
 * lot of them.
 */
function biomeSection(panel, { world, water }) {
  const body = section(panel, "Biome");
  let idx = BIOME_IDS.indexOf(DEFAULT_BIOME);
  const blurb = document.createElement("div");
  blurb.style.cssText = "font-size:10px;opacity:0.55;margin:4px 0 0;line-height:1.35;";
  const show = () => {
    const b = BIOMES[BIOME_IDS[idx]];
    blurb.textContent = `${b.blurb} · reapplied on every hole, so it wins over the pickers below`;
  };
  body.appendChild(row("Weather", select(BIOME_IDS.map((id) => BIOMES[id].name), idx, (i) => {
    idx = i;
    applyBiome(BIOME_IDS[i], { world, water });
    // the bank's colours and the planting are baked, not uniforms: they only
    // change when the ground and the scatter are rebuilt
    world.terrain.rebuild();
    world.trees.setHole();
    world.foliage.setHole();
    world.grass.setHole();
    show();
  })));
  body.appendChild(blurb);
  show();
}

export function initTweakMenu({ scene, world, water, course }) {
  const state = load();
  applyState(state, { scene, world, water });

  const panel = document.createElement("div");
  panel.id = "tweak-menu";
  panel.style.cssText = [
    "position:fixed", "top:12px", "right:12px", "z-index:9999",
    "background:rgba(18,26,34,0.92)", "color:#eaf4fb",
    "font-family:system-ui,-apple-system,sans-serif", "padding:12px 14px",
    "border-radius:10px", "border:1px solid rgba(255,255,255,0.15)",
    "box-shadow:0 6px 24px rgba(0,0,0,0.4)", "width:264px", "display:none",
    "max-height:88vh", "overflow-y:auto", "backdrop-filter:blur(4px)",
  ].join(";");

  const title = document.createElement("div");
  title.textContent = "Debug menu";
  title.style.cssText = "font-weight:600;font-size:13px;letter-spacing:0.02em;margin-bottom:2px;";
  panel.appendChild(title);

  const refreshLevels = course ? levelSection(panel, course) : null;
  biomeSection(panel, { world, water });

  // read current (post-apply) values to seed the controls
  const tree = world.trees.getColors();
  const rockHex = world.course.getRockColor();
  const fog = world.getFog();
  const waterCols = water.getColors();

  const persist = () => save(state);
  const rafRebuild = (() => {
    let queued = false;
    return () => {
      if (queued) return; queued = true;
      requestAnimationFrame(() => { queued = false; world.terrain.rebuild(); });
    };
  })();

  const gradHintText = "click bar: add · drag: move · click dot: colour · right-click: remove";
  const hintLine = (text) => {
    const el = document.createElement("div");
    el.textContent = text;
    el.style.cssText = "font-size:9.5px;opacity:0.5;margin:-2px 0 2px;line-height:1.3;";
    return el;
  };

  // --- trees + grass
  const plants = section(panel, "Trees & grass");
  state.tree = state.tree || { bark: tree.bark, leaf: tree.leaf };
  const applyTree = () => { world.trees.setColors(state.tree.bark, state.tree.leaf); persist(); };
  plants.appendChild(row("Bark", colorInput(state.tree.bark, (v) => { state.tree.bark = v; applyTree(); })));
  plants.appendChild(row("Leaves", colorInput(state.tree.leaf, (v) => { state.tree.leaf = v; applyTree(); })));
  const grass = { color: world.grass.getColor(), wind: world.grass.getWind(), windSpeed: world.grass.getWindSpeed() };
  state.grass = state.grass || {};
  plants.appendChild(row("Grass", colorInput(state.grass.color || grass.color, (v) => { state.grass.color = v; world.grass.setColor(v); persist(); })));
  plants.appendChild(row("Wind sway", rangeInput(state.grass.wind ?? grass.wind, 0, 0.8, 0.01, (v) => { state.grass.wind = v; world.grass.setWind(v); persist(); })));
  plants.appendChild(row("Wind speed", rangeInput(state.grass.windSpeed ?? grass.windSpeed, 0, 5, 0.05, (v) => { state.grass.windSpeed = v; world.grass.setWindSpeed(v); persist(); })));

  // --- terrain gradient
  const ground = section(panel, "Terrain (low → peaks)");
  ground.appendChild(gradientEditor(getTerrainGradient(), (stops) => {
    state.terrain = stops;
    setTerrainGradient(stops);
    rafRebuild();
    persist();
  }));
  ground.appendChild(hintLine(gradHintText));

  // --- sky + fog
  const sky = section(panel, "Sky & fog");
  sky.appendChild(header("Gradient (horizon → zenith)"));
  sky.appendChild(gradientEditor(world.getSkyGradient(), (stops) => {
    state.skyGrad = stops; world.setSkyGradient(stops); persist();
  }));
  sky.appendChild(hintLine(gradHintText));
  state.fog = state.fog || { color: fog.color, density: fog.density };
  const applyFog = () => { world.setFog(state.fog.color, state.fog.density); persist(); };
  sky.appendChild(row("Fog", colorInput(state.fog.color, (v) => { state.fog.color = v; applyFog(); })));
  sky.appendChild(row("Fog density", rangeInput(state.fog.density, 0, 0.03, 0.0005, (v) => { state.fog.density = v; applyFog(); })));

  // --- rock
  const rocks = section(panel, "Rocks");
  rocks.appendChild(row("Rock", colorInput(rockHex, (v) => { state.rock = v; world.course.setRockColor(v); persist(); })));

  // --- water
  const lake = section(panel, "Water");
  lake.appendChild(header("Depth (deep → shore)"));
  lake.appendChild(gradientEditor(water.getDepthGradient(), (stops) => {
    state.waterGrad = stops; water.setDepthGradient(stops); persist();
  }));
  lake.appendChild(hintLine("sampled into 4 flat bands · same controls as above"));
  state.water = state.water || {};
  for (const k of ["uSheen", "uFoam"]) {
    const cur = state.water[k] || waterCols[k];
    lake.appendChild(row(WATER_LABELS[k], colorInput(cur, (v) => { state.water[k] = v; water.setColor(k, v); persist(); })));
  }
  lake.appendChild(header("Effects"));
  lake.appendChild(row("Speed", rangeInput(state.waterSpeed ?? water.getSpeed(), 0, 3, 0.05, (v) => { state.waterSpeed = v; water.setSpeed(v); persist(); })));
  state.waterFx = state.waterFx || {};
  for (const [label, key] of Object.entries(WATER_FX)) {
    const raw = key in state.waterFx ? state.waterFx[key] : water.getFx(key);
    const cur = typeof raw === "boolean" ? (raw ? 1 : 0) : raw; // migrate old on/off saves
    lake.appendChild(row(label, rangeInput(cur, 0, 1, 0.05, (v) => { state.waterFx[key] = v; water.setFx(key, v); persist(); })));
  }

  // --- export / import
  const share = section(panel, "Share scene tweaks");
  const io = document.createElement("textarea");
  io.readOnly = true;
  io.style.cssText = "width:100%;height:54px;box-sizing:border-box;font:11px/1.3 ui-monospace,monospace;background:rgba(0,0,0,0.35);color:#cfe;border:1px solid rgba(255,255,255,0.15);border-radius:6px;padding:6px;resize:vertical;display:none;";
  const btnRow = document.createElement("div");
  btnRow.style.cssText = "display:flex;gap:8px;";
  const btnStyle = BTN + "flex:1;";

  const exportBtn = document.createElement("button");
  exportBtn.textContent = "Export";
  exportBtn.style.cssText = btnStyle;
  exportBtn.addEventListener("click", () => {
    const json = JSON.stringify(state, null, 2);
    io.style.display = "block";
    io.value = json;
    io.readOnly = false; io.select(); io.readOnly = true;
    if (navigator.clipboard) {
      navigator.clipboard.writeText(json)
        .then(() => { exportBtn.textContent = "Copied!"; setTimeout(() => (exportBtn.textContent = "Export"), 1200); })
        .catch(() => {});
    }
  });

  const importBtn = document.createElement("button");
  importBtn.textContent = "Import";
  importBtn.style.cssText = btnStyle;
  importBtn.addEventListener("click", () => {
    if (io.style.display === "none" || io.readOnly) {
      // first click reveals an editable box to paste into
      io.style.display = "block";
      io.readOnly = false;
      io.value = "";
      io.placeholder = "paste exported JSON, then press Import again";
      io.focus();
      return;
    }
    try {
      const next = JSON.parse(io.value);
      Object.assign(state, next);
      save(state);
      location.reload(); // reapply everything and reseed the controls
    } catch {
      importBtn.textContent = "Bad JSON";
      setTimeout(() => (importBtn.textContent = "Import"), 1200);
    }
  });

  const resetBtn = document.createElement("button");
  resetBtn.textContent = "Reset";
  resetBtn.style.cssText = btnStyle;
  resetBtn.addEventListener("click", () => {
    try { localStorage.removeItem(KEY); } catch { /* ignore */ }
    location.reload(); // rebuild from the code defaults
  });

  btnRow.append(exportBtn, importBtn, resetBtn);
  share.appendChild(btnRow);
  share.appendChild(io);

  const hint = document.createElement("div");
  hint.textContent = "saved to localStorage · press ` to toggle";
  hint.style.cssText = "font-size:10px;opacity:0.55;margin-top:10px;text-align:right;";
  panel.appendChild(hint);

  document.body.appendChild(panel);

  let ticker = 0;
  window.addEventListener("keydown", (e) => {
    if (e.code === "Backquote" && !e.repeat) {
      e.preventDefault();
      const show = panel.style.display === "none";
      panel.style.display = show ? "block" : "none";
      clearInterval(ticker);
      if (show && refreshLevels) {
        refreshLevels();
        ticker = setInterval(refreshLevels, 250); // follows the race while it's up
      }
    }
  });

  return panel;
}

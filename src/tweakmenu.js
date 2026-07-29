/**
 * Debug scene-colour tweak menu, toggled with the backtick (`) key.
 *
 * A dev-only overlay for dialling in the world's look at runtime: tree bark &
 * leaf tints, an editable terrain elevation gradient (add / drag / recolour
 * stops), sky hue, rock hue, water surface bands, and fog colour + density
 * (which also bleeds up the sky). Every control writes straight into the live
 * materials / uniforms, and the whole set is persisted to localStorage under
 * `KEY`, so tweaks survive a reload. Only wired up in the normal build.
 */
import { setTerrainGradient, getTerrainGradient } from "./terrain.js";
import { WATER_COLOR_KEYS, WATER_FX } from "./water.js";

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

export function initTweakMenu({ scene, world, water }) {
  const state = load();
  applyState(state, { scene, world, water });

  const panel = document.createElement("div");
  panel.style.cssText = [
    "position:fixed", "top:12px", "right:12px", "z-index:9999",
    "background:rgba(18,26,34,0.92)", "color:#eaf4fb",
    "font-family:system-ui,-apple-system,sans-serif", "padding:12px 14px",
    "border-radius:10px", "border:1px solid rgba(255,255,255,0.15)",
    "box-shadow:0 6px 24px rgba(0,0,0,0.4)", "width:264px", "display:none",
    "max-height:88vh", "overflow-y:auto", "backdrop-filter:blur(4px)",
  ].join(";");

  const title = document.createElement("div");
  title.textContent = "Scene tweaks";
  title.style.cssText = "font-weight:600;font-size:13px;letter-spacing:0.02em;";
  panel.appendChild(title);

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

  // --- trees
  panel.appendChild(header("Trees"));
  state.tree = state.tree || { bark: tree.bark, leaf: tree.leaf };
  const applyTree = () => { world.trees.setColors(state.tree.bark, state.tree.leaf); persist(); };
  panel.appendChild(row("Bark", colorInput(state.tree.bark, (v) => { state.tree.bark = v; applyTree(); })));
  panel.appendChild(row("Leaves", colorInput(state.tree.leaf, (v) => { state.tree.leaf = v; applyTree(); })));

  // --- grass
  panel.appendChild(header("Grass"));
  const grass = { color: world.grass.getColor(), wind: world.grass.getWind(), windSpeed: world.grass.getWindSpeed() };
  state.grass = state.grass || {};
  panel.appendChild(row("Grass", colorInput(state.grass.color || grass.color, (v) => { state.grass.color = v; world.grass.setColor(v); persist(); })));
  panel.appendChild(row("Wind sway", rangeInput(state.grass.wind ?? grass.wind, 0, 0.8, 0.01, (v) => { state.grass.wind = v; world.grass.setWind(v); persist(); })));
  panel.appendChild(row("Wind speed", rangeInput(state.grass.windSpeed ?? grass.windSpeed, 0, 5, 0.05, (v) => { state.grass.windSpeed = v; world.grass.setWindSpeed(v); persist(); })));

  // --- terrain gradient
  panel.appendChild(header("Terrain gradient (low → peaks)"));
  panel.appendChild(gradientEditor(getTerrainGradient(), (stops) => {
    state.terrain = stops;
    setTerrainGradient(stops);
    rafRebuild();
    persist();
  }));
  const gradHint = document.createElement("div");
  gradHint.textContent = "click bar: add · drag: move · click dot: colour · right-click: remove";
  gradHint.style.cssText = "font-size:9.5px;opacity:0.5;margin:-2px 0 2px;line-height:1.3;";
  panel.appendChild(gradHint);

  // --- sky + fog
  panel.appendChild(header("Sky gradient (horizon → zenith)"));
  panel.appendChild(gradientEditor(world.getSkyGradient(), (stops) => {
    state.skyGrad = stops; world.setSkyGradient(stops); persist();
  }));
  const skyHint = document.createElement("div");
  skyHint.textContent = "click bar: add · drag: move · click dot: colour · right-click: remove";
  skyHint.style.cssText = "font-size:9.5px;opacity:0.5;margin:-2px 0 2px;line-height:1.3;";
  panel.appendChild(skyHint);
  state.fog = state.fog || { color: fog.color, density: fog.density };
  const applyFog = () => { world.setFog(state.fog.color, state.fog.density); persist(); };
  panel.appendChild(row("Fog", colorInput(state.fog.color, (v) => { state.fog.color = v; applyFog(); })));
  panel.appendChild(row("Fog density", rangeInput(state.fog.density, 0, 0.03, 0.0005, (v) => { state.fog.density = v; applyFog(); })));

  // --- rock
  panel.appendChild(header("Rocks"));
  panel.appendChild(row("Rock", colorInput(rockHex, (v) => { state.rock = v; world.course.setRockColor(v); persist(); })));

  // --- water
  panel.appendChild(header("Water depth (deep → shore)"));
  panel.appendChild(gradientEditor(water.getDepthGradient(), (stops) => {
    state.waterGrad = stops; water.setDepthGradient(stops); persist();
  }));
  const waterHint = document.createElement("div");
  waterHint.textContent = "sampled into 4 flat bands · same controls as above";
  waterHint.style.cssText = "font-size:9.5px;opacity:0.5;margin:-2px 0 4px;line-height:1.3;";
  panel.appendChild(waterHint);
  state.water = state.water || {};
  for (const k of ["uSheen", "uFoam"]) {
    const cur = state.water[k] || waterCols[k];
    panel.appendChild(row(WATER_LABELS[k], colorInput(cur, (v) => { state.water[k] = v; water.setColor(k, v); persist(); })));
  }

  // --- water effect strengths + speed
  panel.appendChild(header("Water effects"));
  panel.appendChild(row("Speed", rangeInput(state.waterSpeed ?? water.getSpeed(), 0, 3, 0.05, (v) => { state.waterSpeed = v; water.setSpeed(v); persist(); })));
  state.waterFx = state.waterFx || {};
  for (const [label, key] of Object.entries(WATER_FX)) {
    const raw = key in state.waterFx ? state.waterFx[key] : water.getFx(key);
    const cur = typeof raw === "boolean" ? (raw ? 1 : 0) : raw; // migrate old on/off saves
    panel.appendChild(row(label, rangeInput(cur, 0, 1, 0.05, (v) => { state.waterFx[key] = v; water.setFx(key, v); persist(); })));
  }

  // --- export / import
  panel.appendChild(header("Share"));
  const io = document.createElement("textarea");
  io.readOnly = true;
  io.style.cssText = "width:100%;height:54px;box-sizing:border-box;font:11px/1.3 ui-monospace,monospace;background:rgba(0,0,0,0.35);color:#cfe;border:1px solid rgba(255,255,255,0.15);border-radius:6px;padding:6px;resize:vertical;display:none;";
  const btnRow = document.createElement("div");
  btnRow.style.cssText = "display:flex;gap:8px;";
  const btnStyle = "flex:1;padding:6px;font-size:12px;border-radius:6px;border:1px solid rgba(255,255,255,0.2);background:rgba(255,255,255,0.08);color:#eaf4fb;cursor:pointer;";

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
  panel.appendChild(btnRow);
  panel.appendChild(io);

  const hint = document.createElement("div");
  hint.textContent = "saved to localStorage · press ` to toggle";
  hint.style.cssText = "font-size:10px;opacity:0.55;margin-top:10px;text-align:right;";
  panel.appendChild(hint);

  document.body.appendChild(panel);

  window.addEventListener("keydown", (e) => {
    if (e.code === "Backquote" && !e.repeat) {
      e.preventDefault();
      panel.style.display = panel.style.display === "none" ? "block" : "none";
    }
  });

  return panel;
}

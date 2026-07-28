/**
 * Admin → Level Editor tab.
 *
 * A self-contained, top-down procedural course editor. Bend the fairway
 * centreline (which is the shape the lake is carved into), slide islands and
 * spire rocks around, tune channel width, then copy the HOLES array straight
 * back into src/holes.js. Edits are kept in localStorage so a refresh doesn't
 * lose your work; "Reset" restores the shipped holes.
 */
import { HOLES as DEFAULT_HOLES } from "../holes.js";
import { makeChannelCanvas, getNoise, setNoise } from "../channelrender.js";
import { buoysAlong, arrangeRocksAroundBuoys } from "../course.js";

// mirror of water.js constants (kept light so admin doesn't bundle three.js)
const LAKE_R = 64;
const CHANNEL_W = 13;
const VIEW_R = LAKE_R * 1.4;
const STORE_KEY = "skippidy.holes.draft";

export function initLevelEditor(panel) {
  const state = {
    holes: loadHoles(),
    idx: 0,
    tool: "move",
    sel: null, // { kind:'node'|'island'|'rock', i }
    dragging: false,
    noise: getNoise(), // shoreline edge noise (global, persisted)
  };

  panel.innerHTML = `
    <div class="lvl-wrap">
      <div class="lvl-side card">
        <h3>Course</h3>
        <div class="row">
          <button class="btn ghost" data-act="prev">◀</button>
          <span class="lvl-hole" data-el="holeLabel">Hole 1 / 3</span>
          <button class="btn ghost" data-act="next">▶</button>
        </div>
        <div class="row" style="margin-top:10px;">
          <button class="btn ghost" data-act="newHole">＋ New hole</button>
          <button class="btn ghost" data-act="delHole">🗑 Hole</button>
        </div>
        <div class="row" style="margin-top:10px;">
          <button class="btn ghost" data-act="arrangeRocks">🪨 Rocks around buoys</button>
        </div>

        <h3 style="margin-top:18px;">Tools</h3>
        <div class="lvl-tools">
          <button class="btn ghost tool on" data-tool="move">Move</button>
          <button class="btn ghost tool" data-tool="addNode">+ Node</button>
          <button class="btn ghost tool" data-tool="addIsland">+ Island</button>
          <button class="btn ghost tool" data-tool="addRock">+ Rock</button>
          <button class="btn ghost tool" data-tool="delete">Delete</button>
        </div>
        <p class="lvl-hint" data-el="hint"></p>

        <h3 style="margin-top:18px;">Selected</h3>
        <div class="lvl-sel" data-el="selBox"><span class="muted">Nothing selected</span></div>

        <h3 style="margin-top:18px;">Hole settings</h3>
        <div class="field">
          <label>Channel width <span class="val" data-el="wLabel">13</span></label>
          <input type="range" data-el="width" min="5" max="30" step="1" value="13">
        </div>
        <div class="field">
          <label>Time limit <span class="val" data-el="tLabel">90s</span></label>
          <input type="range" data-el="time" min="30" max="180" step="5" value="90">
        </div>

        <h3 style="margin-top:18px;">Shoreline noise <span class="muted" style="font-weight:400; text-transform:none; letter-spacing:0;">(global)</span></h3>
        <div class="field">
          <label>Frequency <span class="val" data-el="nfLabel">0.050</span></label>
          <input type="range" data-el="nfreq" min="0.005" max="0.15" step="0.005" value="0.05">
        </div>
        <div class="field">
          <label>Amplitude <span class="val" data-el="naLabel">7.0</span></label>
          <input type="range" data-el="namp" min="0" max="18" step="0.5" value="7">
        </div>
      </div>

      <div class="lvl-stage">
        <div class="card" style="padding:12px;">
          <canvas data-el="canvas" width="760" height="760"></canvas>
        </div>
        <div class="row" style="margin-top:12px; justify-content:center;">
          <button class="btn blue" data-act="export">Copy HOLES JSON</button>
          <button class="btn ghost" data-act="reset">Reset to shipped</button>
        </div>
        <textarea class="lvl-json" data-el="json" readonly spellcheck="false"></textarea>
      </div>
    </div>`;

  injectStyles();

  const els = {
    holeLabel: q("holeLabel"), hint: q("hint"), selBox: q("selBox"),
    wLabel: q("wLabel"), width: q("width"), tLabel: q("tLabel"), time: q("time"),
    nfreq: q("nfreq"), nfLabel: q("nfLabel"), namp: q("namp"), naLabel: q("naLabel"),
    canvas: q("canvas"), json: q("json"),
  };
  function q(name) { return panel.querySelector(`[data-el="${name}"]`); }
  const ctx = els.canvas.getContext("2d");
  const hole = () => state.holes[state.idx];

  // ---------------------------------------------------------------- interactions
  panel.addEventListener("click", (e) => {
    const tool = e.target.getAttribute?.("data-tool");
    if (tool) return setTool(tool);
    const act = e.target.getAttribute?.("data-act");
    if (act) action(act);
  });

  els.width.addEventListener("input", () => { hole().width = +els.width.value; els.wLabel.textContent = els.width.value; persist(); draw(); });
  els.time.addEventListener("input", () => { hole().time = +els.time.value; els.tLabel.textContent = els.time.value + "s"; persist(); });
  els.nfreq.addEventListener("input", () => { state.noise.freq = +els.nfreq.value; els.nfLabel.textContent = (+els.nfreq.value).toFixed(3); setNoise(state.noise); draw(); });
  els.namp.addEventListener("input", () => { state.noise.amp = +els.namp.value; els.naLabel.textContent = (+els.namp.value).toFixed(1); setNoise(state.noise); draw(); });

  els.canvas.addEventListener("pointerdown", (e) => {
    els.canvas.setPointerCapture(e.pointerId);
    const w = toWorld(e);
    if (state.tool === "move" || state.tool === "delete") {
      state.sel = hit(w);
      if (state.tool === "delete" && state.sel) { deleteSel(); state.sel = null; }
      else state.dragging = !!state.sel;
    } else if (state.tool === "addNode") addNode(w);
    else if (state.tool === "addIsland") { hole().islands.push({ x: rnd(w.x), z: rnd(w.z), r: 3.2 }); state.sel = { kind: "island", i: hole().islands.length - 1 }; }
    else if (state.tool === "addRock") { hole().rocks.push({ x: rnd(w.x), z: rnd(w.z), r: 4.5, h: 8 }); state.sel = { kind: "rock", i: hole().rocks.length - 1 }; }
    persist(); syncSel(); draw();
  });
  els.canvas.addEventListener("pointermove", (e) => {
    if (!state.dragging || !state.sel) return;
    const w = toWorld(e);
    const t = target(state.sel);
    if (t) { t.x = rnd(w.x); t.z = rnd(w.z); }
    persist(); syncSel(); draw();
  });
  const endDrag = () => { state.dragging = false; };
  els.canvas.addEventListener("pointerup", endDrag);
  els.canvas.addEventListener("pointercancel", endDrag);

  // ---------------------------------------------------------------- helpers
  function target(sel) {
    if (!sel) return null;
    const h = hole();
    return sel.kind === "node" ? h.path[sel.i] : sel.kind === "island" ? h.islands[sel.i] : h.rocks[sel.i];
  }

  function hit(w) {
    const h = hole();
    let best = null, bestD = 6;
    h.path.forEach((p, i) => { const d = dist(p, w); if (d < bestD) { bestD = d; best = { kind: "node", i }; } });
    if (best) return best;
    let area = Infinity;
    h.islands.forEach((p, i) => { const d = dist(p, w); if (d < p.r + 2 && d < area) { area = d; best = { kind: "island", i }; } });
    h.rocks.forEach((p, i) => { const d = dist(p, w); if (d < p.r + 2 && d < area) { area = d; best = { kind: "rock", i }; } });
    return best;
  }

  function addNode(w) {
    const path = hole().path;
    let seg = -1, sd = Infinity;
    for (let i = 0; i < path.length - 1; i++) { const d = segDist(w, path[i], path[i + 1]); if (d < sd) { sd = d; seg = i; } }
    const node = { x: rnd(w.x), z: rnd(w.z) };
    if (sd < 9 && seg >= 0) { path.splice(seg + 1, 0, node); state.sel = { kind: "node", i: seg + 1 }; }
    else { path.push(node); state.sel = { kind: "node", i: path.length - 1 }; }
  }

  function deleteSel() {
    const h = hole(), s = state.sel;
    if (s.kind === "node") { if (h.path.length > 2) h.path.splice(s.i, 1); }
    else if (s.kind === "island") h.islands.splice(s.i, 1);
    else if (s.kind === "rock") h.rocks.splice(s.i, 1);
    persist();
  }

  function setTool(tool) {
    state.tool = tool;
    panel.querySelectorAll(".tool").forEach((b) => b.classList.toggle("on", b.getAttribute("data-tool") === tool));
    els.hint.textContent = {
      move: "Drag the tee (green T), fairway nodes (blue), islands (sand) or rocks (grey). The blue ribbon is the water — bending it reshapes the lake.",
      addNode: "Tap on/near the fairway to insert a bend, or far away to extend toward the flag.",
      addIsland: "Tap to drop a sandy rest-stop island.",
      addRock: "Tap to drop a spire obstacle.",
      delete: "Tap any element to remove it (a hole keeps at least 2 nodes).",
    }[tool];
  }

  function action(act) {
    const h = hole();
    switch (act) {
      case "prev": go(state.idx - 1); break;
      case "next": go(state.idx + 1); break;
      case "newHole":
        state.holes.push({ time: 90, width: CHANNEL_W, path: [{ x: 0, z: 40 }, { x: 0, z: 0 }, { x: 0, z: -40 }], islands: [], rocks: [] });
        go(state.holes.length - 1); break;
      case "delHole":
        if (state.holes.length > 1) { state.holes.splice(state.idx, 1); go(Math.min(state.idx, state.holes.length - 1)); }
        break;
      case "arrangeRocks":
        h.rocks = arrangeRocksAroundBuoys(h.rocks, h.path, h.width ?? CHANNEL_W, h.islands);
        state.sel = null; persist(); syncSel(); flash(`Moved ${h.rocks.length} rocks around the buoys ✓`); break;
      case "delSel": if (state.sel) { deleteSel(); state.sel = null; syncSel(); draw(); } break;
      case "reset":
        if (confirm("Discard your draft and reload the shipped holes?")) { state.holes = clone(DEFAULT_HOLES); state.idx = 0; state.sel = null; persist(); go(0); }
        break;
      case "export": exportJson(); break;
    }
    persist();
  }

  function go(i) {
    if (i < 0 || i >= state.holes.length) return;
    state.idx = i; state.sel = null; syncHole(); syncSel(); draw();
  }

  async function exportJson() {
    const clean = state.holes.map((h) => ({
      time: h.time ?? 90, width: h.width ?? CHANNEL_W,
      path: h.path.map((p) => ({ x: p.x, z: p.z })),
      islands: h.islands.map((p) => ({ x: p.x, z: p.z, r: p.r })),
      rocks: h.rocks.map((p) => ({ x: p.x, z: p.z, r: p.r, h: p.h })),
    }));
    const noiseNote = `// shoreline noise (set DEFAULT_NOISE in src/channelrender.js): { freq: ${(+state.noise.freq).toFixed(3)}, amp: ${(+state.noise.amp).toFixed(1)} }\n`;
    const txt = noiseNote + "export const HOLES = " + JSON.stringify(clean, null, 2) + ";\n";
    els.json.value = txt;
    els.json.classList.add("show");
    try { await navigator.clipboard.writeText(txt); flash("Copied to clipboard ✓"); }
    catch { flash("Select the text below and copy it."); }
  }
  function flash(msg) { els.hint.textContent = msg; }

  // ---------------------------------------------------------------- sync + persist
  function persist() { try { localStorage.setItem(STORE_KEY, JSON.stringify(state.holes)); } catch { /* ignore */ } }

  function syncHole() {
    const h = hole();
    els.holeLabel.textContent = `Hole ${state.idx + 1} / ${state.holes.length}`;
    els.width.value = h.width ?? CHANNEL_W; els.wLabel.textContent = String(h.width ?? CHANNEL_W);
    els.time.value = h.time ?? 90; els.tLabel.textContent = (h.time ?? 90) + "s";
  }

  function syncSel() {
    const s = state.sel, box = els.selBox;
    if (!s) { box.innerHTML = '<span class="muted">Nothing selected</span>'; return; }
    const t = target(s);
    if (!t) { box.innerHTML = '<span class="muted">Nothing selected</span>'; return; }
    let rows = `<div class="kv"><span>type</span><b>${s.kind}${s.kind === "node" ? ` #${s.i + 1}` : ""}</b></div>`;
    rows += numRow("x", t, "x", -VIEW_R, VIEW_R, 0.5);
    rows += numRow("z", t, "z", -VIEW_R, VIEW_R, 0.5);
    if (s.kind === "island") rows += numRow("radius", t, "r", 1, 8, 0.2);
    if (s.kind === "rock") { rows += numRow("radius", t, "r", 2, 8, 0.2); rows += numRow("height", t, "h", 3, 14, 0.5); }
    rows += `<button class="btn ghost" data-act="delSel" style="margin-top:8px;">Delete selected</button>`;
    box.innerHTML = rows;
    box.querySelectorAll("input[data-prop]").forEach((inp) => {
      inp.addEventListener("input", () => {
        const t2 = target(state.sel); if (!t2) return;
        t2[inp.dataset.prop] = +inp.value;
        inp.parentElement.querySelector(".val").textContent = (+inp.value).toFixed(1);
        persist(); draw();
      });
    });
  }
  function numRow(label, obj, prop, min, max, step) {
    const v = obj[prop] ?? 0;
    return `<div class="field mini"><label>${label} <span class="val">${(+v).toFixed(1)}</span></label>
      <input type="range" data-prop="${prop}" min="${min}" max="${max}" step="${step}" value="${v}"></div>`;
  }

  // ---------------------------------------------------------------- coord map
  function toWorld(e) {
    const r = els.canvas.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width * 2 - 1) * VIEW_R, z: ((e.clientY - r.top) / r.height * 2 - 1) * VIEW_R };
  }
  function toPx(x, z) { const s = els.canvas.width; return { x: (x / VIEW_R * 0.5 + 0.5) * s, y: (z / VIEW_R * 0.5 + 0.5) * s }; }
  const wpx = (u) => u / VIEW_R * 0.5 * els.canvas.width;

  // ---------------------------------------------------------------- render
  function draw() {
    const s = els.canvas.width, h = hole();
    // organic water channel + sandy banks + grass — shared with the minimap so
    // the editor previews exactly the noise-broken shape the game renders.
    const layer = makeChannelCanvas({
      res: 200,
      pxToWorld: (u, v) => ({ x: (u * 2 - 1) * VIEW_R, z: (v * 2 - 1) * VIEW_R }),
      path: h.path, width: h.width ?? CHANNEL_W, grass: "#6fb254",
      noiseFreq: state.noise.freq, noiseAmp: state.noise.amp,
    });
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(layer, 0, 0, s, s);
    ctx.save();

    // playable lake bounds
    const c = toPx(0, 0), rr = wpx(LAKE_R);
    ctx.beginPath(); ctx.arc(c.x, c.y, rr, 0, Math.PI * 2);
    ctx.setLineDash([6, 6]); ctx.strokeStyle = "rgba(255,255,255,0.4)"; ctx.lineWidth = 1.5; ctx.stroke();
    ctx.setLineDash([]);

    // buoys along the path
    if (h.path.length >= 2) buoysAlong(h.path, h.islands).forEach((b) => { const g = toPx(b.x, b.z); dotPx(g, 3, "#ff8a3d", "#fdf6e3"); });

    // rocks
    h.rocks.forEach((p, i) => blob(p, wpx(p.r), "#8a959b", "#5d686e", isSel("rock", i), `${p.h}`));
    // islands
    h.islands.forEach((p, i) => blob(p, wpx(p.r), "#e7cf93", "#c9a34f", isSel("island", i)));
    // path nodes
    h.path.forEach((p, i) => {
      const tee = i === 0, flag = i === h.path.length - 1;
      node(p, tee ? "#5fe08a" : flag ? "#ff6b6b" : "#7fc4ff", isSel("node", i), tee ? "T" : flag ? "F" : String(i));
    });
    ctx.restore();
  }

  function isSel(kind, i) { return state.sel && state.sel.kind === kind && state.sel.i === i; }
  function blob(p, r, fill, edge, sel, label) {
    const g = toPx(p.x, p.z);
    ctx.beginPath(); ctx.arc(g.x, g.y, Math.max(6, r), 0, Math.PI * 2);
    ctx.fillStyle = fill; ctx.fill();
    ctx.lineWidth = sel ? 4 : 2; ctx.strokeStyle = sel ? "#fff" : edge; ctx.stroke();
    if (label) { ctx.fillStyle = "#16324a"; ctx.font = "bold 12px system-ui"; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(label, g.x, g.y); }
  }
  function node(p, color, sel, label) {
    const g = toPx(p.x, p.z);
    ctx.beginPath(); ctx.arc(g.x, g.y, sel ? 11 : 8, 0, Math.PI * 2);
    ctx.fillStyle = color; ctx.fill();
    ctx.lineWidth = sel ? 4 : 2; ctx.strokeStyle = sel ? "#fff" : "#16324a"; ctx.stroke();
    if (label) { ctx.fillStyle = "#16324a"; ctx.font = "bold 11px system-ui"; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(label, g.x, g.y); }
  }
  function dotPx(g, r, fill, edge) {
    ctx.beginPath(); ctx.arc(g.x, g.y, r, 0, Math.PI * 2); ctx.fillStyle = fill; ctx.fill();
    ctx.lineWidth = 1; ctx.strokeStyle = edge; ctx.stroke();
  }

  // boot
  setTool("move");
  syncHole();
  els.nfreq.value = state.noise.freq; els.nfLabel.textContent = (+state.noise.freq).toFixed(3);
  els.namp.value = state.noise.amp; els.naLabel.textContent = (+state.noise.amp).toFixed(1);
  syncSel();
  draw();
}

// -------------------------------------------------------------------- utilities
function dist(a, b) { return Math.hypot(a.x - b.x, a.z - b.z); }
function segDist(p, a, b) {
  const bax = b.x - a.x, baz = b.z - a.z, pax = p.x - a.x, paz = p.z - a.z;
  const len2 = bax * bax + baz * baz || 1;
  const t = Math.min(1, Math.max(0, (pax * bax + paz * baz) / len2));
  return Math.hypot(pax - bax * t, paz - baz * t);
}
function rnd(v) { return Math.round(v * 10) / 10; }
function clone(x) { return JSON.parse(JSON.stringify(x)); }
function loadHoles() {
  try { const raw = localStorage.getItem(STORE_KEY); if (raw) { const p = JSON.parse(raw); if (Array.isArray(p) && p.length) return p; } } catch { /* ignore */ }
  return clone(DEFAULT_HOLES);
}

function injectStyles() {
  if (document.getElementById("lvled-style")) return;
  const st = document.createElement("style");
  st.id = "lvled-style";
  st.textContent = `
    .lvl-wrap { display: grid; grid-template-columns: 300px 1fr; gap: 18px; align-items: start; margin-top: 18px; }
    @media (max-width: 900px) { .lvl-wrap { grid-template-columns: 1fr; } }
    .lvl-stage canvas { display: block; width: 100%; max-width: 760px; aspect-ratio: 1; border-radius: 12px; touch-action: none; cursor: crosshair; margin: 0 auto; }
    .lvl-hole { font-weight: 800; color: var(--gold); padding: 0 6px; }
    .lvl-tools { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
    .lvl-tools .tool.on { background: var(--accent2); color: var(--ink); border-color: var(--accent2); }
    .lvl-hint { font-size: 12px; opacity: 0.75; margin-top: 10px; min-height: 2.4em; }
    .lvl-sel { font-size: 13px; }
    .lvl-sel .muted { opacity: 0.5; }
    .lvl-sel .kv { display: flex; justify-content: space-between; padding: 2px 0; }
    .field.mini { margin-bottom: 8px; }
    .field.mini label { font-size: 11px; }
    .lvl-json { width: 100%; height: 120px; margin-top: 12px; display: none; background: #06202f; color: #bfe2ff; border: 1px solid rgba(255,255,255,0.15); border-radius: 8px; padding: 10px; font: 11px/1.45 ui-monospace, monospace; resize: vertical; }
    .lvl-json.show { display: block; }
  `;
  document.head.appendChild(st);
}

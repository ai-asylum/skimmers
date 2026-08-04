/**
 * Admin → Level Editor tab.
 *
 * A self-contained, top-down procedural course editor. Bend the fairway
 * centreline (which is the shape the lake is carved into), slide islands and
 * spire rocks around, drop and drag the furniture — waterfalls, dams, bridges,
 * caves, mill wheels, fallen trees, rapids, ice and weed beds — tune
 * channel width and current, then copy the HOLES array straight back into
 * src/holes.js. Edits are kept in localStorage so a refresh doesn't lose your
 * work; "Reset" restores the shipped holes.
 *
 * Every redraw runs src/holerules.js, the same rules scripts/checkholes.mjs
 * gates the build on, so a hole that will not pass says so under the canvas
 * while you are still holding the thing that broke it.
 */
import { HOLES as DEFAULT_HOLES } from "../holes.js";
import { makeChannelCanvas, getNoise, setNoise } from "../channelrender.js";
import { buoysAlong, arrangeRocksAroundBuoys } from "../course.js";
import { holeWarnings, ownerLine } from "../holerules.js";
import { LAKE_R, CHANNEL_W } from "../limits.js";

// holes run corner to corner now, well past the lake radius (terrain.js pulls
// the mountain ring back around the channel), so the editor has to show that
const VIEW_R = LAKE_R * 1.7;
const STORE_KEY = "skippidy.holes.draft";

/**
 * Everything a hole can have in it besides its path, islands and spires: the
 * furniture from src/props.js and the water patches from src/water.js. One
 * table drives the placing tool, the drag hit-test, the numbers in the Selected
 * panel and the plan-view drawing, so adding a prop kind is adding a row here.
 *
 * `shape` is only how it reads on this canvas — props.js owns the real
 * dimensions. `bar` spans the channel at the local flow angle, `run` is a
 * stretch of river laid along it, `disc` is a thing sitting in it.
 */
const PROP_SPECS = {
  falls: {
    label: "Waterfall", shape: "bar", color: "#bfe9ff", tag: (o) => `${o.drop}`,
    make: () => ({ drop: 5 }), fields: [["drop", 2.5, 9, 0.5]],
  },
  dams: {
    label: "Beaver dam", shape: "bar", color: "#9a6a3a", tag: (o) => `${o.gap}`,
    make: () => ({ notch: 0, gap: 2.6, drop: 2.8 }),
    fields: [["notch", -9, 9, 0.5], ["gap", 1.8, 6, 0.2], ["drop", 2.5, 6, 0.1]],
  },
  bridges: {
    label: "Bridge", shape: "bar", color: "#c08b4a", tag: (o) => `${o.clear}`,
    make: () => ({ clear: 2.4, piers: 2 }), fields: [["clear", 1.6, 5, 0.1], ["piers", 1, 3, 1]],
  },
  logs: {
    label: "Fallen tree", shape: "bar", color: "#7a5230", tag: (o) => `${o.clear}`,
    make: () => ({ clear: 2, tilt: 2.6, bank: 1 }),
    fields: [["clear", 1.2, 4, 0.1], ["tilt", 1.2, 4, 0.1], ["bank", -1, 1, 2]],
  },
  caves: {
    label: "Cave", shape: "run", color: "rgba(40,30,52,0.75)", ink: "#e6dcff",
    len: (o) => o.len ?? 18, tag: (o) => `roof ${o.clear}`,
    make: () => ({ len: 18, clear: 3.6, pillars: 2 }),
    fields: [["len", 10, 30, 1], ["clear", 2.6, 6, 0.1], ["pillars", 0, 3, 1]],
  },
  rapids: {
    label: "Rapids", shape: "run", color: "rgba(255,255,255,0.5)", len: (o) => o.len ?? 18,
    tag: (o) => `×${o.mul}`, make: () => ({ len: 18, mul: 2.4 }),
    fields: [["len", 10, 40, 1], ["mul", 1.2, 4, 0.1]],
  },
  ice: {
    label: "Ice sheet", shape: "run", color: "rgba(150,206,232,0.85)", len: (o) => o.len ?? 24,
    tag: () => "ice", make: () => ({ len: 24 }), fields: [["len", 10, 40, 1]],
  },
  wheels: {
    label: "Mill wheel", shape: "disc", color: "#8d6a45", edge: "#4d3826", tag: () => "M",
    r: (o) => o.r ?? 4.2, make: () => ({ r: 4.2, rpm: 8, bank: 1 }),
    fields: [["r", 3, 6, 0.1], ["rpm", 2, 24, 0.5], ["bank", -1, 1, 2]],
  },
  weeds: {
    label: "Weed bed", shape: "disc", color: "rgba(79,143,82,0.75)", edge: "#2f6b34",
    r: (o) => o.r ?? 5, make: () => ({ r: 5 }), fields: [["r", 2, 10, 0.5]],
  },
};
const PROP_KEYS = Object.keys(PROP_SPECS);

export function initLevelEditor(panel) {
  const state = {
    holes: loadHoles(),
    idx: 0,
    tool: "move",
    sel: null, // { kind:'node'|'island'|'rock'|<a PROP_SPECS key>, i }
    propKind: "falls", // what "+ Prop" drops
    dragging: false,
    noise: getNoise(), // shoreline edge noise (global, persisted)
  };

  panel.innerHTML = `
    <div class="lvl-wrap">
      <div class="lvl-side card">
        <h3>Course</h3>
        <div class="row">
          <button class="btn ghost" data-act="prev">←</button>
          <span class="lvl-hole" data-el="holeLabel">Hole 1 / 3</span>
          <button class="btn ghost" data-act="next">→</button>
        </div>
        <div class="row" style="margin-top:10px;">
          <button class="btn ghost" data-act="newHole">＋ New hole</button>
          <button class="btn ghost" data-act="delHole">− Delete hole</button>
        </div>
        <div class="row" style="margin-top:10px;">
          <button class="btn ghost" data-act="arrangeRocks">Rocks around buoys</button>
        </div>

        <h3 style="margin-top:18px;">Tools</h3>
        <div class="lvl-tools">
          <button class="btn ghost tool on" data-tool="move">Move</button>
          <button class="btn ghost tool" data-tool="addNode">+ Node</button>
          <button class="btn ghost tool" data-tool="addIsland">+ Island</button>
          <button class="btn ghost tool" data-tool="addRock">+ Rock</button>
          <button class="btn ghost tool" data-tool="addProp">+ Prop</button>
          <button class="btn ghost tool" data-tool="addCut">+ Shortcut</button>
          <button class="btn ghost tool" data-tool="delete">Delete</button>
        </div>
        <select class="lvl-prop" data-el="propKind">
          ${PROP_KEYS.map((k) => `<option value="${k}">${PROP_SPECS[k].label}</option>`).join("")}
        </select>
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
        <div class="field">
          <label>Current <span class="val" data-el="fLabel">still</span></label>
          <input type="range" data-el="flow" min="0" max="9" step="0.1" value="0">
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
        <div class="lvl-warn" data-el="warn"></div>
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
    flow: q("flow"), fLabel: q("fLabel"), propKind: q("propKind"),
    nfreq: q("nfreq"), nfLabel: q("nfLabel"), namp: q("namp"), naLabel: q("naLabel"),
    canvas: q("canvas"), json: q("json"), warn: q("warn"),
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
  els.flow.addEventListener("input", () => {
    const v = +els.flow.value;
    hole().flow = v;
    els.fLabel.textContent = v ? `${v.toFixed(1)} u/s` : "still";
    persist(); draw();
  });
  els.propKind.addEventListener("change", () => { state.propKind = els.propKind.value; setTool("addProp"); });
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
    else if (state.tool === "addProp") addProp(w);
    else if (state.tool === "addCut") addCutNode(w);
    persist(); syncSel(); draw();
  });
  els.canvas.addEventListener("pointermove", (e) => {
    if (!state.dragging || !state.sel) return;
    const w = toWorld(e);
    const t = target(state.sel);
    if (!t) return;
    // The two ends of a shortcut belong to the main line — they are the fork
    // and the rejoin — so they stick to it as you drag rather than having to be
    // landed on it by eye.
    const p = state.sel.kind === "cut" && endOfCut(state.sel) ? snapToLine(w, 9) : w;
    t.x = rnd(p.x); t.z = rnd(p.z);
    persist(); syncSel(); draw();
  });
  const endDrag = () => { state.dragging = false; };
  els.canvas.addEventListener("pointerup", endDrag);
  els.canvas.addEventListener("pointercancel", endDrag);

  // ---------------------------------------------------------------- helpers
  function target(sel) {
    if (!sel) return null;
    const h = hole();
    if (sel.kind === "cut") return h.branches?.[sel.b]?.path?.[sel.i];
    if (PROP_SPECS[sel.kind]) return h[sel.kind]?.[sel.i];
    return sel.kind === "node" ? h.path[sel.i] : sel.kind === "island" ? h.islands[sel.i] : h.rocks[sel.i];
  }

  function hit(w) {
    const h = hole();
    let best = null, bestD = 6;
    h.path.forEach((p, i) => { const d = dist(p, w); if (d < bestD) { bestD = d; best = { kind: "node", i }; } });
    (h.branches ?? []).forEach((b, bi) => {
      b.path.forEach((p, i) => { const d = dist(p, w); if (d < bestD) { bestD = d; best = { kind: "cut", b: bi, i }; } });
    });
    if (best) return best;
    // furniture next: it is smaller than the islands it sits between, and the
    // whole point of the tool is being able to grab it
    let area = Infinity;
    for (const key of PROP_KEYS) {
      (h[key] ?? []).forEach((p, i) => {
        const d = dist(p, w);
        if (d < pickR(key, p) && d < area) { area = d; best = { kind: key, i }; }
      });
    }
    if (best) return best;
    h.islands.forEach((p, i) => { const d = dist(p, w); if (d < p.r + 2 && d < area) { area = d; best = { kind: "island", i }; } });
    h.rocks.forEach((p, i) => { const d = dist(p, w); if (d < p.r + 2 && d < area) { area = d; best = { kind: "rock", i }; } });
    return best;
  }

  /** how close you have to tap a prop to grab it, in world units */
  function pickR(key, o) {
    const spec = PROP_SPECS[key];
    return spec.shape === "disc" ? Math.max(3, spec.r(o)) : 4.5;
  }

  function addProp(w) {
    const h = hole(), key = state.propKind;
    const list = (h[key] ??= []);
    list.push({ x: rnd(w.x), z: rnd(w.z), ...PROP_SPECS[key].make() });
    state.sel = { kind: key, i: list.length - 1 };
  }

  /**
   * Draw a shortcut a tap at a time. The first tap plants the fork on the main
   * line, the taps after it walk the branch away from the river, and a tap back
   * near the line finishes it there. Anything dropped within snapping distance
   * of the main line lands *on* it, because a branch that starts or ends a
   * couple of metres out is a lagoon, not a way round (holerules.js).
   */
  function addCutNode(w) {
    const h = hole();
    const list = (h.branches ??= []);
    const open = state.sel?.kind === "cut" ? list[state.sel.b] : null;
    const near = snapToLine(w, 9);
    if (!open) {
      const cut = { width: +((h.width ?? CHANNEL_W) * 0.62).toFixed(1), path: [near] };
      list.push(cut);
      state.sel = { kind: "cut", b: list.length - 1, i: 0 };
      return;
    }
    open.path.push(near);
    state.sel = { kind: "cut", b: state.sel.b, i: open.path.length - 1 };
  }

  /** the nearest point on the main line, if it is within `within` of (x,z) */
  function snapToLine(w, within) {
    const p = hole().path;
    let best = null, bestD = within;
    for (let i = 0; i < p.length - 1; i++) {
      const a = p[i], b = p[i + 1];
      const bax = b.x - a.x, baz = b.z - a.z;
      const len2 = bax * bax + baz * baz || 1;
      const t = Math.min(1, Math.max(0, ((w.x - a.x) * bax + (w.z - a.z) * baz) / len2));
      const cx = a.x + bax * t, cz = a.z + baz * t;
      const d = Math.hypot(w.x - cx, w.z - cz);
      if (d < bestD) { bestD = d; best = { x: rnd(cx), z: rnd(cz) }; }
    }
    return best ?? { x: rnd(w.x), z: rnd(w.z) };
  }

  /** true for the fork and the rejoin — the two nodes that live on the river */
  function endOfCut(sel) {
    const cut = hole().branches?.[sel.b];
    return !!cut && (sel.i === 0 || sel.i === cut.path.length - 1);
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
    if (s.kind === "cut") {
      const cut = h.branches?.[s.b];
      if (!cut) return;
      cut.path.splice(s.i, 1);
      // a shortcut needs a fork and a rejoin; below that it is just a puddle
      if (cut.path.length < 2) h.branches.splice(s.b, 1);
      if (!h.branches.length) delete h.branches;
    } else if (PROP_SPECS[s.kind]) h[s.kind]?.splice(s.i, 1);
    else if (s.kind === "node") { if (h.path.length > 2) h.path.splice(s.i, 1); }
    else if (s.kind === "island") h.islands.splice(s.i, 1);
    else if (s.kind === "rock") h.rocks.splice(s.i, 1);
    persist();
  }

  function setTool(tool) {
    state.tool = tool;
    panel.querySelectorAll(".tool").forEach((b) => b.classList.toggle("on", b.getAttribute("data-tool") === tool));
    els.propKind.classList.toggle("show", tool === "addProp");
    // starting a fresh shortcut means starting from nothing selected; keeping a
    // branch node selected is how you carry on drawing the one you have
    if (tool === "addCut" && state.sel?.kind !== "cut") state.sel = null;
    els.hint.textContent = {
      move: "Drag the tee (green T), fairway nodes (blue), islands (sand), rocks (grey) or any prop. The blue ribbon is the water — bending it reshapes the lake.",
      addNode: "Tap on/near the fairway to insert a bend, or far away to extend toward the flag.",
      addIsland: "Tap to drop a sandy rest-stop island.",
      addRock: "Tap to drop a spire obstacle.",
      addProp: `Tap to drop a ${PROP_SPECS[state.propKind].label.toLowerCase()}. It takes its angle from the fairway, so place it after you have bent the line.`,
      addCut: "Tap the fairway to fork off it, tap out into the bank to shape the shortcut, then tap the fairway again to rejoin. Select a node of it first to carry on drawing that one.",
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
    const clean = state.holes.map((h) => {
      const out = {
        time: h.time ?? 90, width: h.width ?? CHANNEL_W,
        path: h.path.map((p) => ({ x: p.x, z: p.z })),
        islands: h.islands.map((p) => ({ x: p.x, z: p.z, r: p.r })),
        rocks: h.rocks.map((p) => ({ x: p.x, z: p.z, r: p.r, h: p.h })),
      };
      if (h.flow) out.flow = +(+h.flow).toFixed(1);
      if (h.branches?.length) {
        out.branches = h.branches.map((b) => ({
          width: +(+b.width).toFixed(1),
          path: b.path.map((p) => ({ x: p.x, z: p.z })),
        }));
      }
      for (const k of PROP_KEYS) if (h[k]?.length) out[k] = h[k].map((o) => tidy(o));
      return out;
    });
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
    const f = h.flow ?? 0;
    els.flow.value = f; els.fLabel.textContent = f ? `${(+f).toFixed(1)} u/s` : "still";
  }

  function syncSel() {
    const s = state.sel, box = els.selBox;
    if (!s) { box.innerHTML = '<span class="muted">Nothing selected</span>'; return; }
    const t = target(s);
    if (!t) { box.innerHTML = '<span class="muted">Nothing selected</span>'; return; }
    const spec = PROP_SPECS[s.kind];
    const cut = s.kind === "cut" ? hole().branches?.[s.b] : null;
    const name = spec ? spec.label
      : cut ? `shortcut ${s.b + 1} · node ${s.i + 1}/${cut.path.length}`
        : s.kind + (s.kind === "node" ? ` #${s.i + 1}` : "");
    let rows = `<div class="kv"><span>type</span><b>${name}</b></div>`;
    rows += numRow("x", t, "x", -VIEW_R, VIEW_R, 0.5);
    rows += numRow("z", t, "z", -VIEW_R, VIEW_R, 0.5);
    // the width belongs to the whole shortcut, not to the node you grabbed
    if (cut) rows += numRow("cut width", cut, "width", 4, 20, 0.5, "cut");
    if (spec) for (const [prop, min, max, step] of spec.fields) rows += numRow(prop, t, prop, min, max, step);
    if (s.kind === "island") rows += numRow("radius", t, "r", 1, 8, 0.2);
    if (s.kind === "rock") { rows += numRow("radius", t, "r", 2, 8, 0.2); rows += numRow("height", t, "h", 3, 14, 0.5); }
    rows += `<button class="btn ghost" data-act="delSel" style="margin-top:8px;">Delete selected</button>`;
    box.innerHTML = rows;
    box.querySelectorAll("input[data-prop]").forEach((inp) => {
      inp.addEventListener("input", () => {
        const t2 = inp.dataset.on === "cut" ? hole().branches?.[state.sel.b] : target(state.sel);
        if (!t2) return;
        t2[inp.dataset.prop] = +inp.value;
        inp.parentElement.querySelector(".val").textContent = (+inp.value).toFixed(1);
        persist(); draw();
      });
    });
  }
  function numRow(label, obj, prop, min, max, step, on = "") {
    const v = obj[prop] ?? 0;
    return `<div class="field mini"><label>${label} <span class="val">${(+v).toFixed(1)}</span></label>
      <input type="range" data-prop="${prop}"${on ? ` data-on="${on}"` : ""} min="${min}" max="${max}" step="${step}" value="${v}"></div>`;
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
      path: h.path, width: h.width ?? CHANNEL_W, branches: h.branches, grass: "#6fb254",
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
    drawProps(h);
    // shortcuts: the line they run, then their nodes, in the lime the minimap
    // uses so the editor and the map agree about which line is which
    (h.branches ?? []).forEach((b, bi) => {
      ctx.beginPath();
      b.path.forEach((p, i) => { const g = toPx(p.x, p.z); i ? ctx.lineTo(g.x, g.y) : ctx.moveTo(g.x, g.y); });
      ctx.strokeStyle = "rgba(154,222,60,0.85)"; ctx.lineWidth = 3; ctx.setLineDash([5, 5]);
      ctx.lineCap = "round"; ctx.stroke(); ctx.setLineDash([]);
      b.path.forEach((p, i) => {
        const end = i === 0 || i === b.path.length - 1;
        node(p, end ? "#d8f36a" : "#9ade3c", isSel("cut", i, bi), end ? (i ? "⤿" : "⤾") : "");
      });
    });
    // path nodes
    h.path.forEach((p, i) => {
      const tee = i === 0, flag = i === h.path.length - 1;
      node(p, tee ? "#5fe08a" : flag ? "#ff6b6b" : "#7fc4ff", isSel("node", i), tee ? "T" : flag ? "F" : String(i));
    });
    ctx.restore();
    report(h);
  }

  /**
   * The same rules scripts/checkholes.mjs fails the build on, run on every
   * redraw. Dragging a dam into the bank should tell you so while your finger
   * is still on it, not two days later in CI.
   */
  function report(h) {
    let list = [];
    try { list = holeWarnings(h); }
    catch (e) { list = [`the rule checker fell over: ${e.message}`]; }
    els.warn.className = "lvl-warn" + (list.length ? " bad" : " ok");
    els.warn.innerHTML = list.length
      ? `<b>${list.length} problem${list.length > 1 ? "s" : ""}</b><ul>${list.map((w) => `<li>${esc(w)}</li>`).join("")}</ul>`
      : "<b>Hole checks out ✓</b>";
  }

  /**
   * Furniture and water patches, drawn flat and in one pass off PROP_SPECS:
   * `run` stretches lie along the channel and go down first so the things that
   * cross it read on top. Everything here is a marker, not a footprint —
   * props.js owns the real dimensions.
   */
  function drawProps(h) {
    const order = { run: 0, bar: 1, disc: 2 };
    const items = [];
    for (const key of PROP_KEYS) (h[key] ?? []).forEach((o, i) => items.push({ key, o, i }));
    items.sort((a, b) => order[PROP_SPECS[a.key].shape] - order[PROP_SPECS[b.key].shape]);

    for (const { key, o, i } of items) {
      const spec = PROP_SPECS[key], sel = isSel(key, i);
      // measured against the channel it is standing in: a log across a shortcut
      // lies at the shortcut's angle and only spans the shortcut's width
      const line = ownerLine(h, o.x, o.z);
      const W = line.width;
      const [ux, uz] = tangentAt(o.x, o.z, line.path);
      if (spec.shape === "run") {
        const half = spec.len(o) / 2;
        stroke(toPx(o.x - ux * half, o.z - uz * half), toPx(o.x + ux * half, o.z + uz * half),
          spec.color, wpx(W) * 2, "butt");
        if (sel) stroke(toPx(o.x - ux * half, o.z - uz * half), toPx(o.x + ux * half, o.z + uz * half),
          "#fff", 2, "butt");
        label(toPx(o.x, o.z), spec.tag?.(o), spec.ink);
      } else if (spec.shape === "bar") {
        // across the channel, at right angles to the flow. A dam is the same
        // bar with its notch bitten out, since where that gap sits is the hole.
        const across = (t) => toPx(o.x + uz * t, o.z - ux * t);
        const a = across(W), b = across(-W);
        if (sel) stroke(a, b, "#fff", 11, "round");
        if (key === "dams") {
          const n = o.notch ?? 0, g2 = (o.gap ?? 2.4) / 2;
          stroke(a, across(n + g2), spec.color, 7, "round");
          stroke(across(n - g2), b, spec.color, 7, "round");
        } else stroke(a, b, spec.color, 7, "round");
        label(toPx(o.x, o.z), spec.tag?.(o), spec.ink);
      } else {
        blob(o, wpx(spec.r(o)), spec.color, spec.edge, sel, spec.tag?.(o) ?? "");
      }
    }
  }
  function label(g, text, ink) {
    if (!text) return;
    ctx.fillStyle = ink ?? "#0b2036"; ctx.font = "bold 10px system-ui";
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(text, g.x, g.y);
  }
  function stroke(a, b, color, width, cap) {
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
    ctx.strokeStyle = color; ctx.lineWidth = width; ctx.lineCap = cap; ctx.stroke();
  }

  function isSel(kind, i, b) {
    const s = state.sel;
    return !!s && s.kind === kind && s.i === i && (b === undefined || s.b === b);
  }
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
  els.propKind.value = state.propKind;
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
/** a prop as it should appear in holes.js: same keys, no 3.4000000000000004 */
function tidy(o) {
  const out = {};
  for (const [k, v] of Object.entries(o)) out[k] = typeof v === "number" ? rnd(v) : v;
  return out;
}
/** unit flow direction on the leg nearest a point — mirrors water.pathTangentAt */
function tangentAt(x, z, path) {
  let best = Infinity, ux = 0, uz = -1;
  for (let i = 0; i < path.length - 1; i++) {
    const d = segDist({ x, z }, path[i], path[i + 1]);
    if (d < best) {
      best = d;
      const dx = path[i + 1].x - path[i].x, dz = path[i + 1].z - path[i].z;
      const l = Math.hypot(dx, dz) || 1;
      ux = dx / l; uz = dz / l;
    }
  }
  return [ux, uz];
}
function clone(x) { return JSON.parse(JSON.stringify(x)); }
function esc(s) { return String(s).replace(/[<&]/g, (c) => (c === "<" ? "&lt;" : "&amp;")); }
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
    .lvl-prop { display: none; width: 100%; margin-top: 8px; padding: 7px 8px; border-radius: 8px; background: #06202f; color: #dff0ff; border: 1px solid rgba(255,255,255,0.18); font: 13px system-ui; }
    .lvl-prop.show { display: block; }
    .lvl-hint { font-size: 12px; opacity: 0.75; margin-top: 10px; min-height: 2.4em; }
    .lvl-sel { font-size: 13px; }
    .lvl-sel .muted { opacity: 0.5; }
    .lvl-sel .kv { display: flex; justify-content: space-between; padding: 2px 0; }
    .field.mini { margin-bottom: 8px; }
    .field.mini label { font-size: 11px; }
    .lvl-json { width: 100%; height: 120px; margin-top: 12px; display: none; background: #06202f; color: #bfe2ff; border: 1px solid rgba(255,255,255,0.15); border-radius: 8px; padding: 10px; font: 11px/1.45 ui-monospace, monospace; resize: vertical; }
    .lvl-json.show { display: block; }
    .lvl-warn { margin-top: 12px; padding: 10px 12px; border-radius: 10px; font-size: 12.5px; line-height: 1.5; border: 1px solid transparent; }
    .lvl-warn.ok { background: rgba(95,224,138,0.10); border-color: rgba(95,224,138,0.35); color: #8ff0b4; }
    .lvl-warn.bad { background: rgba(255,107,107,0.10); border-color: rgba(255,107,107,0.35); color: #ffb3b3; }
    .lvl-warn ul { margin: 6px 0 0; padding-left: 18px; }
  `;
  document.head.appendChild(st);
}

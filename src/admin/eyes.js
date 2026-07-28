// Eyes Lab — preview and align the procedural-pupil eye system.
//
// The expression is a FLAT outline image (one cell of rock-eyes-grid.png).
// The pupils are drawn 100% in a fragment shader, so they can be styled and
// moved freely to follow the cursor.
//
// Alignment: every face carries its own socket (centre + radius of each eye
// white) because the faces are drawn at different heights in their cells.
// Sockets come from src/eyeconfig.js, can be dragged/nudged here, and save
// straight to localStorage — a game tab open beside this updates live.

import { RockPreview3D } from "./eyes3d.js";
import {
  EYE_SOCKETS, EYE_FALLBACK_SOCKET, EYE_TRIM,
  eyeTuning, applyEyeTuning, saveEyeTuning, clearEyeTuning,
} from "../eyeconfig.js";

const SHEET_URL = "rock-eyes-grid.png?v=2"; // ?v bump busts stale caches
const COLS = 4;
const ROWS = 3;
const NAMES = [
  "neutral", "happy", "angry", "sad",
  "surprised", "suspicious", "sleepy", "dizzy",
  "determined", "worried", "wink", "excited",
];

// last resort, for a face that has no entry in eyeconfig.js and won't detect
const DEFAULT_SOCKET = EYE_FALLBACK_SOCKET;

// ---- grid model: the region of the sheet that holds the cells, sliced into
// cols×rows. x0/y0/x1/y1 are fractions of the whole sheet (the outer inset),
// gapX/gapY trim an inter-cell gutter as a fraction of each cell. Tweaking
// these "realigns" the grid over an imperfectly-laid-out sheet.
const DEFAULT_GRID = { cols: COLS, rows: ROWS, x0: 0, y0: 0, x1: 1, y1: 1, gapX: 0, gapY: 0 };
const STORE_KEY = "skippidy.eyes.lab";

export function initEyesLab(root) {
  const stage = root.querySelector("#stage");
  const exprImg = root.querySelector("#stage-expr");
  const glCanvas = root.querySelector("#stage-gl");
  const uiCanvas = root.querySelector("#stage-ui");
  const glCanvas3d = root.querySelector("#stage-3d");
  const gridCanvas = root.querySelector("#grid-sheet");

  const uic = uiCanvas.getContext("2d");
  const gsc = gridCanvas.getContext("2d");

  // grid-aligner control refs
  const grid = {
    cols: root.querySelector("#g-cols"), rows: root.querySelector("#g-rows"),
    left: root.querySelector("#g-left"), top: root.querySelector("#g-top"),
    right: root.querySelector("#g-right"), bottom: root.querySelector("#g-bottom"),
    gapx: root.querySelector("#g-gapx"), gapy: root.querySelector("#g-gapy"),
    reset: root.querySelector("#g-reset"), allOn: root.querySelector("#g-all-on"),
    vCols: root.querySelector("#v-cols"), vRows: root.querySelector("#v-rows"),
    vL: root.querySelector("#v-gl"), vT: root.querySelector("#v-gt"),
    vR: root.querySelector("#v-gr"), vB: root.querySelector("#v-gb"),
    vGx: root.querySelector("#v-gx"), vGy: root.querySelector("#v-gy"),
  };

  // control refs
  const ctl = {
    psize: root.querySelector("#c-psize"),
    follow: root.querySelector("#c-follow"),
    iris: root.querySelector("#c-iris"),
    tint: root.querySelector("#c-tint"),
    gloss: root.querySelector("#c-gloss"),
    threeD: root.querySelector("#c-3d"),
    rock: root.querySelector("#c-rock"),
    anchors: root.querySelector("#c-anchors"),
    export: root.querySelector("#c-export"),
  };
  const val = {
    psize: root.querySelector("#v-psize"),
    follow: root.querySelector("#v-follow"),
    gloss: root.querySelector("#v-gloss"),
  };

  // alignment control refs
  const al = {
    face: root.querySelector("#a-face"),
    x: root.querySelector("#a-x"), y: root.querySelector("#a-y"), r: root.querySelector("#a-r"),
    vx: root.querySelector("#v-ax"), vy: root.querySelector("#v-ay"), vr: root.querySelector("#v-ar"),
    detect: root.querySelector("#a-detect"), reset: root.querySelector("#a-reset"),
    detectAll: root.querySelector("#a-detect-all"), resetAll: root.querySelector("#a-reset-all"),
    tx: root.querySelector("#t-x"), ty: root.querySelector("#t-y"), ts: root.querySelector("#t-s"),
    vtx: root.querySelector("#v-tx"), vty: root.querySelector("#v-ty"), vts: root.querySelector("#v-ts"),
  };

  const saved = loadSaved();
  const tuned = eyeTuning();
  const state = {
    ready: false,
    sheet: null,
    grid: { ...DEFAULT_GRID, ...(saved.grid || {}) },
    enabled: NAMES.map((_, i) => saved.enabled?.[i] ?? true),
    current: 0,
    // per-face sockets, seeded from eyeconfig.js + whatever was tuned here last
    sockets: Object.fromEntries(NAMES.map((n) => [n, { ...baked(n), ...(tuned.sockets[n] || {}) }])),
    trim: { ...tuned.trim },
    nudge: { x: 0, y: 0, r: 1 }, // slider positions for the current face
    look: { x: 0.5, y: 0.42 },      // normalized target within stage
    lookSmooth: { x: 0.5, y: 0.42 },
    hovering: false,
    imgRect: { x: 0, y: 0, w: 1, h: 1 }, // displayed image rect within canvas (css px)
    drag: null,
  };

  function baked(name) { return EYE_SOCKETS[name] || DEFAULT_SOCKET; }
  const curName = () => NAMES[state.current];
  const curSocket = () => state.sockets[curName()] || (state.sockets[curName()] = { ...DEFAULT_SOCKET });

  /** what the game will actually draw: the face's socket plus the global trim */
  function trimmed(s) {
    const t = state.trim;
    return {
      lx: s.lx + t.dx, ly: s.ly + t.dy, rl: s.rl * t.scale,
      rx: s.rx + t.dx, ry: s.ry + t.dy, rr: s.rr * t.scale,
    };
  }

  /** push sockets + trim to eyeconfig so the 3D rock here (and any open game
   *  tab) redraws; `store` writes it to localStorage as well */
  function pushTuning(store = true) {
    const payload = { trim: { ...state.trim }, sockets: state.sockets };
    if (store) saveEyeTuning(payload);
    else applyEyeTuning(payload);
  }

  const gl = new PupilGL(glCanvas);

  // ---------------- 3D rock preview (the real in-game stone) ----------------
  let preview3d = null;
  function pupilOpts() {
    return {
      size: ctl.psize.value / 100,
      follow: ctl.follow.value / 100,
      gloss: ctl.gloss.value / 100,
      iris: ctl.iris.value,
      tint: ctl.tint.value,
    };
  }
  function sync3dStyle() {
    if (!preview3d) return;
    preview3d.setExpression(NAMES[state.current]);
    preview3d.setPupil(pupilOpts());
  }
  function set3dEnabled(on) {
    stage.classList.toggle("view-3d", on);
    if (on) {
      if (!preview3d) {
        preview3d = new RockPreview3D(glCanvas3d);
        sync3dStyle();
      }
      preview3d.resize();
      preview3d.start();
    } else if (preview3d) {
      preview3d.stop();
    }
  }

  // ---------------- load sheet ----------------
  const sheet = new Image();
  sheet.onload = () => {
    state.sheet = sheet;
    syncGridControls();
    buildPicker();
    state.ready = true;
    selectExpr(0);
    resize();
    drawGridSheet();
  };
  sheet.onerror = () => {
    console.error("Could not load eye sheet:", SHEET_URL);
  };
  sheet.src = SHEET_URL;

  // ---------------- expression picker ----------------
  function buildPicker() {
    const grid = root.querySelector("#expr-grid");
    grid.innerHTML = "";
    NAMES.forEach((name, i) => {
      const t = document.createElement("div");
      t.className = "expr-thumb";
      t.innerHTML =
        `<input type="checkbox" class="en" title="enable / disable">` +
        `<span class="lbl">${name}</span>`;
      const cb = t.querySelector(".en");
      cb.checked = state.enabled[i];
      cb.addEventListener("click", (e) => e.stopPropagation()); // don't select on toggle
      cb.addEventListener("change", () => {
        state.enabled[i] = cb.checked;
        t.classList.toggle("off", !cb.checked);
        drawGridSheet();
        persist();
      });
      t.addEventListener("click", () => selectExpr(i));
      grid.appendChild(t);
    });
    refreshThumbs();
  }

  // repaint every thumbnail from its live crop (reflects grid realignment)
  function refreshThumbs() {
    root.querySelectorAll(".expr-thumb").forEach((el, i) => {
      el.classList.toggle("off", !state.enabled[i]);
      if (!state.sheet || !hasCell(i)) { el.style.backgroundImage = "none"; return; }
      el.style.backgroundImage = `url(${cropCell(i)})`;
      el.style.backgroundSize = "85%";
      el.style.backgroundPosition = "center";
      el.style.backgroundRepeat = "no-repeat";
    });
  }

  function selectExpr(i) {
    state.current = i;
    root.querySelectorAll(".expr-thumb").forEach((el, idx) =>
      el.classList.toggle("sel", idx === i)
    );
    computeImgRect();
    // crop the cell into a clean data URL for the stage image
    exprImg.src = hasCell(i) ? cropCell(i) : "";
    if (preview3d) preview3d.setExpression(NAMES[i]);
    syncAlign();
    drawGridSheet();
  }

  // source pixel rect for cell `i` under the current grid alignment
  function cellRect(i) {
    const g = state.grid;
    const W = state.sheet.width, H = state.sheet.height;
    const col = i % g.cols, rowN = Math.floor(i / g.cols);
    const regW = g.x1 - g.x0, regH = g.y1 - g.y0;
    const cw = regW / g.cols, ch = regH / g.rows;
    const gx = cw * g.gapX * 0.5, gy = ch * g.gapY * 0.5;
    return {
      sx: (g.x0 + col * cw + gx) * W,
      sy: (g.y0 + rowN * ch + gy) * H,
      sw: Math.max(1, (cw - 2 * gx) * W),
      sh: Math.max(1, (ch - 2 * gy) * H),
    };
  }

  function cellCanvas(i) {
    const r = cellRect(i);
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(r.sw));
    c.height = Math.max(1, Math.round(r.sh));
    const g = c.getContext("2d");
    g.drawImage(state.sheet, r.sx, r.sy, r.sw, r.sh, 0, 0, c.width, c.height);
    return c;
  }

  function cropCell(i) {
    return cellCanvas(i).toDataURL("image/png");
  }

  const hasCell = (i) => i < state.grid.cols * state.grid.rows;

  // ---------------- socket auto-detection ----------------
  // Same method as scripts/measure-eyes.mjs, so the button and the script
  // agree: the sheet is keyed, so the sclera is the opaque near-white pixels;
  // per half we take the biggest white blob and the largest circle that fits
  // inside it. A half with no enclosed white is a shut eye (radius 0, so the
  // shader draws no pupil there).
  function detectCellSockets(i, out) {
    const c = cellCanvas(i);
    const w = c.width, h = c.height;
    const data = c.getContext("2d").getImageData(0, 0, w, h).data;
    const white = new Uint8Array(w * h);
    for (let p = 0; p < w * h; p++) {
      const a = data[p * 4 + 3];
      const lum = 0.299 * data[p * 4] + 0.587 * data[p * 4 + 1] + 0.114 * data[p * 4 + 2];
      white[p] = a > 100 && lum > 200 ? 1 : 0;
    }
    const big = labelComponents(white, w, h).filter((b) => b.count > w * h * 0.004);
    const left = big.filter((b) => b.cx < w / 2)[0];
    const right = big.filter((b) => b.cx >= w / 2)[0];
    if (!left && !right) return false;

    const L = left && inscribed(left, w, h);
    const R = right && inscribed(right, w, h);
    out.lx = L ? L.x / w : (R ? 1 - R.x / w : DEFAULT_SOCKET.lx);
    out.ly = L ? L.y / h : (R ? R.y / h : DEFAULT_SOCKET.ly);
    out.rl = L ? L.r / w : 0;
    out.rx = R ? R.x / w : (L ? 1 - L.x / w : DEFAULT_SOCKET.rx);
    out.ry = R ? R.y / h : (L ? L.y / h : DEFAULT_SOCKET.ry);
    out.rr = R ? R.r / w : 0;
    return true;
  }

  function detectInto(i) {
    const s = { ...baked(NAMES[i]) };
    if (!hasCell(i) || !detectCellSockets(i, s)) return false;
    state.sockets[NAMES[i]] = s;
    return true;
  }

  /** largest inscribed circle of a blob (two-pass chamfer distance transform) */
  function inscribed(blob, w, h) {
    const inside = new Uint8Array(w * h);
    for (const p of blob.px) inside[p] = 1;
    const D = new Float32Array(w * h).fill(1e9);
    const at = (x, y) => (x < 0 || y < 0 || x >= w || y >= h ? 0 : D[y * w + x]);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (!inside[i]) { D[i] = 0; continue; }
        D[i] = Math.min(D[i], at(x - 1, y) + 1, at(x, y - 1) + 1, at(x - 1, y - 1) + 1.414, at(x + 1, y - 1) + 1.414);
      }
    }
    let best = -1, bx = blob.cx, by = blob.cy;
    for (let y = h - 1; y >= 0; y--) {
      for (let x = w - 1; x >= 0; x--) {
        const i = y * w + x;
        if (!inside[i]) continue;
        D[i] = Math.min(D[i], at(x + 1, y) + 1, at(x, y + 1) + 1, at(x + 1, y + 1) + 1.414, at(x - 1, y + 1) + 1.414);
        if (D[i] > best) { best = D[i]; bx = x; by = y; }
      }
    }
    return { x: bx, y: by, r: best };
  }

  function labelComponents(mask, w, h) {
    const labels = new Int32Array(w * h);
    const comps = [];
    const stack = [];
    let next = 1;
    for (let start = 0; start < w * h; start++) {
      if (!mask[start] || labels[start]) continue;
      const id = next++;
      stack.length = 0;
      stack.push(start);
      labels[start] = id;
      const px = [];
      let sumX = 0, sumY = 0;
      while (stack.length) {
        const p = stack.pop();
        const x = p % w, y = (p / w) | 0;
        px.push(p); sumX += x; sumY += y;
        // 4-neighbours
        if (x > 0 && mask[p - 1] && !labels[p - 1]) { labels[p - 1] = id; stack.push(p - 1); }
        if (x < w - 1 && mask[p + 1] && !labels[p + 1]) { labels[p + 1] = id; stack.push(p + 1); }
        if (y > 0 && mask[p - w] && !labels[p - w]) { labels[p - w] = id; stack.push(p - w); }
        if (y < h - 1 && mask[p + w] && !labels[p + w]) { labels[p + w] = id; stack.push(p + w); }
      }
      comps.push({ px, count: px.length, cx: sumX / px.length, cy: sumY / px.length });
    }
    return comps.sort((a, b) => b.count - a.count);
  }

  // ---------------- sizing ----------------
  function computeImgRect() {
    const rect = stage.getBoundingClientRect();
    const cw = rect.width, ch = rect.height;
    let a = 1;
    if (state.sheet) { const cr = cellRect(state.current); a = cr.sw / cr.sh || 1; }
    let w = cw, hh = cw / a;
    if (hh > ch) { hh = ch; w = ch * a; }
    state.imgRect = { x: (cw - w) / 2, y: (ch - hh) / 2, w, h: hh, cw, ch };
  }

  function resize() {
    const rect = stage.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    for (const cv of [glCanvas, uiCanvas]) {
      cv.width = Math.round(rect.width * dpr);
      cv.height = Math.round(rect.height * dpr);
      cv.style.width = rect.width + "px";
      cv.style.height = rect.height + "px";
    }
    uic.setTransform(dpr, 0, 0, dpr, 0, 0);
    gl.resize(glCanvas.width, glCanvas.height, dpr);
    computeImgRect();
    if (preview3d) preview3d.resize();
    if (state.ready) drawGridSheet();
  }
  window.addEventListener("resize", resize);

  // ---------------- pointer ----------------
  stage.addEventListener("pointermove", (e) => {
    const rect = stage.getBoundingClientRect();
    const nx = (e.clientX - rect.left) / rect.width;
    const ny = (e.clientY - rect.top) / rect.height;
    if (state.drag) {
      applyDrag(nx, ny);
    } else {
      state.hovering = true;
      state.look.x = nx;
      state.look.y = ny;
    }
  });
  stage.addEventListener("pointerleave", () => {
    state.hovering = false;
    state.look.x = 0.5;
    state.look.y = 0.42;
  });

  // anchor dragging (only in edit mode)
  stage.addEventListener("pointerdown", (e) => {
    if (!ctl.anchors.checked) return;
    const rect = stage.getBoundingClientRect();
    const nx = (e.clientX - rect.left) / rect.width;
    const ny = (e.clientY - rect.top) / rect.height;
    const hit = pickHandle(nx, ny);
    if (hit) { state.drag = hit; stage.setPointerCapture(e.pointerId); }
  });
  stage.addEventListener("pointerup", () => {
    if (state.drag) { state.drag = null; persist(); }
  });

  function toCellFrac(nx, ny) {
    // stage-normalized -> displayed image -> cell fraction
    const r = state.imgRect;
    return {
      x: (nx * r.cw - r.x) / r.w,
      y: (ny * r.ch - r.y) / r.h,
    };
  }
  function pickHandle(nx, ny) {
    const s = trimmed(curSocket());
    const f = toCellFrac(nx, ny);
    const near = (px, py) => Math.hypot(f.x - px, f.y - py) < 0.06;
    if (near(s.lx, s.ly)) return "L";
    if (near(s.rx, s.ry)) return "R";
    return null;
  }
  function applyDrag(nx, ny) {
    const s = curSocket();
    const f = toCellFrac(nx, ny);
    // the handles are drawn trimmed, so drag back out through the trim
    const x = f.x - state.trim.dx, y = f.y - state.trim.dy;
    if (state.drag === "L") { s.lx = x; s.ly = y; }
    else { s.rx = x; s.ry = y; }
    syncAlign();
    pushTuning(false); // storage write waits for pointerup
  }

  // ---------------- controls ----------------
  const fmtPct = (el, v) => (el.textContent = Math.round(v * 100) + "%");
  const push3dPupil = () => { if (preview3d) preview3d.setPupil(pupilOpts()); };
  ctl.psize.addEventListener("input", () => { fmtPct(val.psize, ctl.psize.value / 100); push3dPupil(); });
  ctl.follow.addEventListener("input", () => { fmtPct(val.follow, ctl.follow.value / 100); push3dPupil(); });
  ctl.gloss.addEventListener("input", () => { fmtPct(val.gloss, ctl.gloss.value / 100); push3dPupil(); });
  ctl.iris.addEventListener("input", push3dPupil);
  ctl.tint.addEventListener("input", push3dPupil);
  ctl.threeD.addEventListener("change", () => set3dEnabled(ctl.threeD.checked));
  ctl.rock.addEventListener("change", () => stage.classList.toggle("rock-off", !ctl.rock.checked));
  ctl.anchors.addEventListener("change", () => { if (!ctl.anchors.checked) state.drag = null; });
  ctl.export.addEventListener("click", exportConfig);

  // ---------------- alignment ----------------
  // The nudge sliders move the current face relative to wherever it is now, so
  // they never undo a careful drag; their readout is the accumulated distance
  // from the value baked into eyeconfig.js.
  function nudgeFace(dx, dy, ratio) {
    const s = curSocket();
    s.lx += dx; s.rx += dx;
    s.ly += dy; s.ry += dy;
    s.rl *= ratio; s.rr *= ratio;
    pushTuning();
  }
  const bindNudge = (el, apply) => {
    el.addEventListener("input", () => { apply(+el.value); syncAlign(); });
  };
  bindNudge(al.x, (v) => { nudgeFace(v - state.nudge.x, 0, 1); state.nudge.x = v; });
  bindNudge(al.y, (v) => { nudgeFace(0, v - state.nudge.y, 1); state.nudge.y = v; });
  bindNudge(al.r, (v) => { nudgeFace(0, 0, (v / 100) / state.nudge.r); state.nudge.r = v / 100; });

  const bindTrim = (el, key, scale = 1) => {
    el.addEventListener("input", () => {
      state.trim[key] = +el.value / scale;
      syncAlign();
      pushTuning();
    });
  };
  bindTrim(al.tx, "dx");
  bindTrim(al.ty, "dy");
  bindTrim(al.ts, "scale", 100);

  al.detect.addEventListener("click", () => { detectInto(state.current); syncAlign(); pushTuning(); });
  al.detectAll.addEventListener("click", () => {
    NAMES.forEach((_, i) => detectInto(i));
    syncAlign();
    pushTuning();
  });
  al.reset.addEventListener("click", () => {
    state.sockets[curName()] = { ...baked(curName()) };
    syncAlign();
    pushTuning();
  });
  al.resetAll.addEventListener("click", () => {
    state.sockets = Object.fromEntries(NAMES.map((n) => [n, { ...baked(n) }]));
    state.trim = { ...EYE_TRIM };
    clearEyeTuning();
    syncAlign();
  });

  /** refresh the alignment readouts for whichever face is selected */
  function syncAlign() {
    const name = curName();
    const s = curSocket(), b = baked(name);
    state.nudge = {
      x: ((s.lx - b.lx) + (s.rx - b.rx)) / 2,
      y: ((s.ly - b.ly) + (s.ry - b.ry)) / 2,
      r: b.rl + b.rr > 0 ? (s.rl + s.rr) / (b.rl + b.rr) : 1,
    };
    al.face.textContent = name;
    al.x.value = state.nudge.x;
    al.y.value = state.nudge.y;
    al.r.value = Math.round(state.nudge.r * 100);
    al.vx.textContent = state.nudge.x.toFixed(3);
    al.vy.textContent = state.nudge.y.toFixed(3);
    al.vr.textContent = Math.round(state.nudge.r * 100) + "%";
    al.tx.value = state.trim.dx;
    al.ty.value = state.trim.dy;
    al.ts.value = Math.round(state.trim.scale * 100);
    al.vtx.textContent = state.trim.dx.toFixed(3);
    al.vty.textContent = state.trim.dy.toFixed(3);
    al.vts.textContent = Math.round(state.trim.scale * 100) + "%";
  }

  // ---------------- grid aligner ----------------
  const gridInputs = [grid.cols, grid.rows, grid.left, grid.top, grid.right, grid.bottom, grid.gapx, grid.gapy];
  gridInputs.forEach((inp) => {
    inp.addEventListener("input", () => onGrid(false));
    inp.addEventListener("change", () => onGrid(true)); // re-detect sockets on release
  });
  grid.reset.addEventListener("click", () => {
    state.grid = { ...DEFAULT_GRID };
    syncGridControls();
    onGrid(true);
  });
  grid.allOn.addEventListener("click", () => {
    state.enabled = NAMES.map(() => true);
    root.querySelectorAll(".expr-thumb .en").forEach((cb) => (cb.checked = true));
    refreshThumbs();
    drawGridSheet();
    persist();
  });
  // click a cell in the full-sheet overlay to preview that expression
  gridCanvas.addEventListener("pointerdown", (e) => {
    if (!state.sheet) return;
    const r = gridCanvas.getBoundingClientRect();
    const fx = (e.clientX - r.left) / r.width, fy = (e.clientY - r.top) / r.height;
    const W = state.sheet.width, H = state.sheet.height;
    for (let i = 0; i < NAMES.length; i++) {
      if (!hasCell(i)) continue;
      const cr = cellRect(i);
      const x0 = cr.sx / W, y0 = cr.sy / H, x1 = x0 + cr.sw / W, y1 = y0 + cr.sh / H;
      if (fx >= x0 && fx <= x1 && fy >= y0 && fy <= y1) { selectExpr(i); break; }
    }
  });

  function onGrid(redetect) {
    readGrid();
    updateGridLabels();
    // a realigned grid means new crops, so the sockets need re-measuring
    if (redetect && state.ready) { NAMES.forEach((_, i) => detectInto(i)); pushTuning(); }
    if (state.ready) { refreshThumbs(); selectExpr(state.current); }
    persist();
  }

  function readGrid() {
    const g = state.grid;
    g.cols = Math.max(1, (+grid.cols.value) | 0);
    g.rows = Math.max(1, (+grid.rows.value) | 0);
    g.x0 = +grid.left.value / 100;
    g.y0 = +grid.top.value / 100;
    g.x1 = 1 - +grid.right.value / 100;
    g.y1 = 1 - +grid.bottom.value / 100;
    if (g.x1 <= g.x0) g.x1 = g.x0 + 0.02;
    if (g.y1 <= g.y0) g.y1 = g.y0 + 0.02;
    g.gapX = +grid.gapx.value / 100;
    g.gapY = +grid.gapy.value / 100;
  }

  function updateGridLabels() {
    grid.vCols.textContent = grid.cols.value;
    grid.vRows.textContent = grid.rows.value;
    grid.vL.textContent = (+grid.left.value).toFixed(1) + "%";
    grid.vT.textContent = (+grid.top.value).toFixed(1) + "%";
    grid.vR.textContent = (+grid.right.value).toFixed(1) + "%";
    grid.vB.textContent = (+grid.bottom.value).toFixed(1) + "%";
    grid.vGx.textContent = Math.round(+grid.gapx.value) + "%";
    grid.vGy.textContent = Math.round(+grid.gapy.value) + "%";
  }

  function syncGridControls() {
    const g = state.grid;
    grid.cols.value = g.cols;
    grid.rows.value = g.rows;
    grid.left.value = (g.x0 * 100).toFixed(1);
    grid.top.value = (g.y0 * 100).toFixed(1);
    grid.right.value = ((1 - g.x1) * 100).toFixed(1);
    grid.bottom.value = ((1 - g.y1) * 100).toFixed(1);
    grid.gapx.value = Math.round(g.gapX * 100);
    grid.gapy.value = Math.round(g.gapY * 100);
    updateGridLabels();
  }

  // draw the whole sheet with the grid + enable state overlaid
  function drawGridSheet() {
    if (!state.sheet) return;
    const cssW = gridCanvas.clientWidth || 320;
    const aspect = state.sheet.height / state.sheet.width;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const cw = Math.round(cssW), ch = Math.round(cssW * aspect);
    gridCanvas.width = cw * dpr; gridCanvas.height = ch * dpr;
    gridCanvas.style.height = ch + "px";
    gsc.setTransform(dpr, 0, 0, dpr, 0, 0);
    gsc.clearRect(0, 0, cw, ch);
    gsc.drawImage(state.sheet, 0, 0, cw, ch);

    const W = state.sheet.width, H = state.sheet.height;
    for (let i = 0; i < NAMES.length; i++) {
      if (!hasCell(i)) continue;
      const r = cellRect(i);
      const x = r.sx / W * cw, y = r.sy / H * ch, w = r.sw / W * cw, h = r.sh / H * ch;
      const on = state.enabled[i], cur = i === state.current;
      gsc.lineWidth = cur ? 3 : 1.5;
      gsc.setLineDash(on ? [] : [5, 4]);
      gsc.strokeStyle = on ? (cur ? "#ffd24a" : "rgba(55,200,224,0.95)") : "rgba(255,84,112,0.95)";
      gsc.strokeRect(x + 0.75, y + 0.75, w - 1.5, h - 1.5);
      gsc.setLineDash([]);
      gsc.fillStyle = "rgba(11,34,48,0.72)";
      gsc.fillRect(x + 2, y + 2, gsc.measureText(NAMES[i]).width + 8, 13);
      gsc.fillStyle = cur ? "#ffd24a" : on ? "#bdeefb" : "#ffb3c1";
      gsc.font = "bold 10px sans-serif";
      gsc.textAlign = "left"; gsc.textBaseline = "top";
      gsc.fillText(NAMES[i], x + 6, y + 4);
    }
  }

  function persist() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({ grid: state.grid, enabled: state.enabled }));
    } catch { /* ignore */ }
    pushTuning();
  }

  function loadSaved() {
    try { return JSON.parse(localStorage.getItem(STORE_KEY)) || {}; }
    catch { return {}; }
  }

  // Paste-ready source for src/eyeconfig.js — the per-face sockets and the
  // global trim, in the exact shape the game imports.
  function exportConfig() {
    const f3 = (v) => v.toFixed(3);
    const t = state.trim;
    const lines = NAMES.map((n) => {
      const s = state.sockets[n] || baked(n);
      const shut = s.rl < 0.001 ? " // left eye shut" : s.rr < 0.001 ? " // right eye shut" : "";
      return `  ${n}: { lx: ${f3(s.lx)}, ly: ${f3(s.ly)}, rl: ${f3(s.rl)}, ` +
             `rx: ${f3(s.rx)}, ry: ${f3(s.ry)}, rr: ${f3(s.rr)} },${shut}`;
    });
    const src =
      "export const EYE_SOCKETS = {\n" + lines.join("\n") + "\n};\n\n" +
      `export const EYE_TRIM = { dx: ${f3(t.dx)}, dy: ${f3(t.dy)}, scale: ${f3(t.scale)} };\n`;
    navigator.clipboard?.writeText(src).catch(() => {});
    console.log("[eyes-lab] paste into src/eyeconfig.js:\n" + src);
    // the pupil styling isn't part of eyeconfig; log it for flateyes.js
    console.log("[eyes-lab] pupil styling:", {
      size: +(ctl.psize.value / 100).toFixed(2),
      follow: +(ctl.follow.value / 100).toFixed(2),
      iris: ctl.iris.value,
      tint: ctl.tint.value,
      gloss: +(ctl.gloss.value / 100).toFixed(2),
    });
  }

  // ---------------- render loop ----------------
  function hexToRgb(hex) {
    const n = parseInt(hex.slice(1), 16);
    return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
  }

  function frame() {
    requestAnimationFrame(frame);
    if (!state.ready) return;

    // smooth the look target
    const k = 0.22;
    state.lookSmooth.x += (state.look.x - state.lookSmooth.x) * k;
    state.lookSmooth.y += (state.look.y - state.lookSmooth.y) * k;

    const r = state.imgRect;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const s = trimmed(curSocket());

    // socket + look positions in device pixels
    const toPx = (fx, fy) => [(r.x + fx * r.w) * dpr, (r.y + fy * r.h) * dpr];
    const [lx, ly] = toPx(s.lx, s.ly);
    const [rx, ry] = toPx(s.rx, s.ry);
    const lookPx = [state.lookSmooth.x * r.cw * dpr, state.lookSmooth.y * r.ch * dpr];
    const rlPx = s.rl * r.w * dpr;
    const rrPx = s.rr * r.w * dpr;

    gl.render({
      eyeA: [lx, ly], radA: rlPx,
      eyeB: [rx, ry], radB: rrPx,
      look: lookPx,
      pupilFrac: ctl.psize.value / 100,
      follow: ctl.follow.value / 100,
      iris: hexToRgb(ctl.iris.value),
      tint: hexToRgb(ctl.tint.value),
      gloss: ctl.gloss.value / 100,
    });

    drawAnchors(s);
  }

  function drawAnchors(s) {
    uic.clearRect(0, 0, uiCanvas.width, uiCanvas.height);
    if (!ctl.anchors.checked) return;
    const r = state.imgRect;
    const draw = (fx, fy, rr, label) => {
      const px = r.x + fx * r.w, py = r.y + fy * r.h;
      uic.beginPath();
      uic.arc(px, py, rr * r.w, 0, Math.PI * 2);
      uic.strokeStyle = "rgba(255,210,74,0.9)";
      uic.lineWidth = 2;
      uic.setLineDash([5, 4]);
      uic.stroke();
      uic.setLineDash([]);
      uic.beginPath();
      uic.arc(px, py, 6, 0, Math.PI * 2);
      uic.fillStyle = "#ffd24a";
      uic.fill();
      uic.fillStyle = "#16324a";
      uic.font = "bold 11px sans-serif";
      uic.textAlign = "center";
      uic.textBaseline = "middle";
      uic.fillText(label, px, py);
    };
    draw(s.lx, s.ly, s.rl, "L");
    draw(s.rx, s.ry, s.rr, "R");
  }

  requestAnimationFrame(frame);
}

// =============================================================================
// WebGL pupil renderer. One fullscreen quad; the fragment shader draws both
// pupils (iris gradient + black pupil + specular gloss + rim) and positions
// them by clamping the look vector inside each socket radius.
// =============================================================================
class PupilGL {
  constructor(canvas) {
    const gl = canvas.getContext("webgl", { alpha: true, premultipliedAlpha: false, antialias: true });
    this.gl = gl;
    this.dpr = 1;

    const vs = `
      attribute vec2 aPos;
      void main() { gl_Position = vec4(aPos, 0.0, 1.0); }
    `;
    const fs = `
      precision highp float;
      uniform vec2 uRes;
      uniform vec2 uEyeA, uEyeB;
      uniform float uRadA, uRadB;
      uniform vec2 uLook;
      uniform float uPupilFrac, uFollow, uGloss;
      uniform vec3 uIris, uTint;

      // one eye's contribution -> premultiplied rgb + alpha.
      // \`udir\`/\`len\` are shared across both eyes so they always look in the
      // SAME direction (parallel), which avoids the cross-eyed look.
      vec4 eye(vec2 frag, vec2 center, float sclera, vec2 udir, float len) {
        float pupilR = sclera * uPupilFrac;
        if (pupilR < 1.0) return vec4(0.0);
        float travel = max(sclera - pupilR, 0.0);
        vec2 off = udir * min(len, travel) * uFollow;
        vec2 pc = center + off;

        float d = distance(frag, pc) / pupilR;   // 0 = centre, 1 = edge
        float aa = 1.2 / pupilR;

        float disc = smoothstep(1.0, 1.0 - aa, d);
        if (disc <= 0.0) return vec4(0.0);

        // --- cartoon layers, crisp bands from edge inward ---
        vec3 iris = uTint;                 // bold colour ring
        vec3 dark = uIris;                 // pupil / stroke colour

        // start as iris colour
        vec3 col = iris;
        // big solid pupil in the middle
        col = mix(col, dark, smoothstep(0.60, 0.52, d));
        // thin dark cartoon outline stroke at the rim
        col = mix(col, dark * 0.35, smoothstep(0.84, 0.94, d));

        // --- glossy cartoon highlights ---
        // big shine, upper-left, with a crisp edge
        vec2 hp = pc + vec2(-0.30, -0.34) * pupilR;
        float hd = distance(frag, hp) / (pupilR * 0.40);
        col = mix(col, vec3(1.0), smoothstep(1.0, 0.82, hd) * uGloss);
        // small sparkle, lower-right
        vec2 hp2 = pc + vec2(0.28, 0.30) * pupilR;
        float hd2 = distance(frag, hp2) / (pupilR * 0.16);
        col = mix(col, vec3(1.0), smoothstep(1.0, 0.7, hd2) * uGloss * 0.85);

        return vec4(col * disc, disc);
      }

      void main() {
        vec2 frag = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y);
        // shared look vector, measured from the midpoint between both eyes
        vec2 mid = (uEyeA + uEyeB) * 0.5;
        vec2 d = uLook - mid;
        float len = length(d);
        vec2 udir = len > 0.0001 ? d / len : vec2(0.0);

        vec4 a = eye(frag, uEyeA, uRadA, udir, len);
        vec4 b = eye(frag, uEyeB, uRadB, udir, len);
        vec4 o = a + b * (1.0 - a.a);       // a over b
        gl_FragColor = o;
      }
    `;

    const prog = this._program(vs, fs);
    this.prog = prog;
    gl.useProgram(prog);

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, "aPos");
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

    this.u = {
      res: gl.getUniformLocation(prog, "uRes"),
      eyeA: gl.getUniformLocation(prog, "uEyeA"),
      eyeB: gl.getUniformLocation(prog, "uEyeB"),
      radA: gl.getUniformLocation(prog, "uRadA"),
      radB: gl.getUniformLocation(prog, "uRadB"),
      look: gl.getUniformLocation(prog, "uLook"),
      pupilFrac: gl.getUniformLocation(prog, "uPupilFrac"),
      follow: gl.getUniformLocation(prog, "uFollow"),
      gloss: gl.getUniformLocation(prog, "uGloss"),
      iris: gl.getUniformLocation(prog, "uIris"),
      tint: gl.getUniformLocation(prog, "uTint"),
    };

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA); // premultiplied output
    gl.clearColor(0, 0, 0, 0);
  }

  _program(vsSrc, fsSrc) {
    const gl = this.gl;
    const sh = (type, src) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS))
        throw new Error(gl.getShaderInfoLog(s));
      return s;
    };
    const p = gl.createProgram();
    gl.attachShader(p, sh(gl.VERTEX_SHADER, vsSrc));
    gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fsSrc));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS))
      throw new Error(gl.getProgramInfoLog(p));
    return p;
  }

  resize(w, h) {
    this.gl.viewport(0, 0, w, h);
    this._w = w; this._h = h;
  }

  render(o) {
    const gl = this.gl;
    gl.useProgram(this.prog);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.uniform2f(this.u.res, this._w, this._h);
    gl.uniform2f(this.u.eyeA, o.eyeA[0], o.eyeA[1]);
    gl.uniform2f(this.u.eyeB, o.eyeB[0], o.eyeB[1]);
    gl.uniform1f(this.u.radA, o.radA);
    gl.uniform1f(this.u.radB, o.radB);
    gl.uniform2f(this.u.look, o.look[0], o.look[1]);
    gl.uniform1f(this.u.pupilFrac, o.pupilFrac);
    gl.uniform1f(this.u.follow, o.follow);
    gl.uniform1f(this.u.gloss, o.gloss);
    gl.uniform3fv(this.u.iris, o.iris);
    gl.uniform3fv(this.u.tint, o.tint);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
}

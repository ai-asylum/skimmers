/**
 * Audio Lab — audition every cue the game plays, see it as a waveform, cut the
 * dead air off it, rewrite its prompt, and roll a new take, without leaving the
 * browser.
 *
 * The cue table is imported straight from src/audiocues.json, so the tab is
 * useful on the deployed admin too: you can hear the whole library, see every
 * waveform and read what produced it. Editing and regenerating need the dev
 * server, because the Scenario key must not reach the page and a new take has
 * to be written into public/audio/ as a committed file — those go through the
 * /api/audio routes in vite.audio-lab.js. With no server the tab quietly drops
 * to read-only.
 *
 * Auditioning goes through Web Audio rather than an <audio> element so the cue
 * is heard at the level and the clip the game will actually play it at. Judging
 * a take at full scale is how you end up with a reel tick that drills through
 * everything.
 */
import CUES from "../audiocues.json";

const API = "/api/audio";
const KIND_LABEL = { sfx: "Sound effects", music: "Music" };

// A generated one-shot usually has silence in front of the sound and a long
// empty tail behind it. These are what "snap to sound" calls the edges: a level
// relative to the clip's own peak, then a little air either side so the attack
// isn't shaved and a decay isn't cut off mid-fall.
const SNAP = {
  floor: 0.02,   // ~34 dB below peak counts as silence
  window: 0.008, // seconds per test window
  padIn: 0.015,  // keep this much before the first sound
  padOut: 0.12,  // and this much after the last
};

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const secs = (v) => `${v.toFixed(3)}s`;

export function initAudioLab(panel) {
  const state = {
    cues: structuredClone(CUES),
    kind: "sfx",
    id: Object.keys(CUES.sfx)[0],
    live: false,   // is the dev-server API answering?
    busy: false,
    // cache-buster per cue, bumped whenever a file changes under us so a new
    // take isn't shadowed by the old one sitting in the http cache
    rev: {},
  };

  panel.innerHTML = `
    <div class="aud-wrap">
      <div class="aud-side card">
        <h3>Cues</h3>
        <p class="aud-status" data-el="status">checking dev server…</p>
        <div class="aud-list" data-el="list"></div>
      </div>
      <div class="aud-main">
        <div class="card" data-el="editor"></div>
      </div>
    </div>`;

  injectStyles();

  const q = (name) => panel.querySelector(`[data-el="${name}"]`);
  const els = { status: q("status"), list: q("list"), editor: q("editor") };

  const cue = () => state.cues[state.kind][state.id];
  const keyOf = (kind, id) => `${kind}/${id}@${state.rev[`${kind}/${id}`] || 0}`;

  /** The cut points to use, falling back to the whole file when there's no clip. */
  const clipOf = (c, duration) => {
    const [a, b] = c.clip || [0, duration];
    return [clamp(a, 0, duration), clamp(b, 0, duration)];
  };

  // ------------------------------------------------------------------ audio
  let actx = null;
  const buffers = new Map();
  let playing = null;   // { src, from, to, startedAt }
  let rafId = 0;

  const ensureCtx = () => (actx ||= new (window.AudioContext || window.webkitAudioContext)());
  const urlFor = (kind, id) => {
    const r = state.rev[`${kind}/${id}`];
    return `audio/${kind}/${id}.mp3${r ? `?r=${r}` : ""}`;
  };

  /** Decode a cue, or null if it isn't on disk. Decoding needs no gesture. */
  async function load(kind, id) {
    const key = keyOf(kind, id);
    if (buffers.has(key)) return buffers.get(key);
    try {
      const res = await fetch(urlFor(kind, id));
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = await ensureCtx().decodeAudioData(await res.arrayBuffer());
      buffers.set(key, buf);
      return buf;
    } catch {
      buffers.set(key, null);
      return null;
    }
  }

  async function play(kind, id, { raw = false, from = null } = {}) {
    stop();
    const buf = await load(kind, id);
    if (!buf) return flash(`${id}.mp3 not on disk yet — generate it`, "bad");

    const ctx = ensureCtx();
    if (ctx.state === "suspended") await ctx.resume();

    const c = state.cues[kind][id];
    const [a, b] = raw ? [0, buf.duration] : clipOf(c, buf.duration);
    const start = from == null ? a : clamp(from, 0, buf.duration);
    const end = from == null ? b : buf.duration;
    if (end - start < 0.005) return;

    const src = ctx.createBufferSource();
    src.buffer = buf;
    const g = ctx.createGain();
    g.gain.value = raw ? 1 : (c.level ?? 0.5);
    src.connect(g).connect(ctx.destination);
    src.start(0, start, end - start);

    playing = { src, from: start, to: end, startedAt: ctx.currentTime };
    src.onended = () => { if (playing?.src === src) stop(); };
    followPlayhead();
    return undefined;
  }

  function stop() {
    if (playing) {
      try { playing.src.stop(); } catch { /* already finished */ }
      playing = null;
    }
    cancelAnimationFrame(rafId);
    rafId = 0;
    const head = q("playhead");
    if (head) head.style.opacity = "0";
  }

  /** Walk the playhead across the waveform for as long as something is sounding. */
  function followPlayhead() {
    const head = q("playhead");
    if (!head || !playing) return;
    const buf = buffers.get(keyOf(state.kind, state.id));
    if (!buf) return;
    const step = () => {
      if (!playing) return;
      const at = playing.from + (actx.currentTime - playing.startedAt);
      head.style.opacity = "1";
      head.style.left = `${(clamp(at, 0, buf.duration) / buf.duration) * 100}%`;
      rafId = requestAnimationFrame(step);
    };
    step();
  }

  // ------------------------------------------------------------------ server
  async function call(path, body) {
    const res = await fetch(`${API}${path}`, {
      method: body ? "POST" : "GET",
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    // A static host answers an unknown path with index.html and a cheerful 200,
    // so the content type is the only honest signal that the API is really there
    if (!res.headers.get("content-type")?.includes("application/json")) {
      throw new Error("no audio API on this server");
    }
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
  }

  /** Pull the table with each file's on-disk level, and learn whether we're live. */
  async function refresh() {
    try {
      const fresh = await call("/cues");
      if (!fresh?.sfx || !fresh?.music) throw new Error("not the cue table");
      state.cues = fresh;
      state.live = true;
      els.status.textContent = "connected — edits save to src/audiocues.json";
      els.status.className = "aud-status ok";
    } catch {
      state.live = false;
      els.status.textContent = "read-only: no dev server, so no saving or regenerating";
      els.status.className = "aud-status bad";
    }
    renderList();
    renderEditor();
  }

  // ------------------------------------------------------------------ render
  const dB = (v) => (Number.isFinite(v) ? `${v.toFixed(1)} dB` : "—");

  function badge(c) {
    if (!state.live) return ""; // without the server we know nothing about disk
    const f = c.file;
    if (!f?.exists) return `<span class="aud-badge bad">missing</span>`;
    if (f.dud || (Number.isFinite(f.mean) && f.mean < -35)) return `<span class="aud-badge warn">quiet</span>`;
    if (c.clip) return `<span class="aud-badge cut">cut</span>`;
    return "";
  }

  function renderList() {
    els.list.innerHTML = ["sfx", "music"].map((kind) => `
      <h4 class="aud-group">${KIND_LABEL[kind]}</h4>
      ${Object.entries(state.cues[kind]).map(([id, c]) => `
        <div class="aud-row ${kind === state.kind && id === state.id ? "sel" : ""}" data-kind="${kind}" data-id="${id}">
          <button class="aud-play" data-act="play" title="Play at game level" aria-label="Play"></button>
          <span class="aud-name">${c.label || id}</span>
          ${badge(c)}
        </div>`).join("")}
    `).join("");
  }

  function renderEditor() {
    const c = cue();
    const f = c.file || {};
    const music = state.kind === "music";
    const ro = state.live ? "" : "disabled";

    els.editor.innerHTML = `
      <h3>${c.label || state.id} <span class="aud-id">${state.kind}/${state.id}</span></h3>
      <p class="aud-use">${c.use || ""}</p>

      ${state.live ? `
      <div class="aud-file">
        <span><b>${f.exists ? `${(f.bytes / 1024).toFixed(0)} kB` : "no file"}</b></span>
        <span>length <b>${Number.isFinite(f.duration) ? `${f.duration.toFixed(2)}s` : "—"}</b></span>
        <span>peak <b>${dB(f.peak)}</b></span>
        <span>mean <b>${dB(f.mean)}</b></span>
      </div>` : ""}
      ${f.dud ? `<p class="aud-warn">This take is nearly empty — the model put a whisper in a padded clip. Reword the prompt and roll again.</p>` : ""}

      <div class="aud-wave" data-el="wave">
        <canvas data-el="canvas"></canvas>
        <div class="aud-veil s" data-el="veilS"></div>
        <div class="aud-veil e" data-el="veilE"></div>
        <div class="aud-grip s" data-el="gripS" data-grip="0" title="Drag to move the start"></div>
        <div class="aud-grip e" data-el="gripE" data-grip="1" title="Drag to move the end"></div>
        <div class="aud-head" data-el="playhead"></div>
        <p class="aud-waiting" data-el="waveMsg">decoding…</p>
      </div>
      <div class="aud-cliprow">
        <span>from <b data-el="clipA">—</b></span>
        <span>to <b data-el="clipB">—</b></span>
        <span>keeps <b data-el="clipLen">—</b></span>
        <span class="aud-cut" data-el="clipCut"></span>
        <span class="spacer"></span>
        <button class="btn tiny" data-act="snap" ${ro}>Snap to sound</button>
        <button class="btn tiny" data-act="untrim" ${ro}>Whole file</button>
        <button class="btn tiny" data-act="bake" ${ro}>Bake into file</button>
      </div>
      ${music ? `<p class="aud-tail">A music trim only reaches the game once it's baked: tracks stream from the file rather than being decoded, so the game can't cut them as it plays.</p>` : ""}

      <div class="field" style="margin-top:14px;">
        <label>Prompt</label>
        <textarea class="aud-prompt" data-el="prompt" spellcheck="false" ${ro}>${music ? c.prompt : c.text}</textarea>
      </div>
      ${music ? "" : `<p class="aud-tail">every effect prompt gets this appended: <i>${state.cues.sfxStyle}</i></p>`}

      <div class="aud-params">
        <div class="field mini">
          <label>Length <span class="val" data-el="durVal">${c.duration}s</span></label>
          <input type="range" data-el="duration" min="${music ? 3 : 0.5}" max="${music ? 180 : 30}" step="${music ? 1 : 0.1}" value="${c.duration}" ${ro}>
        </div>
        ${music ? "" : `
        <div class="field mini">
          <label>Guidance <span class="val" data-el="infVal">${c.influence}</span></label>
          <input type="range" data-el="influence" min="0" max="1" step="0.05" value="${c.influence}" ${ro}>
        </div>`}
        <div class="field mini">
          <label>Mix level <span class="val" data-el="levelVal">${c.level}</span></label>
          <input type="range" data-el="level" min="0" max="1" step="0.01" value="${c.level}" ${ro}>
        </div>
        ${music ? "" : `<label class="toggle"><input type="checkbox" data-el="loop" ${c.loop ? "checked" : ""} ${ro}> seamless loop</label>`}
      </div>

      <div class="row aud-actions">
        <button class="btn ghost" data-act="play">Play trimmed</button>
        <button class="btn ghost" data-act="playRaw">Play whole file</button>
        <button class="btn ghost" data-act="stop">Stop</button>
        <span class="spacer"></span>
        <button class="btn blue" data-act="save" ${ro}>Save</button>
        <button class="btn" data-act="regen" ${ro}>Roll a new take</button>
      </div>
      <p class="aud-msg" data-el="msg"></p>`;

    // live labels, so dragging a slider and hitting play needs no save
    bindRange("duration", "durVal", (v) => `${v}s`);
    bindRange("influence", "infVal", (v) => v);
    bindRange("level", "levelVal", (v) => v);

    showWave();
  }

  function bindRange(name, labelName, fmt) {
    const input = q(name);
    if (!input) return;
    input.addEventListener("input", () => {
      const v = parseFloat(input.value);
      q(labelName).textContent = fmt(v);
      cue()[name] = v;
    });
  }

  function flash(msg, cls = "") {
    const el = q("msg");
    if (!el) return;
    el.textContent = msg;
    el.className = `aud-msg ${cls}`;
  }

  // ------------------------------------------------------------------ waveform
  const peakCache = new Map();

  /**
   * Column min/max for the whole buffer, so a 20-second bed and a 200ms tick
   * both draw as one screen of waveform.
   *
   * Min and max rather than an RMS average: a transient is one or two samples
   * tall and averaging buries exactly the thing you're looking for when you're
   * hunting for where a splash begins.
   */
  function peaks(buf, cols) {
    const key = `${keyOf(state.kind, state.id)}:${cols}`;
    const hit = peakCache.get(key);
    if (hit) return hit;

    const out = new Float32Array(cols * 2);
    const per = buf.length / cols;
    const chans = Array.from({ length: buf.numberOfChannels }, (_, i) => buf.getChannelData(i));
    for (let c = 0; c < cols; c++) {
      const from = Math.floor(c * per);
      const to = Math.min(buf.length, Math.floor((c + 1) * per)) || from + 1;
      let lo = 0, hi = 0;
      for (const data of chans) {
        for (let i = from; i < to; i++) {
          const v = data[i];
          if (v < lo) lo = v;
          if (v > hi) hi = v;
        }
      }
      out[c * 2] = lo;
      out[c * 2 + 1] = hi;
    }
    peakCache.set(key, out);
    return out;
  }

  /** Decode if needed, then draw. Called on select and after anything changes the file. */
  async function showWave() {
    const { kind, id } = state;
    const msg = q("waveMsg");
    const buf = await load(kind, id);
    if (state.kind !== kind || state.id !== id) return; // selection moved on while decoding
    if (!buf) {
      if (msg) msg.textContent = state.live ? "no file yet — roll a take" : "no file at this path";
      return;
    }
    if (msg) msg.remove();
    drawWave(buf);
    layoutClip(buf);
  }

  function drawWave(buf) {
    const canvas = q("canvas");
    const wrap = q("wave");
    if (!canvas || !wrap) return;

    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.round(wrap.clientWidth));
    const h = Math.max(1, Math.round(wrap.clientHeight));
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;

    const g = canvas.getContext("2d");
    g.scale(dpr, dpr);
    g.clearRect(0, 0, w, h);

    const mid = h / 2;
    g.strokeStyle = "rgba(255,255,255,0.14)";
    g.beginPath();
    g.moveTo(0, mid);
    g.lineTo(w, mid);
    g.stroke();

    const p = peaks(buf, w);
    g.fillStyle = "#37c8e0";
    for (let x = 0; x < w; x++) {
      const lo = p[x * 2], hi = p[x * 2 + 1];
      const top = mid - hi * mid * 0.94;
      g.fillRect(x, top, 1, Math.max(1, (hi - lo) * mid * 0.94));
    }
  }

  /** Put the veils, grips and readouts where the current clip says they go. */
  function layoutClip(buf) {
    const c = cue();
    const [a, b] = clipOf(c, buf.duration);
    const pa = (a / buf.duration) * 100;
    const pb = (b / buf.duration) * 100;

    const set = (name, css) => { const el = q(name); if (el) Object.assign(el.style, css); };
    set("veilS", { left: "0%", width: `${pa}%` });
    set("veilE", { left: `${pb}%`, width: `${100 - pb}%` });
    // as a custom property, so the css can hold a grip inside the box at 0% and
    // 100% instead of letting overflow eat the half of it you need to grab
    q("gripS")?.style.setProperty("--x", `${pa}%`);
    q("gripE")?.style.setProperty("--x", `${pb}%`);

    const txt = (name, v) => { const el = q(name); if (el) el.textContent = v; };
    txt("clipA", secs(a));
    txt("clipB", secs(b));
    txt("clipLen", secs(b - a));
    const lost = buf.duration - (b - a);
    txt("clipCut", lost > 0.005 ? `${secs(lost)} cut` : "");
  }

  /** Write a clip back, dropping it entirely when it covers the whole file. */
  function setClip(a, b, duration) {
    const whole = a <= 0.002 && b >= duration - 0.002;
    if (whole) delete cue().clip;
    else cue().clip = [+a.toFixed(3), +b.toFixed(3)];
    layoutClip(buffers.get(keyOf(state.kind, state.id)));
  }

  /**
   * Find the edges of the actual sound and clip to them.
   *
   * Peak per short window against a floor relative to the file's own peak. The
   * files are all levelled to -1 dBFS before they get here, so a fixed fraction
   * of the peak is a consistent idea of "silent" across the whole library.
   */
  function snapToSound(buf) {
    const rate = buf.sampleRate;
    const win = Math.max(1, Math.round(SNAP.window * rate));
    const chans = Array.from({ length: buf.numberOfChannels }, (_, i) => buf.getChannelData(i));

    const loud = [];
    let peak = 0;
    for (let s = 0; s < buf.length; s += win) {
      const to = Math.min(buf.length, s + win);
      let m = 0;
      for (const data of chans) {
        for (let i = s; i < to; i++) {
          const v = data[i] < 0 ? -data[i] : data[i];
          if (v > m) m = v;
        }
      }
      loud.push(m);
      if (m > peak) peak = m;
    }
    if (peak <= 0) return null; // a file with nothing in it has no edges to find

    const floor = peak * SNAP.floor;
    let first = loud.findIndex((v) => v >= floor);
    let last = loud.length - 1;
    while (last > first && loud[last] < floor) last--;
    if (first < 0) return null;

    return [
      clamp((first * win) / rate - SNAP.padIn, 0, buf.duration),
      clamp(((last + 1) * win) / rate + SNAP.padOut, 0, buf.duration),
    ];
  }

  // dragging a grip, or clicking the waveform to hear it from there
  let drag = null;

  function timeAt(clientX, buf) {
    const box = q("wave").getBoundingClientRect();
    return clamp((clientX - box.left) / box.width, 0, 1) * buf.duration;
  }

  panel.addEventListener("pointerdown", (e) => {
    const wave = e.target.closest?.(".aud-wave");
    if (!wave) return;
    const buf = buffers.get(keyOf(state.kind, state.id));
    if (!buf) return;

    const grip = e.target.getAttribute?.("data-grip");
    if (grip != null && state.live) {
      drag = { which: Number(grip), buf };
      e.target.setPointerCapture(e.pointerId);
      e.preventDefault();
      return;
    }
    play(state.kind, state.id, { from: timeAt(e.clientX, buf) });
  });

  panel.addEventListener("pointermove", (e) => {
    if (!drag) return;
    const t = timeAt(e.clientX, drag.buf);
    const [a, b] = clipOf(cue(), drag.buf.duration);
    const gap = 0.01;
    if (drag.which === 0) setClip(Math.min(t, b - gap), b, drag.buf.duration);
    else setClip(a, Math.max(t, a + gap), drag.buf.duration);
  });

  const endDrag = () => {
    if (!drag) return;
    drag = null;
    flash("trim changed — Save to keep it", "");
  };
  panel.addEventListener("pointerup", endDrag);
  panel.addEventListener("pointercancel", endDrag);

  // ------------------------------------------------------------------ actions
  function patchFromForm() {
    const c = cue();
    const music = state.kind === "music";
    const patch = {
      duration: parseFloat(q("duration").value),
      level: parseFloat(q("level").value),
      clip: c.clip ?? null,
    };
    patch[music ? "prompt" : "text"] = q("prompt").value.trim();
    if (!music) {
      patch.influence = parseFloat(q("influence").value);
      patch.loop = q("loop").checked;
    }
    Object.assign(c, patch);
    if (patch.clip == null) delete c.clip;
    return patch;
  }

  async function save() {
    const patch = patchFromForm();
    await call("/cue", { kind: state.kind, id: state.id, patch });
    flash("saved to src/audiocues.json", "ok");
    renderList();
  }

  async function regen() {
    if (state.busy) return;
    state.busy = true;
    const { kind, id } = state;
    try {
      await save();
      flash("generating… this takes 10–90s, the panel is waiting on Scenario", "");
      const result = await call("/generate", { kind, id });
      const c = state.cues[kind][id];
      c.file = { ...result.file, dud: result.dud };
      delete c.clip; // the cut points belonged to the take we just replaced
      bumpFile(kind, id);
      flash(
        result.dud ? "new take is very quiet — worth rewording and rolling again" : "new take written to public/audio",
        result.dud ? "bad" : "ok"
      );
      if (!result.dud) play(kind, id);
    } catch (e) {
      flash(String(e.message || e), "bad");
    } finally {
      state.busy = false;
    }
  }

  async function bake() {
    if (state.busy) return;
    const { kind, id } = state;
    if (!cue().clip) return flash("nothing to bake — this cue already plays whole", "");
    state.busy = true;
    try {
      await save();
      const r = await call("/bake", { kind, id });
      state.cues[kind][id].file = r.file;
      delete state.cues[kind][id].clip;
      bumpFile(kind, id);
      const saved = (r.before.duration - r.after.duration) || 0;
      flash(`baked — ${saved.toFixed(2)}s cut out of the file, ${r.after.duration.toFixed(2)}s left (git has the old one)`, "ok");
    } catch (e) {
      flash(String(e.message || e), "bad");
    } finally {
      state.busy = false;
    }
    return undefined;
  }

  /** The file on disk changed: drop what we cached of it and redraw. */
  function bumpFile(kind, id) {
    stop();
    state.rev[`${kind}/${id}`] = Date.now();
    renderList();
    renderEditor();
  }

  panel.addEventListener("click", (e) => {
    const row = e.target.closest(".aud-row");
    const act = e.target.getAttribute?.("data-act");
    const buf = () => buffers.get(keyOf(state.kind, state.id));

    if (row && act === "play") return play(row.dataset.kind, row.dataset.id);
    if (row) {
      stop();
      state.kind = row.dataset.kind;
      state.id = row.dataset.id;
      renderList();
      renderEditor();
      return;
    }
    if (act === "play") return play(state.kind, state.id);
    if (act === "playRaw") return play(state.kind, state.id, { raw: true });
    if (act === "stop") return stop();
    if (act === "save") return save().catch((err) => flash(String(err.message || err), "bad"));
    if (act === "regen") return regen();
    if (act === "bake") return bake();
    if (act === "untrim") {
      const b = buf();
      if (b) { setClip(0, b.duration, b.duration); flash("back to the whole file — Save to keep it", ""); }
      return;
    }
    if (act === "snap") {
      const b = buf();
      if (!b) return;
      const found = snapToSound(b);
      if (!found) return flash("nothing above the noise floor to snap to", "bad");
      setClip(found[0], found[1], b.duration);
      play(state.kind, state.id);
      flash("snapped to the sound — Save to keep it", "");
    }
    return undefined;
  });

  // the waveform is sized in css pixels, so it has to be redrawn when it resizes
  const ro = new ResizeObserver(() => {
    const b = buffers.get(keyOf(state.kind, state.id));
    if (b && q("canvas")) { drawWave(b); layoutClip(b); }
  });
  ro.observe(panel);

  refresh();
}

function injectStyles() {
  if (document.getElementById("audlab-style")) return;
  const st = document.createElement("style");
  st.id = "audlab-style";
  st.textContent = `
    .aud-wrap { display: grid; grid-template-columns: 290px 1fr; gap: 18px; align-items: start; margin-top: 18px; }
    @media (max-width: 900px) { .aud-wrap { grid-template-columns: 1fr; } }
    .aud-side { max-height: 78vh; display: flex; flex-direction: column; }
    .aud-list { overflow-y: auto; margin: -4px -6px 0; padding: 4px 6px; }
    .aud-group { font-size: 11px; text-transform: uppercase; letter-spacing: 0.12em; opacity: 0.5; margin: 14px 0 6px; }
    .aud-group:first-child { margin-top: 0; }
    .aud-row {
      display: flex; align-items: center; gap: 8px; cursor: pointer;
      padding: 5px 8px; border-radius: 8px; font-size: 13px; font-weight: 700;
      border: 1px solid transparent;
    }
    .aud-row:hover { background: rgba(255,255,255,0.05); }
    .aud-row.sel { background: rgba(55,200,224,0.14); border-color: rgba(55,200,224,0.4); color: var(--gold); }
    .aud-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    /* the play triangle is drawn rather than typed: the glyph for it counts as an
       emoji to the icon audit, and it renders differently per platform anyway */
    .aud-play {
      cursor: pointer; border: none; border-radius: 6px; width: 22px; height: 22px;
      background: rgba(255,255,255,0.1); color: var(--paper); flex: none;
      display: flex; align-items: center; justify-content: center;
    }
    .aud-play::before {
      content: ""; width: 0; height: 0; margin-left: 2px;
      border-top: 5px solid transparent; border-bottom: 5px solid transparent;
      border-left: 8px solid currentColor;
    }
    .aud-play:hover { background: var(--accent2); color: var(--ink); }
    .aud-badge { font-size: 9px; font-weight: 900; text-transform: uppercase; letter-spacing: 0.05em; padding: 2px 5px; border-radius: 5px; }
    .aud-badge.bad { background: rgba(255,84,112,0.2); color: #ffb3b3; }
    .aud-badge.warn { background: rgba(255,210,74,0.18); color: var(--gold); }
    .aud-badge.cut { background: rgba(55,200,224,0.18); color: #9fe8f5; }

    .aud-status { font-size: 11px; line-height: 1.4; margin-bottom: 12px; opacity: 0.8; }
    .aud-status.ok { color: #8ff0b4; }
    .aud-status.bad { color: #ffb3b3; }

    .aud-id { font-size: 10px; opacity: 0.45; letter-spacing: 0; text-transform: none; font-weight: 600; }
    .aud-use { font-size: 12.5px; opacity: 0.7; margin-bottom: 14px; }
    .aud-file { display: flex; gap: 18px; flex-wrap: wrap; font-size: 12px; opacity: 0.8; padding: 10px 12px; background: rgba(255,255,255,0.04); border-radius: 10px; }
    .aud-file b { color: var(--gold); font-weight: 800; }
    .aud-warn { margin-top: 10px; padding: 9px 12px; border-radius: 10px; font-size: 12.5px; line-height: 1.5; background: rgba(255,210,74,0.1); border: 1px solid rgba(255,210,74,0.35); color: var(--gold); }

    .aud-wave {
      position: relative; height: 116px; margin-top: 14px; border-radius: 10px;
      background: #06202f; border: 1px solid rgba(255,255,255,0.12);
      overflow: hidden; cursor: pointer; touch-action: none; user-select: none;
    }
    .aud-wave canvas { display: block; }
    .aud-veil { position: absolute; top: 0; bottom: 0; background: rgba(4,16,24,0.72); pointer-events: none; }
    .aud-grip {
      position: absolute; top: 0; bottom: 0; width: 13px; --x: 0%;
      left: clamp(0px, calc(var(--x) - 6.5px), calc(100% - 13px));
      cursor: col-resize; touch-action: none;
    }
    .aud-grip::before {
      content: ""; position: absolute; top: 0; bottom: 0; left: 5px; width: 3px;
      background: var(--gold); border-radius: 2px;
    }
    .aud-grip::after {
      content: ""; position: absolute; left: 1px; width: 11px; height: 11px; top: 50%;
      margin-top: -5.5px; border-radius: 3px; background: var(--gold);
    }
    .aud-grip:hover::before, .aud-grip:hover::after { background: #fff3bd; }
    .aud-head {
      position: absolute; top: 0; bottom: 0; width: 2px; margin-left: -1px;
      background: #fff; opacity: 0; pointer-events: none;
    }
    .aud-waiting {
      position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
      font-size: 12px; opacity: 0.5; margin: 0;
    }
    .aud-cliprow { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; font-size: 12px; opacity: 0.85; margin-top: 9px; }
    .aud-cliprow b { color: var(--gold); font-weight: 800; }
    .aud-cliprow .spacer { flex: 1; }
    .aud-cut { color: #9fe8f5; font-weight: 700; }
    .btn.tiny { font-size: 11px; padding: 5px 9px; }

    .aud-prompt {
      width: 100%; height: 88px; background: #06202f; color: #dff0ff;
      border: 1px solid rgba(255,255,255,0.15); border-radius: 8px; padding: 10px;
      font-family: inherit; font-size: 13px; line-height: 1.5; resize: vertical;
    }
    .aud-prompt:disabled { opacity: 0.6; }
    .aud-tail { font-size: 11px; opacity: 0.5; line-height: 1.5; margin: 8px 0 14px; }
    .aud-params { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 0 18px; align-items: end; }
    .aud-actions { margin-top: 16px; }
    .aud-actions .spacer { flex: 1; }
    .aud-msg { font-size: 12.5px; margin-top: 12px; min-height: 1.3em; opacity: 0.85; }
    .aud-msg.ok { color: #8ff0b4; }
    .aud-msg.bad { color: #ffb3b3; }
  `;
  document.head.appendChild(st);
}

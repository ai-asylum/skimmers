/**
 * Procedural sound via the Web Audio API — no asset files.
 * Pattern lifted from Train Slop's core/Audio.js (team scrap: procedural-audio):
 * shared noise buffer, filtered noise + tone envelope helpers, first-gesture
 * unlock, ambient bed. SFX authored for water: skip plinks that rise with the
 * combo, splashes scaled by impact, reel clicks, gulls, cheers.
 */
export class Audio {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.noiseBuffer = null;
    this.volume = 0.6;
    this.muted = false;
    this._gullT = 4 + Math.random() * 6;

    const resume = () => this._ensure();
    window.addEventListener("pointerdown", resume);
    window.addEventListener("keydown", resume);
  }

  setMuted(m) {
    this.muted = m;
    if (this.master) this.master.gain.value = m ? 0 : this.volume;
  }

  _ensure() {
    if (this.ctx) {
      if (this.ctx.state === "suspended") this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : this.volume;
    // gentle master compressor so stacked splashes don't clip
    const comp = this.ctx.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.ratio.value = 6;
    this.master.connect(comp).connect(this.ctx.destination);

    const len = this.ctx.sampleRate * 2;
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    this.noiseBuffer = buf;

    this._startLakeAmbience();
  }

  _now() { return this.ctx.currentTime; }

  _noise(dur, { type = "lowpass", freq = 800, q = 1, gain = 0.3, attack = 0.005, slideTo = null, delay = 0 } = {}) {
    if (!this.ctx) return;
    const t = this._now() + delay;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.loop = true;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const filt = this.ctx.createBiquadFilter();
    filt.type = type;
    filt.frequency.setValueAtTime(freq, t);
    if (slideTo) filt.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    filt.Q.value = q;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(filt).connect(g).connect(this.master);
    src.start(t);
    src.stop(t + dur + 0.05);
  }

  _tone(freq, dur, { type = "sine", gain = 0.3, slideTo = null, delay = 0 } = {}) {
    if (!this.ctx) return;
    const t = this._now() + delay;
    const osc = this.ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g).connect(this.master);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  }

  // lapping water + breeze bed
  _startLakeAmbience() {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.loop = true;
    const filt = this.ctx.createBiquadFilter();
    filt.type = "lowpass";
    filt.frequency.value = 380;
    const g = this.ctx.createGain();
    g.gain.value = 0.035;
    const lfo = this.ctx.createOscillator();
    lfo.frequency.value = 0.13;
    const lfoGain = this.ctx.createGain();
    lfoGain.gain.value = 0.02;
    lfo.connect(lfoGain).connect(g.gain);
    src.connect(filt).connect(g).connect(this.master);
    src.start();
    lfo.start();
    // second, higher lap layer with offset phase
    const src2 = this.ctx.createBufferSource();
    src2.buffer = this.noiseBuffer;
    src2.loop = true;
    const filt2 = this.ctx.createBiquadFilter();
    filt2.type = "bandpass";
    filt2.frequency.value = 900;
    filt2.Q.value = 0.6;
    const g2 = this.ctx.createGain();
    g2.gain.value = 0.012;
    const lfo2 = this.ctx.createOscillator();
    lfo2.frequency.value = 0.21;
    const lfo2Gain = this.ctx.createGain();
    lfo2Gain.gain.value = 0.01;
    lfo2.connect(lfo2Gain).connect(g2.gain);
    src2.connect(filt2).connect(g2).connect(this.master);
    src2.start();
    lfo2.start();
  }

  /** occasional gull cries; call each frame */
  update(dt) {
    if (!this.ctx || this.ctx.state !== "running") return;
    this._gullT -= dt;
    if (this._gullT <= 0) {
      this._gullT = 7 + Math.random() * 12;
      if (Math.random() < 0.7) this.gull();
    }
  }

  // --- one-off sfx ---

  /** stone leaves the hand — whoosh scaled by power 0..1 */
  throwWhoosh(power = 0.7) {
    this._noise(0.28, { type: "bandpass", freq: 500 + 900 * power, q: 0.8, gain: 0.1 + 0.14 * power, attack: 0.02, slideTo: 2200 });
  }

  /** skip plink #n of the combo — pitch climbs, tiny splash under it */
  skip(n = 1, power = 0.7) {
    const step = Math.min(n, 10);
    const f = 300 * Math.pow(1.13, step);
    this._tone(f, 0.14, { type: "sine", gain: 0.2, slideTo: f * 1.4 });
    this._tone(f * 1.5, 0.09, { type: "triangle", gain: 0.08 });
    this._noise(0.12, { type: "highpass", freq: 2200, gain: 0.06 + 0.05 * power, attack: 0.003 });
    this._noise(0.1, { type: "lowpass", freq: 900, gain: 0.09, attack: 0.004 });
  }

  /** rock settles into the water gently */
  settle() {
    this._noise(0.35, { type: "lowpass", freq: 600, gain: 0.14, attack: 0.01, slideTo: 220 });
    this._tone(180, 0.2, { type: "sine", gain: 0.07, slideTo: 90 });
  }

  /** full sink — deep glub */
  sink() {
    this._noise(0.5, { type: "lowpass", freq: 500, gain: 0.3, attack: 0.006, slideTo: 150 });
    this._tone(160, 0.4, { type: "sine", gain: 0.22, slideTo: 50 });
    // bubbles
    for (let i = 0; i < 4; i++) {
      this._tone(300 + Math.random() * 400, 0.06, { type: "sine", gain: 0.05, slideTo: 900, delay: 0.15 + i * 0.09 });
    }
  }

  /** big splash blast (rock-on-rock hit) */
  blast() {
    this._noise(0.45, { type: "lowpass", freq: 1400, gain: 0.4, attack: 0.004, slideTo: 300 });
    this._tone(110, 0.3, { type: "sine", gain: 0.25, slideTo: 40 });
    this._noise(0.25, { type: "highpass", freq: 1800, gain: 0.14, attack: 0.003 });
  }

  /** boat thunk */
  thunk() {
    this._noise(0.12, { type: "lowpass", freq: 400, gain: 0.25, attack: 0.003 });
    this._tone(140, 0.16, { type: "square", gain: 0.08, slideTo: 70 });
  }

  /** landed ON the boat deck */
  deckLand() {
    this._noise(0.1, { type: "lowpass", freq: 800, gain: 0.2, attack: 0.003 });
    this._tone(320, 0.12, { type: "triangle", gain: 0.12, slideTo: 240 });
    this._tone(480, 0.14, { type: "triangle", gain: 0.08, delay: 0.08 });
  }

  /** fishing reel tick */
  reelTick() {
    this._noise(0.03, { type: "highpass", freq: 3000, gain: 0.06, attack: 0.002 });
  }

  /** fishing catch success */
  catchRock() {
    this._tone(523, 0.1, { type: "triangle", gain: 0.16 });
    this._tone(784, 0.16, { type: "triangle", gain: 0.16, delay: 0.09 });
    this._noise(0.2, { type: "lowpass", freq: 900, gain: 0.12, attack: 0.01, delay: 0.05 });
  }

  fishMiss() {
    this._tone(220, 0.18, { type: "sawtooth", gain: 0.1, slideTo: 120 });
  }

  /** UI pip */
  pip(up = true) {
    this._tone(up ? 620 : 420, 0.07, { type: "triangle", gain: 0.14, slideTo: up ? 880 : 300 });
  }

  grind() {
    this._noise(0.09, { type: "bandpass", freq: 1300 + Math.random() * 900, q: 2.5, gain: 0.1, attack: 0.005 });
  }

  paintDab() {
    this._noise(0.07, { type: "bandpass", freq: 700, q: 1.5, gain: 0.08 });
    this._tone(500 + Math.random() * 300, 0.05, { type: "sine", gain: 0.05 });
  }

  pickRock() {
    this._noise(0.08, { type: "lowpass", freq: 900, gain: 0.14 });
    this._tone(340, 0.12, { type: "triangle", gain: 0.12, slideTo: 500 });
  }

  gull() {
    const f = 900 + Math.random() * 300;
    this._tone(f, 0.18, { type: "sawtooth", gain: 0.018, slideTo: f * 0.6 });
    this._tone(f * 1.1, 0.14, { type: "sawtooth", gain: 0.012, slideTo: f * 0.7, delay: 0.22 });
  }

  /** hole won fanfare */
  holeWin(mine = true) {
    if (mine) {
      [523, 659, 784, 1047].forEach((f, i) =>
        this._tone(f, 0.35, { type: "triangle", gain: 0.2, delay: i * 0.1 })
      );
      this._noise(0.6, { type: "highpass", freq: 3000, gain: 0.08, attack: 0.05, delay: 0.3 });
    } else {
      [392, 494, 587].forEach((f, i) =>
        this._tone(f, 0.3, { type: "triangle", gain: 0.12, delay: i * 0.12 })
      );
    }
  }

  /** final victory */
  win() {
    [523, 659, 784, 1047, 1319].forEach((f, i) =>
      this._tone(f, 0.5, { type: "triangle", gain: 0.22, delay: i * 0.11 })
    );
    [262, 330, 392].forEach((f, i) =>
      this._tone(f, 1.2, { type: "sine", gain: 0.1, delay: 0.5 + i * 0.02 })
    );
  }

  lose() {
    [392, 330, 247, 165].forEach((f, i) =>
      this._tone(f, 0.5, { type: "sawtooth", gain: 0.13, delay: i * 0.16 })
    );
  }

  splashed() {
    this._tone(600, 0.25, { type: "square", gain: 0.09, slideTo: 200 });
    this._noise(0.3, { type: "lowpass", freq: 1000, gain: 0.2, attack: 0.004 });
  }
}

export const audio = new Audio();

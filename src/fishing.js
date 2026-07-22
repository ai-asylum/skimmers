/**
 * The fishing minigame: your rock sank — reel it back before you can throw
 * again. A cursor sweeps the bar; click while it's inside the gold zone.
 * One clean hit = caught. Each miss shrinks the zone; third miss the lake
 * takes pity and coughs the rock up anyway (you lose the most time).
 */
import { audio } from "./audio.js";
import { els } from "./ui.js";

export class Fishing {
  constructor() {
    this.el = document.getElementById("fishing-ui");
    this.zoneEl = document.getElementById("fishing-zone");
    this.cursorEl = document.getElementById("fishing-cursor");
    this.hintEl = document.getElementById("fishing-hint");
    this.catchesEl = document.getElementById("fishing-catches");
    this.active = false;
    this.onDone = null;
    this._click = () => this._attempt();
    this._tickT = 0;
  }

  start(onDone) {
    this.active = true;
    this.onDone = onDone;
    this.t = 0;
    this.speed = 1.35 + Math.random() * 0.4;
    this.zoneW = 0.24;
    this.zoneX = 0.15 + Math.random() * 0.55;
    this.tries = 0;
    this.el.classList.remove("hidden");
    this.el.style.pointerEvents = "auto";
    els.throwUi.classList.add("hidden");
    this.hintEl.textContent = "CLICK when the line crosses the gold zone!";
    this.catchesEl.textContent = "🎣";
    this._layoutZone();
    window.addEventListener("pointerdown", this._click);
  }

  _layoutZone() {
    this.zoneEl.style.left = `${this.zoneX * 100}%`;
    this.zoneEl.style.width = `${this.zoneW * 100}%`;
  }

  _cursorPos() {
    // ping-pong 0..1
    const k = (Math.sin(this.t * this.speed * Math.PI * 2 - Math.PI / 2) + 1) / 2;
    return k;
  }

  _attempt() {
    if (!this.active) return;
    const c = this._cursorPos();
    if (c >= this.zoneX && c <= this.zoneX + this.zoneW) {
      audio.catchRock();
      this._finish(true);
    } else {
      this.tries++;
      audio.fishMiss();
      this.zoneW = Math.max(0.1, this.zoneW - 0.06);
      this.zoneX = 0.12 + Math.random() * 0.6;
      this.speed += 0.15;
      this._layoutZone();
      this.catchesEl.textContent = "🎣" + " ❌".repeat(this.tries);
      this.hintEl.textContent = this.tries >= 2 ? "last chance..." : "missed! again!";
      if (this.tries >= 3) {
        audio.catchRock();
        this._finish(false);
      }
    }
  }

  /** abort without result (hole was decided while we fished) */
  cancel() {
    if (!this.active) return;
    this.active = false;
    window.removeEventListener("pointerdown", this._click);
    this.el.classList.add("hidden");
    this.el.style.pointerEvents = "none";
    els.throwUi.classList.remove("hidden");
  }

  _finish(clean) {
    this.active = false;
    window.removeEventListener("pointerdown", this._click);
    this.el.classList.add("hidden");
    this.el.style.pointerEvents = "none";
    els.throwUi.classList.remove("hidden");
    this.onDone?.(clean, this.tries);
  }

  update(dt) {
    if (!this.active) return;
    this.t += dt;
    const c = this._cursorPos();
    this.cursorEl.style.left = `calc(${c * 100}% - 3px)`;
    this._tickT += dt;
    if (this._tickT > 0.09) {
      this._tickT = 0;
      audio.reelTick();
    }
  }
}

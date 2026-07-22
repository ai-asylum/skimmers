/**
 * CPU rivals (team scrap: ghost-matchmaking / tc-ai-controller spirit) —
 * bots play through the *exact same* Skimmer physics as the human. Each has
 * a persona (skill, aggression, patience). To aim they dry-run candidate
 * powers through simulateThrow — the same function the player's preview
 * uses — then add skill-scaled angular error so nobody is a laser bot.
 */
import * as THREE from "three";
import { simulateThrow } from "./physics.js";

export const BOT_PERSONAS = [
  { name: "Granite Gary", color: "#e0503a", skill: 0.86, aggro: 0.35, patience: [2.6, 4.2] },
  { name: "Pebbles", color: "#9d7cf4", skill: 0.72, aggro: 0.15, patience: [3.0, 5.0] },
  { name: "Skipzilla", color: "#37c8e0", skill: 0.9, aggro: 0.55, patience: [2.4, 3.8] },
  { name: "Wet Wanda", color: "#6fe07a", skill: 0.66, aggro: 0.25, patience: [3.4, 5.4] },
  { name: "Plunkett", color: "#ffd24a", skill: 0.58, aggro: 0.1, patience: [3.8, 6.0] },
  { name: "Flat Stanley", color: "#f4f0e6", skill: 0.8, aggro: 0.3, patience: [2.8, 4.4] },
  { name: "Mossback", color: "#ff8a3d", skill: 0.63, aggro: 0.45, patience: [3.2, 5.2] },
];

const _dir = new THREE.Vector3();

export class BotBrain {
  constructor(skimmer, persona) {
    this.s = skimmer;
    this.p = persona;
    this.cooldown = 1.5 + Math.random() * 3; // stagger the first volley
    this.fishT = 0;
    this.fishAt = null;
  }

  update(ctx) {
    const s = this.s;
    if (s.finished) return;

    // auto-fishing: bots take a skill-scaled break to reel their rock back
    if (s.state === "sinking" && s.sinkT > 0.8 && !this.fishAt) {
      this.fishAt = s.pos.clone();
      this.fishT = 2.8 + (1 - this.p.skill) * 3 + Math.random() * 1.5;
      s.state = "fishing";
    }
    if (s.state === "fishing") {
      this.fishT -= ctx.dt;
      if (this.fishT <= 0) {
        const at = this.fishAt ?? s.pos;
        s.placeAt(at.x, at.z);
        this.fishAt = null;
        ctx.onBotRecover?.(s);
      }
      return;
    }

    if (s.state !== "resting" && s.state !== "beached" && s.state !== "onboat") return;

    this.cooldown -= ctx.dt;
    if (this.cooldown > 0) return;
    const [pMin, pMax] = this.p.patience;
    this.cooldown = pMin + Math.random() * (pMax - pMin);

    // consider a splash attack on the leading rival stone nearby
    if (Math.random() < this.p.aggro * 0.5) {
      const target = this._splashTarget(ctx);
      if (target) {
        this._throwAt(target.pos, "splash", ctx);
        return;
      }
    }
    this._throwAt(this._navTarget(ctx), "skip", ctx);
  }

  /** furthest-forward fairway waypoint within throwing reach — bots follow the
   *  buoy line through doglegs instead of firing blind at the flag */
  _navTarget(ctx) {
    const path = ctx.path;
    if (!path) return ctx.flagPos;
    const reach = 40;
    for (let i = path.length - 1; i >= 0; i--) {
      const d = Math.hypot(path[i].x - this.s.pos.x, path[i].z - this.s.pos.z);
      if (d < reach) {
        // already standing on this waypoint — aim for the next bend
        if (d < 7 && i < path.length - 1) return path[i + 1];
        return path[i];
      }
    }
    return path[0];
  }

  _splashTarget(ctx) {
    // best rival: closest to the flag, within reasonable lob range of us
    let best = null, bestD = Infinity;
    for (const o of ctx.others) {
      if (o === this.s || o.finished) continue;
      if (o.state !== "resting" && o.state !== "beached") continue;
      const dFlag = o.distToFlag(ctx.flagPos);
      const dMe = o.pos.distanceTo(this.s.pos);
      const myD = this.s.distToFlag(ctx.flagPos);
      // only worth a lob if they're meaningfully ahead of us
      if (dFlag < myD - 9 && dMe > 4 && dMe < 26 && dFlag < bestD) {
        best = o;
        bestD = dFlag;
      }
    }
    return best;
  }

  _throwAt(targetPos, mode, ctx) {
    const s = this.s;
    _dir.set(targetPos.x - s.pos.x, 0, targetPos.z - s.pos.z);
    const dist = _dir.length();
    if (dist < 0.5) return;
    _dir.normalize();

    // candidate powers, judged with the shared preview sim
    let bestPower = 0.7, bestErr = Infinity;
    for (const pw of [0.35, 0.5, 0.65, 0.8, 0.95]) {
      const sim = simulateThrow(s.pos, _dir, pw, mode, s.rock, ctx.water, ctx.elapsed, 5, ctx.islands);
      const endP = sim.points[sim.points.length - 1];
      if (!endP) continue;
      const err = Math.hypot(endP.x - targetPos.x, endP.z - targetPos.z) + (sim.end === "sink" ? 8 : 0);
      if (err < bestErr) { bestErr = err; bestPower = pw; }
    }

    // skill-scaled sloppiness
    const wob = (1 - this.p.skill) * 0.19;
    const ang = (Math.random() - 0.5) * 2 * wob;
    const cos = Math.cos(ang), sin = Math.sin(ang);
    const dx = _dir.x * cos - _dir.z * sin;
    const dz = _dir.x * sin + _dir.z * cos;
    _dir.set(dx, 0, dz);
    const power = Math.max(0.2, Math.min(1, bestPower + (Math.random() - 0.5) * wob * 1.4));

    s.throwRock(_dir, power, mode);
  }
}

/**
 * CPU rivals (team scrap: ghost-matchmaking / tc-ai-controller spirit) —
 * bots play through the *exact same* Skimmer physics as the human. Each has
 * a persona (skill, aggression, patience). To aim they dry-run candidate
 * powers through simulateThrow — the same function the player's preview
 * uses — then add skill-scaled angular error so nobody is a laser bot.
 */
import * as THREE from "three";
import { simulateThrow } from "./physics.js";
import { DEFAULT_MODS } from "./upgrades.js";
import { lakeDepthAt, isWaterAt } from "./water.js";
import { buildRoute } from "./route.js";

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

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// Global nerf: how much sloppier every bot aims than its skill would suggest.
// 1 = original difficulty, 3 = roughly "3x less good" (three times the aim
// error on both heading and power). Bump this to make rivals easier still.
const AIM_NERF = 3;

// Rubber band. The nerf above makes rivals worse everywhere at once, which buys
// an easier race at the cost of a boring one: the field still strings itself out
// down the lake, and the last hop to the flag is uncontested either way. So on
// top of it, a rival that runs away from the people in the race is *slowed* —
// longer between throws, longer down there fishing a glugged stone back, and a
// looser line when it does throw — until the hole is a race again.
//
// It is a brake and only a brake. A rival that gets dropped is left dropped
// while anyone is still playing, and no stone is ever handed a truer line than
// its persona earns, so nothing here can cost the player a place they had won.
// The one exception is BAND_BEHIND, which comes off the leash only once every
// person is home and there is no place left to lose (see _pace).
//
// The dials are fractions of *pace*, not of the wait between throws. That
// distinction matters and it bit once already: stretching a wait by 1.55x only
// takes 35% off a leader, while shrinking one to 0.6x puts 67% on a trailer, so
// constants that look lopsided toward braking are really lopsided toward
// chasing. Working in pace and dividing at the end keeps them honest.
const BAND_SPAN = 0.18; // course fraction at which the band is fully wound
const BAND_AHEAD = 0.45; // a runaway leader does everything this much slower
const BAND_BEHIND = 0.15; // a straggler hurries up this much, once nobody can lose to it
const BAND_AIM = 0.5; // and a leader's heading wobble opens up by this much
// A brake is a fraction, but "looks asleep" is an absolute number of seconds:
// Plunkett down in Calm already waits the better part of eight between throws,
// and a stone that then sits there for eleven doing nothing reads as a bug
// rather than as a rival taking its time. Cap what the band may add.
const BAND_MAX_DELAY = 3;

const _pathCum = new WeakMap();
const _routes = new WeakMap();

/** Cumulative arc length at each waypoint. Cached — the path is fixed per hole. */
function pathCum(path) {
  let cum = _pathCum.get(path);
  if (!cum) {
    cum = [0];
    for (let i = 1; i < path.length; i++) {
      cum.push(cum[i - 1] + Math.hypot(path[i].x - path[i - 1].x, path[i].z - path[i - 1].z));
    }
    _pathCum.set(path, cum);
  }
  return cum;
}

/**
 * The route through the hole being played, cached against the path the caller
 * handed us. On a hole with no branches this is the same polyline it always
 * was, wearing route.js's interface; on one with a shortcut it is the graph
 * that knows a stone in the gut is not behind (src/route.js).
 */
function routeFor(ctx) {
  if (ctx.route) return ctx.route;
  if (!ctx.path || ctx.path.length < 2) return null;
  let r = _routes.get(ctx.path);
  if (!r) { r = buildRoute({ path: ctx.path }); _routes.set(ctx.path, r); }
  return r;
}

/**
 * Closest point on the fairway centreline to (x, z): `d` is the sideways miss,
 * `arc` how far along the buoy line from the tee that point sits.
 */
function projectToPath(path, x, z) {
  const cum = pathCum(path);
  let best = { x: path[0].x, z: path[0].z, d: Infinity, arc: 0 };
  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i], b = path[i + 1];
    const bax = b.x - a.x, baz = b.z - a.z;
    const len2 = bax * bax + baz * baz || 1;
    const h = clamp(((x - a.x) * bax + (z - a.z) * baz) / len2, 0, 1);
    const cx = a.x + bax * h, cz = a.z + baz * h;
    const d = Math.hypot(x - cx, z - cz);
    if (d < best.d) best = { x: cx, z: cz, d, arc: cum[i] + Math.sqrt(len2) * h };
  }
  return best;
}

export class BotBrain {
  /**
   * `tier` is the difficulty class the player picked (cups.js TIERS). It bends
   * the persona rather than replacing it, so Skipzilla is still the sharpest
   * rival on the water at every class — there's just a wider gap between him
   * and Plunkett down in Ripple than there is up in Maelstrom, where everyone
   * is good.
   */
  constructor(skimmer, persona, tier = null) {
    this.s = skimmer;
    this.p = persona;
    this.skill = clamp(persona.skill + (tier?.botSkill ?? 0), 0.2, 0.98);
    this.aggro = clamp(persona.aggro * (tier?.aggroMul ?? 1), 0, 1);
    const pm = tier?.patienceMul ?? 1;
    this.patience = [persona.patience[0] * pm, persona.patience[1] * pm];
    this.bandMul = tier?.bandMul ?? 1; // how tightly this class holds the field together
    this.band = 0; // signed, ±bandMul: how far ahead of the people this stone has got
    this._humansHome = false; // every person is in, so stragglers may hurry up
    this.cooldown = 1.5 + Math.random() * 3; // stagger the first volley
    this.fishT = 0;
    this.fishAt = null;
  }

  update(ctx) {
    const s = this.s;
    if (s.finished) return;

    // auto-fishing: bots take a skill-scaled break to reel their rock back
    if (s.state === "sinking" && s.sinkT > s.sinkDelay && !this.fishAt) {
      this.fishAt = s.pos.clone();
      // long enough for the full line choreography (sink to bed at
      // ~depth/2.4, line down at HOOK_SPEED, reel up) plus skill-scaled
      // dawdling at the surface — roughly what the player's minigame costs.
      // Banded like everything else, and this is where the band earns its keep:
      // a glug is far and away the biggest thing that strings the field out, and
      // how long a rival spends under the water is the one cost the player never
      // sees being paid.
      this.band = this._band(ctx);
      this.fishT = this._banded(2.6 + lakeDepthAt(s.pos.x, s.pos.z) * 0.7 + (1 - this.skill) * 2.5 + Math.random() * 1.2);
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

    // Read the field once per throw, and let it set both this shot's wobble and
    // the wait after it. Only measured here, on the throw, so the projections
    // cost nothing on the frames in between.
    this.band = this._band(ctx);
    const [pMin, pMax] = this.patience;
    this.cooldown = this._banded(pMin + Math.random() * (pMax - pMin));

    // consider a splash attack on the leading rival stone nearby
    if (Math.random() < this.aggro * 0.5) {
      const target = this._splashTarget(ctx);
      if (target) {
        this._throwAt(target.pos, "splash", ctx);
        return;
      }
    }
    // stranded up in the hills is its own problem: forwards is a wall, and the
    // one line back to the fairway may be blocked by a spire
    if (this._stranded && ctx.path) { this._escapeThrow(ctx); return; }
    this._throwAt(this._navTarget(ctx), "skip", ctx);
  }

  /**
   * How fast this stone is going about its business right now, as a fraction of
   * its own natural pace: below 1 it has run away and is taking its time, above
   * 1 it has been dropped and is getting on with it. Everything that costs a
   * rival wall-clock time divides through this.
   *
   * While anybody is still playing the hole the band is a brake and only a
   * brake. A rival that has been dropped stays dropped, because a player having
   * the race of their life should be caught by a better throw or not at all —
   * never by the machinery quietly winding the field back onto them.
   *
   * The moment the last person is home that reverses, and the stragglers get a
   * hurry-up instead. Nobody can lose a place to it by then, and it buys back
   * the worst dead time in the game: sitting in spectator cam watching seven
   * stones you've already beaten dawdle up the lake on the final-stretch clock.
   */
  _pace() {
    if (this.band > 0) return 1 - this.band * BAND_AHEAD;
    return this._humansHome ? 1 - this.band * BAND_BEHIND : 1;
  }

  /** a duration bent by the band, held short of the point where it looks broken */
  _banded(seconds) {
    return Math.min(seconds / this._pace(), seconds + BAND_MAX_DELAY);
  }

  /**
   * How far ahead of the people this stone has got, as a signed fraction of the
   * band's span: +1 it has run away and should ease off, -1 it has been dropped
   * and should hustle. Measured against whichever human is furthest along, so in
   * solo this is simply "am I beating the player", and on a host with several
   * people nobody gets to sail off the front of the field unchallenged.
   *
   * A human who has already holed out counts as home, which quietly shortens the
   * final stretch: the rest of the field stops dawdling once someone has won.
   */
  _band(ctx) {
    const route = routeFor(ctx);
    if (!route || !this.bandMul) return 0;
    let human = -1;
    let allHome = true;
    for (const o of ctx.others) {
      if (!o.isPlayer && !o.isRemote) continue;
      if (!o.finished) allHome = false;
      const p = o.finished ? 1 : route.progressAt(o.pos.x, o.pos.z);
      if (p > human) human = p;
    }
    this._humansHome = human >= 0 && allHome;
    if (human < 0) return 0; // a field of nothing but bots: let them race straight
    const mine = route.progressAt(this.s.pos.x, this.s.pos.z);
    return clamp((mine - human) / BAND_SPAN, -1, 1) * this.bandMul;
  }

  /** beached on the actual banks (not resting on an island in the channel) */
  get _stranded() {
    return this.s.state === "beached" && !isWaterAt(this.s.pos.x, this.s.pos.z);
  }

  /**
   * Where to throw next: the furthest bend down the route still within a
   * throw, so bots follow the water through doglegs instead of firing blind at
   * the flag.
   *
   * On a hole that forks this is also where a rival decides. Nerve is the
   * persona showing through — Skipzilla will take a tight line for a small
   * saving, Plunkett wants the wide water — and it is asked fresh on every
   * throw rather than committed to once, so a bot that gets shoved into the
   * mouth of the gut plays the gut, and one that comes up short of it doesn't
   * keep aiming at a line it can no longer reach.
   */
  _navTarget(ctx) {
    const route = routeFor(ctx);
    if (!route) return ctx.flagPos;
    const p = route.waypointAhead(this.s.pos.x, this.s.pos.z, 40, this._nerve());
    this._onBranch = p.branch;
    return p;
  }

  /** appetite for the narrow line: skill to pull it off, aggression to try */
  _nerve() {
    return clamp((this.skill - 0.68) * 2.4 + this.aggro * 0.8 - this.band * 0.35, -1, 1);
  }

  /**
   * Beached on the banks, where aiming at the fairway isn't enough: a ridge or
   * a spire can sit right on that line. So sweep the whole compass through the
   * shared preview sim and take whatever actually gets wet — falling back to
   * the throw that makes the most ground if nothing does. Only runs while
   * stranded, once per throw cooldown, so the extra sims are free.
   */
  _escapeThrow(ctx) {
    const s = this.s;
    const goal = this._nearestFairwayPoint(ctx);
    const d0 = Math.hypot(goal.x - s.pos.x, goal.z - s.pos.z);
    let bestScore = -Infinity, bestTh = 0, bestPw = 0.6, bestMode = "skip";
    for (let a = 0; a < 12; a++) {
      const th = (a / 12) * Math.PI * 2;
      _dir.set(Math.cos(th), 0, Math.sin(th));
      for (const mode of ["skip", "splash"]) {
        for (const pw of [0.4, 0.6, 0.8, 1]) {
          const sim = simulateThrow(s.pos, _dir, pw, mode, s.rock, ctx.water, ctx.elapsed, 5, ctx.islands, ctx.rocks, null, DEFAULT_MODS, ctx.ceilings);
          const end = sim.points[sim.points.length - 1];
          if (!end) continue;
          const gain = d0 - Math.hypot(goal.x - end.x, goal.z - end.z);
          const score = gain + (sim.end !== "beach" ? 100 : 0);
          if (score > bestScore) { bestScore = score; bestTh = th; bestPw = pw; bestMode = mode; }
        }
      }
    }
    const wob = (1 - this.skill) * 0.12 * AIM_NERF; // steadier than usual — just get out
    const th = bestTh + (Math.random() - 0.5) * wob;
    _dir.set(Math.cos(th), 0, Math.sin(th));
    s.throwRock(_dir, bestPw, bestMode);
  }

  /** closest point on any of the hole's water — the shortest way back in */
  _nearestFairwayPoint(ctx) {
    const route = routeFor(ctx);
    if (route) return route.nearestPoint(this.s.pos.x, this.s.pos.z);
    return projectToPath(ctx.path, this.s.pos.x, this.s.pos.z);
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

    // candidate powers, judged with the shared preview sim; thudding into the
    // banks scores badly now that they're real hills
    let bestPower = 0.7, bestErr = Infinity;
    for (const pw of [0.35, 0.5, 0.65, 0.8, 0.95]) {
      const sim = simulateThrow(s.pos, _dir, pw, mode, s.rock, ctx.water, ctx.elapsed, 5, ctx.islands, ctx.rocks, null, DEFAULT_MODS, ctx.ceilings);
      const endP = sim.points[sim.points.length - 1];
      if (!endP) continue;
      let err = Math.hypot(endP.x - targetPos.x, endP.z - targetPos.z);
      if (sim.end === "sink") err += 8;
      if (sim.end === "beach") err += 12;
      if (err < bestErr) { bestErr = err; bestPower = pw; }
    }

    // skill-scaled sloppiness, opened up on a runaway leader and never once
    // tightened — a rival with ground to make up makes it up on the clock, not
    // by suddenly shooting better than it can
    const wob = (1 - this.skill) * 0.19 * AIM_NERF * (1 + Math.max(0, this.band) * BAND_AIM);
    const ang = (Math.random() - 0.5) * 2 * wob;
    const cos = Math.cos(ang), sin = Math.sin(ang);
    const dx = _dir.x * cos - _dir.z * sin;
    const dz = _dir.x * sin + _dir.z * cos;
    _dir.set(dx, 0, dz);
    const power = Math.max(0.2, Math.min(1, bestPower + (Math.random() - 0.5) * wob * 1.4));

    s.throwRock(_dir, power, mode);
  }
}

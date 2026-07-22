/**
 * Game-feel toolkit: trauma-based camera shake, hitstop time dilation,
 * springy scalar values, FOV punch, easings.
 * Ported from Spellbook's core/juice.ts (team scrap: common-hitstop-juice).
 */
import * as THREE from "three";

// ---------------------------------------------------------------- time scale
let timeScale = 1;
let hitstopT = 0;
let hitstopDur = 0;
let targetDepth = 0.9;
// long-form slow-mo (dramatic final approach), separate from hitstop
let slowmoT = 0;
let slowmoScale = 1;

/** Freeze time briefly. depth 0..1 (how deep the slowdown goes). */
export function hitstop(duration = 0.09, depth = 0.92) {
  hitstopT = Math.max(hitstopT, duration);
  hitstopDur = duration;
  targetDepth = depth;
}

/** Sustained slow motion for `duration` seconds at `scale` speed. */
export function slowmo(duration = 0.8, scale = 0.3) {
  slowmoT = Math.max(slowmoT, duration);
  slowmoScale = scale;
}

export function updateTime(rawDt) {
  if (hitstopT > 0) {
    hitstopT -= rawDt;
    const k = Math.max(0, hitstopT / Math.max(1e-4, hitstopDur));
    timeScale = 1 - targetDepth * Math.sin(k * Math.PI); // dip and recover
  } else if (slowmoT > 0) {
    slowmoT -= rawDt;
    // ease back to full speed over the final 30%
    const k = Math.min(1, slowmoT / 0.25);
    timeScale = slowmoScale + (1 - slowmoScale) * (1 - k);
  } else {
    timeScale = 1;
  }
  return rawDt * timeScale;
}

export function getTimeScale() { return timeScale; }

// ---------------------------------------------------------------- shake
let trauma = 0;
const shakeSeed = Math.random() * 1000;

/** Add screen shake. amount 0..1. */
export function shake(amount) {
  trauma = Math.min(1, trauma + amount);
}

const _euler = new THREE.Euler();

/** Apply shake offset to a camera-holder each frame. Call with the rig, not the camera. */
export function applyShake(rig, dt, elapsed) {
  trauma = Math.max(0, trauma - dt * 1.6);
  const t2 = trauma * trauma;
  const f = elapsed * 34;
  _euler.set(
    noise1(shakeSeed + f) * 0.028 * t2,
    noise1(shakeSeed + 100 + f) * 0.028 * t2,
    noise1(shakeSeed + 200 + f) * 0.036 * t2
  );
  rig.rotation.copy(_euler);
  rig.position.set(
    noise1(shakeSeed + 300 + f) * 0.06 * t2,
    noise1(shakeSeed + 400 + f) * 0.06 * t2,
    0
  );
}

/** Cheap smooth noise in [-1, 1]. */
function noise1(x) {
  return (
    Math.sin(x * 1.0) * 0.5 +
    Math.sin(x * 2.153 + 1.3) * 0.3 +
    Math.sin(x * 4.311 + 2.7) * 0.2
  );
}

// ---------------------------------------------------------------- springs
/** Critically-damped-ish spring for satisfying UI/object motion. */
export class Spring {
  constructor(target, stiffness = 170, damping = 18) {
    this.target = target;
    this.stiffness = stiffness;
    this.damping = damping;
    this.value = target;
    this.velocity = 0;
  }
  update(dt) {
    const f = -this.stiffness * (this.value - this.target);
    const d = -this.damping * this.velocity;
    this.velocity += (f + d) * dt;
    this.value += this.velocity * dt;
    return this.value;
  }
  kick(v) { this.velocity += v; }
  set(v) { this.value = v; this.target = v; this.velocity = 0; }
}

/** Vector3 spring, same maths per component. */
export class SpringV3 {
  constructor(target, stiffness = 170, damping = 18) {
    this.target = target.clone();
    this.value = target.clone();
    this.velocity = new THREE.Vector3();
    this.stiffness = stiffness;
    this.damping = damping;
  }
  update(dt) {
    const s = this.stiffness, d = this.damping;
    this.velocity.x += (-s * (this.value.x - this.target.x) - d * this.velocity.x) * dt;
    this.velocity.y += (-s * (this.value.y - this.target.y) - d * this.velocity.y) * dt;
    this.velocity.z += (-s * (this.value.z - this.target.z) - d * this.velocity.z) * dt;
    this.value.addScaledVector(this.velocity, dt);
    return this.value;
  }
  kick(v) { this.velocity.add(v); }
  set(v) { this.value.copy(v); this.target.copy(v); this.velocity.set(0, 0, 0); }
}

// ---------------------------------------------------------------- fov punch
let fovKickAmount = 0;

/** Punch the camera FOV outward briefly (big throws, impacts). */
export function fovKick(amount = 3) {
  fovKickAmount = Math.min(10, fovKickAmount + amount);
}

/** Returns the current FOV offset and decays it. */
export function updateFovKick(dt) {
  fovKickAmount = Math.max(0, fovKickAmount - dt * 26);
  return fovKickAmount;
}

// ---------------------------------------------------------------- haptics
export function haptic(pattern = 20) {
  try { navigator.vibrate?.(pattern); } catch { /* unsupported */ }
}

// ---------------------------------------------------------------- easing
export const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
export const easeInCubic = (t) => t * t * t;
export const easeOutBack = (t) => {
  const c1 = 1.70158, c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
};
export const easeOutElastic = (t) => {
  const c4 = (2 * Math.PI) / 3;
  return t === 0 ? 0 : t === 1 ? 1 : Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * c4) + 1;
};
export const clamp01 = (t) => Math.max(0, Math.min(1, t));
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const damp = (a, b, lambda, dt) => lerp(a, b, 1 - Math.exp(-lambda * dt));

// Eyes Lab — 3D rock preview.
//
// Renders the ACTUAL in-game stone (Rock + FlatEyes), cel-shaded with the same
// inverted-hull outline and mood-lighting rig as the game, so you can see how
// an expression + pupil styling reads on the real 3D pebble (not just the flat
// outline sheet). Drag to tumble it, move the cursor over it and the pupils
// gaze along; leave it alone and it drifts back into a lazy turntable spin.
import * as THREE from "three";
import { Rock, setEyeTarget } from "../rock.js";
import { addOutline } from "../outline.js";
import { CelShader } from "../celshader.js";

export class RockPreview3D {
  constructor(canvas) {
    this.canvas = canvas;

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
    this.camera.position.set(0, 0.2, 4.6);
    this.camDist = this.camera.position.length();

    // mood-lighting rig, mirrored from world.js (scaled to this tiny scene)
    const key = new THREE.DirectionalLight(0xfff2d8, 1.9); key.position.set(6, 8, 6);
    const fill = new THREE.DirectionalLight(0x9fd0ff, 0.55); fill.position.set(-5, 3, -6);
    this.scene.add(key, fill);
    this.scene.add(new THREE.AmbientLight(0x88aabb, 0.6));
    this.scene.add(new THREE.HemisphereLight(0xbfeaf5, 0x2a6448, 0.6));

    // a nice flat, smooth stone so the eyes read big and clean
    this.rock = new Rock({
      seed: 7, lumpAmp: 0.05, thickness: 0.5, size: 1.5,
      color: "#8f9aa3", pattern: "plain", expression: "neutral",
    });
    this.scene.add(this.rock.group);
    addOutline(this.rock.mesh, 0x16324a, { thickness: 0.05 });
    this.cel = new CelShader(this.scene, { steps: 4, floor: 0.42, rescanSec: 1.0 });

    // interaction state
    this.spinVel = 0.35;   // idle turntable speed
    this.idleAt = 0;       // elapsed after which the lazy spin may resume
    this.elapsed = 0;
    this.dragging = false;
    this.lastX = 0; this.lastY = 0;
    this.hovering = false;
    this.ndc = new THREE.Vector2(0, 0.1);

    this.raycaster = new THREE.Raycaster();
    this._target = new THREE.Vector3(0, 0.2, 0);
    this._camQuat = new THREE.Quaternion();

    this.running = false;
    this._last = 0;
    this._frame = this._frame.bind(this);
    this._bindPointer();
  }

  // ---------------------------------------------------------------- pointer
  _bindPointer() {
    const c = this.canvas;
    c.addEventListener("pointermove", (e) => {
      const r = c.getBoundingClientRect();
      this.ndc.x = ((e.clientX - r.left) / r.width) * 2 - 1;
      this.ndc.y = -(((e.clientY - r.top) / r.height) * 2 - 1);
      this.hovering = true;
      if (this.dragging) {
        const dx = e.clientX - this.lastX;
        const dy = e.clientY - this.lastY;
        this.rock.group.rotation.y += dx * 0.01;
        this.rock.group.rotation.x = THREE.MathUtils.clamp(
          this.rock.group.rotation.x - dy * 0.008, -1.0, 1.0
        );
        this.lastX = e.clientX; this.lastY = e.clientY;
      }
    });
    c.addEventListener("pointerdown", (e) => {
      this.dragging = true;
      this.lastX = e.clientX; this.lastY = e.clientY;
      this.spinVel = 0;
      this.idleAt = Infinity; // hold still while grabbed
      c.setPointerCapture(e.pointerId);
    });
    const release = () => {
      this.dragging = false;
      this.idleAt = this.elapsed + 4; // resume the lazy spin 4s after letting go
    };
    c.addEventListener("pointerup", release);
    c.addEventListener("pointercancel", release);
    c.addEventListener("pointerleave", () => { this.hovering = false; });
  }

  // ---------------------------------------------------------------- controls
  setExpression(name) {
    this.rock.baseExpr = name;
    this.rock._mood = name;
    this.rock._moodT = 0;
    this.rock.flatEyes.setExpression(name);
  }

  setPupil({ size, follow, gloss, iris, tint } = {}) {
    const u = this.rock.flatEyes.mat.uniforms;
    if (size != null) u.uPupilFrac.value = size;
    if (follow != null) u.uFollow.value = follow;
    if (gloss != null) u.uGloss.value = gloss;
    if (iris) u.uIris.value.set(iris);
    if (tint) u.uTint.value.set(tint);
  }

  // ---------------------------------------------------------------- lifecycle
  resize() {
    const r = this.canvas.getBoundingClientRect();
    if (!r.width || !r.height) return;
    this.renderer.setSize(r.width, r.height, false);
    this.camera.aspect = r.width / r.height;
    this.camera.updateProjectionMatrix();
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.resize();
    this._last = performance.now();
    requestAnimationFrame(this._frame);
  }

  stop() { this.running = false; }

  _frame(now) {
    if (!this.running) return;
    requestAnimationFrame(this._frame);
    let dt = Math.min(0.05, (now - this._last) / 1000);
    if (!Number.isFinite(dt) || dt < 0) dt = 1 / 60;
    this._last = now;
    this.elapsed += dt;

    // lazy turntable when idle
    if (!this.dragging && this.elapsed >= this.idleAt) {
      this.spinVel = THREE.MathUtils.damp(this.spinVel, 0.35, 1.5, dt);
      this.rock.group.rotation.y += this.spinVel * dt;
    }

    // pupils gaze along the cursor; otherwise look at the viewer
    if (this.hovering) {
      this.raycaster.setFromCamera(this.ndc, this.camera);
      this.raycaster.ray.at(this.camDist, this._target);
    } else {
      this._target.copy(this.camera.position);
    }
    this.camera.getWorldQuaternion(this._camQuat);
    setEyeTarget(this._target, this._camQuat);

    this.rock.update(dt);
    this.cel.update(dt);
    this.renderer.render(this.scene, this.camera);
  }
}

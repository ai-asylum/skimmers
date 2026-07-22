import * as THREE from "three";

// Inverted-hull silhouette outlines — copied from Train Slop's utils/outline.js
// (team scrap: inverted-hull-outline). For every mesh under `root`, add a
// slightly larger back-faced shell so objects read with a dark comic line.

const SHARED_MATS = new Map();

function matFor(color) {
  const key = `${color}`;
  let m = SHARED_MATS.get(key);
  if (!m) {
    m = new THREE.MeshBasicMaterial({ color, side: THREE.BackSide });
    SHARED_MATS.set(key, m);
  }
  return m;
}

export function addOutline(root, color = 0x16324a, opts = {}) {
  if (!root) return;
  const { thickness = 0.06 } = typeof opts === "number" ? { thickness: opts } : opts;
  const mat = matFor(color);
  const meshes = [];
  root.traverse((o) => {
    if (o.isMesh && o.geometry && !o.userData._outline) meshes.push(o);
  });
  for (const m of meshes) {
    const shell = new THREE.Mesh(m.geometry, mat);
    shell.userData._outline = true;
    shell.scale.setScalar(1 + thickness);
    shell.renderOrder = (m.renderOrder || 0) - 1;
    shell.castShadow = false;
    shell.receiveShadow = false;
    m.add(shell);
  }
}

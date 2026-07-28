/**
 * The inflatable ring, built once and used twice: bobbing on the lake as the
 * fishing line's tie-off (fishing.js) and three in a row along the bench seat
 * holding your stones (bench.js). One builder so a floater is a floater
 * wherever you meet it.
 *
 * Flat-shaded like the rest of the props, laid flat in the xz plane with its
 * centre on the group origin, so a caller can drop a rock straight into it.
 */
import * as THREE from "three";

export const BUOY_R = 0.85;    // ring centreline radius
export const BUOY_TUBE = 0.34; // how fat the tube is
const RING_COLOR = 0xff5a3c;
const PATCH_COLOR = 0xf4f0e6;

/**
 * The two materials come back out with the group because a bought floater
 * (cosmetics.js `paintFloater`) is just a recolour of this same ring — and the
 * sprinkles that only the donut wants are built once, hidden, and switched on
 * by whoever is wearing it.
 *
 * @returns {{ group: THREE.Group, ringMat: THREE.Material, patchMat: THREE.Material, setSprinkles: (on:boolean)=>void }}
 */
export function makeLifebuoy() {
  const group = new THREE.Group();
  group.rotation.x = Math.PI / 2; // lay the torus flat
  const ringMat = new THREE.MeshStandardMaterial({ color: RING_COLOR, flatShading: true });
  group.add(new THREE.Mesh(new THREE.TorusGeometry(BUOY_R, BUOY_TUBE, 10, 18), ringMat));
  // classic lifebuoy patches, a slightly fatter tube so they sit proud
  const patchMat = new THREE.MeshStandardMaterial({ color: PATCH_COLOR, flatShading: true });
  for (let i = 0; i < 4; i++) {
    const patch = new THREE.Mesh(new THREE.TorusGeometry(BUOY_R, BUOY_TUBE + 0.02, 10, 4, Math.PI / 6), patchMat);
    patch.rotation.z = i * (Math.PI / 2) - Math.PI / 12;
    group.add(patch);
  }

  const sprinkles = new THREE.Group();
  sprinkles.visible = false;
  const SPRINKLE_COLORS = [0xffffff, 0x37c8e0, 0xffd24a, 0x6fe07a, 0xff5470];
  for (let i = 0; i < 22; i++) {
    const a = (i / 22) * Math.PI * 2 + Math.random() * 0.2;
    const lean = (Math.random() - 0.5) * 1.1;
    const bit = new THREE.Mesh(
      new THREE.BoxGeometry(0.13, 0.04, 0.04),
      new THREE.MeshStandardMaterial({ color: SPRINKLE_COLORS[i % SPRINKLE_COLORS.length], flatShading: true }),
    );
    bit.position.set(Math.cos(a) * BUOY_R, Math.sin(a) * BUOY_R, -BUOY_TUBE * Math.cos(lean) * 0.92);
    bit.rotation.set(0, 0, a + lean);
    sprinkles.add(bit);
  }
  group.add(sprinkles);

  return { group, ringMat, patchMat, setSprinkles: (on) => { sprinkles.visible = on; } };
}

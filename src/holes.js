/**
 * Course definitions, shared by the game (src/main.js) and the admin level
 * editor (src/admin/leveleditor.js).
 *
 * Each hole is a fairway path (tee = first point, flag = last) with island
 * rest stops on the bends and spire rocks that wall off the straight shot.
 * `width` is the half-width of the water channel the lake is carved into
 * (see water.setPath). Edit these by hand, or visually in /admin, then paste
 * the exported array back over this one.
 */
export const HOLES = [
  {
    // gentle S through one island; spires wall off the straight shot
    time: 90,
    width: 13,
    path: [
      { x: 0, z: 46 }, { x: -18, z: 28 }, { x: -27, z: 6 },
      { x: -14, z: -16 }, { x: 0, z: -38 },
    ],
    islands: [{ x: -27, z: 6, r: 3.4 }],
    rocks: [
      { x: 0.6, z: 33.4, r: 5.5, h: 9 }, { x: -18.6, z: 40.6, r: 4.5, h: 8 },
      { x: -12.3, z: 17.1, r: 4.2, h: 7 }, { x: -30.7, z: -6.1, r: 4, h: 8 },
      { x: -10.3, z: -3.9, r: 4, h: 8 }, { x: -17.2, z: -28.4, r: 4, h: 7 },
    ],
  },
  {
    // double dogleg around the east shore, two islands
    time: 100,
    width: 13,
    path: [
      { x: -40, z: -22 }, { x: -14, z: -37 }, { x: 12, z: -34 },
      { x: 34, z: -16 }, { x: 40, z: 6 }, { x: 28, z: 24 }, { x: 12, z: 34 },
    ],
    islands: [{ x: 12, z: -34, r: 3.2 }, { x: 40, z: 6, r: 3.6 }],
    rocks: [
      { x: -26.7, z: -18.9, r: 6, h: 9 }, { x: -27.3, z: -40.1, r: 5, h: 8 },
      { x: 2.3, z: -25.7, r: 4.5, h: 7 }, { x: 32.6, z: -29.2, r: 4.5, h: 8 },
      { x: 27, z: -6.2, r: 4.5, h: 8 }, { x: 41.8, z: 20.2, r: 4, h: 7 },
    ],
  },
  {
    // full zigzag, three islands
    time: 110,
    width: 13,
    path: [
      { x: 40, z: -30 }, { x: 14, z: -41 }, { x: -14, z: -35 },
      { x: -36, z: -14 }, { x: -38, z: 12 }, { x: -16, z: 29 },
      { x: 8, z: 37 }, { x: 28, z: 26 },
    ],
    islands: [{ x: 14, z: -41, r: 3 }, { x: -36, z: -14, r: 3.4 }, { x: -16, z: 29, r: 3 }],
    rocks: [
      { x: 35, z: -42.3, r: 5.5, h: 9 }, { x: 6.6, z: -29.8, r: 4.5, h: 8 },
      { x: -27.8, z: -34.8, r: 4.5, h: 7 }, { x: -27.3, z: -4.6, r: 5, h: 8 },
      { x: -36.4, z: 25.1, r: 4.5, h: 8 }, { x: -5, z: 22.8, r: 4, h: 7.5 },
      { x: 19.2, z: 41.5, r: 4, h: 7 },
    ],
  },
];

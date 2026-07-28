/**
 * Course definitions, shared by the game (src/main.js) and the admin level
 * editor (src/admin/leveleditor.js).
 *
 * Each hole is a fairway path (tee = first point, flag = last) with island
 * rest stops on the bends and spire rocks that wall off the straight shot.
 * `width` is the half-width of the water channel the lake is carved into
 * (see water.setPath). Edit these by hand, or visually in /admin, then paste
 * the exported array back over this one.
 *
 * Shape rule: a hole is a river, not a lap. It runs tee to flag in one
 * direction across the whole map and takes its character from long legs with
 * hard elbows between them — never from curling back around the middle. Run
 * `node scripts/checkholes.mjs` after editing; it enforces the straightness,
 * leg length, elbow angle and hazard placement that rule implies.
 */
export const HOLES = [
  {
    // the long easy river: a run down the map with two lazy leans to read
    time: 150,
    width: 13,
    path: [
      { x: 0, z: 86 }, { x: -8, z: 44 }, { x: 10, z: 4 },
      { x: -8, z: -36 }, { x: 6, z: -84 },
    ],
    islands: [{ x: -8, z: 44, r: 3.4 }, { x: 10, z: 4, r: 3.2 }, { x: -8, z: -36, r: 3.2 }],
    rocks: [
      { x: -10, z: 77, r: 4, h: 7 }, { x: 4, z: 63, r: 4.5, h: 8 },
      { x: -6, z: 21, r: 4.5, h: 8 }, { x: 13, z: 17, r: 4, h: 7 },
      { x: 8, z: -19, r: 4.5, h: 8 }, { x: -11, z: -23, r: 4, h: 7 },
      { x: -9, z: -62, r: 4.5, h: 8 }, { x: 10, z: -70, r: 4, h: 7 },
    ],
  },
  {
    // the diagonal: corner to corner, three doglegs you can cut or respect
    time: 170,
    width: 13,
    path: [
      { x: -76, z: 34 }, { x: -30, z: 54 }, { x: 2, z: 26 },
      { x: 16, z: -16 }, { x: 52, z: -30 }, { x: 62, z: -58 },
    ],
    islands: [
      { x: -30, z: 54, r: 3.4 }, { x: 2, z: 26, r: 3.2 },
      { x: 16, z: -16, r: 3.2 }, { x: 52, z: -30, r: 3.2 },
    ],
    rocks: [
      { x: -56, z: 51, r: 4.5, h: 8 }, { x: -38, z: 42, r: 4, h: 7 },
      { x: -19, z: 34, r: 4.5, h: 8 }, { x: -1, z: 39, r: 4, h: 7 },
      { x: 17, z: 8, r: 4.5, h: 8 }, { x: 5, z: -8, r: 4, h: 7 },
      { x: 31, z: -30, r: 4.5, h: 8 }, { x: 46, z: -19, r: 4, h: 7 },
      { x: 64, z: -41, r: 4, h: 7.5 },
    ],
  },
  {
    // the switchback: the full width of the map, elbow after elbow, no way round
    time: 190,
    width: 13,
    path: [
      { x: 76, z: -38 }, { x: 30, z: -52 }, { x: 2, z: -14 },
      { x: -40, z: -28 }, { x: -64, z: 0 }, { x: -74, z: 44 },
    ],
    islands: [
      { x: 30, z: -52, r: 3.2 }, { x: 2, z: -14, r: 3.4 },
      { x: -40, z: -28, r: 3.2 }, { x: -64, z: 0, r: 3 },
    ],
    rocks: [
      { x: 55, z: -53, r: 4.5, h: 8 }, { x: 39, z: -41, r: 4, h: 7 },
      { x: 22, z: -28, r: 4.5, h: 8 }, { x: 3, z: -28, r: 4, h: 7 },
      { x: -17, z: -29, r: 4.5, h: 8 }, { x: -32, z: -17, r: 4, h: 7 },
      { x: -46, z: -9, r: 4.5, h: 8 }, { x: -70, z: 12, r: 4, h: 7 },
      { x: -61, z: 24, r: 4.5, h: 8 },
    ],
  },
];

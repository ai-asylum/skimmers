/**
 * The skip playable's course — five short holes instead of the full game's three
 * long ones.
 *
 * An ad is teaching a stranger a control scheme from scratch, so these are built
 * as a lesson rather than as a cup: hole 1 is an empty straight where the only
 * thing to work out is the drag, and each one after it adds exactly one idea —
 * spires to steer past, an elbow to read, a narrow channel, then all of it at
 * once. They're a third the length of an authored hole (src/holes.js) and run a
 * third of the clock, because every one of them ends on the store CTA and most
 * players will only ever see the first couple.
 *
 * Same shape as the holes in src/holes.js — `node scripts/checkholes.mjs` checks
 * these too, against its own looser leg/length limits.
 */
export const PLAYABLE_HOLES = [
  {
    // nothing in the way and a wide channel to land in: the whole hole is "drag
    // back and let go", and a stranger's first throw should not be able to fail
    name: "First Skip",
    time: 45,
    width: 15,
    path: [{ x: 0, z: 30 }, { x: 0, z: 0 }, { x: 0, z: -28 }],
    islands: [],
    rocks: [],
  },
  {
    // the same throw, now with a reason to aim it. Cut diagonally across the lake
    // off a leaning fairway rather than straight down the middle again: hole 1 is
    // a corridor pointed at the horizon, and a second corridor pointed at the same
    // horizon reads as the same hole with rocks in it, however different it plays.
    // The spires sit near enough the centreline to be in shot from the tee — the
    // new idea has to be visible before the throw, not discovered by hitting it.
    name: "Spire Run",
    time: 45,
    width: 14,
    path: [{ x: -34, z: 28 }, { x: -8, z: 4 }, { x: 26, z: -8 }],
    islands: [],
    rocks: [{ x: -16, z: 21, r: 3.2, h: 7 }, { x: 7, z: -9, r: 3.2, h: 7 }],
  },
  {
    // the first hole you can't see the flag from, and the first island to rest a
    // stone on — which is where the two-throw hole gets taught
    name: "The Elbow",
    time: 50,
    width: 14,
    path: [{ x: -14, z: 40 }, { x: -2, z: 0 }, { x: 34, z: -16 }],
    islands: [{ x: -2, z: 0, r: 3.2 }],
    rocks: [{ x: 4, z: 22, r: 3, h: 6 }, { x: 22, z: -4, r: 3, h: 6 }],
  },
  {
    // an S with the banks pulled in: the first hole that punishes a lazy line,
    // and the first that reliably drops someone in the water to go fishing
    name: "Slalom",
    time: 55,
    width: 12,
    path: [{ x: 22, z: 40 }, { x: -6, z: 8 }, { x: 16, z: -30 }],
    islands: [{ x: -6, z: 8, r: 3 }],
    // alternating shoulders rather than gates: side to side down the fairway, so
    // there's always a way past without threading two spires at once
    rocks: [
      { x: 17, z: 27, r: 2.8, h: 6 }, { x: 0, z: 22, r: 2.8, h: 6 },
      { x: 6, z: -3, r: 2.8, h: 6 }, { x: 5, z: -22, r: 2.8, h: 6 },
    ],
  },
  {
    // the finale: full width of the playable's lake, two elbows, both hazards.
    // Long enough that finishing it is worth a card that says you won
    name: "The Long Haul",
    time: 60,
    width: 13,
    path: [{ x: -46, z: 44 }, { x: -6, z: 26 }, { x: 6, z: -16 }, { x: 46, z: -40 }],
    islands: [{ x: -6, z: 26, r: 3.2 }, { x: 6, z: -16, r: 3.2 }],
    // the opening leg is left bare. Hole 4 already opens on a pair of spires
    // framing the shot, and a second tee that does the same reads as the same
    // place — so the last hole starts on open water and a long view, and spends
    // its hazards over the two legs you can't see from the tee
    rocks: [
      { x: 4, z: 17, r: 3.2, h: 7 }, { x: -6, z: 1, r: 3, h: 6.5 },
      { x: 11, z: -8, r: 3.2, h: 7 }, { x: 12, z: -28, r: 3, h: 6.5 },
      { x: 32, z: -23, r: 3.2, h: 7 }, { x: 34, z: -41, r: 3, h: 6.5 },
    ],
  },
];

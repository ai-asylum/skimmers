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
 *
 * Every hole offers more than one way down:
 *
 *   branches: [{ width, path }]           a shortcut. It leaves the main line
 *                                         at its first point, rejoins at its
 *                                         last, and both of those have to sit
 *                                         on the line. It is real water — the
 *                                         lake is the union of the two — and
 *                                         it is narrower, which is what the
 *                                         saved distance costs. There has to
 *                                         be bank standing between it and the
 *                                         river, or it is one wide pool rather
 *                                         than a choice. src/route.js works
 *                                         out what is ahead of what; the rules
 *                                         in src/holerules.js keep the bargain
 *                                         honest (8-40% shorter).
 *
 * Furniture may be placed in a branch as readily as in the main line: it is
 * measured against whichever channel it is standing in, so a tree felled across
 * a shortcut only has to span the shortcut.
 *
 * Beyond islands and rocks a hole may carry furniture, all of it optional and
 * all of it keyed to a point on the centreline (see src/props.js):
 *
 *   falls:   { x, z, drop }               a lip the river steps down. Everything
 *                                         upstream — water, bed, banks, props —
 *                                         rides `drop` higher, so the hole plays
 *                                         downhill in terraces. Every hole has
 *                                         at least one; checkholes.mjs insists.
 *   wheels:  { x, z, r, rpm, bank }       an undershot mill wheel with a mill on
 *                                         the `bank` side (-1 / +1). The blades
 *                                         bat a stone that arrives at the wrong
 *                                         moment and slingshot one that doesn't.
 *   bridges: { x, z, clear, piers }       a plank deck `clear` above the water on
 *                                         `piers` pillars. Skip under it, bonk
 *                                         the underside, or land on the deck.
 *   caves:   { x, z, len, clear, pillars} a tunnel `len` long through a headland.
 *                                         Dark, low, and full of things to hit.
 *   logs:    { x, z, clear, tilt, bank }  a fallen tree lying across the water,
 *                                         `clear` above it on the `bank` side
 *                                         and `tilt` higher at the far end. The
 *                                         line under it is never the middle.
 *   dams:    { x, z, notch, gap }         a beaver dam: a wall with one gap in
 *                                         it, `gap` wide, `notch` off centre.
 *                                         It holds water back, so it is also a
 *                                         small waterfall (see `holeFalls`).
 *
 * And the water itself can be given a character, which acts on stones that have
 * already stopped rather than on the throw:
 *
 *   flow:    <units/second>               the river runs. Quickest down the
 *                                         middle, dead at the bank, quicker
 *                                         still into a lip, and backwards in
 *                                         the lee of a spire. A settled stone
 *                                         goes where the water takes it.
 *   rapids:  { x, z, len, mul }           a stretch that runs `mul` times
 *                                         faster, and is white about it.
 *   ice:     { x, z, len }                a frozen stretch. Nothing skips and
 *                                         nothing sinks: stones land and slide.
 *   weeds:   { x, z, r }                  a reed bed. Soft to land in, hard to
 *                                         get through, and it holds you still.
 *
 * Finally, a hole may name a `biome` (src/biomes.js) — the sky, light, water
 * and planting it is dressed in. Leave it off and the hole wears whatever its
 * cup is wearing, which is the usual case; set it only when the hole would look
 * absurd otherwise, like a sheet of ice in high summer.
 *
 * ---------------------------------------------------------------------------
 * The order of this array is the order the game teaches itself.
 *
 * Every hole introduces exactly one element that no hole before it had, and
 * keeps whatever it likes of the ones that came before. That is the whole rule,
 * and it is worth defending: a hole that brings two new things at once teaches
 * neither, and a hole that brings none is a hole the player has already played.
 *
 * The terrace and the fork are the exceptions, and both are deliberate. A lake
 * that steps down is not a trick laid on top of the river, it is what a river
 * *is* — and so is a river that braids. So every hole in the lake has at least
 * one lip in it and at least one second way down, and hole 1 shows you both
 * along with the islands and the spires. That costs the ladder two rungs, and
 * it buys three holes whose whole test is a drop or a choice rather than a new
 * noun: hole 2 makes a staircase of the step and hole 4 makes a cliff of it,
 * and hole 13 is nothing but the fork, run twice as far and twice as mean.
 * Those three are the only holes allowed to introduce nothing (checkholes.mjs
 * names them).
 *
 * What a fork is *for* changes down the ladder, which is the other reason it
 * is not a rung. Early on it is a plain choice between wide water and short
 * water. Later it is the way past the hole's own element — the gut that goes
 * round the wheels, under neither tree, through the notch nobody dammed — so
 * that every element the game teaches gets asked a second question: is it
 * worth going through this, or worth going round it in half the width?
 *
 *    1  Long Water     the river itself — islands, spires, a step and a fork
 *    2  Stepwater      three drops in a row and nothing else to read
 *    3  Bridgeworks    bridges     something over the water to duck
 *    4  Cataract Run   the same step again, twelve metres of it
 *    5  Millrace       wheels      something you have to time
 *    6  The Undertow   caves       a throw you cannot see the end of
 *    7  The Race       flow        the water moves, so a stopped stone hasn't
 *    8  The Chute      rapids      ...and moves faster down some of it
 *    9  The Slack      weeds       ...and holds on to you in the rest
 *   10  Deadfall       logs        headroom, but only against one bank
 *   11  The Lodge      dams        a wall with a single gap chewed in it
 *   12  Cold Snap      ice         nothing skips and nothing sinks
 *   13  The Split      the fork itself, with everything else stripped away
 *
 * src/cups.js walks this ladder two rungs a cup. Adding a hole in the middle
 * means renumbering the `base` indices there, which is the price of the order
 * meaning something. Adding an element means adding a rung.
 */
export const HOLES = [
  {
    // 1 · LONG WATER — the river and nothing else in it. A run down the map
    // with two lazy leans to read, islands on the bends to rest a stone on and
    // spires to miss. Everything the game asks of you later is asked here
    // first, with nothing on top of it — except the one three-metre step below
    // the first bend, which is not a hazard so much as an introduction: the
    // lake you are about to spend thirteen holes on is not one flat sheet.
    time: 150,
    width: 13,
    path: [
      { x: 0, z: 86 }, { x: -8, z: 44 }, { x: 20, z: 4 },
      { x: -8, z: -36 }, { x: 6, z: -84 },
    ],
    branches: [
      // the first fork, and the plainest one in the lake: the river leans east
      // around the middle island and a straight side channel carries on down
      // the west bank between the two rest stops. Nothing is hidden and nothing
      // is in the way — the only thing being taught is that the water has more
      // than one way down, and that the shorter one is the narrower one.
      { width: 8, path: [{ x: -8, z: 44 }, { x: -26, z: 4 }, { x: -8, z: -36 }] },
    ],
    falls: [{ x: -0.5, z: 34, drop: 3 }],
    islands: [{ x: -8, z: 44, r: 3.4 }, { x: 20, z: 4, r: 3.2 }, { x: -8, z: -36, r: 3.2 }],
    rocks: [
      { x: -10, z: 77, r: 4, h: 7 }, { x: 4, z: 63, r: 4.5, h: 8 },
      { x: -0.5, z: 20, r: 4.5, h: 8 }, { x: 20, z: 18.5, r: 4, h: 7 },
      { x: 12.5, z: -20, r: 4.5, h: 8 }, { x: -8, z: -21.5, r: 4, h: 7 },
      { x: -9, z: -62, r: 4.5, h: 8 }, { x: 10, z: -70, r: 4, h: 7 },
    ],
  },
  {
    // 2 · STEPWATER — the step from hole 1, three times over, and nothing else
    // to think about. Wide, shallow, almost no rock: the hole is the drops.
    // Each one is small enough to survive badly and close enough to the next
    // that a stone still skipping when it goes over the first is a stone that
    // takes all three, which is the thing this hole is for. Come down short
    // into a plunge pool and you throw the next one from the bottom of it.
    time: 155,
    width: 14,
    path: [
      { x: 74, z: -40 }, { x: 34, z: -56 }, { x: -2, z: -16 },
      { x: -44, z: -40 }, { x: -76, z: -14 },
    ],
    branches: [
      // the staircase has a banister. The river climbs north around the middle
      // island and takes the second lip on the way; the side channel runs the
      // south side of it in one long straight and takes the same lip lower
      // down, where it is a slide rather than a step. Same three drops either
      // way — this hole would not be itself if a shortcut let you off one.
      { width: 8.5, path: [{ x: 35, z: -55.5 }, { x: -8, z: -64 }, { x: -44.5, z: -39.5 }] },
    ],
    falls: [
      { x: 45, z: -52, drop: 3 }, { x: 9, z: -28.5, drop: 3 },
      { x: -33, z: -33.5, drop: 2.8 },
    ],
    islands: [{ x: 34, z: -56, r: 3.4 }, { x: -2, z: -16, r: 3.4 }, { x: -44, z: -40, r: 3.2 }],
    rocks: [
      { x: 56, z: -42, r: 3.6, h: 6.5 }, { x: 13.5, z: -49, r: 4, h: 7 },
      { x: -17.5, z: -36, r: 4, h: 7 }, { x: -58, z: -36, r: 3.6, h: 6.5 },
      { x: -70, z: -28, r: 3.4, h: 6.5 },
    ],
  },
  {
    // 3 · BRIDGEWORKS — new: bridges, the first thing that is over the water
    // rather than in it. Three crossings of a narrow channel, each meaner than
    // the last: a single mid-stream pier, then a low deck on two, then a
    // three-pier trestle with gaps barely wider than a stone. Land on a deck
    // and you throw the next one from up there, which is its own kind of good.
    // A lip on the long run out of the last trestle, so the hole finishes on
    // the shelf below the one it spent three crossings getting across.
    time: 165,
    width: 11,
    path: [
      { x: -70, z: -46 }, { x: -26, z: -72 }, { x: 4, z: -38 },
      { x: 34, z: -2 }, { x: 56, z: 36 },
    ],
    branches: [
      // the works are on the river, so the gut is the way round the works: it
      // leaves below the first pier and comes back above the trestle, buying
      // you the middle deck — the low one — and the whole bend it stands on.
      // Seven metres wide with nowhere to stop, against eleven with an island
      // on it. The first crossing and the last are on both lines: one because
      // it is the opening throw, one because it is the hole's last word.
      { width: 7, path: [{ x: -54.5, z: -55 }, { x: -32, z: -30 }, { x: 15, z: -24.5 }] },
    ],
    bridges: [
      { x: -48, z: -59, clear: 2.9, piers: 1 },
      { x: -10, z: -55, clear: 2.2, piers: 2 },
      { x: 22, z: -16, clear: 2.5, piers: 3 },
    ],
    falls: [{ x: 42, z: 13, drop: 3.5 }],
    islands: [{ x: -26, z: -72, r: 3.2 }, { x: 4, z: -38, r: 3.4 }, { x: 34, z: -2, r: 3.2 }],
    rocks: [
      { x: -60, z: -39.5, r: 3.4, h: 6.5 }, { x: -22, z: -56, r: 3.6, h: 7 },
      { x: 12, z: -24, r: 3.4, h: 6.5 }, { x: 32, z: -14, r: 3.6, h: 7 },
      { x: 55, z: 24, r: 3.4, h: 6.5 },
    ],
  },
  {
    // 4 · CATARACT RUN — the steps of hole 2 grown up. Nothing new, and that
    // is the point: the river falls twelve metres in two of them instead of
    // nine in three. You tee off on the top shelf and can see both lips from
    // there; the trick is that a stone going over one keeps everything it had,
    // so a fast flat throw off the top arrives in the bottom pool still
    // skipping. Everything else on the hole is rock, and there is a lot of it.
    time: 170,
    width: 12,
    path: [
      { x: -24, z: 80 }, { x: -10, z: 36 }, { x: 26, z: -8 },
      { x: -2, z: -54 }, { x: 10, z: -86 },
    ],
    branches: [
      // both cataracts are on both lines — a lip is a step in the whole valley,
      // not a thing you can walk around. What the west channel sells is the
      // approach: seven and a half metres of dead straight water aimed at both
      // lips instead of the river's swing out east and back, so a stone that is
      // still skipping at the top of the first one is still skipping at the
      // bottom of the second. It is the greedy line, and it is walled in.
      { width: 7.5, path: [{ x: -9, z: 34.5 }, { x: -16, z: -12 }, { x: -1.5, z: -55 }] },
    ],
    falls: [{ x: 10, z: 12, drop: 6.5 }, { x: 11, z: -33, drop: 5.5 }],
    islands: [{ x: -10, z: 36, r: 3.4 }, { x: 26, z: -8, r: 3.2 }, { x: -2, z: -54, r: 3.2 }],
    rocks: [
      { x: -22, z: 62, r: 4, h: 7 }, { x: -4, z: 50, r: 3.6, h: 6.5 },
      { x: -1, z: 18.5, r: 3.4, h: 6.5 }, { x: 23.5, z: 3.5, r: 3.6, h: 7 },
      { x: 12, z: -15.5, r: 4, h: 7.5 }, { x: 10, z: -46, r: 3.6, h: 7 },
      { x: -3, z: -72, r: 4, h: 7.5 }, { x: 10, z: -67, r: 3.6, h: 7 },
    ],
  },
  {
    // 5 · MILLRACE — new: mill wheels, and with them timing. Everything before
    // now has been where; this is when. A weir at the top feeds three undershot
    // wheels strung down the stream, each on the opposite bank to the last, so
    // the fairway zigzags between the blades. They turn at different speeds:
    // the gaps only line up now and then, and the payoff for waiting is a
    // paddle flinging you on. A deck at the bottom to duck, for old times' sake.
    time: 180,
    width: 11,
    path: [
      { x: -78, z: 26 }, { x: -38, z: 52 }, { x: -2, z: 22 },
      { x: 26, z: -14 }, { x: 58, z: -44 },
    ],
    branches: [
      // the leat: the cut the millwright dug to take water round the wheels
      // when the mill was idle. It leaves just above the weir and comes back
      // past the second wheel, so the two you skip are the two that pair up —
      // and it is seven metres wide, which is not much more than a paddle is
      // long. Wait for the gaps or take the ditch nobody maintains.
      { width: 7, path: [{ x: -63, z: 36 }, { x: -40, z: 12 }, { x: 22, z: -9 }] },
    ],
    falls: [{ x: -60, z: 37.5, drop: 4 }],
    wheels: [
      { x: -22.5, z: 33.5, r: 4.2, rpm: 20, bank: 1 },
      { x: 16, z: 7, r: 4.6, rpm: 17, bank: -1 },
      { x: 34, z: -28, r: 4, rpm: 23, bank: 1 },
    ],
    bridges: [{ x: 47, z: -33, clear: 2.4, piers: 2 }],
    islands: [{ x: -38, z: 52, r: 3.4 }, { x: -2, z: 22, r: 3.2 }, { x: 26, z: -14, r: 3.2 }],
    rocks: [
      { x: -50, z: 50, r: 4, h: 7 }, { x: -34, z: 42, r: 3.4, h: 6.5 },
      { x: -6.5, z: 34.5, r: 3.6, h: 7 }, { x: 3, z: 7, r: 3.4, h: 6.5 },
      { x: 22, z: -2, r: 3.6, h: 7 },
    ],
  },
  {
    // 6 · THE UNDERTOW — new: a cave, which is the first throw you cannot watch
    // to the end. A dead straight diagonal with a headland across the middle of
    // it: twenty-two metres of tunnel, two pillars in the dark, and a roof low
    // enough that the only way through is the throw you'd normally never risk —
    // flat, fast and blind. A lip on the approach, so you go over a drop and
    // into the dark on the same throw if you want the tunnel in one.
    time: 175,
    width: 10,
    path: [
      { x: 58, z: 64 }, { x: 26, z: 40 }, { x: -20, z: 26 },
      { x: -34, z: -20 }, { x: -50, z: -58 },
    ],
    branches: [
      // the river gave up on the headland and went round the west of it. The
      // cut is the line it used to take, straight through the middle, and the
      // tunnel is in the cut — so the dark is not something the hole does to
      // you any more, it is something you choose. Six and a half metres and a
      // roof, against ten metres of daylight and further to go.
      { width: 6.5, path: [{ x: 27.5, z: 41 }, { x: 2, z: 4 }, { x: -37, z: -27 }] },
    ],
    caves: [{ x: -17.5, z: -11.5, len: 22, clear: 4.2, pillars: 2 }],
    falls: [{ x: 3, z: 33, drop: 3.5 }],
    islands: [{ x: 26, z: 40, r: 3.4 }, { x: -20, z: 26, r: 3.2 }, { x: -34, z: -20, r: 3.2 }],
    rocks: [
      { x: 44, z: 46, r: 3.6, h: 7 }, { x: 13.5, z: 39.5, r: 3.4, h: 6.5 },
      { x: -8.5, z: 34.5, r: 3.2, h: 6 }, { x: -45, z: -33, r: 3.6, h: 7 },
      { x: -40, z: -50, r: 3.4, h: 6.5 },
    ],
  },
  {
    // 7 · THE RACE — new: current. The first hole that is actually a river, and
    // the first where the throw isn't over when the stone stops. Five metres a
    // second down the middle, nothing at all against the bank, and backwards in
    // the lee of a spire: park in the fast lane and the water walks you on
    // toward the flag, park in the slack and you sit there all day. Nothing is
    // laid on top of it — one lip and one deck — because the current is the
    // hole and it takes a whole hole to believe in. The lip is there to be
    // shown the current's other habit: it quickens as it nears an edge, so a
    // stone parked anywhere above it is a stone on its way over.
    time: 175,
    width: 12,
    flow: 5,
    path: [
      { x: -70, z: 46 }, { x: -34, z: 30 }, { x: 6, z: 40 },
      { x: 44, z: 14 }, { x: 70, z: -26 },
    ],
    branches: [
      // the current is the hole, so the fork is a question about the current:
      // the river loops north through the deep fast middle and under the deck,
      // the cut runs the inside of the loop where the water is seven and a
      // half metres wide and therefore slow all the way across. Shorter, and
      // it will not carry you an inch of it.
      { width: 7.5, path: [{ x: -33.5, z: 30 }, { x: 0, z: 4 }, { x: 60, z: -10.5 }] },
    ],
    bridges: [{ x: 25, z: 27, clear: 2.5, piers: 2 }],
    falls: [{ x: -8, z: 36, drop: 3.5 }],
    islands: [{ x: -34, z: 30, r: 3.4 }, { x: 6, z: 40, r: 3.2 }, { x: 44, z: 14, r: 3.2 }],
    rocks: [
      { x: -58, z: 36, r: 4, h: 7 }, { x: -20, z: 26, r: 3.6, h: 6.5 },
      { x: 14, z: 30, r: 3.4, h: 6.5 }, { x: 34, z: 26, r: 3.6, h: 7 },
      { x: 62, z: -14, r: 3.4, h: 6.5 },
    ],
  },
  {
    // 8 · THE CHUTE — new: rapids. The river you learned last hole, except that
    // two stretches of it run at two and a half times everything else and are
    // white about it. Corner to corner, five legs, and the white water sits on
    // the two longest of them — so a stone parked in a chute is not parked, it
    // is queueing. The rest of the hole is the plain river underneath, which is
    // the comparison the whole thing is built on.
    time: 185,
    width: 13,
    flow: 5.5,
    path: [
      { x: -76, z: 34 }, { x: -30, z: 54 }, { x: 2, z: 26 },
      { x: 16, z: -16 }, { x: 52, z: -30 }, { x: 62, z: -58 },
    ],
    branches: [
      // it leaves halfway down the first chute, so committing to it means
      // committing while the white water is already carrying you, and it lands
      // you below the second one. Skip both chutes and you skip the two
      // stretches that were doing the work — this is the hole where the
      // shortcut is also the slow way.
      { width: 8, path: [{ x: -59.5, z: 41 }, { x: -30, z: 6 }, { x: 35.5, z: -23.5 }] },
    ],
    rapids: [{ x: -52, z: 44, len: 20, mul: 2.4 }, { x: 9, z: 5, len: 18, mul: 2.2 }],
    // the lip sits in the quiet water between the two chutes, so the hole
    // reads chute, drop, chute — fast, further down, fast again
    falls: [{ x: -22, z: 47, drop: 3.2 }],
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
    // 9 · THE SLACK — new: reed beds, which are the other end of the same idea.
    // A chute is water that will not let you stop; a reed bed is water that will
    // not let you go. Three of them sit on the insides of the elbows down the
    // full width of the map — soft to land in, safe, and slow — with one chute
    // off the tee to make the point by contrast. Elbow after elbow and no way
    // round any of them: this is the hole where you choose your own pace.
    time: 190,
    width: 13,
    flow: 4,
    path: [
      { x: 76, z: -38 }, { x: 30, z: -52 }, { x: 2, z: -14 },
      { x: -40, z: -28 }, { x: -64, z: 0 }, { x: -74, z: 44 },
    ],
    branches: [
      // the elbow after elbow this hole is made of, cut off in one line. It
      // leaves at the third bend and does not come back until the last, which
      // is the longest gamble on the course and skips the middle reed bed with
      // it — so the hole where you choose your own pace has one line that
      // chooses a fast one for you, at eight metres of margin.
      { width: 8, path: [{ x: -6.5, z: -17 }, { x: -32, z: 18 }, { x: -69, z: 23 }] },
    ],
    rapids: [{ x: 52, z: -44, len: 18, mul: 2.2 }],
    weeds: [{ x: 22, z: -46, r: 5.5 }, { x: -52, z: -14, r: 5 }, { x: -70, z: 26, r: 5 }],
    falls: [{ x: -9, z: -18, drop: 3.2 }],
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
  {
    // 10 · DEADFALL — new: fallen timber. A bridge has headroom all the way
    // across; a tree that came down in a gale has headroom at one end and none
    // at the other, so the line under it is never the middle and it swaps banks
    // from one tree to the next. The hole runs south to north up the spine of
    // the map with two of them across it, and reeds in the slack water behind
    // the first, where anything that clips the trunk ends up anyway.
    time: 185,
    width: 11,
    flow: 3,
    path: [
      { x: -30, z: -80 }, { x: -4, z: -46 }, { x: -30, z: -8 },
      { x: 2, z: 30 }, { x: 18, z: 72 },
    ],
    branches: [
      // both trees came down across the river, and the river is what bends —
      // so the straight seven-metre channel up the east side goes under
      // neither of them. That is the trade the whole hole turns on: the timber
      // is only in your way if you take the water that has somewhere to land.
      { width: 7, path: [{ x: -4.5, z: -46.5 }, { x: 12, z: -10 }, { x: 3, z: 33 }] },
    ],
    logs: [
      { x: -17, z: -27, clear: 1.9, tilt: 2.6, bank: 1 },
      { x: -14, z: 11, clear: 1.7, tilt: 3, bank: -1 },
    ],
    weeds: [{ x: -20.5, z: -20, r: 4.6 }],
    // a step off the tee shelf, before the first trunk: the hole makes you
    // spend a throw getting down to the water the trees are lying across
    falls: [{ x: -12, z: -56, drop: 3 }],
    islands: [{ x: -4, z: -46, r: 3.2 }, { x: -30, z: -8, r: 3.4 }, { x: 2, z: 30, r: 3.2 }],
    rocks: [
      { x: -16, z: -70, r: 3.6, h: 7 }, { x: -17, z: -36.5, r: 3.4, h: 6.5 },
      { x: -17.5, z: -4.5, r: 3.4, h: 6.5 }, { x: 10, z: 48, r: 3.6, h: 7 },
      { x: 10, z: 58, r: 3.4, h: 6.5 },
    ],
  },
  {
    // 11 · THE LODGE — new: beaver dams, the first thing in the lake that is a
    // wall. Two of them, each with a single gap chewed in it, and the gaps are
    // nowhere near each other. Threading one is also going over it, because a
    // dam that holds water back is a waterfall by another name. Between them a
    // tree came down at an angle, so the only headroom is against one bank —
    // the far one from the notch you just went through, naturally.
    time: 195,
    width: 11,
    flow: 3.6,
    path: [
      { x: -66, z: -58 }, { x: -30, z: -34 }, { x: 8, z: -44 },
      { x: 40, z: -20 }, { x: 66, z: 18 },
    ],
    branches: [
      // the beavers dammed the river; they did not dam the overflow. The cut
      // leaves below the first wall and rejoins past the second, which is the
      // one with the mean notch in it, and it goes under no fallen tree on the
      // way. Everything this hole is famous for is avoidable in seven metres
      // of water — and the first dam, which you meet before the fork, is not.
      { width: 7, path: [{ x: -31, z: -34.5 }, { x: 2, z: -8 }, { x: 55.5, z: 2.5 }] },
    ],
    dams: [
      // the first one is generous, because it is 20u off the tee and a wall you
      // cannot pass on the opening throw is not a hole. The second is the test.
      { x: -46, z: -45, notch: -2, gap: 3.4, drop: 3 },
      { x: 24, z: -32, notch: 4, gap: 2.4, drop: 2.8 },
    ],
    logs: [{ x: -8, z: -40, clear: 1.9, tilt: 2.8, bank: 1 }],
    weeds: [{ x: -28, z: -36, r: 5.5 }],
    // and past both dams, the real thing they are imitating
    falls: [{ x: 45, z: -12, drop: 3 }],
    islands: [{ x: -30, z: -34, r: 3.2 }, { x: 8, z: -44, r: 3.4 }, { x: 40, z: -20, r: 3.2 }],
    rocks: [
      // kept off to one side: the notch in the first dam is the opening throw
      // and a spire on the line to it would make that throw a lottery
      { x: -59, z: -45, r: 3.4, h: 6.5 }, { x: -16, z: -32, r: 3.4, h: 6.5 },
      { x: 12, z: -36, r: 3.6, h: 7 }, { x: 50, z: -6, r: 3.6, h: 7 },
      { x: 62, z: 8, r: 3.4, h: 6.5 },
    ],
  },
  {
    // 12 · COLD SNAP — new: ice, which takes everything the water rules gave
    // you and swaps them round. Nothing skips and nothing sinks: a steep
    // arrival is survivable for once, and a flat one runs and runs. Spires
    // stand in the sheets to bank off, the middle narrows is open water you
    // have to cross properly, and the last sheet runs out barely short of the
    // flag.
    time: 190,
    width: 12,
    flow: 2.4,
    // whatever cup it turns up in, a hole with ice on it is having a cold day
    biome: "pinewood",
    path: [
      { x: 66, z: 52 }, { x: 30, z: 46 }, { x: -4, z: 8 },
      { x: -44, z: 30 }, { x: -74, z: 4 },
    ],
    branches: [
      // a frozen backwater across the top of the bend, straight as a rink and
      // seven and a half metres wide. It skips the second sheet and the reeds,
      // and because nothing sinks on ice the usual price of a narrow line is
      // not the price here: what you are risking is the bank, which on ice is
      // the one thing that will still stop you dead.
      { width: 7.5, path: [{ x: 32.5, z: 46.5 }, { x: -10, z: 52 }, { x: -44.5, z: 29.5 }] },
    ],
    ice: [{ x: 48, z: 49, len: 26 }, { x: -24, z: 19, len: 26 }],
    weeds: [{ x: 11, z: 20.5, r: 5 }],
    // the one thing on the hole still moving: the drop between the two sheets
    falls: [{ x: 21, z: 36, drop: 3 }],
    islands: [{ x: 30, z: 46, r: 3.4 }, { x: -4, z: 8, r: 3.2 }, { x: -44, z: 30, r: 3.2 }],
    rocks: [
      { x: 58, z: 48, r: 3.4, h: 6.5 }, { x: 40, z: 56, r: 3.6, h: 7 },
      { x: 14, z: 26, r: 3.4, h: 6.5 }, { x: -30, z: 16, r: 3.6, h: 7 },
      { x: -60, z: 20, r: 3.4, h: 6.5 },
    ],
  },
  {
    // 13 · THE SPLIT — new: a second way down, and the last thing the lake has
    // to teach. The river swings north around a headland, wide and quick, with
    // white water at the top of the bend to carry you round. Or you take the
    // gut: a channel barely half the width, with a fallen tree across the mouth
    // of it and reeds in the slack behind, that cuts the corner off entirely.
    // The long way is longer and safe; the short way is one good throw and two
    // bad ones waiting. Both lines come back together at the last elbow, and
    // whoever arrives there first has the same throw at the flag.
    time: 200,
    width: 12,
    flow: 3.2,
    path: [
      { x: -80, z: -8 }, { x: -46, z: 26 }, { x: -2, z: 56 },
      { x: 40, z: 26 }, { x: 74, z: -34 },
    ],
    branches: [
      // leaves at the first elbow, rejoins at the last: 14% less water, at
      // seven and a half metres wide instead of twelve
      { width: 7.5, path: [{ x: -46, z: 26 }, { x: -8, z: 12 }, { x: 40, z: 26 }] },
    ],
    // the toll on the gut: a tree across its mouth, and reeds where the water
    // slows behind the tree
    logs: [{ x: -35, z: 22, clear: 1.8, tilt: 2.4, bank: -1 }],
    weeds: [{ x: -19, z: 16, r: 4.6 }],
    // ...against which the long way round gets the fast water
    rapids: [{ x: 19, z: 41, len: 20, mul: 2.4 }],
    // the drop is above the fork, so both lines start from the same shelf and
    // the only thing to weigh up at the mouth of the gut is the gut
    falls: [{ x: -56, z: 16, drop: 3.5 }],
    islands: [{ x: -46, z: 26, r: 3.2 }, { x: -2, z: 56, r: 3.4 }, { x: 40, z: 26, r: 3.2 }],
    rocks: [
      { x: -66, z: 4, r: 3.6, h: 7 }, { x: -30, z: 44, r: 3.4, h: 6.5 },
      { x: 14, z: 52, r: 3.6, h: 7 }, { x: 56, z: -6, r: 3.4, h: 6.5 },
      // and one standing in the gut itself, because a narrow line with nothing
      // in it is just a narrow line
      { x: 6, z: 14, r: 2.8, h: 6 },
    ],
  },
];

/**
 * Every lip a hole has, authored or implied. A beaver dam is a wall that holds
 * water back, which is a terrace with a fence on it — so rather than making
 * authors write the same point out twice and keep the two in step, the dam
 * grows its own fall here. Everything that shapes the lake (main.setupHole, the
 * check scripts) asks this rather than reading `hole.falls` directly.
 */
export function holeFalls(hole) {
  const falls = [...(hole?.falls ?? [])];
  for (const d of hole?.dams ?? []) falls.push({ x: d.x, z: d.z, drop: d.drop ?? 2.8 });
  return falls;
}

/** the surface patches a hole lays in its water, in the shape water.js wants */
export function holeZones(hole) {
  return [
    ...(hole?.rapids ?? []).map((z) => ({ ...z, kind: "rapids" })),
    ...(hole?.ice ?? []).map((z) => ({ ...z, kind: "ice" })),
    ...(hole?.weeds ?? []).map((z) => ({ ...z, kind: "weed" })),
  ];
}

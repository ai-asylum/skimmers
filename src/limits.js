/**
 * The numbers that describe the *shape* of a hole: how wide the water is, how
 * far a waterfall reaches, and how many of each thing a shader uniform can hold.
 *
 * They live apart from water.js only so that things which reason about a hole
 * without drawing it — the level editor in the admin page, the rule checker in
 * holerules.js — can read them without pulling in three.js. water.js imports
 * and re-exports the lot, so it is still the place to import them from when you
 * already have the renderer in hand.
 */
export const LAKE_R = 64; // water becomes shore past this radius

// The lake is shaped as a winding "fairway channel": water lives within
// CHANNEL_W of the current hole's centreline path, everything else reads as
// grassy bank.
export const CHANNEL_MAX_PTS = 32; // points allowed in one fairway centreline
// The lake shader takes the channel as legs, not as a point list, because a
// hole may fork: the main line and every branch share this budget (channel.js).
export const CHANNEL_MAX_SEGS = 40;
export const CHANNEL_W = 13; // default half-width of the water channel

// A waterfall is a terrace: the lake plane stops short of the lip, drops, and
// picks up again below. These two say how much river it eats.
export const FALL_MAX = 4; // shader uniform capacity
export const FALL_LIP = 2.0; // lake plane stops this far *before* the lip
export const FALL_RUN = 4.4; // ...and picks up again this far after it
/** the drop the terrain needs before a fall reads as a fall and not a kerb */
export const FALL_MIN_DROP = 2.5;

export const ZONE_MAX = 6; // rapids/ice/weed patches per hole; shader capacity

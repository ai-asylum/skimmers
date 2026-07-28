/**
 * Thirty upgrades, two to a stone.
 *
 * Every upgrade is a pure edit to one numbers bag — `resolveMods()` folds the
 * equipped ids into a plain object that the physics, the fishing minigame and
 * the aim preview all read from. Nothing here reaches into game systems
 * directly, so a stone with no upgrades resolves to DEFAULT_MODS and every
 * formula collapses back to exactly what it was before.
 *
 * `proc` is the loud half: the ones that fire at a moment you can see get a
 * shout and a colour, and main.js throws that on screen with a pop and a chime
 * the instant the upgrade earns its keep. An upgrade you can't feel is an
 * upgrade nobody buys twice.
 */

/** the stone with nothing bolted on — every default here matches vanilla physics */
export const DEFAULT_MODS = Object.freeze({
  // throw
  speedMul: 1,       // launch speed multiplier
  powerFloor: 0.28,  // fraction of MAX_SPEED a zero-power throw still gets
  cooldownMul: 1,    // between-throw lockout
  assistR: 8,        // aim-assist catchment around the flag, in metres
  previewT: 6,       // how many seconds of flight the dotted preview traces
  // skipping
  keepAdd: 0,        // extra horizontal speed kept per hop
  restAdd: 0,        // extra bounce off the water
  flatAdd: 0,        // bonus flatness, widening the skip window
  minSkipMul: 1,     // scales the speed floor a hop needs
  fireAt: 5,         // chain length that sets the stone alight
  fireKeep: 0,       // extra retention once it's burning
  chainBoost: 0,     // speed kick every third hop
  luckySkip: 0,      // chance a doomed entry skips anyway
  // water
  buoyant: 0,        // chance a sink turns into a float
  sinkMul: 1,        // how fast a sunk stone drops
  sinkGlide: 0,      // 0 = drift dies underwater, 1 = it carries
  // fishing
  hookSpeedMul: 1,
  fishFewer: 0,      // fish removed from the dive
  catchWidth: 1.15,  // how close the hook has to pass the stone
  fishBump: 2.7,     // how far a fish shoves the hook back up
  driftMul: 1,       // ground lost per fish bump
  // hazards
  clonkKeep: 0.4,    // speed kept off a spire
  clonkChain: false, // …and whether the chain survives it
  hullRest: 1.92,    // boat-hull rebound
  duckMul: 1.28,     // duck speed burst
  islandR: 0.85,     // island landing catchment
  // splash
  blastR: 2.6,
  knockMul: 1,
  shields: 0,        // splashes shrugged off per hole
  refund: false,     // a landed splash gives the throw back
  // the hole
  captureMul: 1,     // whirlpool grab radius
});

/**
 * @typedef {object} Upgrade
 * @property {string} id
 * @property {string} name
 * @property {string} icon
 * @property {string} blurb   what it does, in the player's words
 * @property {number} cost    shells
 * @property {string} tag     which shelf of the garage it sits on
 * @property {(m: object) => void} apply
 * @property {{ text: string, color: string }} [proc] shout when it fires
 */

/** @type {Upgrade[]} */
export const UPGRADES = [
  // ---------------------------------------------------------------- the throw
  {
    id: "hotarm", name: "Hot Arm", icon: "💪", tag: "throw", cost: 120,
    blurb: "Every throw leaves your hand 12% faster.",
    apply: (m) => { m.speedMul *= 1.12; },
  },
  {
    id: "cannonball", name: "Cannonball", icon: "💥", tag: "throw", cost: 260,
    blurb: "A brutal 24% harder — but the stone bleeds speed faster on each hop.",
    apply: (m) => { m.speedMul *= 1.24; m.keepAdd -= 0.025; },
  },
  {
    id: "heavyhand", name: "Heavy Hand", icon: "🤜", tag: "throw", cost: 180,
    blurb: "Even a limp flick carries: weak throws start far stronger.",
    apply: (m) => { m.powerFloor = 0.46; },
  },
  {
    id: "gyro", name: "Gyro Spin", icon: "🌀", tag: "throw", cost: 300,
    blurb: "Anything aimed near the whirlpool bends toward it from twice as far.",
    apply: (m) => { m.assistR = 18; },
    proc: { text: "ON LINE", color: "#37c8e0" },
  },
  {
    id: "farsight", name: "Farsight", icon: "👁️", tag: "throw", cost: 90,
    blurb: "The dotted line traces the whole flight instead of the first stretch.",
    apply: (m) => { m.previewT = 13; },
  },
  {
    id: "quickdraw", name: "Quick Draw", icon: "⚡", tag: "throw", cost: 140,
    blurb: "Almost no wait between throws — reload the moment it settles.",
    apply: (m) => { m.cooldownMul = 0.24; },
  },

  // ---------------------------------------------------------------- the chain
  {
    id: "longskip", name: "Long Skipper", icon: "〰️", tag: "skip", cost: 220,
    blurb: "Keeps 7% more speed through every single hop.",
    apply: (m) => { m.keepAdd += 0.07; },
  },
  {
    id: "polished", name: "Polished", icon: "💎", tag: "skip", cost: 200,
    blurb: "Rides like a flatter stone: steeper entries still skip.",
    apply: (m) => { m.flatAdd += 0.16; },
  },
  {
    id: "lowrider", name: "Low Rider", icon: "🛶", tag: "skip", cost: 240,
    blurb: "Keeps hopping at speeds that would drown anyone else's rock.",
    apply: (m) => { m.minSkipMul = 0.68; },
    proc: { text: "STILL GOING", color: "#6fe07a" },
  },
  {
    id: "ricochet", name: "Ricochet", icon: "🏓", tag: "skip", cost: 160,
    blurb: "Bounces 30% higher off the water — clears low spires mid-chain.",
    apply: (m) => { m.restAdd += 0.18; },
  },
  {
    id: "chainreaction", name: "Chain Reaction", icon: "⛓️", tag: "skip", cost: 380,
    blurb: "Every third hop kicks the stone 11% faster instead of slower.",
    apply: (m) => { m.chainBoost += 0.11; },
    proc: { text: "CHAIN!", color: "#ff8a3d" },
  },
  {
    id: "everburn", name: "Everburn", icon: "🔥", tag: "skip", cost: 340,
    blurb: "Catches fire at three hops, and a burning stone holds its speed.",
    apply: (m) => { m.fireAt = 3; m.fireKeep += 0.05; },
  },
  {
    id: "skimluck", name: "Skimmer's Luck", icon: "🍀", tag: "skip", cost: 420,
    blurb: "One entry in five that should have sunk you skips clean off instead.",
    apply: (m) => { m.luckySkip += 0.2; },
    proc: { text: "LUCKY!", color: "#6fe07a" },
  },

  // ---------------------------------------------------------------- the water
  {
    id: "quicksink", name: "Quick Sink", icon: "⏬", tag: "water", cost: 100,
    blurb: "Plummets to the bed at speed — you're on the hook before rivals blink.",
    apply: (m) => { m.sinkMul = 2.4; },
  },
  {
    id: "corkstone", name: "Corkstone", icon: "🛟", tag: "water", cost: 400,
    blurb: "A third of the time the stone simply refuses to go under.",
    apply: (m) => { m.buoyant += 0.34; },
    proc: { text: "IT FLOATS!", color: "#ffd24a" },
  },
  {
    id: "deepglide", name: "Deep Glide", icon: "🐋", tag: "water", cost: 150,
    blurb: "Carries its drift underwater, so a sink still gains you ground.",
    apply: (m) => { m.sinkGlide = 1; },
  },

  // ---------------------------------------------------------------- fishing
  {
    id: "repellent", name: "Fish Repellent", icon: "🐟", tag: "fish", cost: 190,
    blurb: "Three fewer fish patrolling between you and your stone.",
    apply: (m) => { m.fishFewer += 3; },
  },
  {
    id: "greasedline", name: "Greased Line", icon: "💧", tag: "fish", cost: 130,
    blurb: "The hook drops 65% faster. Less dive, more racing.",
    apply: (m) => { m.hookSpeedMul *= 1.65; },
  },
  {
    id: "widenet", name: "Wide Net", icon: "🕸️", tag: "fish", cost: 210,
    blurb: "Snags the stone from nearly twice as far off-centre.",
    apply: (m) => { m.catchWidth = 2.1; },
  },
  {
    id: "slipperyhook", name: "Slippery Hook", icon: "🪝", tag: "fish", cost: 170,
    blurb: "Fish barely knock the line — a bump costs you inches, not metres.",
    apply: (m) => { m.fishBump = 0.9; },
  },
  {
    id: "tugboat", name: "Tugboat", icon: "🚤", tag: "fish", cost: 230,
    blurb: "However badly the dive went, you barely drift back toward the tee.",
    apply: (m) => { m.driftMul = 0.3; },
  },

  // ---------------------------------------------------------------- hazards
  {
    id: "bumperstone", name: "Bumper Stone", icon: "🛞", tag: "hazard", cost: 360,
    blurb: "CLONK a spire and you bounce off with the chain still alive.",
    apply: (m) => { m.clonkKeep = 0.82; m.clonkChain = true; },
    proc: { text: "BOUNCED OFF!", color: "#ff8a3d" },
  },
  {
    id: "rubberhull", name: "Rubber Hull", icon: "🎾", tag: "hazard", cost: 150,
    blurb: "Boat hulls fling you 35% harder. Bank shots for days.",
    apply: (m) => { m.hullRest *= 1.35; },
  },
  {
    id: "duckwhisper", name: "Duck Whisperer", icon: "🦆", tag: "hazard", cost: 110,
    blurb: "Clip a duck and the panic launches you half again as fast.",
    apply: (m) => { m.duckMul = 1.62; },
  },
  {
    id: "islandhop", name: "Island Hopper", icon: "🏝️", tag: "hazard", cost: 140,
    blurb: "Islands catch stones that would have skimmed straight past.",
    apply: (m) => { m.islandR = 1.25; },
  },

  // ---------------------------------------------------------------- the splash
  {
    id: "bigsplash", name: "Big Splash", icon: "🌊", tag: "splash", cost: 250,
    blurb: "Your blast radius grows from 2.6m to 4.4m — catch a whole cluster.",
    apply: (m) => { m.blastR = 4.4; },
  },
  {
    id: "depthcharge", name: "Depth Charge", icon: "🧨", tag: "splash", cost: 280,
    blurb: "Rivals you splash get flung twice as far before they go under.",
    apply: (m) => { m.knockMul = 2; },
  },
  {
    id: "bulwark", name: "Bulwark", icon: "🛡️", tag: "splash", cost: 320,
    blurb: "Shrug off the first splash aimed at you every hole.",
    apply: (m) => { m.shields += 1; },
    proc: { text: "BLOCKED!", color: "#37c8e0" },
  },
  {
    id: "grudge", name: "Grudge", icon: "⚔️", tag: "splash", cost: 300,
    blurb: "Land a splash on someone and your throw comes straight back.",
    apply: (m) => { m.refund = true; },
    proc: { text: "FREE THROW!", color: "#ff5470" },
  },

  // ---------------------------------------------------------------- the hole
  {
    id: "lodestone", name: "Lodestone", icon: "🧲", tag: "hazard", cost: 450,
    blurb: "The whirlpool reaches 45% further out to drag your stone under.",
    apply: (m) => { m.captureMul = 1.45; },
  },
];

export const UPGRADE_BY_ID = new Map(UPGRADES.map((u) => [u.id, u]));

export const TAG_LABELS = {
  throw: "The throw",
  skip: "The chain",
  water: "The water",
  fish: "Fishing",
  hazard: "Hazards",
  splash: "The splash",
};

/** fold a list of equipped ids into one numbers bag for the sim to read */
export function resolveMods(ids) {
  const m = { ...DEFAULT_MODS };
  for (const id of ids ?? []) {
    UPGRADE_BY_ID.get(id)?.apply(m);
  }
  return m;
}

/** the untouched bag — bots and remote stones run on this */
export const vanillaMods = () => ({ ...DEFAULT_MODS });

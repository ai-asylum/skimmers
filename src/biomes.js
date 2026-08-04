/**
 * Biomes — the same lake in a different country.
 *
 * A hole's shape (holes.js) says nothing about what it looks like, and the look
 * is a whole scene's worth of settings that have to agree with each other: the
 * sky and the fog and the water and the treeline all have to be from the same
 * afternoon or the picture falls apart. So they are authored together, one
 * bundle per biome, and applied in one call at the top of setupHole.
 *
 * This is also what carries the third track in each cup (cups.js), which is
 * always an earlier hole mirrored or turned round — the *same water* as a hole
 * you played a cup ago. Put summer on one and October on the other and they
 * read as different places before the player has thrown anything.
 *
 * Every field is optional. `meadow` states the whole shipped look, every other
 * biome is merged over it, so a biome only has to say what it changes and
 * nothing can quietly inherit half of the last hole's weather.
 *
 * All of them are loud, and that is a rule rather than a taste: a flat grey
 * stone on flat grey water is unreadable at a glance, and a glance is all an ad
 * gets. Overcast and last-light versions of these were cut for exactly that.
 * Saturated palettes, a wide spread between the darkest and lightest thing on
 * screen, a hard key light and thin fog — haze is what eats contrast, so no
 * biome gets to hide behind it. scripts/check-biomes.mjs holds the line.
 *
 *   sky      horizon -> zenith gradient stops for the dome
 *   fog      colour + FogExp2 density; also bleeds up the sky's horizon
 *   sun      direction of the painted sun, the key light and the lake's sheen
 *   light    key / fill / ambient / hemisphere colours and intensities
 *   clouds   tint of the cloud pack
 *   land     elevation gradient for the banks, shoreline -> peaks (terrain.js)
 *   shore    the beach and the lake bed underfoot
 *   water    the lake's own bands (water.js WATER_COLOR_KEYS)
 *   trees    bark and leaf, a species mix by model prefix, and how many
 *   under    a wash over the undergrowth's baked colours, and how much of it
 *   grass    blade colour and density
 *   rock     the big spires in the channel
 */
import { WATER_COLOR_KEYS } from "./water.js";
import { setTerrainGradient, setShoreColors } from "./terrain.js";

export const BIOMES = {
  meadow: {
    name: "Meadow",
    blurb: "High summer on a wide green lake. The shipped look.",
    sky: [{ t: 0, hex: "#ffe9c4" }, { t: 0.35, hex: "#a7dcef" }, { t: 1, hex: "#3f9bd8" }],
    fog: { color: "#a7dcef", density: 0.0088 },
    sun: [0.5, 0.55, 0.35],
    light: {
      key: { hex: "#fff2d8", i: 2.15 }, fill: { hex: "#9fd0ff", i: 0.44 },
      ambient: { hex: "#88aabb", i: 0.38 }, hemi: { sky: "#bfeaf5", ground: "#2a6448", i: 0.5 },
    },
    clouds: "#ffffff",
    land: [
      { t: 0, hex: "#7cb86b" }, { t: 0.234, hex: "#5c9358" },
      { t: 0.571, hex: "#679e67" }, { t: 1, hex: "#cbd3d1" },
    ],
    shore: { sand: "#f7edd1", mud: "#ddd4bc", mudDeep: "#95adad" },
    water: {
      uDeep: "#3f82ab", uMid: "#378ba9", uShallow: "#1b8793",
      uShelf: "#29a3b3", uSheen: "#d6f4ff", uFoam: "#ffffff",
    },
    trees: { bark: "#a06b40", leaf: "#659334", mix: null, density: 1 },
    under: { tint: null, amount: 0, density: 1 },
    grass: { color: "#8fdb5c", density: 1 },
    rock: "#b5a77d",
  },

  autumn: {
    name: "Autumn",
    blurb: "The same rivers in October. Low sun, rust in the canopy.",
    sky: [{ t: 0, hex: "#ffdcae" }, { t: 0.4, hex: "#dccfba" }, { t: 1, hex: "#7ba6cb" }],
    fog: { color: "#e8d6b4", density: 0.0086 },
    sun: [0.62, 0.33, 0.3],
    light: {
      key: { hex: "#ffd9a5", i: 2.2 }, fill: { hex: "#b9c6e0", i: 0.42 },
      ambient: { hex: "#a99883", i: 0.38 }, hemi: { sky: "#f0dcbb", ground: "#4a3a24", i: 0.5 },
    },
    clouds: "#ffeedd",
    land: [
      { t: 0, hex: "#9aa858" }, { t: 0.24, hex: "#7d8b45" },
      { t: 0.58, hex: "#87794a" }, { t: 1, hex: "#c9bfae" },
    ],
    shore: { sand: "#f0e0bc", mud: "#cfc0a0", mudDeep: "#8d9a92" },
    water: {
      uDeep: "#3d6f92", uMid: "#3a7c95", uShallow: "#2c8481",
      uShelf: "#42a598", uSheen: "#ffe9c8", uFoam: "#fff6e8",
    },
    trees: { bark: "#8a5a33", leaf: "#d0842c", mix: { Willow: 1.4, BirchTree: 1.6, PineTree: 0.5 }, density: 1 },
    under: { tint: "#c9793a", amount: 0.55, density: 0.9 },
    grass: { color: "#c2bd58", density: 0.85 },
    rock: "#a89773",
  },

  highland: {
    name: "Highland",
    blurb: "Glacier water under a hard blue sky. Cold light, loud colour.",
    sky: [{ t: 0, hex: "#e8fbff" }, { t: 0.35, hex: "#5fd8f5" }, { t: 1, hex: "#0e6fd4" }],
    fog: { color: "#bfeeff", density: 0.0072 },
    sun: [0.35, 0.7, -0.2],
    light: {
      key: { hex: "#ffffff", i: 2.5 }, fill: { hex: "#7fc4ff", i: 0.35 },
      ambient: { hex: "#6f93a8", i: 0.34 }, hemi: { sky: "#bfeeff", ground: "#20402c", i: 0.42 },
    },
    clouds: "#ffffff",
    land: [
      { t: 0, hex: "#54c257" }, { t: 0.24, hex: "#2f9450" },
      { t: 0.55, hex: "#5d8f6a" }, { t: 1, hex: "#ffffff" },
    ],
    shore: { sand: "#f2ead2", mud: "#b9b39a", mudDeep: "#3f7f96" },
    water: {
      uDeep: "#0a4b7a", uMid: "#0e6f9e", uShallow: "#0f9db0",
      uShelf: "#31d9cf", uSheen: "#ffffff", uFoam: "#ffffff",
    },
    trees: { bark: "#6b4a2f", leaf: "#2f8a49", mix: { PineTree: 2.2, Willow: 0.3, CommonTree: 0.6 }, density: 0.75 },
    under: { tint: "#3f9a5c", amount: 0.35, density: 1.15 },
    grass: { color: "#66d95e", density: 0.8 },
    rock: "#a8b0b4",
  },

  dusk: {
    name: "Sunset",
    blurb: "The sky on fire and the lake throwing it straight back at you.",
    sky: [{ t: 0, hex: "#ffd23f" }, { t: 0.3, hex: "#ff5e7a" }, { t: 1, hex: "#3d1d8f" }],
    fog: { color: "#ff9e6b", density: 0.0068 },
    sun: [0.85, 0.2, 0.2],
    light: {
      key: { hex: "#ffb43f", i: 2.6 }, fill: { hex: "#7a5ce0", i: 0.4 },
      ambient: { hex: "#5a4a80", i: 0.32 }, hemi: { sky: "#ff9ec0", ground: "#1a0f2e", i: 0.45 },
    },
    clouds: "#ff9a6b",
    land: [
      { t: 0, hex: "#3f8f52" }, { t: 0.24, hex: "#2c6b4a" },
      { t: 0.57, hex: "#5a4a72" }, { t: 1, hex: "#ffd9a8" },
    ],
    shore: { sand: "#ffd9a0", mud: "#c98f6a", mudDeep: "#3f5f8c" },
    water: {
      uDeep: "#14205e", uMid: "#1e3f96", uShallow: "#2f7fc4",
      uShelf: "#3fc7d8", uSheen: "#ffd23f", uFoam: "#fff3d0",
    },
    trees: { bark: "#4a3320", leaf: "#2f7a4a", mix: null, density: 1.05 },
    under: { tint: "#7a3f9a", amount: 0.35, density: 1 },
    grass: { color: "#4fa95c", density: 1 },
    rock: "#a37f92",
  },

  pinewood: {
    name: "Pinewood",
    blurb: "Snowmelt water under black pines. Everything here is cold.",
    sky: [{ t: 0, hex: "#eaf4f8" }, { t: 0.35, hex: "#bfe0ef" }, { t: 1, hex: "#3f7fb8" }],
    fog: { color: "#cde3ee", density: 0.0084 },
    sun: [0.42, 0.4, 0.5],
    light: {
      key: { hex: "#eef6ff", i: 2.15 }, fill: { hex: "#a8c8e8", i: 0.44 },
      ambient: { hex: "#93a8b8", i: 0.38 }, hemi: { sky: "#dceef8", ground: "#2c3d38", i: 0.55 },
    },
    clouds: "#ffffff",
    land: [
      { t: 0, hex: "#5f9068" }, { t: 0.22, hex: "#3f6b52" },
      { t: 0.52, hex: "#51655e" }, { t: 1, hex: "#e8eff2" },
    ],
    shore: { sand: "#d8dcd6", mud: "#b0b8b4", mudDeep: "#7e9aa0" },
    water: {
      uDeep: "#1f5c80", uMid: "#236c8b", uShallow: "#218190",
      uShelf: "#3ba3ad", uSheen: "#eaf9ff", uFoam: "#ffffff",
    },
    trees: { bark: "#6b533c", leaf: "#33604a", mix: { PineTree: 3, BirchTree: 1.2, Willow: 0, CommonTree: 0.35 }, density: 1.1 },
    under: { tint: "#7f9a86", amount: 0.4, density: 0.8 },
    grass: { color: "#6fae74", density: 0.7 },
    rock: "#9aa3a6",
  },
};

export const DEFAULT_BIOME = "meadow";
export const BIOME_IDS = Object.keys(BIOMES);

/** the biome a hole should be dressed in: its own, else its cup's, else summer */
export function biomeFor(hole) {
  const id = hole?.biome;
  return BIOMES[id] ? id : DEFAULT_BIOME;
}

/**
 * Put a biome on the running scene. Called from setupHole *before* world.setHole
 * so the terrain gradient, the shore colours and the tree mix are already in
 * place when the ground and the forest are rebuilt — otherwise the hole would
 * come up in the last biome's colours and only change on the one after it.
 *
 * The rock spires are the exception: world.course.setHole builds them fresh
 * afterwards, so setRockColor is applied again by the caller. It is cheap, and
 * doing it twice is how the spire hue survives the rebuild.
 */
export function applyBiome(id, { world, water }) {
  const b = { ...BIOMES[DEFAULT_BIOME], ...(BIOMES[id] ?? {}) };
  world.setSkyGradient(b.sky);
  world.setFog(b.fog.color, b.fog.density);
  world.setLights(b.light);
  world.setSunDir(b.sun[0], b.sun[1], b.sun[2], water);
  world.setCloudColor(b.clouds);

  setTerrainGradient(b.land);
  setShoreColors(b.shore);

  for (const k of WATER_COLOR_KEYS) if (b.water[k]) water.setColor(k, b.water[k]);

  world.trees.setColors(b.trees.bark, b.trees.leaf);
  world.trees.setMix(b.trees.mix);
  world.trees.setDensity(b.trees.density ?? 1);
  world.foliage.setTint(b.under.tint ?? "#ffffff", b.under.tint ? b.under.amount : 0);
  world.foliage.setDensity(b.under.density ?? 1);
  world.grass.setColor(b.grass.color);
  world.grass.setDensity(b.grass.density ?? 1);
  world.course.setRockColor(b.rock);
  return b;
}

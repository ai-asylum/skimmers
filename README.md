# Skippidy Skip — the rock-skipping race

**First stone to the flag wins.** Find a rock, grind it flat, paint it, then
skip it across a lake full of rivals, boats, islands and ducks.
2–8 players · online multiplayer · browser · 3D · ~3 minute matches.

**Play now → [skimmers-lake.vercel.app](https://skimmers-lake.vercel.app)**

![racing across the lake](media/race.png)

## Multiplayer

Serverless WebRTC (PeerJS): pick a room size and hit **Find match**. There is
no matchmaking server either — everyone hunting for a room of that size probes
the same well-known peer ids, joining the first one with a free seat and
claiming it themselves if it's empty. Everyone preps their own rock while the
lobby fills; empty seats become bots (up to 8 racers). Each player's stone
runs full physics on their own machine — throws feel instant — while positions
and events stream peer-to-peer. The host referees: match clock, hole
transitions, winner calls, and the bot fleet.

## How to play

```
pick a rock off your bench → skip battle
             ↑ or make a new one: find → shape → paint → name it
```

Your finished stones keep their names and live on a park bench by the lake —
three floaters, three rocks. Tap one to race it again exactly as you left it,
or tap an empty floater to go and carve another.

| Verb | How |
|---|---|
| **Look** | drag sideways — a swipe across the screen spins you the whole way round the stone, and it costs no power, so you can read the hole before committing |
| **Skip** | drag *back* & release — how far back is the power, and it comes out flat and fast to chain hops |
| **Lob** | drag *forward* instead and the stone goes up rather than out, as steep as a mortar. It lands flat with zero skips, which is how you drop one into a pocket a skipper could never reach |
| **Splash** | tap the SKIP/SPLASH pill (or press `X`) and lob your stone at a rival — knock theirs under and they have to fish it back |
| **Fish** | sank it? the camera dives underwater — steer the descending hook past the fish to your rock. Every fish you bump shoves the hook back up and costs you distance |
| **Island stop** | land on an island and you throw from dry sand — no drowning, no fishing |
| **Ferry** | land *in* a boat and it carries your stone across the lake |
| **Rebound** | hit a hull side and the stone BOINGs off elastically — bank shots count toward your chain |

Each hole is a long river of buoys that runs the full width of the map, tee to
flag in one direction, with hard elbows and island rest stops along the way —
follow the minimap (tap it to blow it up). Giant rock spires wall off the straight line to the flag:
**CLONK** into one and your chain is dead (a high splash-lob can just clear
the shorter ones). The hole itself is a whirlpool with the flagpole planted
bare in the middle of it, and the swirl you can see is exactly the zone that
counts — put a stone *into* that water and it gets dragged under and you take
the hole. Sail over the top of it and nothing happens. Most holes wins.

![spires guard the flag](media/course.png)

## The juicy bits

![instant replay killcam](media/killcam.png)

- **Instant-replay killcam** — every winning throw is recorded on a flight
  tape and replayed letterboxed from a cinematic side angle
- chain 5+ hops and your rock catches **fire**
- Squash & stretch on every skip, googly eyes that jiggle on springs
- Hitstop, slow-mo final approach, FOV kicks, trauma-based screen shake
- Fully procedural Web Audio — zero sound files; pitch-climbing skip plinks
- Brush-paint your stone by hand — drag the water to spin & tilt it under your brush

![painting your rock](media/paint.png)

Sink your stone and the camera follows it down:

![underwater fishing](media/fishing.png)

## Run it locally

```sh
npm run dev
# open http://localhost:8741
```

No build step. Plain ES modules; three.js comes from a CDN importmap.

## Architecture notes

- [`src/physics.js`](src/physics.js) — the skip sim: water-entry angle +
  speed + rock flatness decide *skip / settle / sink*. `simulateThrow()` runs
  the identical step for the aim preview and the bot planner, so neither lies.
- [`src/bots.js`](src/bots.js) — 7 CPU personas play through the *same*
  `Skimmer` physics as you, navigating the fairway waypoint by waypoint with
  skill-scaled wobble.
- [`src/rock.js`](src/rock.js) — procedural stones: a drillable voxel field
  meshed by marching cubes, packed tighter (and darker, and slower to cut) the
  closer to its middle you get. A bite that would snap the stone in two is
  refused rather than taken, so the neck holding it together is the one thing the
  drill won't cut. Plus a layered canvas skin (base coat + brush strokes) and
  spring-loaded googly eyes that glance at whichever rival stone is nearest.
- [`src/marchingcubes.js`](src/marchingcubes.js) — the isosurface mesher, with
  its triangle table derived at load time rather than typed in by hand.
- [`src/fish.js`](src/fish.js) — the three sculpted fish that guard a sunken
  stone. They have no skeleton: a vertex shader bends each body with scrolling
  Perlin noise, weighted head-to-tail so the nose holds steady and the tail
  whips, and anchored to the fish's world position so every one swims on its own
  phase. Geometry is baked out of `assets/models/*.fbx` by
  `npm run bake:fish` — the game still fetches nothing at runtime.
- [`src/foliage.js`](src/foliage.js) — the forest and the undergrowth under it,
  re-scattered per hole and banded by height up the bank: willows at the
  waterline, birch on the slopes, pine alone on the crests, with bushes, ferns,
  flowers, mossy boulders and fallen logs filling in between. Models are
  Quaternius' Ultimate Nature Pack (CC0), baked out of OBJ by
  `npm run bake:nature` into delta-coded arrays that ship in the bundle, so this
  fetches nothing at runtime either. One instanced draw per model, and a shared
  vertex-shader wind that stirs canopies and leaves but not rock.
- [`src/eyeconfig.js`](src/eyeconfig.js) — where the pupils sit in each face of
  the eye sheet. Re-measure the whole sheet with
  `node scripts/measure-eyes.mjs`, drag the sockets by hand in the Eyes Lab at
  `/admin` (edits save live to any open game tab), and eyeball every face at
  once at `/eyecheck.html`.
- [`src/minimap.js`](src/minimap.js) — course baked once per hole, live blips
  stamped on top.
- Reused team scraps: Spellbook's juice kit (hitstop/shake/springs), Train
  Slop's cel shader + inverted-hull outlines + procedural-audio pattern,
  Frankentoys' brush-paint splat, plus pooled-particle, journey-spline,
  mood-lighting, killcam and minimap recipes from the shared registry.

![results podium](media/results.png)

---

Built with [Claude Code](https://claude.com/claude-code) — one session,
from empty folder to deployed game.

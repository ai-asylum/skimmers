# Skippidy Skip — the rock-skipping race

**First stone to the flag wins.** Find a rock, grind it flat, paint it, then
skip it across a lake full of rivals, boats, islands and ducks.
2–8 players · online multiplayer · browser · 3D · ~3 minute matches.

**Play now → [skimmers-lake.vercel.app](https://skimmers-lake.vercel.app)**

![racing across the lake](media/race.png)

## Multiplayer

Serverless WebRTC (PeerJS): **Host a lobby**, share the 4-letter room code,
friends hit **Join**. Everyone preps their own rock while the lobby fills;
empty seats become bots (up to 8 racers). Each player's stone runs full
physics on their own machine — throws feel instant — while positions and
events stream peer-to-peer. The host referees: match clock, hole
transitions, winner calls, and the bot fleet.

## How to play

```
find a rock → shape it → paint it → skip battle
```

| Verb | How |
|---|---|
| **Skip** | drag back & release — drag length is power, sideways drag steers. Flat + fast throws chain hops. |
| **Splash** | tap the SKIP/SPLASH pill (or press `X`) and lob your stone at a rival — knock theirs under and they have to fish it back |
| **Fish** | sank it? the camera dives underwater — steer the descending hook past the fish to your rock. Every fish you bump shoves the hook back up and costs you distance |
| **Island stop** | land on an island and you throw from dry sand — no drowning, no fishing |
| **Ferry** | land *in* a boat and it carries your stone across the lake |
| **Rebound** | hit a hull side and the stone BOINGs off elastically — bank shots count toward your chain |

Each hole is a fairway of buoys with doglegs and island rest stops — follow
the minimap. Giant rock spires wall off the straight line to the flag:
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
- [`src/rock.js`](src/rock.js) — procedural stones: grindable lump field,
  layered canvas skin (base coat + brush strokes), spring-loaded googly eyes
  that glance at whichever rival stone is nearest.
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

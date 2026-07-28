# Tidewright — Game Pitch

> Source: concepts drawn at random from the human-tokens registry
> [`human_tokens.json`](/Users/ruben/Projects/team-vault/01_SYSTEM/KNOWLEDGE/human_tokens.json)
> (Reusable-concept registry mined from game projects, maintained by the human-harvester agent.)

## Concepts used

This pitch builds on three registry concepts:

1. **Analytic heightfield ray picker** (`world`) — Ray-marches a world ray against an
   analytical walk surface `y = heightAt(x,z)` with sign-change detection, graze-skin
   handling for raised decks, and binary refinement — accurate ground picking under
   pitched cameras where a flat-plane pick misses by units.
2. **WebAudio beat clock** (`audio`) — An `AudioContext`-based music system that exposes
   the playhead as musical time (`getCurrentBeat`, `getBeatPhase`, `isBeatWindow`) for
   beat-synced gameplay/visuals, with decoded-buffer caching and a timer-based fallback.
3. **LLM-as-decision-layer NPC agent** (`sim`) — Autonomous NPCs with zero hardcoded
   behavior: the character observes state, one LLM call decides, and typed tool calls are
   the only way the world changes — so characters keep living and reaching out while the
   app is closed.

## The pitch

A rhythm-driven tactics game set on a living, breathing tidal marsh that literally rises
and falls to the music.

**The hook: the terrain *is* the beat.** The whole world is a heightfield
(`y = heightAt(x,z)`) whose water level and mud banks pulse in time with the soundtrack via
the WebAudio beat clock. On every downbeat, sandbars surface and channels flood. You play a
"Tidewright" — a wandering channel-digger who reshapes the marsh — and you can only *commit*
a dig, dam, or leap during the on-beat window (`isBeatWindow`). Off-beat actions fizzle.
Because you're always looking at the marsh from a low, pitched, cinematic camera, targeting
uses the **analytic heightfield ray picker**: your cursor snaps precisely to the true ground
point on a sloped bank, not a flat-plane approximation — which matters intensely when a
channel edge is one tile wide and half-submerged.

**The soul: the marsh is populated by creatures run as real LLM agents.** Herons, eels,
mudskippers, and rival Tidewrights are **LLM-as-decision-layer NPCs** — no scripted behavior
trees. Each one observes the current heightfield + tide phase and decides via a single LLM
call, acting only through a small set of typed tools (`move_to`, `flee`, `nest`,
`follow_channel`, `trade_favor`). So when you flood a bank on the beat, the heron genuinely
reasons "my nest is about to drown, relocate upstream" and reaches out to you for help — and
because agents run on a wall-clock schedule, the marsh keeps evolving even while the game is
closed. You come back to find the channels you dug have silted, an eel colony has moved in,
and a rival Tidewright left you a message.

## Core loop

- Listen for the beat, watch the tide rise/fall the terrain.
- On the beat window, pick a precise point on a sloped bank (ray picker) and dig/dam/leap.
- Redirect water to strand predators, irrigate an agent's nest, or open a path.
- Agents react and remember; the ecosystem persists between sessions.

## Why it's fun

It fuses rhythm-game timing pressure, precise 3D spatial puzzle-solving on deformable
terrain, and an emergent world of little AI minds that treat your edits as real events in
their lives.

## Source references

Traceable back to the originating projects in the registry:

### Analytic heightfield ray picker
- **Amber Marches** (Mera) — [`heightfieldPick.ts`](https://github.com/ai-asylum/amber-marches/blob/main/src/lib/world/data/heightfieldPick.ts)

### WebAudio beat clock
- **Beat Forge** (Kalvin Lyle) — [`AudioSystem.ts`](https://github.com/ai-asylum/beat-forge/blob/main/src/systems/AudioSystem.ts), [`TrackRegistry.ts`](https://github.com/ai-asylum/beat-forge/blob/main/src/game/TrackRegistry.ts)

### LLM-as-decision-layer NPC agent
- **Call My Agent** (Liam Poli) — [`system-design.md`](https://github.com/ai-asylum/call-my-agent/blob/main/docs/system-design.md), [`process-interaction/index.ts`](https://github.com/ai-asylum/call-my-agent/blob/main/supabase/functions/process-interaction/index.ts), [`tools/index.ts`](https://github.com/ai-asylum/call-my-agent/blob/main/supabase/functions/_shared/tools/index.ts)
- **Star Damage** (Paul Gadi) — [`agentManager.ts`](https://github.com/liam-poli/star-damage/blob/main/src/game/agent/agentManager.ts), [`tools/definitions.ts`](https://github.com/liam-poli/star-damage/blob/main/src/game/agent/tools/definitions.ts)
- **DeskPet** (Sven Schmid) — [`llm.js`](https://github.com/ai-asylum/deskpet/blob/main/src/main/llm.js), [`heuristics.js`](https://github.com/ai-asylum/deskpet/blob/main/src/main/heuristics.js)

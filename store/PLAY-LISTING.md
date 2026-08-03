# Skippidy Skip — Google Play Console kit

Working doc for the Play Store listing. Edit here; paste into Play Console.
Canonical-answers structure borrowed from `ai-asylum/total-clash`'s
`store/PLAY-LISTING.md`.

**Decisions locked:** Brand = **Skippidy Skip** · Package id =
**`games.misaligned.skippidyskip`** (permanent once uploaded — must not change) ·
Developer account = **Misaligned Games** · Studio credit = Skipstone Games
(in-fiction) · Hosting = **`skimmers-lake.vercel.app`** (existing Vercel deploy) ·
Analytics = **PostHog Cloud EU**, integrated in [src/analytics.js](../src/analytics.js),
gated on `VITE_POSTHOG_KEY`.

> ✅ **PostHog-EU is wired** (`src/analytics.js`): manual events `session_start` /
> `race_start` / `race_end`; pageviews on, autocapture **off**, session replay
> **armed but not started** (never enabled — no recordings ship), `identified_only`,
> localStorage persistence. Gated on `VITE_POSTHOG_KEY` (CI secret). Leave the
> secret unset and the APK collects **nothing** → answer Data Safety "No data
> collected" and drop the analytics paragraph from the privacy policy. Set it and
> the "collects data" section below applies.
>
> ✅ **PostHog project created** — "Skippidy Skip" on EU cloud, project id
> **239165**. `VITE_POSTHOG_KEY` and `VITE_POSTHOG_HOST` are set as repo secrets,
> and the key is confirmed baked into the release APK. The shipped build
> therefore **does** collect — answer Data Safety with the "collects data"
> section below, not "No data collected".

---

## ⚠️ Fix / confirm before the first upload

1. **Package name** — ✅ done: `games.misaligned.skippidyskip` in
   `capacitor.config.json` and `android/app/build.gradle` (`applicationId` +
   `namespace`). Permanent Play URL once uploaded.
2. **Store assets** — ✅ done, in two places for two consumers:
   - **Fake-door page** (published): `store/icon.webp` + five dressed 9:16
     WebP shots in `store/shots/`, all listed in `store/fakedoor.config.json`.
   - **Play Console upload** (never published — kept out of `store/` so the
     build doesn't copy it into `dist/` and the APK): `media/store-upload/`
     holds the same five shots as **JPEG** plus `feature.png` and `icon.png`.
     Play rejects WebP, so upload from `media/store-upload/`, not `store/`.

   Captured from the running game with Playwright at 1152×2048 and dressed
   via the `store-assets` skill.
3. **Privacy policy URL** — `https://skimmers-lake.vercel.app/store/privacy.html`
   ✅ verified 200 on the production deploy (as is `/store/terms.html`).

---

## Main store listing

**App name** (≤30):
```
Skippidy Skip
```

**Short description** (≤80):
```
Skip a painted stone across a lake — first rock to the flag wins.
```

**Full description** (≤4000):
```
Skippidy Skip is a chaotic online rock-skipping race. Find a stone on the beach, grind it flat, hand-paint it, then drag back and let it fly — flat, fast throws chain hop after hop across the lake.

Chain five skips and your rock catches fire. Splash-lob a rival's stone under the water and they have to fish it back while you pull ahead. Ferry across on passing boats, bank shots off their hulls, and thread the giant rock spires guarding the flag.

FEATURES
• Skip physics that reward flat, fast throws — chain hops to build combos
• Shape and hand-paint your own stone before every race
• 2–8 player online races, or a full field of CPU rivals solo
• Splash-lob rivals, ferry on boats, bank shots off hulls, dodge duck boosts
• Underwater fishing mini-game when you sink — steer the hook back to your rock
• Instant-replay killcam of every winning throw
• Free to play, ~3 minute matches

First stone inside the flag ring takes the hole. Most holes wins.
```

**What's new / release notes** (≤500):
```
Welcome to Skippidy Skip 1.0 — grind a flat one, chain your hops, and race friends to the flag. Thanks for playing! Tell us what you want next: hello@misaligned.games
```

## Categorization & contact

| Field | Value |
|---|---|
| App or game | **Game** |
| Category | **Arcade** |
| Tags (≤5) | Arcade · Racing · Multiplayer · Casual · Physics |
| Email | `hello@misaligned.games` |
| Website | `https://misaligned.games` |
| Privacy policy URL | `https://skimmers-lake.vercel.app/store/privacy.html` |

## Graphics assets — status & spec

| Asset | Spec | Status |
|---|---|---|
| App icon | 512×512, 32-bit PNG, ≤1 MB | ✅ `media/store-upload/icon.png` (from `media/icon.png`) |
| Feature graphic | 1024×500 PNG/JPEG | ✅ `media/store-upload/feature.png` |
| Phone screenshots (2–8) | PNG/JPEG for Play (WebP only for the fake door) | ✅ five JPEGs in `media/store-upload/` — race / chain / paint / fishing / start line |

---

## IARC content-rating questionnaire

Category **Game**. Answer as below; Play auto-computes the final rating (don't set it manually):

- Violence: **No** (cartoon rock-skipping; splash-lobbing a rival's stone is non-violent slapstick)
- Realistic violence / toward real-looking humans or animals: **No**
- Blood or gore: **No**
- Sexual content or nudity: **No**
- Fear / horror: **No**
- Simulated or real gambling: **No**
- Profanity / crude humor: **No**
- Drugs, alcohol, tobacco: **No**
- User interaction: **Yes → online multiplayer** (peer-to-peer race lobbies via a
  4-letter room code; **no chat, no user-generated content, no profiles**)
- Shares location: **No** (beyond PostHog geoIP country-level; see Data safety)
- Digital purchases (IAP): **No** (no Play Billing SDK)

Expected result: ~PEGI 3 / ESRB Everyone.

## Data safety

*(applies only if `VITE_POSTHOG_KEY` is set — otherwise "No data collected".)*

- Does your app collect or share user data? → **Yes (collect only; not shared/sold)**
- Data types collected:
  - **App activity** — in-app product events (`session_start`, `race_start`, `race_end`)
  - **Device or other IDs** — anonymous PostHog `distinct_id`
  - **Approximate location** — country-level, derived from IP by PostHog's geoIP
- Session replay: **armed but never started** in `src/analytics.js`
  (`disable_session_recording: true`; `enableSessionReplay()` is never called) —
  **no recordings ship**. No extra Data Safety category.
- Purpose: **Analytics** only
- Shared with third parties: **No** direct sale; PostHog acts as a processor (EU cloud)
- Encrypted in transit: **Yes**
- Users can request deletion: **Yes** — email `hello@misaligned.games`
  (anonymous only; no accounts)

## App content declarations

| Declaration | Answer |
|---|---|
| Ads | **No** — the app contains no ads (playable ads are separate marketing creatives, not in-app) |
| Target age | 13+ suggested (all-ages content; online multiplayer without chat) |
| Appeals to children | No |
| App access | All functionality available without special access (no login) |
| News app | No |
| COVID-19 tracing/status | No |

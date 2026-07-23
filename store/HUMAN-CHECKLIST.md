# Mobile launch — human console session for Skippidy Skip

One sitting, ~15 min. Everything the agent could pre-fill is pre-filled — you
click, check, and paste three values back. Canonical long-form answers live in
`store/PLAY-LISTING.md`.

> **Agents: this checklist is a LIVE document, not a printout.** When the human
> works through it with you conversationally, update the GitHub issue after
> every confirmed item: flip its `- [ ]` to `- [x]` in the issue body
> (`gh issue edit <n> --repo ai-asylum/skimmers --body-file <updated.md>`) and
> add a short comment when a step needs a note (e.g. "IARC rated 3"). NEVER
> paste secret values (keys, keystores) into the issue; secrets go through
> `gh secret set` only, the issue just records "done".

**Identity**
- App name: `Skippidy Skip`
- Package id: `games.misaligned.skippidyskip`
- Privacy policy URL: `https://skimmers-lake.vercel.app/store/privacy.html`
  (served from `dist/store/` after the Vite build — verify it returns 200 on the
  production deploy once this PR merges)
- Store listing copy: `store/PLAY-LISTING.md` + `store/fakedoor.config.json`

## 0. Blocking pre-reqs before secrets/build do anything

- [ ] **Create the PostHog project** (EU cloud) named "Skippidy Skip", then
      `gh secret set VITE_POSTHOG_KEY --repo ai-asylum/skimmers --body "<phc_...>"`
      and `gh secret set VITE_POSTHOG_HOST --repo ai-asylum/skimmers --body "https://eu.i.posthog.com"`.
      (Wiring is done; no key was available at build time, so the app is
      analytics-off until this is set — see PLAY-LISTING.md.)
- [ ] **Store art** — add `store/icon.webp` + `store/shots/*.webp` (≥2, 9:16) and a
      1024×500 feature graphic via the `store-assets` skill. Needed for the Play
      upload and to make the fake-door `store/index.html` render cleanly.

## 1. Google Play Console (no API for any of this)
- [ ] Create app → name/package above, Game, Free
- [ ] Data safety form → answers in `store/PLAY-LISTING.md` §Data safety
      (summary: PostHog EU analytics — approximate location via geoIP, no
      identifiers sold/shared, encrypted in transit, deletion on request; **only
      if `VITE_POSTHOG_KEY` is set**, else "No data collected")
- [ ] IARC content-rating questionnaire → email: `support@misaligned.games`;
      remaining answers in `store/PLAY-LISTING.md` §IARC (online multiplayer,
      **no chat/UGC**; expect ~PEGI 3 / Everyone)
- [ ] Target audience / child-directed declarations → `store/PLAY-LISTING.md` §App content
- [ ] **First AAB upload is manual** (Google rule): grab `app-release.aab` from the
      latest `Android Build` workflow artifacts → internal testing track
- [ ] **Also create a CLOSED testing release before going for production** —
      promote the same build to a closed track and select the org's EXISTING
      "founding team" tester group (~7 people — already set up; do NOT create a
      new one). Internal + closed before prod = noticeably faster review.
- [ ] CI uploads: NOTHING to do — the SHARED org service account
      `play-publisher@entropedia-499116.iam.gserviceaccount.com` has
      account-level Play access and its key is the org Actions secret
      `PLAY_SERVICE_ACCOUNT_JSON`. **NEVER create a service account, grant
      per-app access, or paste anything per repo.**

## 2. AppsFlyer (no public API for app registration)
- [ ] HQ dashboard → Add app → Android, package `games.misaligned.skippidyskip`,
      currency **EUR**, timezone UTC, not directed at children
- [ ] Enable the AppLovin integration for the app (Partner Marketplace)
- [ ] Dev key: NOTHING to paste — account-level, already the org Actions secret
      `VITE_APPSFLYER_DEV_KEY` (same key for every app).

## 3. Keystore — nothing to do (shared org upload key)
Signing uses the ORG-wide upload keystore (org secrets
`ANDROID_KEYSTORE_BASE64` / `ANDROID_KEYSTORE_PASSWORD`) — Play App Signing makes
the upload key resettable, so one shared key is fine. **Do NOT generate a
per-repo keystore.** Only if the org secret is missing entirely, an admin creates
it once (see the skill).

## Hand back to the agent
Re-run the `Android Build` workflow (Actions → Run workflow). With the secrets in
place it builds a signed AAB and uploads to the internal track automatically from
now on. Comment "done" on the issue so the run gets verified.

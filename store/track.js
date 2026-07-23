// Shared event client for fake-door store pages.
// IDENTICAL across every game so the dashboard compares them 1:1.
// Inserts directly into the shared Supabase `events` table via PostgREST
// (anon key, insert-only RLS). Swappable to an Edge Function later without
// touching this contract.
//
// Configure via Vite env (set on the Vercel project). NOTE the FAKEDOOR_
// prefix: it deliberately namespaces the *shared marketing events* DB so it
// never collides with a game's own VITE_SUPABASE_* (the game keeps its own
// Supabase project; the fake door points at the shared cross-game events DB).
//   VITE_FAKEDOOR_SUPABASE_URL       https://<ref>.supabase.co
//   VITE_FAKEDOOR_SUPABASE_ANON_KEY  <anon public key>
// Missing either → events are console-logged only (safe local/dev default).

const env = (import.meta && import.meta.env) || {};
const SUPABASE_URL = env.VITE_FAKEDOOR_SUPABASE_URL;
const SUPABASE_ANON_KEY = env.VITE_FAKEDOOR_SUPABASE_ANON_KEY;

const params = new URLSearchParams(location.search);

const attribution = {};
for (const k of ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"]) {
  attribution[k] = params.get(k) || null;
}
const clickId =
  params.get("gclid") || params.get("fbclid") || params.get("ttclid") || null;

function sessionId() {
  let s = sessionStorage.getItem("fs_sid");
  if (!s) {
    s = (crypto.randomUUID && crypto.randomUUID()) || String(Math.random()).slice(2);
    sessionStorage.setItem("fs_sid", s);
  }
  return s;
}

// makeTracker("clashbreaker", { platform: "ios" }) -> track(event, props)
// baseProps ride on every event's props (e.g. platform) so the dashboard can
// split funnels by store without changing the call sites.
export function makeTracker(gameSlug, baseProps = {}) {
  const base = {
    game_slug: gameSlug,
    session_id: sessionId(),
    ...attribution,
    click_id: clickId,
    referrer: document.referrer || "direct",
  };

  return function track(event, props = {}) {
    const row = { ...base, event, ua: navigator.userAgent };
    // email gets its own column; everything else rides in props (jsonb)
    const { email, ...rest } = props;
    row.email = email || null;
    row.props = { ...baseProps, ...rest };

    console.log("[track]", event, row);
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return;

    fetch(`${SUPABASE_URL}/rest/v1/events`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        Prefer: "return=minimal",
      },
      body: JSON.stringify(row),
      keepalive: true,
    }).catch(() => {});
  };
}

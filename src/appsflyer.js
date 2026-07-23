// AppsFlyer install attribution (MMP). Same contract as analytics: no
// VITE_APPSFLYER_DEV_KEY => no-op. Runs ONLY inside the Capacitor native app
// (the plugin has no web implementation) — the guard keeps it off the web /
// fake-door deploys regardless of build flags. Dynamic-imported from main.js
// so the web bundle never pulls in the native plugin.
import { Capacitor } from "@capacitor/core";

const env = import.meta.env ?? {};
const DEV_KEY = env.VITE_APPSFLYER_DEV_KEY;
const DEV = env.DEV === true;

let ready = false;

/** Start AppsFlyer once, early in boot. Native-only; no-op without a dev key. */
export async function initAppsFlyer() {
  if (ready) return;
  if (!Capacitor.isNativePlatform()) return; // browser / fake-door: skip entirely
  if (!DEV_KEY) {
    if (DEV) console.info("[appsflyer] no VITE_APPSFLYER_DEV_KEY — attribution disabled");
    return;
  }
  try {
    // Lazy import so the web bundle never pulls in the native plugin.
    const { AppsFlyer } = await import("appsflyer-capacitor-plugin");
    await AppsFlyer.initSDK({
      devKey: DEV_KEY,
      appID: "", // iOS App Store id — unused on Android-only apps
      isDebug: DEV,
      minTimeBetweenSessions: 6,
      registerConversionListener: false,
      registerOnAppOpenAttribution: false,
    });
    ready = true;
  } catch (err) {
    if (DEV) console.warn("[appsflyer] init failed", err);
  }
}

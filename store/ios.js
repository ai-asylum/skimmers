import { makeTracker } from "./track.js";

// Same fake-door behaviour as the Play page, wired to the App Store DOM.
// Per-game data is injected by the generator into window.__FAKEDOOR__.
const FD = (typeof window !== "undefined" && window.__FAKEDOOR__) || {};
const track = makeTracker(FD.slug || "game", { platform: "ios" });
track("page_view");

// nav bar reveals the compact app + GET once the big title scrolls under it
const nav = document.getElementById("nav");
addEventListener("scroll", () => {
  nav.classList.toggle("scrolled", scrollY > 120);
}, { passive: true });

// description: tap "more" to expand (App Store drops the toggle once open)
const desc = document.getElementById("desc");
const moreBtn = document.getElementById("moreBtn");
moreBtn.addEventListener("click", () => { desc.classList.add("open"); moreBtn.remove(); });

// GET → email-capture sheet (the conversion event)
const scrim = document.getElementById("scrim");
const sheet = document.getElementById("sheet");
function openSheet(source) {
  track("install_click", { source });
  scrim.classList.add("show");
  sheet.classList.add("show");
  setTimeout(() => document.getElementById("email").focus(), 320);
}
function closeSheet() {
  scrim.classList.remove("show");
  sheet.classList.remove("show");
}
document.querySelectorAll("[data-install]").forEach((b) =>
  b.addEventListener("click", () => openSheet(b.closest("#nav") ? "nav_bar" : "hero")),
);
scrim.addEventListener("click", closeSheet);

// email capture → a couple of quick survey questions → done
const survey = {};
document.querySelectorAll(".survey .chips").forEach((group) =>
  group.addEventListener("click", (e) => {
    const chip = e.target.closest(".chip");
    if (!chip) return;
    group.querySelectorAll(".chip").forEach((c) => c.classList.remove("sel"));
    chip.classList.add("sel");
    survey[group.dataset.q] = chip.dataset.v;
  }),
);
document.getElementById("notifyForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const email = document.getElementById("email").value.trim();
  track("email_submit", { email });
  sheet.classList.add("survey-open");
});
document.querySelector(".surveyDone").addEventListener("click", () => {
  track("survey_submit", survey);
  sheet.classList.remove("survey-open");
  sheet.classList.add("success");
  setTimeout(closeSheet, 2400);
});

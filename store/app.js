import { makeTracker } from "./track.js";

// Per-game data is injected by the generator into window.__FAKEDOOR__.
const FD = (typeof window !== "undefined" && window.__FAKEDOOR__) || {};
const track = makeTracker(FD.slug || "game", { platform: "android" });

track("page_view");

// app bar elevation + sticky install reveal
const appbar = document.getElementById("appbar");
const bottombar = document.getElementById("bottombar");
addEventListener(
  "scroll",
  () => {
    appbar.classList.toggle("scrolled", scrollY > 12);
    bottombar.classList.toggle("show", scrollY > 220);
  },
  { passive: true },
);

// about expand
const about = document.getElementById("about");
const moreBtn = document.getElementById("moreBtn");
moreBtn.addEventListener("click", () => {
  const open = about.classList.toggle("open");
  moreBtn.innerHTML = open
    ? 'Less <span class="ms" style="font-size:16px;vertical-align:-3px">expand_less</span>'
    : 'More <span class="ms" style="font-size:16px;vertical-align:-3px">expand_more</span>';
});

// install → bottom sheet (the conversion event)
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
  b.addEventListener("click", () =>
    openSheet(b.closest("#bottombar") ? "sticky_bar" : "hero"),
  ),
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

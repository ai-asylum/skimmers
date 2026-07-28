// Admin panel entry. Wires up the simple tab switcher and boots each tab's
// module lazily. New tabs: add a <button class="tab" data-tab="x"> in admin.html,
// a matching <section id="tab-x">, and an init entry in TABS below.
import { initLevelEditor } from "./leveleditor.js";
import { initEyesLab } from "./eyes.js";

const TABS = {
  level: initLevelEditor,
  eyes: initEyesLab,
};

const booted = new Set();

function activate(name) {
  document.querySelectorAll("nav.tabs .tab").forEach((b) => {
    b.classList.toggle("active", b.dataset.tab === name);
  });
  document.querySelectorAll(".tab-panel").forEach((p) => {
    p.classList.toggle("active", p.id === `tab-${name}`);
  });
  if (!booted.has(name) && TABS[name]) {
    booted.add(name);
    TABS[name](document.getElementById(`tab-${name}`));
  }
  history.replaceState(null, "", `#${name}`);
}

document.getElementById("tabs").addEventListener("click", (e) => {
  const btn = e.target.closest(".tab");
  if (btn) activate(btn.dataset.tab);
});

const initial = location.hash.replace("#", "");
activate(TABS[initial] ? initial : "level");

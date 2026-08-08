import "./board-view.css";

type BoardViewMode = "explore" | "fit";

const storageKey = "tabletop-board-view-mode";
let mode: BoardViewMode = window.localStorage.getItem(storageKey) === "fit" ? "fit" : "explore";

const toggle = document.querySelector<HTMLButtonElement>("#board-view-toggle");
toggle?.addEventListener("click", () => setMode(mode === "fit" ? "explore" : "fit"));

function setMode(next: BoardViewMode) {
  if (next === mode) return;

  if (next === "fit") {
    resetCamera();
    window.requestAnimationFrame(() => {
      mode = next;
      persistAndApply();
    });
    return;
  }

  mode = next;
  persistAndApply();
}

function persistAndApply() {
  window.localStorage.setItem(storageKey, mode);
  applyMode();
}

function applyMode() {
  const fit = mode === "fit";
  const boardVisible = !!document.querySelector(".board-engine");
  document.documentElement.classList.toggle("fit-board-view", fit);

  for (const map of document.querySelectorAll<SVGSVGElement>(".map-svg")) {
    const expected = fit ? "none" : "xMidYMid meet";
    if (map.getAttribute("preserveAspectRatio") !== expected) {
      map.setAttribute("preserveAspectRatio", expected);
    }
  }

  if (toggle) {
    toggle.hidden = !boardVisible;
    const label = fit ? "Explore map" : "Fit board";
    if (toggle.textContent !== label) toggle.textContent = label;
    toggle.title = fit
      ? "Return to the pannable and zoomable map camera"
      : "Fit the whole board to the available space and freeze the camera";
    toggle.setAttribute("aria-pressed", String(fit));
  }
}

function resetCamera() {
  const controls = document.querySelector(".map-controls");
  const reset = [...(controls?.querySelectorAll<HTMLButtonElement>("button") ?? [])]
    .find((button) => button.textContent?.trim() === "Reset");
  reset?.click();
}

/* The React board starts panning on pointerdown. In fit mode we still allow
 * clicks, hover, drag/drop order tokens, and pointer movement for previews;
 * only the camera-drag start is intercepted. */
window.addEventListener("pointerdown", (event) => {
  if (mode !== "fit") return;
  const target = event.target;
  if (target instanceof Element && target.closest(".map-svg")) event.stopPropagation();
}, true);

const observer = new MutationObserver(() => applyMode());
observer.observe(document.documentElement, { childList: true, subtree: true });

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", applyMode, { once: true });
} else {
  applyMode();
}

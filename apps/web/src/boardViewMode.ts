import "./board-view.css";

type BoardViewMode = "explore" | "fit";

const storageKey = "tabletop-board-view-mode";
const originalViewBoxes = new WeakMap<SVGSVGElement, string>();
const installedLandscape = window.matchMedia("(display-mode: standalone) and (orientation: landscape)");
const savedMode = window.localStorage.getItem(storageKey);
let mode: BoardViewMode = savedMode === "fit" || (!savedMode && installedLandscape.matches) ? "fit" : "explore";
let fitFrame = 0;

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
    rememberOriginalViewBox(map);
    map.setAttribute("preserveAspectRatio", "xMidYMid meet");
    if (fit) scheduleFit(map);
    else restoreMapViewport(map);
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

function rememberOriginalViewBox(map: SVGSVGElement) {
  if (!originalViewBoxes.has(map)) {
    originalViewBoxes.set(map, map.getAttribute("viewBox") ?? "0 0 1200 1040");
  }
}

function restoreMapViewport(map: SVGSVGElement) {
  const original = originalViewBoxes.get(map);
  if (original && map.getAttribute("viewBox") !== original) map.setAttribute("viewBox", original);
  map.style.removeProperty("--fit-board-ratio");
}

function scheduleFit(map: SVGSVGElement) {
  window.cancelAnimationFrame(fitFrame);
  fitFrame = window.requestAnimationFrame(() => fitMapToContent(map));
}

function fitMapToContent(map: SVGSVGElement) {
  if (mode !== "fit" || !map.isConnected) return;

  const regions = map.querySelector<SVGGElement>(".regions");
  const screenMatrix = map.getScreenCTM();
  if (!regions || !screenMatrix) return;

  const rect = regions.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return;

  const inverse = screenMatrix.inverse();
  const corners = [
    svgPoint(map, rect.left, rect.top, inverse),
    svgPoint(map, rect.right, rect.top, inverse),
    svgPoint(map, rect.left, rect.bottom, inverse),
    svgPoint(map, rect.right, rect.bottom, inverse)
  ];
  const xs = corners.map((point) => point.x);
  const ys = corners.map((point) => point.y);
  const left = Math.min(...xs);
  const right = Math.max(...xs);
  const top = Math.min(...ys);
  const bottom = Math.max(...ys);
  const contentWidth = right - left;
  const contentHeight = bottom - top;
  if (contentWidth <= 0 || contentHeight <= 0) return;

  // Enough room for labels, unit markers, and selection strokes without keeping
  // the large decorative sea margin from the original 1200x1040 canvas.
  const padX = Math.max(26, contentWidth * 0.035);
  const padY = Math.max(28, contentHeight * 0.045);
  const width = contentWidth + padX * 2;
  const height = contentHeight + padY * 2;
  const x = left - padX;
  const y = top - padY;

  map.setAttribute("viewBox", `${round(x)} ${round(y)} ${round(width)} ${round(height)}`);
  map.setAttribute("preserveAspectRatio", "xMidYMid meet");
  map.style.setProperty("--fit-board-ratio", `${round(width)} / ${round(height)}`);
}

function svgPoint(map: SVGSVGElement, x: number, y: number, matrix: DOMMatrix) {
  const point = map.createSVGPoint();
  point.x = x;
  point.y = y;
  return point.matrixTransform(matrix);
}

function round(value: number) {
  return Math.round(value * 100) / 100;
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

window.addEventListener("resize", () => {
  if (mode === "fit") applyMode();
});

installedLandscape.addEventListener("change", (event) => {
  if (!window.localStorage.getItem(storageKey) && event.matches) {
    mode = "fit";
    applyMode();
  }
});

const observer = new MutationObserver(() => applyMode());
observer.observe(document.documentElement, { childList: true, subtree: true });

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", applyMode, { once: true });
} else {
  applyMode();
}

import "./session-toolbar.css";

const popover = document.createElement("section");
popover.id = "session-menu-popover";
popover.className = "session-menu-popover";
popover.hidden = true;
popover.setAttribute("aria-label", "Game session details");
document.body.append(popover);

let anchor: HTMLButtonElement | null = null;

syncSessionToolbar();
const observer = new MutationObserver(syncSessionToolbar);
observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["class"] });

window.addEventListener("resize", positionPopover);
window.addEventListener("scroll", positionPopover, true);
window.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closePopover();
});
document.addEventListener("pointerdown", (event) => {
  if (popover.hidden) return;
  const target = event.target as Node;
  if (!popover.contains(target) && !anchor?.contains(target)) closePopover();
});

function syncSessionToolbar() {
  const main = document.querySelector("main");
  const started = main?.classList.contains("game-started") ?? false;
  document.getElementById("game-mode-control")?.toggleAttribute("hidden", started);

  const toolbar = main?.querySelector<HTMLElement>(".toolbar");
  if (!started || !toolbar) {
    toolbar?.classList.remove("session-toolbar-compact");
    closePopover();
    return;
  }

  toolbar.classList.add("session-toolbar-compact");
  const tools = toolbar.querySelector<HTMLElement>(".started-tools");
  if (!tools) return;

  let button = tools.querySelector<HTMLButtonElement>(".session-menu-toggle");
  if (!button) {
    button = document.createElement("button");
    button.type = "button";
    button.className = "session-menu-toggle";
    button.textContent = "Game";
    button.setAttribute("aria-haspopup", "dialog");
    button.setAttribute("aria-expanded", "false");
    button.addEventListener("click", () => {
      if (popover.hidden) openPopover(toolbar, button!);
      else closePopover();
    });
    tools.prepend(button);
  }

  anchor = button;
  if (!popover.hidden) renderPopover(toolbar);
}

function openPopover(toolbar: HTMLElement, button: HTMLButtonElement) {
  anchor = button;
  renderPopover(toolbar);
  popover.hidden = false;
  button.setAttribute("aria-expanded", "true");
  positionPopover();
}

function closePopover() {
  popover.hidden = true;
  anchor?.setAttribute("aria-expanded", "false");
}

function positionPopover() {
  if (popover.hidden || !anchor) return;
  const bounds = anchor.getBoundingClientRect();
  popover.style.top = `${Math.min(window.innerHeight - 12, bounds.bottom + 6)}px`;
  popover.style.right = `${Math.max(6, window.innerWidth - bounds.right)}px`;
}

function renderPopover(toolbar: HTMLElement) {
  const textInputs = toolbar.querySelectorAll<HTMLInputElement>('input:not([type="checkbox"])');
  const gameId = textInputs[0]?.value ?? "";
  const playerName = textInputs[1]?.value ?? "Player";
  const houseSelect = toolbar.querySelector<HTMLSelectElement>("select");
  const house = houseSelect?.selectedOptions[0]?.textContent?.trim() ?? "—";
  const aiToggle = toolbar.querySelector<HTMLInputElement>('label.toggle input[type="checkbox"]');

  popover.replaceChildren();

  const header = document.createElement("header");
  const heading = document.createElement("strong");
  heading.textContent = "Game session";
  const close = document.createElement("button");
  close.type = "button";
  close.className = "session-menu-close";
  close.textContent = "×";
  close.setAttribute("aria-label", "Close game session details");
  close.addEventListener("click", closePopover);
  header.append(heading, close);
  popover.append(header);

  popover.append(detailRow("Player", playerName));
  popover.append(detailRow("House", house));

  const gameRow = document.createElement("div");
  gameRow.className = "session-detail-row session-id-row";
  const gameLabel = document.createElement("span");
  gameLabel.textContent = "Game ID";
  const gameValue = document.createElement("code");
  gameValue.textContent = gameId || "—";
  const copy = document.createElement("button");
  copy.type = "button";
  copy.textContent = "Copy";
  copy.disabled = !gameId;
  copy.addEventListener("click", async () => {
    if (!gameId) return;
    await navigator.clipboard.writeText(gameId);
    copy.textContent = "Copied";
    window.setTimeout(() => { copy.textContent = "Copy"; }, 900);
  });
  gameRow.append(gameLabel, gameValue, copy);
  popover.append(gameRow);

  if (aiToggle) {
    const aiRow = document.createElement("label");
    aiRow.className = "session-ai-toggle";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = aiToggle.checked;
    checkbox.addEventListener("change", () => {
      if (checkbox.checked !== aiToggle.checked) aiToggle.click();
    });
    const text = document.createElement("span");
    text.textContent = "AI pilot";
    aiRow.append(checkbox, text);
    popover.append(aiRow);
  }
}

function detailRow(label: string, value: string) {
  const row = document.createElement("div");
  row.className = "session-detail-row";
  const key = document.createElement("span");
  key.textContent = label;
  const content = document.createElement("strong");
  content.textContent = value || "—";
  row.append(key, content);
  return row;
}

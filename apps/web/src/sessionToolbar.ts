import "./session-toolbar.css";

const root = document.getElementById("root");

const button = document.createElement("button");
button.type = "button";
button.id = "session-menu-toggle";
button.className = "session-menu-toggle-external";
button.textContent = "Game";
button.setAttribute("aria-haspopup", "dialog");
button.setAttribute("aria-expanded", "false");
button.setAttribute("aria-controls", "session-menu-popover");
document.body.append(button);

const popover = document.createElement("section");
popover.id = "session-menu-popover";
popover.className = "session-menu-popover";
popover.hidden = true;
popover.setAttribute("aria-label", "Game session details");
document.body.append(popover);

button.addEventListener("click", () => {
  if (popover.hidden) openPopover();
  else closePopover();
});

window.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closePopover();
});

document.addEventListener("pointerdown", (event) => {
  if (popover.hidden) return;
  const target = event.target as Node;
  if (!popover.contains(target) && !button.contains(target)) closePopover();
});

function toolbar() {
  return root?.querySelector<HTMLElement>("main.game-started .toolbar") ?? null;
}

function openPopover() {
  if (!toolbar()) return;
  renderPopover();
  popover.hidden = false;
  button.setAttribute("aria-expanded", "true");
}

function closePopover() {
  popover.hidden = true;
  button.setAttribute("aria-expanded", "false");
}

function renderPopover() {
  const bar = toolbar();
  if (!bar) return;

  const textInputs = bar.querySelectorAll<HTMLInputElement>('input:not([type="checkbox"])');
  const gameId = textInputs[0]?.value ?? "";
  const playerName = textInputs[1]?.value ?? "Player";
  const houseSelect = bar.querySelector<HTMLSelectElement>("select");
  const house = houseSelect?.selectedOptions[0]?.textContent?.trim() ?? "—";
  const aiToggle = bar.querySelector<HTMLInputElement>('label.toggle input[type="checkbox"]');

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

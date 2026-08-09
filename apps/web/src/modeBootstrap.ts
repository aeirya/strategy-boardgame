import { gameBundle, standardGameModeId, type Order } from "@tabletop/rules";
import "./mode-controls.css";

const params = new URLSearchParams(window.location.search);
const selectedModeId = params.get("mode") ?? standardGameModeId;
const selectedMode = gameBundle.rules.modes?.[selectedModeId];
const modeEntries = Object.entries(gameBundle.rules.modes ?? {});

document.documentElement.dataset.gameMode = selectedModeId;
installModeControl();
installModeFetchAdapter();
if (selectedMode) installPlayerChoiceFilter();

function installModeControl() {
  if (document.getElementById("game-mode-control")) return;
  const container = document.createElement("label");
  container.id = "game-mode-control";
  container.className = "game-mode-control";
  container.innerHTML = `<span>Mode</span>`;

  const select = document.createElement("select");
  const standard = document.createElement("option");
  standard.value = standardGameModeId;
  standard.textContent = "Standard";
  select.append(standard);

  for (const [modeId, mode] of modeEntries) {
    const option = document.createElement("option");
    option.value = modeId;
    option.textContent = mode.name;
    option.title = mode.description ?? mode.name;
    select.append(option);
  }

  select.value = selectedModeId;
  select.addEventListener("change", () => {
    const url = new URL(window.location.href);
    if (select.value === standardGameModeId) url.searchParams.delete("mode");
    else url.searchParams.set("mode", select.value);
    url.hash = "";
    window.location.assign(url.toString());
  });
  container.append(select);

  if (selectedMode?.description) {
    const note = document.createElement("small");
    note.textContent = selectedMode.description;
    container.append(note);
  }

  document.body.prepend(container);
}

function installModeFetchAdapter() {
  const previousFetch = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    let nextInput: RequestInfo | URL = input;
    let nextInit = init;
    const url = new URL(input instanceof Request ? input.url : String(input), window.location.href);
    const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();

    if (selectedMode && method === "POST" && url.pathname === "/games") {
      url.searchParams.set("mode", selectedModeId);
      nextInput = url.toString();
    }

    if (selectedMode && method === "POST" && url.pathname.endsWith("/commands") && typeof init?.body === "string") {
      const command = JSON.parse(init.body) as { type?: string; playerId?: string; orders?: Record<string, Order> };
      if (command.type === "placeOrders" && command.playerId?.startsWith("ai-") && command.orders) {
        command.orders = normalizeBotOrders(command.orders);
        nextInit = { ...init, body: JSON.stringify(command) };
      }
    }

    return previousFetch(nextInput, nextInit);
  };
}

function normalizeBotOrders(orders: Record<string, Order>): Record<string, Order> {
  if (!selectedMode) return orders;
  const allowed = selectedMode.allowedOrderKinds ?? [];
  const fallback = allowed.includes("defend") ? "defend" : allowed[0];
  return Object.fromEntries(Object.entries(orders).map(([area, order]) => {
    const kind = allowed.length === 0 || allowed.includes(order.kind) ? order.kind : fallback;
    return [area, { kind: kind ?? order.kind } satisfies Order];
  }));
}

function installPlayerChoiceFilter() {
  const allowed = new Set(selectedMode?.playerKeys ?? []);
  const allPlayers = new Set(gameBundle.players.map((player) => player.id));
  const apply = () => {
    document.querySelectorAll<HTMLSelectElement>("select").forEach((select) => {
      for (const option of select.options) {
        if (!allPlayers.has(option.value)) continue;
        option.hidden = !allowed.has(option.value);
        option.disabled = !allowed.has(option.value);
      }
      if (allPlayers.has(select.value) && !allowed.has(select.value)) {
        select.value = selectedMode?.playerKeys[0] ?? select.value;
        select.dispatchEvent(new Event("change", { bubbles: true }));
      }
    });
  };
  apply();
  const observer = new MutationObserver(apply);
  observer.observe(document.body, { childList: true, subtree: true });
}

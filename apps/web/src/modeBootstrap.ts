import { gameBundle, standardGameModeId, type GameState, type Order } from "@tabletop/rules";
import "./mode-controls.css";

const params = new URLSearchParams(window.location.search);
const selectedModeId = params.get("mode") ?? standardGameModeId;
const selectedMode = gameBundle.rules.modes?.[selectedModeId];
const modeEntries = Object.entries(gameBundle.rules.modes ?? {});
const latestStateByGame = new Map<string, GameState>();

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
    window.location.assign(url);
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
    const gameId = gameIdFromUrl(url);

    if (selectedMode && method === "POST" && url.pathname === "/games") {
      url.searchParams.set("mode", selectedModeId);
      nextInput = url.toString();
    }

    if (selectedMode && gameId && method === "POST" && url.pathname.endsWith("/commands") && typeof init?.body === "string") {
      const command = JSON.parse(init.body) as { type?: string; playerId?: string; orders?: Record<string, Order> };
      if (command.type === "placeOrders" && command.playerId?.startsWith("ai-") && command.orders) {
        command.orders = normalizeBotOrders(command.playerId.slice(3), command.orders, latestStateByGame.get(gameId));
        nextInit = { ...init, body: JSON.stringify(command) };
      }
    }

    const response = await previousFetch(nextInput, nextInit);
    void rememberState(gameId, response);
    return response;
  };
}

function normalizeBotOrders(playerKey: string, orders: Record<string, Order>, state?: GameState): Record<string, Order> {
  if (!selectedMode) return orders;
  const allowed = selectedMode.allowedOrderKinds ?? [];
  const fallback = allowed.includes("defend") ? "defend" : allowed[0];
  const opening = selectedMode.openingMoves?.[playerKey];

  if (state?.tracks.round === 1 && opening) {
    return Object.fromEntries(Object.keys(orders).map((area) => [area, { kind: area === opening.from ? "advance" : "defend" } satisfies Order]));
  }

  return Object.fromEntries(Object.entries(orders).map(([area, order]) => {
    const kind = allowed.length === 0 || allowed.includes(order.kind) ? order.kind : fallback;
    return [area, { kind: kind ?? order.kind } satisfies Order];
  }));
}

async function rememberState(gameId: string | undefined, response: Response) {
  if (!gameId || !response.ok) return;
  try {
    const payload = await response.clone().json() as GameState | { state?: GameState };
    const state = "state" in payload ? payload.state : payload;
    if (state?.tracks) latestStateByGame.set(gameId, state);
  } catch {
    // Non-JSON responses are unrelated to game state.
  }
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

function gameIdFromUrl(url: URL): string | undefined {
  return url.pathname.match(/^\/games\/([^/]+)/)?.[1];
}

import type { GameState } from "@tabletop/rules";

const pendingAutoContinue = new Set<string>();

installCombatFetchAutomation();
installCombatResultPolish();

function installCombatFetchAutomation() {
  const previousFetch = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const response = await previousFetch(input, init);
    const url = new URL(input instanceof Request ? input.url : String(input), window.location.href);
    const gameId = url.pathname.match(/^\/games\/([^/]+)/)?.[1];
    if (gameId && response.ok) void inspectState(gameId, response, previousFetch);
    return response;
  };
}

async function inspectState(gameId: string, response: Response, send: typeof window.fetch) {
  try {
    const state = gameStateFromPayload(await response.clone().json());
    const combat = state?.combat;
    if (!state || !combat || combat.status !== "revealed") return;

    const attacker = state.players.find((player) => player.playerKey === combat.attacker);
    const defender = state.players.find((player) => player.playerKey === combat.defender);
    if (!attacker?.id.startsWith("ai-") || !defender?.id.startsWith("ai-")) return;

    const key = `${gameId}:${combat.area}:${combat.attacker}:${combat.defender}:${state.tracks.round}`;
    if (pendingAutoContinue.has(key)) return;
    pendingAutoContinue.add(key);

    window.setTimeout(async () => {
      try {
        await send(`${window.location.protocol}//${window.location.hostname}:3000/games/${gameId}/commands`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ type: "continueCombat", playerId: attacker.id })
        });
      } finally {
        pendingAutoContinue.delete(key);
      }
    }, 1200);
  } catch {
    // Ignore non-state JSON responses.
  }
}

function gameStateFromPayload(payload: unknown): GameState | undefined {
  if (!payload || typeof payload !== "object") return undefined;
  const envelope = payload as { state?: unknown };
  const candidate = envelope.state ?? payload;
  if (!candidate || typeof candidate !== "object") return undefined;
  const state = candidate as GameState;
  return state.tracks && Array.isArray(state.players) ? state : undefined;
}

function installCombatResultPolish() {
  const polish = () => {
    document.querySelectorAll<HTMLElement>(".combat-result").forEach((result) => {
      const score = result.querySelector<HTMLElement>(":scope > b");
      const label = result.querySelector<HTMLElement>(":scope > div > span");
      const winner = result.querySelector<HTMLElement>(":scope > div > strong");
      const values = score?.textContent?.match(/(\d+)\s*[—-]\s*(\d+)/);
      if (values && values[1] === values[2] && label && winner) {
        label.textContent = "Tie · precedence to";
        result.dataset.tie = "true";
      }

      const button = result.querySelector<HTMLButtonElement>("button[disabled]");
      if (!button || button.dataset.spectatorClose === "true") return;
      button.dataset.spectatorClose = "true";
      button.disabled = false;
      button.textContent = "Close result";
      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
      }, { capture: true });
    });
  };

  polish();
  const observer = new MutationObserver(polish);
  observer.observe(document.body, { childList: true, subtree: true, characterData: true });
}

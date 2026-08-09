import {
  applyGameModeState,
  createInitialState,
  decide,
  getGameMode,
  prepareGameModeCommand,
  publicView,
  reduceEvents,
  standardGameModeId,
  validateGameModeCommand,
  type Command,
  type GameState
} from "@tabletop/rules";

type LocalGame = {
  state: GameState;
  modeId: string;
};

const useLocalBackend = import.meta.env.VITE_STATIC_BACKEND === "1" || window.location.hostname.endsWith(".github.io");

if (useLocalBackend) installLocalBackend();

void import("./main.tsx")
  .then(() => import("./responsive.css"))
  .then(() => import("./pwa.css"));

function installLocalBackend() {
  const games = new Map<string, LocalGame>();
  const sockets = new Map<string, Set<LocalWebSocket>>();
  const nativeFetch = window.fetch.bind(window);
  const NativeWebSocket = window.WebSocket;

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = requestUrl(input);
    if (!isGameApiUrl(url)) return nativeFetch(input, init);

    const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
    const parts = url.pathname.split("/").filter(Boolean);

    if (method === "POST" && parts.length === 1 && parts[0] === "games") {
      const modeId = url.searchParams.get("mode") ?? standardGameModeId;
      if (modeId !== standardGameModeId && !getGameMode(modeId)) return jsonResponse({ error: "Unknown game mode." }, 400);
      const gameId = crypto.randomUUID();
      const seed = crypto.randomUUID();
      games.set(gameId, { state: createInitialState(gameId, seed), modeId });
      return jsonResponse({ gameId, seed, modeId });
    }

    const gameId = parts[1];
    const game = gameId ? games.get(gameId) : undefined;
    if (!game) return jsonResponse({ error: "Game not found." }, 404);

    if (method === "GET" && parts.length === 2) {
      return jsonResponse(publicView(game.state, url.searchParams.get("playerId") ?? undefined));
    }

    if (method === "POST" && parts.length === 3 && parts[2] === "commands") {
      try {
        const submitted = JSON.parse(await requestBody(input, init)) as Command;
        const command = prepareGameModeCommand(game.state, submitted, game.modeId);
        validateGameModeCommand(game.state, command, game.modeId);
        const events = decide(game.state, command);
        game.state = applyGameModeState(reduceEvents(game.state, events), command, game.modeId);
        broadcast(gameId, game.state);
        return jsonResponse({
          events,
          state: publicView(game.state, "playerId" in command ? command.playerId : undefined)
        });
      } catch (error) {
        return jsonResponse({ error: error instanceof Error ? error.message : "Invalid command." }, 400);
      }
    }

    return jsonResponse({ error: "Not found." }, 404);
  };

  class LocalWebSocket extends EventTarget {
    static readonly CONNECTING = 0;
    static readonly OPEN = 1;
    static readonly CLOSING = 2;
    static readonly CLOSED = 3;

    readonly url: string;
    readonly protocol = "";
    readonly extensions = "";
    readonly bufferedAmount = 0;
    binaryType: BinaryType = "blob";
    readyState = LocalWebSocket.CONNECTING;
    private readonly gameId?: string;
    private readonly playerId?: string;

    constructor(url: string | URL) {
      super();
      this.url = String(url);
      const parsed = new URL(this.url, window.location.href);
      const match = parsed.pathname.match(/^\/games\/([^/]+)\/ws$/);
      this.gameId = match?.[1];
      this.playerId = parsed.searchParams.get("playerId") ?? undefined;

      queueMicrotask(() => {
        if (this.readyState !== LocalWebSocket.CONNECTING) return;
        this.readyState = LocalWebSocket.OPEN;
        if (this.gameId) {
          const set = sockets.get(this.gameId) ?? new Set<LocalWebSocket>();
          set.add(this);
          sockets.set(this.gameId, set);
          const game = games.get(this.gameId);
          if (game) this.emitState(game.state);
        }
        this.dispatchEvent(new Event("open"));
      });
    }

    close() {
      if (this.readyState === LocalWebSocket.CLOSED) return;
      this.readyState = LocalWebSocket.CLOSING;
      if (this.gameId) sockets.get(this.gameId)?.delete(this);
      this.readyState = LocalWebSocket.CLOSED;
      this.dispatchEvent(new CloseEvent("close"));
    }

    send() {
      throw new Error("The browser-local game backend does not accept WebSocket client messages.");
    }

    emitState(state: GameState) {
      const data = JSON.stringify({ type: "state", state: publicView(state, this.playerId) });
      this.dispatchEvent(new MessageEvent("message", { data }));
    }
  }

  function broadcast(gameId: string, state: GameState) {
    for (const socket of sockets.get(gameId) ?? []) socket.emitState(state);
  }

  window.WebSocket = LocalWebSocket as unknown as typeof NativeWebSocket;
}

function requestUrl(input: RequestInfo | URL) {
  return new URL(input instanceof Request ? input.url : String(input), window.location.href);
}

function isGameApiUrl(url: URL) {
  return url.port === "3000" && url.pathname.startsWith("/games");
}

async function requestBody(input: RequestInfo | URL, init?: RequestInit) {
  if (typeof init?.body === "string") return init.body;
  if (input instanceof Request) return input.clone().text();
  return "";
}

function jsonResponse(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" }
  });
}

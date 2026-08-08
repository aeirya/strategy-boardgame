import websocket from "@fastify/websocket";
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
  type Event,
  type GameState
} from "@tabletop/rules";
import Fastify from "fastify";

type StoredGame = {
  state: GameState;
  events: Event[];
  modeId: string;
};

const games = new Map<string, StoredGame>();
const server = Fastify({ logger: true });
await server.register(websocket);

server.addHook("onRequest", async (request, reply) => {
  reply.header("Access-Control-Allow-Origin", request.headers.origin ?? "*");
  reply.header("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  reply.header("Access-Control-Allow-Headers", "content-type");
  if (request.method === "OPTIONS") return reply.code(204).send();
});

server.get("/", async (request, reply) => {
  const hostname = request.hostname.split(":")[0] ?? "127.0.0.1";
  const webUrl = `http://${hostname}:5173/`;
  return reply.type("text/html").send(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <title>Game Server</title>
    <style>
      body { font-family: system-ui, sans-serif; margin: 2rem; line-height: 1.5; }
      code, a { color: #2f4052; }
    </style>
  </head>
  <body>
    <h1>Game server is running</h1>
    <p>This is the API server. Open the web app at <a href="${webUrl}">${webUrl}</a>.</p>
    <p>Health check: <code>/health</code></p>
  </body>
</html>`);
});

server.get("/health", async () => ({ ok: true }));

server.get("/favicon.ico", async (_request, reply) => reply.code(204).send());

server.post<{ Querystring: { mode?: string } }>("/games", async (request, reply) => {
  const modeId = request.query.mode ?? standardGameModeId;
  if (modeId !== standardGameModeId && !getGameMode(modeId)) return reply.code(400).send({ error: "Unknown game mode." });
  const gameId = crypto.randomUUID();
  const seed = crypto.randomUUID();
  const state = createInitialState(gameId, seed);
  games.set(gameId, { state, events: [{ type: "gameCreated", gameId, seed }], modeId });
  return { gameId, seed, modeId };
});

server.get<{ Params: { gameId: string }; Querystring: { playerId?: string } }>("/games/:gameId", async (request, reply) => {
  const game = games.get(request.params.gameId);
  if (!game) return reply.code(404).send({ error: "Game not found." });
  return publicView(game.state, request.query.playerId);
});

server.post<{ Params: { gameId: string }; Body: Command }>("/games/:gameId/commands", async (request, reply) => {
  const game = games.get(request.params.gameId);
  if (!game) return reply.code(404).send({ error: "Game not found." });
  try {
    const command = prepareGameModeCommand(game.state, request.body as Command, game.modeId);
    validateGameModeCommand(game.state, command, game.modeId);
    const events = decide(game.state, command);
    game.state = applyGameModeState(reduceEvents(game.state, events), command, game.modeId);
    game.events.push(...events);
    broadcast(request.params.gameId, game.state);
    return { events, state: publicView(game.state, "playerId" in command ? command.playerId : undefined) };
  } catch (error) {
    return reply.code(400).send({ error: error instanceof Error ? error.message : "Invalid command." });
  }
});

const sockets = new Map<string, Map<WebSocket, string | undefined>>();

server.get<{ Params: { gameId: string }; Querystring: { playerId?: string } }>("/games/:gameId/ws", { websocket: true }, (socket, request) => {
  const set = sockets.get(request.params.gameId) ?? new Map<WebSocket, string | undefined>();
  set.set(socket, request.query.playerId);
  sockets.set(request.params.gameId, set);
  const game = games.get(request.params.gameId);
  if (game) socket.send(JSON.stringify({ type: "state", state: publicView(game.state, request.query.playerId) }));
  socket.addEventListener("close", () => set.delete(socket));
});

function broadcast(gameId: string, state: GameState) {
  const set = sockets.get(gameId);
  if (!set) return;
  for (const [socket, playerId] of set) {
    if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "state", state: publicView(state, playerId) }));
  }
}

const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? "127.0.0.1";
await server.listen({ host, port });

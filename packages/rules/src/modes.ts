import { gameBundle } from "./data/board.js";
import type { GameModeDefinition } from "./content.js";
import type { Command, GameState, Order, PlayerKey, Unit } from "./types.js";

export const standardGameModeId = "standard";

export function getGameMode(modeId?: string | null): GameModeDefinition | undefined {
  if (!modeId || modeId === standardGameModeId) return undefined;
  return gameBundle.rules.modes?.[modeId];
}

export function getGameModeEntries(): Array<[string, GameModeDefinition]> {
  return Object.entries(gameBundle.rules.modes ?? {});
}

export function prepareGameModeCommand(state: GameState, command: Command, modeId?: string | null): Command {
  const mode = getGameMode(modeId);
  if (!mode || command.type !== "placeOrders") return command;

  const player = state.players.find((candidate) => candidate.id === command.playerId);
  if (!player) return command;

  const opening = mode.openingMoves?.[player.playerKey];
  if (state.tracks.round === 1 && opening) {
    const occupied = ownOccupiedAreas(state, player.playerKey);
    return {
      ...command,
      orders: Object.fromEntries(occupied.map((area) => [area, { kind: area === opening.from ? "advance" : "defend" }]))
    };
  }

  if (mode.allowSpecialOrders === false) {
    return {
      ...command,
      orders: Object.fromEntries(Object.entries(command.orders).map(([area, order]) => [area, { kind: order.kind } satisfies Order]))
    };
  }

  return command;
}

export function validateGameModeCommand(state: GameState, command: Command, modeId?: string | null): void {
  const mode = getGameMode(modeId);
  if (!mode) return;

  if (command.type === "join") {
    if (!mode.playerKeys.includes(command.playerKey)) throw new Error(`${mode.name} does not use that player.`);
    const maxPlayers = mode.maxPlayers ?? mode.playerKeys.length;
    if (state.players.length >= maxPlayers) throw new Error(`${mode.name} is full.`);
    return;
  }

  if (command.type === "start") {
    const minPlayers = mode.minPlayers ?? mode.playerKeys.length;
    const maxPlayers = mode.maxPlayers ?? mode.playerKeys.length;
    if (state.players.length < minPlayers || state.players.length > maxPlayers) {
      throw new Error(`${mode.name} requires ${minPlayers === maxPlayers ? minPlayers : `${minPlayers}-${maxPlayers}`} players.`);
    }
    return;
  }

  if (command.type === "placeOrders") {
    for (const order of Object.values(command.orders)) {
      if (mode.allowedOrderKinds && !mode.allowedOrderKinds.includes(order.kind)) {
        throw new Error(`${mode.name} only allows ${mode.allowedOrderKinds.map((kind) => mode.orderLabels?.[kind] ?? kind).join(" and ")} orders.`);
      }
      if (mode.allowSpecialOrders === false && order.special) throw new Error(`${mode.name} does not use special orders.`);
    }
    return;
  }

  if (command.type === "advance") {
    const unitTypes = "moves" in command ? command.moves.flatMap((move) => move.units) : command.units;
    if (mode.allowedUnitTypes && unitTypes.some((unit) => !mode.allowedUnitTypes?.includes(unit))) {
      throw new Error(`${mode.name} does not use that unit type.`);
    }
    return;
  }

  if (command.type === "skipAdvance" && state.tracks.round === 1) {
    const player = state.players.find((candidate) => candidate.id === command.playerId);
    const opening = player ? mode.openingMoves?.[player.playerKey] : undefined;
    if (opening && state.orders[opening.from]?.kind === "advance") throw new Error(`${mode.name} requires the opening march before skipping.`);
  }
}

export function applyGameModeState(state: GameState, command: Command, modeId?: string | null): GameState {
  const mode = getGameMode(modeId);
  if (!mode) return state;

  let next = command.type === "start" ? applyStartingSetup(state, mode) : state;
  next = applyModeAdjacency(next, mode);
  next = applyModeScore(next, mode);
  return next;
}

function applyStartingSetup(state: GameState, mode: GameModeDefinition): GameState {
  if (!mode.startingUnits) return state;
  const units = Object.fromEntries(Object.keys(state.areas).map((area) => [area, []])) as Record<string, Unit[]>;
  const control: Record<string, PlayerKey> = {};

  for (const player of state.players) {
    for (const placement of mode.startingUnits[player.playerKey] ?? []) {
      units[placement.area] = placement.units.map((type) => ({ playerKey: player.playerKey, type }));
      if (state.areas[placement.area]?.objective) control[placement.area] = player.playerKey;
    }
  }

  const message = `Mode: ${mode.name}.`;
  return {
    ...state,
    units,
    control,
    orders: {},
    combat: null,
    log: state.log.includes(message) ? state.log : [...state.log, message]
  };
}

function applyModeAdjacency(state: GameState, mode: GameModeDefinition): GameState {
  if (!mode.areaIds?.length) return state;
  const activeAreas = new Set(mode.areaIds);
  const openingBySource = new Map(
    state.tracks.round === 1
      ? Object.values(mode.openingMoves ?? {}).map((opening) => [opening.from, opening.to] as const)
      : []
  );
  const bundleAreas = new Map(gameBundle.map.areas.map((area) => [area.id, area]));

  return {
    ...state,
    areas: Object.fromEntries(Object.entries(state.areas).map(([areaId, area]) => {
      if (!activeAreas.has(areaId)) return [areaId, { ...area, adjacent: [] }];
      const forcedTarget = openingBySource.get(areaId);
      const baseAdjacent = bundleAreas.get(areaId)?.adjacent ?? area.adjacent;
      const adjacent = forcedTarget
        ? [forcedTarget]
        : baseAdjacent.filter((target) => activeAreas.has(target));
      return [areaId, { ...area, adjacent }];
    }))
  };
}

function applyModeScore(state: GameState, mode: GameModeDefinition): GameState {
  const scoreTarget = mode.scoreTarget;
  if (!scoreTarget) return state;
  const active = state.players.map((player) => player.playerKey);
  const score = { ...state.tracks.score };
  for (const playerKey of active) score[playerKey] = 0;
  for (const [area, playerKey] of Object.entries(state.control)) {
    if (active.includes(playerKey) && state.areas[area]?.objective) score[playerKey] += 1;
  }
  const winner = active.find((playerKey) => score[playerKey] >= scoreTarget) ?? null;
  return {
    ...state,
    tracks: { ...state.tracks, score },
    winner,
    phase: winner ? "complete" : state.phase,
    pending: winner ? null : state.pending
  };
}

function ownOccupiedAreas(state: GameState, playerKey: PlayerKey): string[] {
  return Object.entries(state.units)
    .filter(([, units]) => units.some((unit) => unit.playerKey === playerKey))
    .map(([area]) => area);
}

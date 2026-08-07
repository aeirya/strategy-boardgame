import { combatCardsById, combatCardsFor, playerTheme, gameBundle, playerKeys, placeholderAreas, startingUnits } from "./data/board.js";
import type {
  Command,
  Event,
  GameState,
  PlayerKey,
  LegalGatherAction,
  LegalAdvanceAction,
  LegalOrderPlacement,
  LegalDisruptAction,
  AdvanceMove,
  Order,
  PendingAction,
  Phase,
  Unit,
  UnitType
} from "./types.js";

const unitStrength: Record<Exclude<UnitType, "artillery">, number> = {
  infantry: 1,
  cavalry: 2,
  fleet: 1
};

const capacityLimits: Record<number, number[]> = {
  0: [2, 2],
  1: [2, 2, 2],
  2: [3, 2, 2],
  3: [3, 2, 2, 2],
  4: [3, 3, 2, 2],
  5: [4, 3, 2, 2],
  6: [4, 3, 2, 2, 2]
};

const orderModifier = (order?: Order): number => {
  if (!order) return 0;
  if (order.kind === "advance") return order.special ? 1 : -1;
  if (order.kind === "defend") return order.special ? 2 : 1;
  if (order.kind === "support") return order.special ? 1 : 0;
  return 0;
};

export function createInitialState(gameId: string, seed = cryptoSafeSeed()): GameState {
  const score = Object.fromEntries(playerKeys.map((playerKey) => [playerKey, 0])) as Record<PlayerKey, number>;
  const capacity = Object.fromEntries(playerKeys.map((playerKey) => [playerKey, gameBundle.rules.initialCapacity])) as Record<PlayerKey, number>;
  return {
    id: gameId,
    seed,
    phase: "lobby",
    players: [],
    areas: placeholderAreas,
    units: Object.fromEntries(Object.keys(placeholderAreas).map((id) => [id, []])) as Record<string, Unit[]>,
    orders: {},
    control: {},
    tracks: {
      round: 1,
      score,
      capacity,
      turnOrder: [...playerKeys],
      combatOrder: [...playerKeys],
      specialOrderOrder: [...playerKeys],
      threat: gameBundle.rules.initialThreat
    },
    log: ["Game created."],
    pending: null,
    combat: null,
    winner: null
  };
}

export function decide(state: GameState, command: Command): Event[] {
  if (state.winner && command.type !== "join") throw new Error("Game is complete.");

  switch (command.type) {
    case "join":
      assertPhase(state, "lobby");
      if (state.players.some((player) => player.id === command.playerId)) throw new Error("Player already joined.");
      if (state.players.some((player) => player.playerKey === command.playerKey)) throw new Error("PlayerKey already taken.");
      if (!playerKeys.includes(command.playerKey)) throw new Error("Unknown player.");
      if (state.players.length >= gameBundle.rules.maxPlayers) throw new Error("Game is full.");
      return [{
        type: "playerJoined",
        player: {
          id: command.playerId,
          name: command.name,
          playerKey: command.playerKey,
          ready: false,
          resource: gameBundle.rules.initialResource,
          hand: initialCombatCards(command.playerKey),
          usedCombatCards: []
        }
      }];

    case "ready":
      requirePlayer(state, command.playerId);
      assertPhase(state, "lobby");
      return [{ type: "playerReadyChanged", playerId: command.playerId, ready: command.ready }];

    case "start": {
      assertPhase(state, "lobby");
      if (state.players.length < gameBundle.rules.minPlayers) throw new Error(`At least ${gameBundle.rules.minPlayers} players are required.`);
      if (!state.players.every((player) => player.ready)) throw new Error("All players must be ready.");
      const activePlayerKeys = state.players.map((player) => player.playerKey);
      const setupState = setupBoard({ ...state, phase: "setup", tracks: reorderTracks(state, activePlayerKeys) }, activePlayerKeys);
      return [
        { type: "gameStarted", playerKeys: activePlayerKeys },
        { type: "scoreUpdated", score: countScore(setupState, activePlayerKeys), winner: null },
        { type: "phaseChanged", phase: "planning", pending: nextPending(activePlayerKeys, "placeOrders", 0) }
      ];
    }

    case "startCombatTest": {
      assertPhase(state, "lobby");
      const player = requirePlayer(state, command.playerId);
      if (state.players.length < 2 || !state.players.every((candidate) => candidate.ready)) throw new Error("Combat test needs two or more ready players.");
      const activePlayerKeys = state.players.map((candidate) => candidate.playerKey);
      const defender = activePlayerKeys.find((candidate) => candidate !== player.playerKey) as PlayerKey | undefined;
      const support = activePlayerKeys.find((candidate) => candidate !== player.playerKey && candidate !== defender) ?? player.playerKey;
      if (!defender) throw new Error("Combat test needs an opposing player.");
      return [{ type: "combatTestStarted", playerKeys: activePlayerKeys, attacker: player.playerKey, defender, support }];
    }

    case "placeOrders": {
      const player = requirePlayer(state, command.playerId);
      assertPhase(state, "planning");
      if (state.pending?.type !== "placeOrders" || state.pending.playerKey !== player.playerKey) throw new Error("Not this player's order window.");
      validateOrders(state, player.playerKey, command.orders);
      const active = activePlayerKeys(state);
      const playerIndex = active.indexOf(player.playerKey);
      const isLast = playerIndex === active.length - 1;
      return [
        { type: "ordersPlaced", playerKey: player.playerKey, orders: command.orders },
        { type: "phaseChanged", phase: isLast ? "reveal" : "planning", pending: isLast ? null : nextPending(active, "placeOrders", playerIndex + 1) }
      ];
    }

    case "revealOrders": {
      requirePlayer(state, command.playerId);
      assertPhase(state, "reveal");
      return [
        { type: "ordersRevealed" },
        ...enterActionPhaseEvents(state, "disrupt", 0)
      ];
    }

    case "skipDisrupt":
      return advanceAction(state, command.playerId, "disrupt", "advance");

    case "disrupt": {
      const player = requireCurrentAction(state, command.playerId, "disrupt");
      const fromOrder = state.orders[command.from];
      const targetOrder = state.orders[command.target];
      if (!fromOrder || fromOrder.kind !== "disrupt") throw new Error("Source area does not have a disrupt order.");
      if (!targetOrder || !canDisruptOrder(fromOrder, targetOrder)) throw new Error("Target order cannot be disrupted.");
      assertOwnOccupiedArea(state, player.playerKey, command.from);
      assertCanDisruptArea(state, command.from, command.target);
      const targetPlayerKey = controllerForArea(state, command.target);
      const events: Event[] = [
        { type: "orderRemoved", area: command.target },
        { type: "orderRemoved", area: command.from }
      ];
      if (targetOrder.kind === "gather") {
        events.push({ type: "resourceAdjusted", playerKey: player.playerKey, amount: 1, reason: "disrupted a gather resource order" });
        if (targetPlayerKey && targetPlayerKey !== player.playerKey) {
          events.push({ type: "resourceAdjusted", playerKey: targetPlayerKey, amount: -1, reason: "lost a gather resource order to a disrupt" });
        }
      }
      events.push(...advanceActionEvents(reduceEvents(state, events), player.playerKey, "disrupt", "advance"));
      return events;
    }

    case "skipAdvance":
      return advanceAction(state, command.playerId, "advance", "gather");

    case "advance": {
      const player = requireCurrentAction(state, command.playerId, "advance");
      const order = state.orders[command.from];
      if (!order || order.kind !== "advance") throw new Error("Source area does not have a advance order.");
      assertOwnOccupiedArea(state, player.playerKey, command.from);
      const moves = normalizeAdvanceCommand(command);
      if (moves.length === 0) throw new Error("Advance must move at least one unit.");
      const moving = takeUnits(state.units[command.from] ?? [], player.playerKey, moves.flatMap((move) => move.units));
      const movingByDestination = allocateAdvanceUnits(moving, moves);
      const enemyMoves = movingByDestination.filter((move) => hasEnemyUnits(state, move.to, player.playerKey));
      if (enemyMoves.length > 1) throw new Error("A advance may enter only one enemy-occupied area.");
      for (const move of movingByDestination) {
        assertAdjacent(state, command.from, move.to);
        assertCanMoveUnits(state, command.from, move.to, player.playerKey, move.units);
      }

      const events: Event[] = movingByDestination.map((move) => ({
        type: "unitsMoved",
        from: command.from,
        to: move.to,
        units: move.units,
        playerKey: player.playerKey
      }));
      events.push({ type: "orderRemoved", area: command.from });

      const enemyMove = enemyMoves[0];
      if (enemyMove) {
        const targetUnits = state.units[enemyMove.to] ?? [];
        const defender = targetUnits.find((unit) => unit.playerKey !== player.playerKey)?.playerKey;
        if (!defender) throw new Error("Enemy area has no defender.");
        const attackerStrength = strength(state, enemyMove.units, order, enemyMove.to, "attacker")
          + automaticSupportStrength(state, enemyMove.to, player.playerKey, "attacker");
        const defenderStrength = strength(state, targetUnits.filter((unit) => unit.playerKey === defender), state.orders[enemyMove.to], enemyMove.to, "defender")
          + automaticSupportStrength(state, enemyMove.to, defender, "defender");
        events.push({
          type: "combatStarted",
          combat: {
            area: enemyMove.to,
            attacker: player.playerKey,
            defender,
            attackerBaseStrength: attackerStrength,
            defenderBaseStrength: defenderStrength,
            chosenCards: {},
            committedPlayerKeys: [],
            status: "choosing"
          }
        });
      }
      const nextState = reduceEvents(state, events);
      assertCapacityLimit(nextState, player.playerKey);
      if (!enemyMove) {
        events.push({ type: "scoreUpdated", score: countScore(nextState, activePlayerKeys(nextState)), winner: findWinner(nextState) });
        events.push(...advanceActionEvents(nextState, player.playerKey, "advance", "gather"));
      }
      return events;
    }

    case "playCombatCard": {
      const player = requirePlayer(state, command.playerId);
      const combat = state.combat;
      if (!combat || combat.status !== "choosing") throw new Error("No combat card choice is active.");
      if (player.playerKey !== combat.attacker && player.playerKey !== combat.defender) throw new Error("This player is not in the combat.");
      if (combat.committedPlayerKeys.includes(player.playerKey)) throw new Error("Combat card is already locked.");
      if (!player.hand.includes(command.cardId) || player.usedCombatCards.includes(command.cardId)) throw new Error("Combat card is not available.");
      const events: Event[] = [{ type: "combatCardChosen", playerKey: player.playerKey, cardId: command.cardId }];
      const choosingState = reduceEvents(state, events);
      const nextCombat = choosingState.combat;
      if (!nextCombat || nextCombat.committedPlayerKeys.length < 2) return events;
      const attackerStrength = nextCombat.attackerBaseStrength + combatCardStrength(nextCombat.chosenCards[nextCombat.attacker]);
      const defenderStrength = nextCombat.defenderBaseStrength + combatCardStrength(nextCombat.chosenCards[nextCombat.defender]);
      const winner = compareCombat(choosingState, nextCombat.attacker, nextCombat.defender, attackerStrength, defenderStrength);
      events.push({ type: "combatResolved", area: nextCombat.area, attacker: nextCombat.attacker, defender: nextCombat.defender, winner, attackerStrength, defenderStrength });
      const resolvedState = reduceEvents(state, events);
      events.push({ type: "scoreUpdated", score: countScore(resolvedState, activePlayerKeys(resolvedState)), winner: findWinner(resolvedState) });
      return events;
    }

    case "continueCombat": {
      const player = requirePlayer(state, command.playerId);
      const combat = state.combat;
      if (!combat || combat.status !== "revealed") throw new Error("Combat is not ready to continue.");
      if (player.playerKey !== combat.attacker && player.playerKey !== combat.defender) throw new Error("This player is not in the combat.");
      const events: Event[] = [{ type: "combatEnded" }];
      events.push(...advanceActionEvents(reduceEvents(state, events), combat.attacker, "advance", "gather"));
      return events;
    }

    case "skipGather":
      return advanceAction(state, command.playerId, "gather", "cleanup");

    case "gather": {
      const player = requireCurrentAction(state, command.playerId, "gather");
      const order = state.orders[command.area];
      if (!order || order.kind !== "gather") throw new Error("Area does not have a gather resource order.");
      assertOwnOccupiedArea(state, player.playerKey, command.area);
      const amount = gatherResourceAmount(state, command.area);
      const events: Event[] = [
        { type: "resourceCollected", playerKey: player.playerKey, area: command.area, amount },
        { type: "orderRemoved", area: command.area }
      ];
      events.push(...advanceActionEvents(reduceEvents(state, events), player.playerKey, "gather", "cleanup"));
      return events;
    }
  }
}

export function reduceEvents(state: GameState, events: Event[]): GameState {
  return events.reduce(reduceEvent, state);
}

export function publicView(state: GameState, playerId?: string): GameState {
  const player = playerId ? state.players.find((candidate) => candidate.id === playerId) : undefined;
  let view = state;
  if (state.combat?.status === "choosing") {
    const ownChoice = player ? state.combat.chosenCards[player.playerKey] : undefined;
    view = { ...state, combat: { ...state.combat, chosenCards: ownChoice && player ? { [player.playerKey]: ownChoice } : {} } };
  }
  if (state.phase !== "planning" || !player) return view;
  const visibleOrders = Object.fromEntries(
    Object.entries(state.orders).filter(([area]) => state.units[area]?.some((unit) => unit.playerKey === player.playerKey))
  );
  return { ...view, orders: visibleOrders };
}

export function getLegalOrderPlacements(state: GameState, playerId: string): LegalOrderPlacement[] {
  const player = state.players.find((candidate) => candidate.id === playerId);
  if (!player || state.phase !== "planning" || state.pending?.playerKey !== player.playerKey) return [];
  return ownOccupiedAreas(state, player.playerKey).map((area) => ({ area, currentOrder: state.orders[area] }));
}

export function getLegalDisruptActions(state: GameState, playerId: string): LegalDisruptAction[] {
  const player = state.players.find((candidate) => candidate.id === playerId);
  if (!player || state.phase !== "disrupt" || state.pending?.playerKey !== player.playerKey) return [];
  return legalDisruptActionsForPlayerKey(state, player.playerKey);
}

export function getLegalAdvanceActions(state: GameState, playerId: string): LegalAdvanceAction[] {
  const player = state.players.find((candidate) => candidate.id === playerId);
  if (!player || state.phase !== "advance" || state.pending?.playerKey !== player.playerKey) return [];
  return legalAdvanceActionsForPlayerKey(state, player.playerKey);
}

export function getLegalGatherActions(state: GameState, playerId: string): LegalGatherAction[] {
  const player = state.players.find((candidate) => candidate.id === playerId);
  if (!player || state.phase !== "gather" || state.pending?.playerKey !== player.playerKey) return [];
  return legalGatherActionsForPlayerKey(state, player.playerKey);
}

export function hasAnyLegalAction(state: GameState, playerKey: PlayerKey, phase: Phase): boolean {
  if (phase === "planning") return ownOccupiedAreas(state, playerKey).length > 0;
  if (phase === "disrupt") return legalDisruptActionsForPlayerKey(state, playerKey).some((action) => action.targets.length > 0);
  if (phase === "advance") return legalAdvanceActionsForPlayerKey(state, playerKey).some((action) => action.destinations.length > 0);
  if (phase === "gather") return legalGatherActionsForPlayerKey(state, playerKey).length > 0;
  return false;
}

function reduceEvent(state: GameState, event: Event): GameState {
  switch (event.type) {
    case "gameCreated":
      return createInitialState(event.gameId, event.seed);
    case "playerJoined":
      return { ...state, players: [...state.players, event.player], log: [...state.log, `${playerName(event.player.playerKey)} joined.`] };
    case "playerReadyChanged":
      return { ...state, players: state.players.map((player) => player.id === event.playerId ? { ...player, ready: event.ready } : player) };
    case "gameStarted":
      return setupBoard({ ...state, phase: "setup", tracks: reorderTracks(state, event.playerKeys) }, event.playerKeys);
    case "combatTestStarted": {
      const prepared = setupBoard({ ...state, phase: "advance", tracks: reorderTracks(state, event.playerKeys) }, event.playerKeys);
      const scenario = gameBundle.testScenario;
      if (!scenario) throw new Error("This bundle does not define a combat test scenario.");
      const units = Object.fromEntries(Object.keys(prepared.areas).map((id) => [id, []])) as Record<string, Unit[]>;
      units[scenario.attackerFrom] = [{ playerKey: event.attacker, type: "cavalry" }, { playerKey: event.attacker, type: "infantry" }];
      units[scenario.defenderArea] = [{ playerKey: event.defender, type: "infantry" }, { playerKey: event.defender, type: "cavalry" }];
      units[scenario.supportArea] = [{ playerKey: event.support, type: "infantry" }];
      return {
        ...prepared,
        phase: "advance",
        pending: { type: "advance", playerKey: event.attacker },
        units,
        orders: {
          [scenario.attackerFrom]: { kind: "advance", special: true },
          [scenario.defenderArea]: { kind: "defend", special: true },
          [scenario.supportArea]: { kind: "support", special: true }
        },
        control: {
          [scenario.attackerFrom]: event.attacker,
          [scenario.defenderArea]: event.defender,
          [scenario.supportArea]: event.support
        },
        combat: null,
        log: [...prepared.log, `Combat test ready: move from ${prepared.areas[scenario.attackerFrom].name} into ${prepared.areas[scenario.defenderArea].name}.`]
      };
    }
    case "ordersPlaced":
      return { ...state, orders: { ...state.orders, ...event.orders }, log: [...state.log, `${playerName(event.playerKey)} placed orders.`] };
    case "ordersRevealed":
      return { ...state, log: [...state.log, "Orders revealed."] };
    case "orderRemoved": {
      const nextOrders = { ...state.orders };
      delete nextOrders[event.area];
      return { ...state, orders: nextOrders };
    }
    case "logMessage":
      return { ...state, log: [...state.log, event.message] };
    case "unitsMoved": {
      const movingCounts = countTypes(event.units);
      const fromUnits = [...(state.units[event.from] ?? [])];
      const remainingFrom = fromUnits.filter((unit) => {
        if (unit.playerKey !== event.playerKey) return true;
        const remaining = movingCounts[unit.type] ?? 0;
        if (remaining <= 0) return true;
        movingCounts[unit.type] = remaining - 1;
        return false;
      });
      return {
        ...state,
        units: { ...state.units, [event.from]: remainingFrom, [event.to]: [...(state.units[event.to] ?? []), ...event.units] },
        control: { ...state.control, [event.to]: event.playerKey },
        log: [...state.log, `${playerName(event.playerKey)} advanceed to ${state.areas[event.to].name}.`]
      };
    }
    case "combatStarted":
      return { ...state, combat: event.combat, pending: { type: "combat", playerKey: event.combat.attacker }, log: [...state.log, `Combat began in ${state.areas[event.combat.area].name}.`] };
    case "combatCardChosen":
      return state.combat ? {
        ...state,
        combat: {
          ...state.combat,
          chosenCards: { ...state.combat.chosenCards, [event.playerKey]: event.cardId },
          committedPlayerKeys: [...state.combat.committedPlayerKeys, event.playerKey]
        },
        players: state.players.map((player) => player.playerKey === event.playerKey
          ? { ...player, usedCombatCards: [...player.usedCombatCards, event.cardId] }
          : player)
      } : state;
    case "combatResolved": {
      const winnerUnits = (state.units[event.area] ?? []).filter((unit) => unit.playerKey === event.winner);
      return {
        ...state,
        units: { ...state.units, [event.area]: winnerUnits },
        control: { ...state.control, [event.area]: event.winner },
        combat: state.combat ? { ...state.combat, status: "revealed", winner: event.winner, attackerStrength: event.attackerStrength, defenderStrength: event.defenderStrength } : null,
        log: [...state.log, `${playerName(event.winner)} won combat in ${state.areas[event.area].name} (${event.attackerStrength}-${event.defenderStrength}).`]
      };
    }
    case "combatEnded":
      return { ...state, combat: null, pending: null };
    case "resourceCollected":
      return {
        ...state,
        players: state.players.map((player) => player.playerKey === event.playerKey ? { ...player, resource: player.resource + event.amount } : player),
        log: [...state.log, `${playerName(event.playerKey)} collected ${event.amount} resource.`]
      };
    case "resourceAdjusted":
      return {
        ...state,
        players: state.players.map((player) => player.playerKey === event.playerKey ? { ...player, resource: Math.max(0, player.resource + event.amount) } : player),
        log: [...state.log, `${playerName(event.playerKey)} ${event.amount > 0 ? "gained" : "lost"} ${Math.abs(event.amount)} resource: ${event.reason}.`]
      };
    case "capacityUpdated":
      return {
        ...state,
        tracks: { ...state.tracks, capacity: event.capacity },
        log: [...state.log, "Capacity adjusted from controlled barrel icons."]
      };
    case "phaseChanged":
      return { ...state, phase: event.phase, pending: event.pending };
    case "roundAdvanced":
      return { ...state, tracks: { ...state.tracks, round: event.round } };
    case "scoreUpdated":
      return { ...state, tracks: { ...state.tracks, score: event.score }, winner: event.winner, phase: event.winner ? "complete" : state.phase };
  }
}

function setupBoard(state: GameState, active: PlayerKey[]): GameState {
  const units = Object.fromEntries(Object.keys(state.areas).map((id) => [id, []])) as Record<string, Unit[]>;
  const control: Record<string, PlayerKey> = {};
  for (const playerKey of active) {
    for (const [area, areaUnits] of Object.entries(startingUnits[playerKey])) {
      units[area] = [...(units[area] ?? []), ...areaUnits];
      if (state.areas[area].objective) control[area] = playerKey;
    }
  }
  return { ...state, units, control, log: [...state.log, "Game started."] };
}

function validateOrders(state: GameState, playerKey: PlayerKey, orders: Record<string, Order>): void {
  const occupied = ownOccupiedAreas(state, playerKey);
  const orderAreas = Object.keys(orders);
  if (orderAreas.length !== occupied.length || !occupied.every((area) => orderAreas.includes(area))) {
    throw new Error("Place exactly one order in each area containing your units.");
  }
  const specialLimit = specialOrderLimit(state, playerKey);
  const specialOrders = Object.values(orders).filter((order) => order.special).length;
  if (specialOrders > specialLimit) throw new Error(`Special order limit exceeded. Limit is ${specialLimit}.`);
}

function specialOrderLimit(state: GameState, playerKey: PlayerKey): number {
  const index = state.tracks.specialOrderOrder.indexOf(playerKey);
  if (index < 0) return 0;
  return index <= 1 ? 3 : index <= 3 ? 2 : 1;
}

function strength(state: GameState, units: Unit[], order: Order | undefined, area: string, role: "attacker" | "defender"): number {
  return units.reduce((sum, unit) => sum + unitCombatStrength(state, unit, area, role), 0) + orderModifier(order);
}

function unitCombatStrength(state: GameState, unit: Unit, area: string, role: "attacker" | "defender"): number {
  if (unit.routed) return 0;
  if (unit.type !== "artillery") return unitStrength[unit.type];
  return role === "attacker" && state.areas[area]?.objective ? 4 : 0;
}

function automaticSupportStrength(state: GameState, embattledArea: string, playerKey: PlayerKey, side: "attacker" | "defender"): number {
  return getAdjacentAreas(state, embattledArea).reduce((total, area) => {
    const order = state.orders[area];
    const units = state.units[area] ?? [];
    if (!order || order.kind !== "support" || !units.some((unit) => unit.playerKey === playerKey)) return total;
    const supportedUnits = units.filter((unit) => unit.playerKey === playerKey && canSupportCombat(state, area, embattledArea, unit));
    if (supportedUnits.length === 0) return total;
    return total + strength(state, supportedUnits, order, embattledArea, side);
  }, 0);
}

function canSupportCombat(state: GameState, supportArea: string, embattledArea: string, unit: Unit): boolean {
  const fromArea = state.areas[supportArea];
  const toArea = state.areas[embattledArea];
  if (!fromArea || !toArea || !fromArea.adjacent.includes(embattledArea)) return false;
  if (unit.routed) return false;
  return unit.type === "fleet" || toArea.type === "land";
}

function compareCombat(state: GameState, attacker: PlayerKey, defender: PlayerKey, attackerStrength: number, defenderStrength: number): PlayerKey {
  if (attackerStrength > defenderStrength) return attacker;
  if (defenderStrength > attackerStrength) return defender;
  return state.tracks.combatOrder.indexOf(attacker) < state.tracks.combatOrder.indexOf(defender) ? attacker : defender;
}

function advanceAction(state: GameState, playerId: string, from: "disrupt" | "advance" | "gather", to: Phase): Event[] {
  const player = requireCurrentAction(state, playerId, from);
  return advanceActionEvents(state, player.playerKey, from, to);
}

function advanceActionEvents(state: GameState, playerKey: PlayerKey, from: "disrupt" | "advance" | "gather", to: Phase): Event[] {
  const active = activePlayerKeys(state);
  const index = active.indexOf(playerKey);
  return enterActionPhaseEvents(state, from, index + 1, to);
}

function enterActionPhaseEvents(state: GameState, phase: "disrupt" | "advance" | "gather" | "cleanup", start = 0, fallback?: Phase): Event[] {
  if (phase === "cleanup") return cleanupEvents(state);

  const active = activePlayerKeys(state);
  const events: Event[] = [];
  for (let index = start; index < active.length; index += 1) {
    const playerKey = active[index];
    if (hasAnyLegalAction(state, playerKey, phase)) {
      events.push({ type: "phaseChanged", phase, pending: { type: phase, playerKey } });
      return events;
    }
    events.push({ type: "logMessage", message: `${playerName(playerKey)} has no ${phaseOrderLabel(phase)} orders; skipped.` });
  }

  events.push({ type: "logMessage", message: `No ${phaseOrderLabel(phase)} orders remain; advancing to ${nextPhaseLabel(fallback ?? nextActionPhase(phase))}.` });
  events.push(...enterActionPhaseEvents(state, (fallback ?? nextActionPhase(phase)) as "disrupt" | "advance" | "gather" | "cleanup", 0));
  return events;
}

function nextActionPhase(phase: "disrupt" | "advance" | "gather"): "advance" | "gather" | "cleanup" {
  if (phase === "disrupt") return "advance";
  if (phase === "advance") return "gather";
  return "cleanup";
}

function phaseOrderLabel(phase: "disrupt" | "advance" | "gather"): string {
  return phase === "gather" ? "gather resource" : phase;
}

function nextPhaseLabel(phase: Phase): string {
  return phase === "cleanup" ? "cleanup" : phase;
}

function cleanupEvents(state: GameState): Event[] {
  const round = state.tracks.round;
  const winner = findWinner(state);
  if (winner || round >= gameBundle.rules.maxRounds) {
    return [
      { type: "scoreUpdated", score: countScore(state, activePlayerKeys(state)), winner: winner ?? leadingPlayerKey(state) },
      { type: "phaseChanged", phase: "complete", pending: null }
    ];
  }
  return [
    { type: "roundAdvanced", round: round + 1 },
    { type: "capacityUpdated", capacity: countCapacity(state, activePlayerKeys(state)) },
    { type: "phaseChanged", phase: "event", pending: null },
    { type: "phaseChanged", phase: "planning", pending: nextPending(activePlayerKeys(state), "placeOrders", 0) }
  ];
}

function countScore(state: GameState, active: PlayerKey[]): Record<PlayerKey, number> {
  const score = { ...state.tracks.score };
  for (const playerKey of active) score[playerKey] = 0;
  for (const [area, playerKey] of Object.entries(state.control)) {
    if (active.includes(playerKey) && state.areas[area]?.objective) score[playerKey] += 1;
  }
  return score;
}

function countCapacity(state: GameState, active: PlayerKey[]): Record<PlayerKey, number> {
  const capacity = { ...state.tracks.capacity };
  for (const playerKey of active) capacity[playerKey] = 0;
  for (const [area, playerKey] of Object.entries(state.control)) {
    if (active.includes(playerKey)) capacity[playerKey] += state.areas[area]?.capacity ?? 0;
  }
  return capacity;
}

function findWinner(state: GameState): PlayerKey | null {
  const score = countScore(state, activePlayerKeys(state));
  return activePlayerKeys(state).find((playerKey) => score[playerKey] >= gameBundle.rules.scoreTarget) ?? null;
}

function leadingPlayerKey(state: GameState): PlayerKey {
  return [...activePlayerKeys(state)].sort((a, b) => state.tracks.score[b] - state.tracks.score[a])[0];
}

function nextPending(playerKeysInOrder: PlayerKey[], type: PendingAction["type"], start: number): PendingAction | null {
  const playerKey = playerKeysInOrder[start];
  return playerKey ? { type, playerKey } : null;
}

function activePlayerKeys(state: GameState): PlayerKey[] {
  return state.tracks.turnOrder.filter((playerKey) => state.players.some((player) => player.playerKey === playerKey));
}

function ownOccupiedAreas(state: GameState, playerKey: PlayerKey): string[] {
  return Object.entries(state.units)
    .filter(([, units]) => units.some((unit) => unit.playerKey === playerKey))
    .map(([area]) => area);
}

function areasWithOwnOrder(state: GameState, playerKey: PlayerKey, orderKind: "disrupt" | "advance" | "gather"): string[] {
  return Object.entries(state.orders)
    .filter(([area, order]) => order.kind === orderKind && state.units[area]?.some((unit) => unit.playerKey === playerKey))
    .map(([area]) => area);
}

function legalDisruptActionsForPlayerKey(state: GameState, playerKey: PlayerKey): LegalDisruptAction[] {
  return areasWithOwnOrder(state, playerKey, "disrupt").map((from) => ({
    from,
    targets: getRemovableDisruptTargets(state, from)
  }));
}

function legalAdvanceActionsForPlayerKey(state: GameState, playerKey: PlayerKey): LegalAdvanceAction[] {
  return areasWithOwnOrder(state, playerKey, "advance").map((from) => {
    const units = (state.units[from] ?? []).filter((unit) => unit.playerKey === playerKey).map((unit) => unit.type);
    const uniqueUnits = [...new Set(units)];
    const unitDestinations = Object.fromEntries(
      uniqueUnits.map((unitType) => [unitType, getAdjacentAreas(state, from).filter((to) => canMoveType(state, from, to, playerKey, unitType))])
    ) as Partial<Record<UnitType, string[]>>;
    const destinations = [...new Set(Object.values(unitDestinations).flat())];
    return { from, units, destinations, unitDestinations };
  });
}

function legalGatherActionsForPlayerKey(state: GameState, playerKey: PlayerKey): LegalGatherAction[] {
  return areasWithOwnOrder(state, playerKey, "gather").map((area) => ({
    area,
    amount: gatherResourceAmount(state, area)
  }));
}

function getRemovableDisruptTargets(state: GameState, from: string): string[] {
  const fromOrder = state.orders[from];
  return getAdjacentAreas(state, from).filter((area) => {
    const order = state.orders[area];
    return !!fromOrder && !!order && canDisruptArea(state, from, area) && canDisruptOrder(fromOrder, order);
  });
}

function getAdjacentAreas(state: GameState, area: string): string[] {
  return state.areas[area]?.adjacent ?? [];
}

function canMoveType(state: GameState, from: string, to: string, playerKey: PlayerKey, unitType: UnitType): boolean {
  const fromArea = state.areas[from];
  const toArea = state.areas[to];
  if (!fromArea || !toArea || !fromArea.adjacent.includes(to)) return false;
  return unitType === "fleet" ? toArea.type === "sea" : toArea.type === "land";
}

function normalizeAdvanceCommand(command: Extract<Command, { type: "advance" }>): AdvanceMove[] {
  return "moves" in command
    ? normalizeAdvanceMoves(command.moves)
    : normalizeAdvanceMoves([{ to: command.to, units: command.units }]);
}

function normalizeAdvanceMoves(moves: AdvanceMove[]): AdvanceMove[] {
  const byDestination = new Map<string, UnitType[]>();
  for (const move of moves) {
    if (move.units.length === 0) continue;
    byDestination.set(move.to, [...(byDestination.get(move.to) ?? []), ...move.units]);
  }
  return [...byDestination].map(([to, units]) => ({ to, units }));
}

function allocateAdvanceUnits(units: Unit[], moves: AdvanceMove[]): Array<{ to: string; units: Unit[] }> {
  const available = [...units];
  return moves.map((move) => ({
    to: move.to,
    units: consumeUnits(available, move.units)
  }));
}

function consumeUnits(available: Unit[], requested: UnitType[]): Unit[] {
  return requested.map((unitType) => {
    const index = available.findIndex((unit) => unit.type === unitType);
    if (index < 0) throw new Error("Requested units are not available.");
    const [unit] = available.splice(index, 1);
    return unit;
  });
}

function hasEnemyUnits(state: GameState, area: string, playerKey: PlayerKey): boolean {
  return (state.units[area] ?? []).some((unit) => unit.playerKey !== playerKey);
}

function canDisruptOrder(fromOrder: Order, targetOrder: Order): boolean {
  if (targetOrder.kind === "advance") return false;
  if (targetOrder.kind === "defend") return !!fromOrder.special;
  return true;
}

function canDisruptArea(state: GameState, from: string, target: string): boolean {
  const fromArea = state.areas[from];
  const targetArea = state.areas[target];
  if (!fromArea || !targetArea || !fromArea.adjacent.includes(target)) return false;
  return fromArea.type === "sea" || targetArea.type !== "sea";
}

function assertCanDisruptArea(state: GameState, from: string, target: string): void {
  if (!canDisruptArea(state, from, target)) throw new Error("Disrupt target is not reachable from this area.");
}

function assertCanMoveUnits(state: GameState, from: string, to: string, playerKey: PlayerKey, units: Unit[]): void {
  for (const unit of units) {
    if (unit.routed) throw new Error("Routed units cannot advance.");
    if (!canMoveType(state, from, to, playerKey, unit.type)) throw new Error(`${title(unit.type)} cannot move to that area.`);
  }
}

function assertCapacityLimit(state: GameState, playerKey: PlayerKey): void {
  if (!isWithinCapacityLimit(state, playerKey)) throw new Error("Advance would exceed this playerKey's capacity limit.");
}

function isWithinCapacityLimit(state: GameState, playerKey: PlayerKey): boolean {
  const cappedCapacity = Math.min(state.tracks.capacity[playerKey] ?? 0, 6);
  const limits = capacityLimits[cappedCapacity] ?? capacityLimits[0];
  const armies = Object.values(state.units)
    .map((units) => units.filter((unit) => unit.playerKey === playerKey).length)
    .filter((size) => size > 1)
    .sort((a, b) => b - a);
  if (armies.length > limits.length) return false;
  return armies.every((size, index) => size <= limits[index]);
}

function controllerForArea(state: GameState, area: string): PlayerKey | undefined {
  return state.units[area]?.[0]?.playerKey ?? state.control[area];
}

function gatherResourceAmount(state: GameState, area: string): number {
  return 1 + (state.areas[area]?.resourceSites ?? 0);
}

function reorderTracks(state: GameState, active: PlayerKey[]) {
  return {
    ...state.tracks,
    turnOrder: playerKeys.filter((playerKey) => active.includes(playerKey)),
    combatOrder: playerKeys.filter((playerKey) => active.includes(playerKey)),
    specialOrderOrder: playerKeys.filter((playerKey) => active.includes(playerKey))
  };
}

function assertPhase(state: GameState, phase: Phase): void {
  if (state.phase !== phase) throw new Error(`Expected ${phase} phase, got ${state.phase}.`);
}

function requirePlayer(state: GameState, playerId: string) {
  const player = state.players.find((candidate) => candidate.id === playerId);
  if (!player) throw new Error("Unknown player.");
  return player;
}

function requireCurrentAction(state: GameState, playerId: string, type: PendingAction["type"]) {
  const player = requirePlayer(state, playerId);
  if (state.pending?.type !== type || state.pending.playerKey !== player.playerKey) throw new Error("Not this player's action.");
  return player;
}

function assertOwnOccupiedArea(state: GameState, playerKey: PlayerKey, area: string): void {
  if (!state.units[area]?.some((unit) => unit.playerKey === playerKey)) throw new Error("Area is not occupied by this playerKey.");
}

function assertAdjacent(state: GameState, from: string, to: string): void {
  if (!state.areas[from]?.adjacent.includes(to)) throw new Error("Areas are not adjacent.");
}

function takeUnits(units: Unit[], playerKey: PlayerKey, requested: UnitType[]): Unit[] {
  const counts = countTypes(requested.map((type) => ({ playerKey, type })));
  const result: Unit[] = [];
  for (const unit of units) {
    if (unit.playerKey !== playerKey) continue;
    const remaining = counts[unit.type] ?? 0;
    if (remaining > 0) {
      counts[unit.type] = remaining - 1;
      result.push(unit);
    }
  }
  if (result.length !== requested.length) throw new Error("Requested units are not available.");
  return result;
}

function countTypes(units: Pick<Unit, "type">[]): Partial<Record<UnitType, number>> {
  return units.reduce<Partial<Record<UnitType, number>>>((counts, unit) => {
    counts[unit.type] = (counts[unit.type] ?? 0) + 1;
    return counts;
  }, {});
}

function initialCombatCards(playerKey: PlayerKey): string[] {
  return combatCardsFor(playerKey).map((card) => card.id);
}

function combatCardStrength(cardId?: string): number {
  return cardId ? combatCardsById[cardId]?.strength ?? 0 : 0;
}

function playerName(playerKey: PlayerKey): string {
  return playerTheme[playerKey]?.label ?? playerKey;
}

function title(value: string): string {
  return value.slice(0, 1).toUpperCase() + value.slice(1);
}

function cryptoSafeSeed(): string {
  return Math.random().toString(36).slice(2);
}

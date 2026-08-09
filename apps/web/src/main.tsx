import {
  getLegalGatherActions,
  getLegalAdvanceActions,
  getLegalOrderPlacements,
  getLegalDisruptActions,
  combatCardsById,
  playerTheme,
  gameBundle,
  playerKeys,
  type Area,
  type Command,
  type GameState,
  type PlayerKey,
  type Order,
  type OrderKind,
  type Unit,
  type UnitType
} from "@tabletop/rules";
import { createRoot } from "react-dom/client";
import type { CSSProperties, DragEvent, MouseEvent, PointerEvent } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { canUseOrder, commitHistory, countOrder, createHistory, cycleOrder, familyForShortcut, moveOrder, orderFamilies, ordersEqual, placeOrder, redoHistory, removeOrder, remainingFor, undoHistory, type DraftHistory } from "./planningOrders";
import { editorHexTiles, inspectMapIntegrity, mapTerrainTypes, terrainTheme, visualAreasById, visualMap, type HexTile, type MapPoint, type MapTerrain, type VisualMapArea } from "./visualMap";
import { GameTopbar } from "./GameTopbar";
import "./styles.css";

const api = `${window.location.protocol}//${window.location.hostname}:3000`;
const wsApi = `${window.location.protocol === "https:" ? "wss" : "ws"}://${window.location.hostname}:3000`;
const soloAiPool: PlayerKey[] = playerKeys;
const orderKinds: OrderKind[] = ["advance", "defend", "support", "disrupt", "gather"];
const orderTokenPool = orderFamilies.flatMap((family) => family.variants);
const unitTypes: UnitType[] = ["infantry", "cavalry", "fleet", "artillery"];
const unitIconStorageKey = "tabletop-unit-icon-designs";
const orderIconStorageKey = "tabletop-order-icon-designs";
const boardIconStorageKey = "tabletop-board-icon-designs";
const patternOpacityStorageKey = "tabletop-pattern-opacity";
const regionNoiseStorageKey = "tabletop-region-noise";
const showRegionNamesStorageKey = "tabletop-show-region-names";
const mapEditorStorageKey = "tabletop-map-editor-draft";
const strongRegionBordersStorageKey = "tabletop-strong-region-borders";
const regionBorderWidthStorageKey = "tabletop-region-border-width";
const orderCursorPreviewStorageKey = "tabletop-order-cursor-preview";

type IconDesign = {
  points: MapPoint[];
  closed: boolean;
  shapes?: IconShape[];
};

type IconShape = {
  points: MapPoint[];
  closed: boolean;
  fill?: string;
  stroke?: string;
  strokeWidth?: string;
  strokeLinecap?: CSSProperties["strokeLinecap"];
  strokeLinejoin?: CSSProperties["strokeLinejoin"];
};

type IconDesignLibrary = {
  units: Record<UnitType, IconDesign>;
  orders: Record<OrderKind, IconDesign>;
  board: Record<BoardIconKind, IconDesign>;
};

type BoardIconKind = "majorObjective" | "objective" | "resourceSite" | "capacity" | "initiative" | "combat" | "orders" | "facedown" | "special";

type EditableIconTarget =
  | { group: "units"; key: UnitType; label: string }
  | { group: "orders"; key: OrderKind; label: string }
  | { group: "board"; key: BoardIconKind; label: string };

const defaultUnitIconDesigns: Record<UnitType, IconDesign> = {
  infantry: { closed: true, points: [[-9, -12], [9, -12], [11, 12], [-11, 12]] },
  cavalry: { closed: true, points: [[0, -14], [13, 0], [0, 14], [-13, 0]] },
  fleet: { closed: true, points: [[-15, 8], [0, -11], [15, 8]] },
  artillery: { closed: true, points: [[-12, -10], [12, -10], [12, -4], [4, -4], [4, 12], [-4, 12], [-4, -4], [-12, -4]] }
};

const defaultOrderIconDesigns: Record<OrderKind, IconDesign> = {
  advance: { closed: true, points: [[-14, -4], [3, -4], [3, -11], [14, 0], [3, 11], [3, 4], [-14, 4]] },
  defend: { closed: true, points: [[-11, -11], [11, -11], [11, 11], [-11, 11]] },
  support: { closed: true, points: [[-4, -13], [4, -13], [4, -4], [13, -4], [13, 4], [4, 4], [4, 13], [-4, 13], [-4, 4], [-13, 4], [-13, -4], [-4, -4]] },
  disrupt: { closed: true, points: [[-12, -9], [-5, -9], [0, -2], [5, -12], [12, -12], [4, 2], [11, 2], [0, 13], [-11, 2], [-4, 2]] },
  gather: { closed: true, points: [[-10, -8], [0, -13], [10, -8], [12, 5], [0, 13], [-12, 5]] }
};

const boardIconKinds: BoardIconKind[] = ["majorObjective", "objective", "resourceSite", "capacity", "initiative", "combat", "orders", "facedown", "special"];
const defaultBoardIconDesigns: Record<BoardIconKind, IconDesign> = {
  majorObjective: { closed: true, points: [[0, -14], [13, -5], [10, 12], [-10, 12], [-13, -5]] },
  objective: { closed: true, points: [[-10, -10], [10, -10], [10, 10], [-10, 10]] },
  resourceSite: { closed: true, points: [[0, -13], [13, 0], [0, 13], [-13, 0]] },
  capacity: { closed: true, points: [[-12, 9], [-8, -9], [8, -9], [12, 9]] },
  initiative: { closed: true, points: [[0, -14], [12, 10], [0, 5], [-12, 10]] },
  combat: { closed: false, points: [[-12, -12], [12, 12], [0, 0], [12, -12], [-12, 12]] },
  orders: { closed: false, points: [[-12, -8], [12, -8], [-12, 0], [12, 0], [-12, 8], [12, 8]] },
  facedown: { closed: true, points: [[-12, -9], [12, -9], [12, 9], [-12, 9]] },
  special: { closed: true, points: [[0, -14], [4, -4], [14, 0], [4, 4], [0, 14], [-4, 4], [-14, 0], [-4, -4]] }
};

const unitIconVersionEvent = "tabletop-unit-icons-changed";

type InteractionMode =
  | { type: "idle" }
  | { type: "placingOrder"; areaId?: string }
  | { type: "selectingDisruptSource" }
  | { type: "selectingDisruptTarget"; from: string }
  | { type: "selectingAdvanceSource" }
  | { type: "selectingUnits"; from: string; selectedUnits: UnitSelection[]; moves: AdvanceDraft[] }
  | { type: "selectingAdvanceDestination"; from: string; selectedUnits: UnitSelection[]; moves: AdvanceDraft[] }
  | { type: "selectingGather" };

type UnitSelection = {
  type: UnitType;
  index: number;
};

type AdvanceDraft = {
  to: string;
  units: UnitSelection[];
};

type RegionNameMode = "off" | "three" | "important" | "empty" | "abbreviated" | "full";

const regionNameModeOptions: Array<{ value: RegionNameMode; label: string }> = [
  { value: "off", label: "Off" },
  { value: "three", label: "Three letter" },
  { value: "important", label: "Only important" },
  { value: "empty", label: "Only empty" },
  { value: "abbreviated", label: "Abbreviated" },
  { value: "full", label: "Full" }
];

function App() {
  const [gameId, setGameId] = useState("");
  const [playerId] = useState(() => crypto.randomUUID());
  const [name, setName] = useState("Player");
  const [playerKey, setPlayerKey] = useState<PlayerKey>(playerKeys[0]);
  const [state, setState] = useState<GameState | null>(null);
  const [selectedArea, setSelectedArea] = useState<string>("");
  const [botEnabled, setBotEnabled] = useState(false);
  const [interaction, setInteraction] = useState<InteractionMode>({ type: "idle" });
  const [draftHistory, setDraftHistory] = useState<DraftHistory>(() => createHistory());
  const localOrders = draftHistory.present.orders;
  const localOrderPositions = draftHistory.present.positions;
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [, setUnitIconVersion] = useState(0);
  const [hash, setHash] = useState(() => window.location.hash);
  const [patternOpacity, setPatternOpacity] = useState(() => {
    const saved = window.localStorage.getItem(patternOpacityStorageKey);
    const parsed = saved ? Number(saved) : 42;
    return Number.isFinite(parsed) ? Math.min(100, Math.max(0, parsed)) : 42;
  });
  const [regionNoise, setRegionNoise] = useState(() => {
    const saved = window.localStorage.getItem(regionNoiseStorageKey);
    const parsed = saved ? Number(saved) : 28;
    return Number.isFinite(parsed) ? Math.min(100, Math.max(0, parsed)) : 28;
  });
  const [regionNameMode, setRegionNameMode] = useState<RegionNameMode>(() => loadRegionNameMode());
  const [strongRegionBorders, setStrongRegionBorders] = useState(() => window.localStorage.getItem(strongRegionBordersStorageKey) === "true");
  const [regionBorderWidth, setRegionBorderWidth] = useState(() => loadNumberSetting(regionBorderWidthStorageKey, 5.2, 2, 10));
  const [orderCursorPreview, setOrderCursorPreview] = useState(() => window.localStorage.getItem(orderCursorPreviewStorageKey) !== "false");
  const [mapEditorDraft, setMapEditorDraft] = useState(loadMapEditorDraft);
  const [warning, setWarning] = useState("");
  const me = state?.players.find((player) => player.id === playerId);
  const effectiveState = useMemo(() => state ? buildEffectiveStateWithMapDraft(state, mapEditorDraft) : null, [state, mapEditorDraft]);
  const selected = selectedArea && effectiveState ? effectiveState.areas[selectedArea] : undefined;
  const currentPlayerKey = me?.playerKey;
  const myTurn = !!state?.pending && state.pending.type !== "combat" && state.players.some((player) => player.id === playerId && player.playerKey === state.pending?.playerKey);
  const showIconDesigner = hash === "#icon-designer";
  const showMapEditor = hash === "#map-editor";
  const gameStarted = !!effectiveState && effectiveState.phase !== "lobby";

  useEffect(() => {
    if (!effectiveState) return;
    const issues = inspectMapIntegrity(effectiveState.areas);
    if (issues.length > 0) console.warn("Map integrity check found problems:", issues);
  }, [effectiveState?.areas]);

  useEffect(() => {
    if (!gameId) return;
    const ws = new WebSocket(`${wsApi}/games/${gameId}/ws?playerId=${playerId}`);
    ws.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (message.type === "state") setState(message.state);
    });
    void loadGame(gameId, playerId).then((loaded) => {
      setState(loaded);
      setSelectedArea(firstOccupiedArea(loaded, playerKey) ?? "");
    });
    return () => ws.close();
  }, [botEnabled, gameId, playerKey, playerId]);

  useEffect(() => {
    if (!botEnabled || !gameId || !state) return;
    const command = nextBotCommand(state, playerId);
    if (!command) return;
    const timer = window.setTimeout(() => {
      void sendCommand(gameId, command).then((next) => setState(next)).catch((error) => console.warn(error));
    }, 650);
    return () => window.clearTimeout(timer);
  }, [botEnabled, gameId, playerId, state]);

  useEffect(() => {
    if (!gameId || !state?.pending || state.phase === "planning") return;
    const command = impossibleActionSkipCommand(state);
    if (!command) return;
    const timer = window.setTimeout(() => {
      void sendCommand(gameId, command).then((next) => setState(next)).catch((error) => console.warn(error));
    }, 260);
    return () => window.clearTimeout(timer);
  }, [botEnabled, gameId, state]);

  useEffect(() => {
    if (!state || !me) return;
    setWarning("");
    if (state.phase !== "planning") {
      setDraftHistory(createHistory());
    }
    if (state.phase === "planning" && myTurn) setInteraction({ type: "placingOrder" });
    else if (state.phase === "disrupt" && myTurn) setInteraction({ type: "selectingDisruptSource" });
    else if (state.phase === "advance" && myTurn) setInteraction({ type: "selectingAdvanceSource" });
    else if (state.phase === "gather" && myTurn) setInteraction({ type: "selectingGather" });
    else setInteraction({ type: "idle" });
  }, [myTurn, me, state?.phase, state?.pending?.playerKey]);

  useEffect(() => {
    window.localStorage.setItem(patternOpacityStorageKey, String(patternOpacity));
  }, [patternOpacity]);

  useEffect(() => {
    window.localStorage.setItem(regionNoiseStorageKey, String(regionNoise));
  }, [regionNoise]);

  useEffect(() => {
    window.localStorage.setItem(showRegionNamesStorageKey, regionNameMode);
  }, [regionNameMode]);

  useEffect(() => {
    window.localStorage.setItem(strongRegionBordersStorageKey, String(strongRegionBorders));
  }, [strongRegionBorders]);

  useEffect(() => {
    window.localStorage.setItem(regionBorderWidthStorageKey, String(regionBorderWidth));
  }, [regionBorderWidth]);

  useEffect(() => {
    window.localStorage.setItem(orderCursorPreviewStorageKey, String(orderCursorPreview));
  }, [orderCursorPreview]);

  useEffect(() => {
    window.localStorage.setItem(mapEditorStorageKey, JSON.stringify(mapEditorDraft));
  }, [mapEditorDraft]);

  useEffect(() => {
    const refreshHash = () => setHash(window.location.hash);
    const refreshIcons = () => setUnitIconVersion((version) => version + 1);
    window.addEventListener("hashchange", refreshHash);
    window.addEventListener(unitIconVersionEvent, refreshIcons);
    return () => {
      window.removeEventListener("hashchange", refreshHash);
      window.removeEventListener(unitIconVersionEvent, refreshIcons);
    };
  }, []);

  const myAreas = useMemo(
    () => Object.entries(effectiveState?.units ?? {}).filter(([, units]) => units.some((unit) => unit.playerKey === me?.playerKey)),
    [effectiveState, me]
  );

  async function createGame() {
    const result = await createGameRequest();
    setGameId(result.gameId);
  }

  async function startSoloTest() {
    const result = gameId ? { gameId } : await createGameRequest();
    setGameId(result.gameId);
    setBotEnabled(true);

    let next = await sendCommand(result.gameId, { type: "join", playerId, name, playerKey }).catch(() => loadGame(result.gameId, playerId));
    for (const aiPlayerKey of soloAiPool.filter((candidate) => candidate !== playerKey)) {
      next = await sendCommand(result.gameId, { type: "join", playerId: botId(aiPlayerKey), name: `${playerTheme[aiPlayerKey].label} AI`, playerKey: aiPlayerKey }).catch(() => next);
    }
    const joinedPlayers = next?.players ?? [];
    for (const player of joinedPlayers) {
      next = await sendCommand(result.gameId, { type: "ready", playerId: player.id, ready: true }).catch(() => next);
    }
    next = await sendCommand(result.gameId, { type: "start" }).catch(() => next);
    if (!next) return;
    setState(next);
    setSelectedArea(firstOccupiedArea(next, playerKey) ?? "");
  }

  async function startCombatTest() {
    const result = gameId ? { gameId } : await createGameRequest();
    setGameId(result.gameId);
    setBotEnabled(true);
    let next = await sendCommand(result.gameId, { type: "join", playerId, name, playerKey }).catch(() => loadGame(result.gameId, playerId));
    const testPlayerKeys = soloAiPool.filter((candidate) => candidate !== playerKey).slice(0, 2);
    for (const aiPlayerKey of testPlayerKeys) {
      next = await sendCommand(result.gameId, { type: "join", playerId: botId(aiPlayerKey), name: `${playerTheme[aiPlayerKey].label} AI`, playerKey: aiPlayerKey }).catch(() => next);
    }
    for (const player of next?.players ?? []) {
      next = await sendCommand(result.gameId, { type: "ready", playerId: player.id, ready: true }).catch(() => next);
    }
    next = await sendCommand(result.gameId, { type: "startCombatTest", playerId }).catch(() => next);
    if (!next) return;
    setState(next);
    setSelectedArea(gameBundle.testScenario?.attackerFrom ?? "");
  }

  async function submit(command: Command) {
    if (!gameId) return;
    try {
      const next = await sendCommand(gameId, command);
      setState(next);
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "Command failed.");
    }
  }

  function placeDemoOrders() {
    if (!me || !state) return;
    const orders = demoOrders(state, me.playerKey);
    setDraftHistory((history) => commitHistory(history, { orders, positions: {} }));
    void submit({ type: "placeOrders", playerId, orders });
  }

  function autoplayMyStep() {
    if (!state || !me) return;
    const command = nextPlayerKeyCommand(state, me.id, me.playerKey);
    if (command) void submit(command);
  }

  function placeLocalOrder(areaId: string, order: Order, position?: MapPoint) {
    const viewState = effectiveState ?? state;
    if (!viewState || !me) return;
    if (!getLegalOrderPlacements(viewState, playerId).some((placement) => placement.area === areaId)) {
      reject("Choose one of your occupied territories.");
      return;
    }
    const specialLimit = specialOrderLimitFor(viewState, me.playerKey);
    if (!canUseOrder(localOrders, order, specialLimit, areaId)) {
      reject("That order token is not available.");
      return;
    }
    setDraftHistory((history) => commitHistory(history, placeOrder(history.present, areaId, order, position)));
    setSelectedOrder(null);
    setSelectedArea(areaId);
    setInteraction({ type: "placingOrder" });
  }

  function removeLocalOrder(areaId: string) {
    setDraftHistory((history) => commitHistory(history, removeOrder(history.present, areaId)));
    setSelectedArea(areaId);
    setInteraction({ type: "placingOrder", areaId });
  }

  function submitLocalOrders() {
    const viewState = effectiveState ?? state;
    if (!viewState || !me) return;
    const required = getOwnOccupiedAreas(viewState, playerId);
    const missing = required.filter((area) => !localOrders[area]);
    if (missing.length > 0) {
      reject(`Missing orders for ${missing.map((area) => viewState.areas[area].name).join(", ")}.`);
      return;
    }
    void submit({ type: "placeOrders", playerId, orders: Object.fromEntries(required.map((area) => [area, localOrders[area]])) });
  }

  function handleAreaClick(areaId: string) {
    const viewState = effectiveState ?? state;
    if (!viewState) return;
    setSelectedArea(areaId);
    setWarning("");
    if (!me || !myTurn) return;

    if (viewState.phase === "planning") {
      if (!getLegalOrderPlacements(viewState, playerId).some((placement) => placement.area === areaId)) {
        reject("Orders can only be placed where you have units.");
        return;
      }
      if (selectedOrder) {
        placeLocalOrder(areaId, selectedOrder);
        return;
      }
      setInteraction({ type: "placingOrder", areaId });
      return;
    }

    if (interaction.type === "selectingDisruptTarget") {
      const disruptAction = getLegalDisruptActions(viewState, playerId).find((action) => action.from === interaction.from);
      if (disruptAction?.targets.includes(areaId)) {
        void submit({ type: "disrupt", playerId, from: interaction.from, target: areaId });
        setInteraction({ type: "selectingDisruptSource" });
      } else {
        reject("That order cannot be disrupted from here.");
      }
      return;
    }

    if (viewState.phase === "disrupt") {
      if (getLegalDisruptActions(viewState, playerId).some((action) => action.from === areaId)) setInteraction({ type: "selectingDisruptTarget", from: areaId });
      else reject("Choose a territory with one of your disrupt orders.");
      return;
    }

    if (interaction.type === "selectingUnits" || interaction.type === "selectingAdvanceDestination") {
      if (interaction.from === areaId) {
        setInteraction({ type: "selectingAdvanceSource" });
        setWarning("");
        return;
      }
      const selectedTypes = selectedUnitTypes(interaction.selectedUnits);
      if (selectedTypes.length > 0 && getLegalAdvanceDestinationsForDraft(viewState, playerId, interaction).includes(areaId)) {
        setInteraction({
          type: "selectingUnits",
          from: interaction.from,
          selectedUnits: [],
          moves: [...interaction.moves, { to: areaId, units: interaction.selectedUnits }]
        });
      } else {
        reject(selectedTypes.length > 0 ? "That destination is not legal for the selected units." : "Select at least one unit first.");
      }
      return;
    }

    if (viewState.phase === "advance") {
      const action = getLegalAdvanceActions(viewState, playerId).find((candidate) => candidate.from === areaId && candidate.destinations.length > 0);
      if (action) {
        const movableUnits = (viewState.units[areaId] ?? []).flatMap((unit, index) =>
          unit.playerKey === me.playerKey && action.unitDestinations[unit.type]?.length
            ? [{ type: unit.type, index }]
            : []
        );
        setInteraction({
          type: "selectingUnits",
          from: areaId,
          selectedUnits: movableUnits.length === 1 ? movableUnits : [],
          moves: []
        });
      }
      else reject("Choose a territory with one of your advance orders.");
      return;
    }

    if (viewState.phase === "gather") {
      if (getLegalGatherActions(viewState, playerId).some((action) => action.area === areaId)) void submit({ type: "gather", playerId, area: areaId });
      else reject("Choose a territory with one of your gather resource orders.");
    }
  }

  function moveLocalOrder(from: string, to: string, position?: MapPoint) {
    if (from === to) return;
    setDraftHistory((history) => commitHistory(history, moveOrder(history.present, from, to, position)));
    setSelectedArea(to);
  }

  function clearLocalOrders() {
    if (Object.keys(localOrders).length === 0 || !window.confirm("Clear all drafted orders?")) return;
    setDraftHistory((history) => commitHistory(history, { orders: {}, positions: {} }));
  }

  function handleUnitClick(areaId: string, unit: Unit, index: number) {
    if (!state || !me || !myTurn || state.phase !== "advance") return;
    if (unit.playerKey !== me.playerKey) return;
    if (!getLegalAdvanceActions(state, playerId).some((action) => action.from === areaId)) {
      reject("Choose units from a territory with one of your advance orders.");
      return;
    }
    if (isUnitAssignedToAdvance(interaction, areaId, unit.type, index)) {
      reject("That unit is already assigned to this advance.");
      return;
    }
    const next = toggleSelectedUnit({
      type: "selectingUnits",
      from: areaId,
      selectedUnits: currentAdvanceSelections(interaction, areaId),
      moves: currentAdvanceMoves(interaction, areaId)
    }, unit.type, index);
    setSelectedArea(areaId);
    setWarning("");
    setInteraction(next);
  }

  function reject(message: string) {
    setWarning(message);
    window.setTimeout(() => setWarning((current) => current === message ? "" : current), 2200);
  }

  useEffect(() => {
    if (!effectiveState || !me) return;
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.repeat || isTypingTarget(event.target) || event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key === " " && !effectiveState.combat && (myTurn || effectiveState.phase === "reveal")) {
        event.preventDefault();
        event.stopImmediatePropagation();
        autoplayMyStep();
        return;
      }
      if (event.key !== "Enter" || effectiveState.phase !== "advance" || !myTurn || !isAdvanceInteraction(interaction)) return;
      const moves = currentAdvanceMoves(interaction, interaction.from);
      if (moves.length === 0) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      void submit(advanceDraftsToCommand(playerId, interaction.from, moves));
      setInteraction({ type: "selectingAdvanceSource" });
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [effectiveState, interaction, me, myTurn, playerId]);

  useEffect(() => {
    if (!effectiveState || !me || effectiveState.phase !== "planning" || !myTurn) return;
    const relevant = getLegalOrderPlacements(effectiveState, playerId).map((placement) => placement.area);
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (isTypingTarget(event.target)) return;
      const family = familyForShortcut(event.key);
      if (family) {
        event.preventDefault();
        const base = family.variants[0].order;
        const next = event.shiftKey ? cycleOrder(base, 1, localOrders, specialOrderLimitFor(effectiveState, me.playerKey)) : base;
        setSelectedOrder(canUseOrder(localOrders, next, specialOrderLimitFor(effectiveState, me.playerKey)) ? next : base);
        setInteraction({ type: "placingOrder" });
        return;
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        setDraftHistory((history) => event.shiftKey ? redoHistory(history) : undoHistory(history));
        return;
      }
      if (event.key === "Tab") {
        event.preventDefault();
        const candidates = relevant.filter((area) => !localOrders[area]);
        const list = candidates.length ? candidates : relevant;
        const current = list.indexOf(selectedArea);
        const next = (current + (event.shiftKey ? -1 : 1) + list.length) % list.length;
        if (list[next]) setSelectedArea(list[next]);
        return;
      }
      if (event.key === "Escape") {
        setSelectedOrder(null);
        setInteraction({ type: "placingOrder" });
        return;
      }
      if (event.key.toLowerCase() === "c") {
        event.preventDefault();
        clearLocalOrders();
        return;
      }
      if ((event.key === "Delete" || event.key === "Backspace") && localOrders[selectedArea]) {
        event.preventDefault();
        removeLocalOrder(selectedArea);
        return;
      }
      if ((event.key === "Shift" || event.key === "Alt") && (localOrders[selectedArea] || selectedOrder)) {
        const current = localOrders[selectedArea] ?? selectedOrder;
        if (!current) return;
        const next = cycleOrder(current, event.key === "Shift" ? 1 : -1, localOrders, specialOrderLimitFor(effectiveState, me.playerKey), localOrders[selectedArea] ? selectedArea : undefined);
        if (ordersEqual(current, next)) reject(event.key === "Shift" ? "No stronger legal variant is available." : "No weaker variant is available.");
        else if (localOrders[selectedArea]) placeLocalOrder(selectedArea, next);
        else setSelectedOrder(next);
        return;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        if (selectedOrder && relevant.includes(selectedArea)) placeLocalOrder(selectedArea, selectedOrder);
        else if (!selectedOrder && interaction.type !== "placingOrder") return;
        else if (relevant.every((area) => localOrders[area])) submitLocalOrders();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [effectiveState, interaction.type, localOrders, me, myTurn, playerId, selectedArea, selectedOrder]);

  return (
    <main className={gameStarted ? "game-started" : undefined}>
      {!gameStarted && <section className="hero">
        <div>
          <p className="eyebrow">{gameBundle.ui.eyebrow}</p>
          <h1>{gameBundle.ui.title}</h1>
          <p className="subtitle">{gameBundle.ui.subtitle}</p>
        </div>
        <div className="hero-actions">
          <button onClick={createGame}>Create Empty Game</button>
          <button className="primary" onClick={startSoloTest}>Start With Dummy AI</button>
          <button className="combat-test-launch" onClick={startCombatTest}>Combat Test Setup</button>
          <a className="tool-link" href="#icon-designer">Icon Designer</a>
          <a className="tool-link" href="#map-editor">Map Editor</a>
        </div>
      </section>}

      {!gameStarted && (
        <section className="toolbar">
          <label>
            Game ID
            <input value={gameId} onChange={(event) => setGameId(event.target.value)} placeholder="Paste game id" />
          </label>
          <label>
            Name
            <input value={name} onChange={(event) => setName(event.target.value)} />
          </label>
          <label>
            {gameBundle.ui.playerLabel}
            <select value={playerKey} onChange={(event) => setPlayerKey(event.target.value as PlayerKey)}>
              {playerKeys.map((candidate) => <option key={candidate} value={candidate}>{playerTheme[candidate].label}</option>)}
            </select>
          </label>
          <button disabled={!gameId || !!me} onClick={() => submit({ type: "join", playerId, name, playerKey })}>Join</button>
          <button disabled={!me} onClick={() => submit({ type: "ready", playerId, ready: !me?.ready })}>{me?.ready ? "Unready" : "Ready"}</button>
          <button disabled={!state || state.phase !== "lobby"} onClick={() => submit({ type: "start" })}>Start</button>
          <label className="toggle">
            <input checked={botEnabled} onChange={(event) => setBotEnabled(event.target.checked)} type="checkbox" />
            AI pilot
          </label>
        </section>
      )}

      {gameStarted && effectiveState && (
        <GameTopbar
          botEnabled={botEnabled}
          gameId={gameId}
          hash={hash}
          playerKey={me?.playerKey ?? playerKey}
          playerName={me?.name ?? name}
          state={effectiveState}
          onBotEnabledChange={setBotEnabled}
        />
      )}

      {showIconDesigner && <IconDesigner onClose={() => {
        window.history.replaceState(null, "", window.location.pathname + window.location.search);
        setHash("");
      }} />}

      {showMapEditor && <MapEditor draft={mapEditorDraft} state={state} onDraftChange={setMapEditorDraft} onClose={() => {
        window.history.replaceState(null, "", window.location.pathname + window.location.search);
        setHash("");
      }} />}

      {!showMapEditor && effectiveState ? (
        <>
          {!gameStarted && (
            <section className="status-strip">
              <div>
                <span>Round</span>
                <strong>{effectiveState.tracks.round}</strong>
              </div>
              <div>
                <span>Phase</span>
                <strong>{phaseLabel(effectiveState.phase)}</strong>
              </div>
              <div>
                <span>To act</span>
                <strong>{effectiveState.pending ? playerTheme[effectiveState.pending.playerKey].label : effectiveState.winner ? `${playerTheme[effectiveState.winner].label} wins` : "None"}</strong>
              </div>
              <div>
                <span>{gameBundle.ui.threatLabel}</span>
                <strong>{effectiveState.tracks.threat}</strong>
              </div>
            </section>
          )}

          <div className="layout">
            <section className="war-table" aria-label="Game board">
              <Board
                currentPlayerKey={currentPlayerKey}
                interaction={interaction}
                localOrders={localOrders}
                localOrderPositions={localOrderPositions}
                mapDraft={mapEditorDraft}
                orderCursorPreview={orderCursorPreview}
                playerId={playerId}
                selectedOrder={selectedOrder}
                selectedArea={selectedArea}
                patternOpacity={patternOpacity}
                regionBorderWidth={regionBorderWidth}
                regionNoise={regionNoise}
                regionNameMode={regionNameMode}
                strongRegionBorders={strongRegionBorders}
                state={effectiveState}
                onPatternOpacityChange={setPatternOpacity}
                onRegionBorderWidthChange={setRegionBorderWidth}
                onRegionNoiseChange={setRegionNoise}
                onRegionNameModeChange={setRegionNameMode}
                onRemoveLocalOrder={removeLocalOrder}
                onMoveLocalOrder={moveLocalOrder}
                onPlaceOrder={placeLocalOrder}
                onStrongRegionBordersChange={setStrongRegionBorders}
                onOrderCursorPreviewChange={setOrderCursorPreview}
                onSelectOrder={setSelectedOrder}
                onSelect={handleAreaClick}
                onDismissOrderPicker={() => {
                  if (effectiveState.phase === "planning" && interaction.type === "placingOrder" && interaction.areaId) {
                    setInteraction({ type: "placingOrder" });
                  }
                }}
                onUnitSelect={handleUnitClick}
              />
              {effectiveState.combat && me && (
                <CombatOverlay
                  combat={effectiveState.combat}
                  me={me}
                  state={effectiveState}
                  onSubmit={submit}
                />
              )}
            </section>

            <aside className="side-panel">
              <ActionPanel
                interaction={interaction}
                localOrders={localOrders}
                state={effectiveState}
                playerId={playerId}
                myAreas={myAreas.map(([area]) => area)}
                selectedArea={selectedArea}
                warning={warning}
                onInteraction={setInteraction}
                onSubmit={submit}
                onSubmitLocalOrders={submitLocalOrders}
                onClearLocalOrders={clearLocalOrders}
                canUndo={draftHistory.past.length > 0}
                canRedo={draftHistory.future.length > 0}
                onUndo={() => setDraftHistory((history) => undoHistory(history))}
                onRedo={() => setDraftHistory((history) => redoHistory(history))}
                onDefaultOrders={placeDemoOrders}
                onAutoplay={autoplayMyStep}
              />
              <InfluenceBoard state={effectiveState} compact={gameStarted} />
              <OrdersPanel localOrders={localOrders} playerId={playerId} state={effectiveState} />
              <PlayerPanel state={effectiveState} me={me} compact={gameStarted} />
              <AreaPanel area={selected} state={effectiveState} />
              {effectiveState.phase === "advance" && <PieceLegend />}
              <CombatCardsPanel me={me} />
              <LogPanel state={effectiveState} />
            </aside>
          </div>
        </>
      ) : !showMapEditor ? (
        <section className="empty-state">
          <h2>Ready the board</h2>
          <p>Start with dummy AI to create a full configured-player test game instantly, or create an empty lobby for manual testing.</p>
        </section>
      ) : null}
    </main>
  );
}

type BoardProps = {
  currentPlayerKey?: PlayerKey;
  interaction: InteractionMode;
  localOrders: Record<string, Order>;
  localOrderPositions: Record<string, MapPoint>;
  mapDraft: MapEditorDraft;
  orderCursorPreview: boolean;
  patternOpacity: number;
  playerId: string;
  regionBorderWidth: number;
  regionNoise: number;
  regionNameMode: RegionNameMode;
  selectedOrder: Order | null;
  strongRegionBorders: boolean;
  state: GameState;
  selectedArea: string;
  onDismissOrderPicker: () => void;
  onPatternOpacityChange: (opacity: number) => void;
  onOrderCursorPreviewChange: (enabled: boolean) => void;
  onMoveLocalOrder: (from: string, to: string, position?: MapPoint) => void;
  onPlaceOrder: (areaId: string, order: Order, position?: MapPoint) => void;
  onRegionBorderWidthChange: (width: number) => void;
  onRegionNameModeChange: (mode: RegionNameMode) => void;
  onRegionNoiseChange: (intensity: number) => void;
  onRemoveLocalOrder: (areaId: string) => void;
  onSelect: (area: string) => void;
  onSelectOrder: (order: Order | null) => void;
  onStrongRegionBordersChange: (enabled: boolean) => void;
  onUnitSelect: (areaId: string, unit: Unit, index: number) => void;
};

type MapControlsProps = {
  canFocus: boolean;
  patternOpacity: number;
  regionBorderWidth: number;
  regionNoise: number;
  regionNameMode: RegionNameMode;
  orderCursorPreview: boolean;
  strongRegionBorders: boolean;
  onFocus: () => void;
  onOrderCursorPreviewChange: (enabled: boolean) => void;
  onPatternOpacityChange: (opacity: number) => void;
  onRegionBorderWidthChange: (width: number) => void;
  onRegionNameModeChange: (mode: RegionNameMode) => void;
  onRegionNoiseChange: (intensity: number) => void;
  onResetView: () => void;
  onStrongRegionBordersChange: (enabled: boolean) => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
};

type MapPiecesLayerProps = {
  currentPlayerKey?: PlayerKey;
  interaction: InteractionMode;
  localOrders: Record<string, Order>;
  localOrderPositions: Record<string, MapPoint>;
  regionNameMode: RegionNameMode;
  state: GameState;
  visualAreas: VisualMapArea[];
  onOpenOrderMenu: (areaId: string) => void;
  onOrderDragStart: (areaId: string, order: Order) => void;
  onRemoveLocalOrder: (areaId: string) => void;
  onUnitSelect: (areaId: string, unit: Unit, index: number) => void;
};

type MapRegionPiecesProps = Omit<MapPiecesLayerProps, "visualAreas"> & {
  region: VisualMapArea;
};

type MapEditorMode = "paint" | "label" | "units";

type MapEditorArea = {
  id: string;
  colorNoise: {
    hue: number;
    intensity: number;
  };
  isCustom: boolean;
  labelHex: string;
  name: string;
  terrain: MapTerrain;
  unitHexes: string[];
};

type MapEditorDraft = {
  activeAreaId: string;
  areas: Record<string, MapEditorArea>;
  mode: MapEditorMode;
  tileOwners: Record<string, string>;
};

function Board({ currentPlayerKey, interaction, localOrders, localOrderPositions, mapDraft, orderCursorPreview, patternOpacity, playerId, regionBorderWidth, regionNoise, regionNameMode, selectedOrder, strongRegionBorders, state, selectedArea, onDismissOrderPicker, onMoveLocalOrder, onOrderCursorPreviewChange, onPatternOpacityChange, onPlaceOrder, onRegionBorderWidthChange, onRegionNameModeChange, onRegionNoiseChange, onRemoveLocalOrder, onSelect, onSelectOrder, onStrongRegionBordersChange, onUnitSelect }: BoardProps) {
  const [zoom, setZoom] = useState(0.84);
  const [pan, setPan] = useState({ x: 96, y: 42 });
  const [dragStart, setDragStart] = useState<{ x: number; y: number; panX: number; panY: number } | null>(null);
  const [draggedOrder, setDraggedOrder] = useState<Order | null>(null);
  const [draggedFrom, setDraggedFrom] = useState("");
  const [dropTarget, setDropTarget] = useState("");
  const [hoveredArea, setHoveredArea] = useState("");
  const [cursorPoint, setCursorPoint] = useState<MapPoint | null>(null);
  const visualAreas = useMemo(() => buildVisualAreasFromDraft(mapDraft), [mapDraft]);
  const boardVisualAreasById = useMemo(() => Object.fromEntries(visualAreas.map((area) => [area.id, area])) as Record<string, VisualMapArea>, [visualAreas]);
  const selectedRegion = selectedArea ? boardVisualAreasById[selectedArea] : undefined;
  const hoveredRegion = hoveredArea ? boardVisualAreasById[hoveredArea] : undefined;
  const planningTargets = getLegalOrderPlacements(state, playerId).map((placement) => placement.area);
  const noiseScale = regionNoise / 100;
  const spotlightActive = isActionSpotlightActive(state, interaction);
  const resetView = () => {
    setZoom(0.84);
    setPan({ x: 96, y: 42 });
  };
  const clampPan = (nextPan: { x: number; y: number }, nextZoom = zoom) => {
    const slack = 180;
    return {
      x: Math.min(slack, Math.max(1200 - visualMap.width * nextZoom - slack, nextPan.x)),
      y: Math.min(slack, Math.max(900 - visualMap.height * nextZoom - slack, nextPan.y))
    };
  };

  function focusSelected() {
    if (!selectedRegion) return;
    const [x, y] = selectedRegion.label;
    setZoom(1.45);
    setPan({ x: 600 - x * 1.45, y: 430 - y * 1.45 });
  }

  function canDropOrder(areaId: string) {
    return state.phase === "planning" && !!draggedOrder && planningTargets.includes(areaId);
  }

  function mapPointFromEvent(event: MouseEvent<SVGGElement> | DragEvent<SVGGElement>): MapPoint {
    const svg = event.currentTarget.ownerSVGElement;
    if (!svg) return [0, 0];
    return mapPointFromSvgEvent(event, svg);
  }

  function mapPointFromSvgEvent(event: { clientX: number; clientY: number }, svg: SVGSVGElement): MapPoint {
    const point = svg.createSVGPoint();
    point.x = event.clientX;
    point.y = event.clientY;
    const screenMatrix = svg.getScreenCTM();
    if (!screenMatrix) return [0, 0];
    const transformed = point.matrixTransform(screenMatrix.inverse());
    return [(transformed.x - pan.x) / zoom, (transformed.y - pan.y) / zoom];
  }

  return (
    <div
      className="board-engine"
      style={{
        "--terrain-opacity": patternOpacity / 100,
        "--region-outline-width": regionBorderWidth
      } as CSSProperties}
    >
      <div className="board-topbar">
        <div>
          <p className="eyebrow">Interactive Map</p>
          <strong>{selectedArea ? state.areas[selectedArea].name : "Select a territory"}</strong>
          {hoveredRegion && hoveredRegion.id !== selectedArea && <span>{regionDisplayName(hoveredRegion, state)}</span>}
        </div>
        <MapControls
          canFocus={!!selectedRegion}
          patternOpacity={patternOpacity}
          regionBorderWidth={regionBorderWidth}
          regionNoise={regionNoise}
          regionNameMode={regionNameMode}
          orderCursorPreview={orderCursorPreview}
          strongRegionBorders={strongRegionBorders}
          onFocus={focusSelected}
          onOrderCursorPreviewChange={onOrderCursorPreviewChange}
          onPatternOpacityChange={onPatternOpacityChange}
          onRegionBorderWidthChange={onRegionBorderWidthChange}
          onRegionNameModeChange={onRegionNameModeChange}
          onRegionNoiseChange={onRegionNoiseChange}
          onResetView={resetView}
          onStrongRegionBordersChange={onStrongRegionBordersChange}
          onZoomIn={() => setZoom((value) => Math.min(1.8, value + 0.16))}
          onZoomOut={() => setZoom((value) => Math.max(0.62, value - 0.16))}
        />
      </div>

      <svg
        aria-label={gameBundle.ui.boardAriaLabel}
        className="map-svg"
        role="application"
        onClick={onDismissOrderPicker}
        onContextMenu={(event) => {
          if (event.target === event.currentTarget || (event.target as Element).classList.contains("map-ocean")) {
            event.preventDefault();
            onSelectOrder(null);
            onDismissOrderPicker();
          }
        }}
        viewBox={visualMap.viewBox}
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          setDragStart({ x: event.clientX, y: event.clientY, panX: pan.x, panY: pan.y });
        }}
        onPointerMove={(event) => {
          if (selectedOrder && orderCursorPreview) setCursorPoint(mapPointFromSvgEvent(event, event.currentTarget));
          if (!dragStart) return;
          setPan(clampPan({ x: dragStart.panX + event.clientX - dragStart.x, y: dragStart.panY + event.clientY - dragStart.y }));
        }}
        onPointerLeave={() => {
          setDragStart(null);
          setCursorPoint(null);
        }}
        onPointerUp={() => setDragStart(null)}
      >
        <defs>
          <radialGradient id="mapLight" cx="47%" cy="42%" r="70%">
            <stop offset="0%" stopColor="#f2c878" stopOpacity="0.42" />
            <stop offset="58%" stopColor="#20333a" stopOpacity="0.12" />
            <stop offset="100%" stopColor="#000" stopOpacity="0.56" />
          </radialGradient>
          <filter id="regionShadow" x="-20%" y="-20%" width="140%" height="140%">
            <feDropShadow dx="0" dy="10" stdDeviation="10" floodColor="#050505" floodOpacity="0.38" />
          </filter>
          <pattern id="terrainLines" width="24" height="24" patternUnits="userSpaceOnUse" patternTransform="rotate(28)">
            <path d="M 0 0 L 0 24" stroke="rgba(255,255,255,.11)" strokeWidth="2" />
          </pattern>
          <pattern id="snowTexture" width="38" height="38" patternUnits="userSpaceOnUse">
            <path d="M8,10 L14,10 M11,7 L11,13 M28,26 L33,30" stroke="rgba(238,248,255,.2)" strokeWidth="2" strokeLinecap="round" />
          </pattern>
          <pattern id="grassTexture" width="34" height="34" patternUnits="userSpaceOnUse">
            <path d="M6,24 C10,17 14,17 18,24 M22,12 C24,8 28,8 30,12" stroke="rgba(239,219,157,.13)" strokeWidth="2" fill="none" strokeLinecap="round" />
          </pattern>
          <pattern id="rockTexture" width="36" height="36" patternUnits="userSpaceOnUse">
            <path d="M7,24 L15,13 L23,24 Z M24,14 L29,7 L34,14" stroke="rgba(255,222,155,.14)" strokeWidth="2" fill="none" />
          </pattern>
          <pattern id="fieldTexture" width="40" height="40" patternUnits="userSpaceOnUse" patternTransform="rotate(32)">
            <path d="M0,10 L40,10 M0,24 L40,24" stroke="rgba(255,232,166,.13)" strokeWidth="2" />
          </pattern>
          <pattern id="sandTexture" width="42" height="42" patternUnits="userSpaceOnUse">
            <path d="M4,28 C12,22 19,34 28,26 C32,22 36,22 40,24" stroke="rgba(255,224,168,.16)" strokeWidth="2" fill="none" strokeLinecap="round" />
          </pattern>
          <pattern id="waveTexture" width="46" height="32" patternUnits="userSpaceOnUse">
            <path d="M2,11 C8,5 14,17 20,11 S32,17 38,11 M10,25 C16,19 22,31 28,25 S40,31 46,25" stroke="rgba(177,232,248,.18)" strokeWidth="2" fill="none" strokeLinecap="round" />
          </pattern>
        </defs>

        <rect className="map-ocean" width={visualMap.width} height={visualMap.height} rx="18" />
        <g className="map-camera" style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }}>
          <path className="coast-haze" d="M0,196 C180,102 330,34 550,36 C740,38 854,144 1010,174 C1118,194 1180,214 1200,260 L1200,860 L0,860Z" />
          <g className="route-lines">
            {visualAreas.flatMap((region) => (state.areas[region.id]?.adjacent ?? [])
              .filter((target) => region.id < target && boardVisualAreasById[target])
              .map((target) => {
                const next = boardVisualAreasById[target];
                return <line key={`${region.id}-${target}`} x1={region.orderSlot[0]} y1={region.orderSlot[1]} x2={next.orderSlot[0]} y2={next.orderSlot[1]} />;
              }))}
          </g>
          <g className={`regions ${strongRegionBorders ? "strong-borders" : ""}`} filter="url(#regionShadow)">
            {visualAreas.map((region) => {
              const area = state.areas[region.id];
              const isCustomRegion = !area;
              const units = area ? projectedAdvanceUnits(state, interaction, region.id) : [];
              const owner = state.control[region.id] ?? units[0]?.playerKey;
              const order = localOrders[region.id] ?? state.orders[region.id];
              const isSelected = selectedArea === region.id;
              const isHovered = hoveredRegion?.id === region.id;
              const isAdvanceOrigin = isAdvanceInteraction(interaction) && interaction.selectedUnits.length > 0 && interaction.from === region.id;
              const highlight = area ? (state.combat?.area === region.id ? "combat-target" : getAreaHighlight(state, playerId, interaction, region.id)) : "";
              const isDimmed = spotlightActive && area && !highlight && !isSelected && !isHovered;
              const isDragLegal = state.phase === "planning" && !!draggedOrder && planningTargets.includes(region.id);
              const isDropTarget = dropTarget === region.id && canDropOrder(region.id);
              const isLocalOrder = !!localOrders[region.id] && state.phase === "planning";
              const isHiddenOrder = !!order && state.phase === "planning" && !isLocalOrder && !units.some((unit) => unit.playerKey === currentPlayerKey);
              const tooltip = area ? areaTooltip(area, units, order, owner, isHiddenOrder) : regionDisplayName(region, state);
              return (
                <g
                  key={region.id}
                  aria-label={tooltip}
                  className={`territory ${region.type} texture-${terrainTheme[region.terrain]?.texture ?? "none"} ${isCustomRegion ? "custom" : ""} ${isSelected ? "selected" : ""} ${isHovered ? "hovered" : ""} ${isAdvanceOrigin ? "advance-origin" : ""} ${isDimmed ? "dimmed" : ""} ${highlight} ${isDragLegal ? "drag-legal" : ""} ${isDropTarget ? "drop-target" : ""}`}
                  data-area={region.id}
                  style={{
                    "--region-base": climateRegionColor(region),
                    "--region-color-filter": `hue-rotate(${Math.round(region.colorNoise.hue * noiseScale * 0.45)}deg) saturate(${Math.max(65, Math.round(100 + region.colorNoise.saturation * noiseScale * 0.55))}%) brightness(${Math.max(74, Math.round(100 + region.colorNoise.lightness * noiseScale * 0.65))}%)`,
                    "--region-texture-opacity": climateTextureOpacity(region, patternOpacity),
                    "--terrain-fill": terrainTextureFill(region)
                  } as CSSProperties}
                  role={area ? "button" : "img"}
                  tabIndex={area ? 0 : undefined}
                  onBlur={() => setHoveredArea((current) => current === region.id ? "" : current)}
                  onDragEnter={() => {
                    if (area && canDropOrder(region.id)) setDropTarget(region.id);
                  }}
                  onDragLeave={() => {
                    if (dropTarget === region.id) setDropTarget("");
                  }}
                  onDragOver={(event) => {
                    if (!area || !canDropOrder(region.id)) return;
                    event.preventDefault();
                    event.dataTransfer.dropEffect = "copy";
                    setDropTarget(region.id);
                  }}
                  onDrop={(event) => {
                    event.preventDefault();
                    const payload = event.dataTransfer.getData("application/json");
                    const order = payload ? safeParseOrder(payload) : draggedOrder;
                    setDropTarget("");
                    setDraggedOrder(null);
                    if (area && order && planningTargets.includes(region.id)) {
                      if (draggedFrom) onMoveLocalOrder(draggedFrom, region.id, mapPointFromEvent(event));
                      else onPlaceOrder(region.id, order, mapPointFromEvent(event));
                    }
                    setDraggedFrom("");
                  }}
                  onClick={(event) => {
                    event.stopPropagation();
                    if (area && selectedOrder && state.phase === "planning" && planningTargets.includes(region.id)) {
                      onPlaceOrder(region.id, selectedOrder, mapPointFromEvent(event));
                      return;
                    }
                    if (area) onSelect(region.id);
                  }}
                  onFocus={() => setHoveredArea(region.id)}
                  onKeyDown={(event) => {
                    if (area && (event.key === "Enter" || event.key === " ")) onSelect(region.id);
                  }}
                  onPointerEnter={() => setHoveredArea(region.id)}
                  onPointerLeave={() => setHoveredArea((current) => current === region.id ? "" : current)}
                >
                  <title>{tooltip}</title>
                  {region.tiles.map((points, index) => (
                    <polygon key={`${region.id}-border-${index}`} className="territory-border" points={points} />
                  ))}
                  {region.tiles.map((points, index) => (
                    <polygon key={`${region.id}-tile-${index}`} className="territory-tile" points={points} />
                  ))}
                  {region.tiles.map((points, index) => (
                    <polygon key={`${region.id}-texture-${index}`} className="terrain-texture" points={points} />
                  ))}
                  {strongRegionBorders && regionBoundaryLines(region).map((line, index) => (
                    <line
                      key={`${region.id}-outline-${index}`}
                      className={`region-outline ${isSeaSeaBoundary(region, line, visualAreas) ? "sea-sea" : "default"}`}
                      x1={line[0][0]}
                      y1={line[0][1]}
                      x2={line[1][0]}
                      y2={line[1][1]}
                    />
                  ))}
                </g>
              );
            })}
          </g>
          <MapPiecesLayer
            currentPlayerKey={currentPlayerKey}
            interaction={interaction}
            localOrders={localOrders}
            localOrderPositions={localOrderPositions}
            regionNameMode={regionNameMode}
            state={state}
            visualAreas={visualAreas}
            onOpenOrderMenu={(areaId) => onSelect(areaId)}
            onOrderDragStart={(areaId, order) => {
              setDraggedFrom(areaId);
              setDraggedOrder(order);
            }}
            onRemoveLocalOrder={onRemoveLocalOrder}
            onUnitSelect={onUnitSelect}
          />
          {state.phase === "planning" && interaction.type === "placingOrder" && interaction.areaId && boardVisualAreasById[interaction.areaId] && (
            <RadialOrderMenu
              currentOrder={localOrders[interaction.areaId]}
              localOrders={localOrders}
              position={boardVisualAreasById[interaction.areaId].orderSlot}
              specialLimit={currentPlayerKey ? specialOrderLimitFor(state, currentPlayerKey) : 0}
              onChoose={(order) => onPlaceOrder(interaction.areaId!, order)}
              onClose={onDismissOrderPicker}
            />
          )}
          <MapRegionAnchors
            hoveredRegion={state.phase === "planning" ? undefined : hoveredRegion}
            selectedRegion={state.phase === "planning" ? undefined : selectedRegion}
            state={state}
          />
          {selectedOrder && orderCursorPreview && cursorPoint && (
            <g className="cursor-order-preview">
              <SvgOrder local order={selectedOrder} x={cursorPoint[0]} y={cursorPoint[1]} />
            </g>
          )}
        </g>
        <rect className="map-vignette" width={visualMap.width} height={visualMap.height} rx="18" />
      </svg>

      {state.phase === "planning" && (
        <OrderTray
          localOrders={localOrders}
          playerId={playerId}
          selectedOrder={selectedOrder}
          state={state}
          onSelect={onSelectOrder}
          onDragEnd={() => {
            setDraggedOrder(null);
            setDraggedFrom("");
            setDropTarget("");
          }}
          onDragStart={setDraggedOrder}
        />
      )}

      <div className="board-bottombar">
        <span>Drag map to pan</span>
        <span>{selectedOrder ? `Placing ${orderLabel(selectedOrder.kind)}${selectedOrder.special ? " special" : ""}` : "Select a tray token, then click a legal territory"}</span>
        <span>{Math.round(zoom * 100)}%</span>
      </div>
    </div>
  );
}

function MapRegionAnchors({ hoveredRegion, selectedRegion, state }: { hoveredRegion?: VisualMapArea; selectedRegion?: VisualMapArea; state: GameState }) {
  const anchors = [
    selectedRegion && { kind: "selected", region: selectedRegion, label: regionDisplayName(selectedRegion, state) },
    hoveredRegion && hoveredRegion.id !== selectedRegion?.id && { kind: "hovered", region: hoveredRegion, label: regionDisplayName(hoveredRegion, state) }
  ].filter((anchor): anchor is { kind: string; region: VisualMapArea; label: string } => !!anchor);
  return (
    <g className="map-region-anchors">
      {anchors.map(({ kind, region, label }) => (
        <g key={`${kind}-${region.id}`} className={`map-region-anchor ${kind}`} transform={`translate(${region.label[0]} ${region.label[1]})`}>
          <rect x="-74" y="-17" width="148" height="28" rx="8" />
          <text y="2">{label}</text>
        </g>
      ))}
    </g>
  );
}

function MapControls({ canFocus, orderCursorPreview, patternOpacity, regionBorderWidth, regionNoise, regionNameMode, strongRegionBorders, onFocus, onOrderCursorPreviewChange, onPatternOpacityChange, onRegionBorderWidthChange, onRegionNameModeChange, onRegionNoiseChange, onResetView, onStrongRegionBordersChange, onZoomIn, onZoomOut }: MapControlsProps) {
  return (
    <div className="map-controls">
      <button onClick={onZoomOut}>-</button>
      <button onClick={onResetView}>Reset</button>
      <button onClick={onZoomIn}>+</button>
      <button disabled={!canFocus} onClick={onFocus}>Focus</button>
      <details className="map-settings">
        <summary>Map</summary>
        <div className="map-settings-menu">
          <label>
            Names
            <select value={regionNameMode} onChange={(event) => onRegionNameModeChange(event.target.value as RegionNameMode)}>
              {regionNameModeOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>
          <label className="toggle">
            <input checked={strongRegionBorders} onChange={(event) => onStrongRegionBordersChange(event.target.checked)} type="checkbox" />
            Strong borders
          </label>
          <label className="map-slider">
            Border
            <input
              aria-label="Region border width"
              max="10"
              min="2"
              onChange={(event) => onRegionBorderWidthChange(Number(event.target.value))}
              onInput={(event) => onRegionBorderWidthChange(Number(event.currentTarget.value))}
              step="0.2"
              type="range"
              value={regionBorderWidth}
            />
            <span>{regionBorderWidth.toFixed(1)}</span>
          </label>
          <label className="toggle">
            <input checked={orderCursorPreview} onChange={(event) => onOrderCursorPreviewChange(event.target.checked)} type="checkbox" />
            Token follows cursor
          </label>
          <label className="map-slider">
            Pattern
            <input
              aria-label="Pattern opacity"
              max="100"
              min="0"
              onChange={(event) => onPatternOpacityChange(Number(event.target.value))}
              onInput={(event) => onPatternOpacityChange(Number(event.currentTarget.value))}
              type="range"
              value={patternOpacity}
            />
            <span>{patternOpacity}%</span>
          </label>
          <label className="map-slider">
            Noise
            <input
              aria-label="Region color noise intensity"
              max="100"
              min="0"
              onChange={(event) => onRegionNoiseChange(Number(event.target.value))}
              onInput={(event) => onRegionNoiseChange(Number(event.currentTarget.value))}
              type="range"
              value={regionNoise}
            />
            <span>{regionNoise}%</span>
          </label>
        </div>
      </details>
    </div>
  );
}

function MapPiecesLayer({ currentPlayerKey, interaction, localOrders, localOrderPositions, regionNameMode, state, visualAreas, onOpenOrderMenu, onOrderDragStart, onRemoveLocalOrder, onUnitSelect }: MapPiecesLayerProps) {
  return (
    <g className="map-pieces">
      {visualAreas.map((region) => (
        <MapRegionPieces
          key={`${region.id}-pieces`}
          currentPlayerKey={currentPlayerKey}
          interaction={interaction}
          localOrders={localOrders}
          localOrderPositions={localOrderPositions}
          regionNameMode={regionNameMode}
          region={region}
          state={state}
          onOpenOrderMenu={onOpenOrderMenu}
          onOrderDragStart={onOrderDragStart}
          onRemoveLocalOrder={onRemoveLocalOrder}
          onUnitSelect={onUnitSelect}
        />
      ))}
    </g>
  );
}

function MapRegionPieces({ currentPlayerKey, interaction, localOrders, localOrderPositions, region, regionNameMode, state, onOpenOrderMenu, onOrderDragStart, onRemoveLocalOrder, onUnitSelect }: MapRegionPiecesProps) {
  const area = state.areas[region.id];
  const units = area ? projectedAdvanceUnits(state, interaction, region.id) : [];
  const owner = area ? state.control[region.id] ?? units[0]?.playerKey : undefined;
  const order = area ? localOrders[region.id] ?? state.orders[region.id] : undefined;
  const isLocalOrder = !!localOrders[region.id] && state.phase === "planning";
  const isHiddenOrder = !!order && state.phase === "planning" && !isLocalOrder && !units.some((unit) => unit.playerKey === currentPlayerKey);
  const label = regionLabel(region, area, units, order, regionNameMode);
  const orderPosition = localOrderPositions[region.id] ?? region.orderSlot;
  const canPlanHere = state.phase === "planning" && !!currentPlayerKey && units.some((unit) => unit.playerKey === currentPlayerKey);

  return (
    <g style={{ "--playerKey": owner ? playerTheme[owner].color : "#b08b58" } as CSSProperties}>
      {owner && units.length > 0 && <circle className="control-ring" cx={region.unitSlots[0][0]} cy={region.unitSlots[0][1]} r="32" />}
      {label && <TerritoryLabel compact={label.compact} label={label.text} position={region.label} />}
      {area && <FeatureIcons area={area} icons={featureIconsNearLabel(area, region)} fallback={[region.label[0], region.label[1] + 24]} />}
      {area && (
        <SvgUnits
          areaId={region.id}
          interaction={interaction}
          units={units}
          slots={region.unitSlots}
          onUnitSelect={onUnitSelect}
        />
      )}
      {canPlanHere && !order && <OrderAnchorMarker playerKey={currentPlayerKey} position={region.orderSlot} onOpen={() => onOpenOrderMenu(region.id)} />}
      {order && <SvgOrder hidden={isHiddenOrder} local={isLocalOrder} order={order} x={orderPosition[0]} y={orderPosition[1]} onOpen={isLocalOrder ? () => onOpenOrderMenu(region.id) : undefined} onRemove={isLocalOrder ? () => onRemoveLocalOrder(region.id) : undefined} onDragStart={isLocalOrder ? () => onOrderDragStart(region.id, order) : undefined} />}
    </g>
  );
}

function TerritoryLabel({ compact, label, position }: { compact: boolean; label: string; position: MapPoint }) {
  return (
    <>
      <LabelPlate compact={compact} x={position[0]} y={position[1]} label={label} />
      <text className={`territory-label ${compact ? "compact" : ""}`} x={position[0]} y={position[1]}>{label}</text>
    </>
  );
}

function LabelPlate({ compact, x, y, label }: { compact?: boolean; x: number; y: number; label: string }) {
  const width = compact ? Math.max(42, label.length * 13 + 18) : Math.max(82, label.length * 10 + 24);
  return <rect className={`label-plate ${compact ? "compact" : ""}`} x={x - width / 2} y={y - 17} width={width} height="26" rx="8" />;
}

type RegionLabel = {
  compact: boolean;
  text: string;
};

function regionLabel(region: VisualMapArea, area: Area | undefined, units: Unit[], order: Order | undefined, mode: RegionNameMode): RegionLabel | null {
  const name = regionDisplayName(region, area);
  if (mode === "off") return null;
  if (mode === "three") return { compact: true, text: compactRegionLabel(name) };
  if (mode === "full") return { compact: false, text: name };
  if (mode === "important" && !isImportantRegion(area, units, order, region)) return null;
  if (mode === "empty" && !isEmptyRegion(units, order)) return null;
  return { compact: false, text: region.shortLabel ?? name };
}

function regionDisplayName(region: VisualMapArea, source: GameState | Area | undefined) {
  if (source && "areas" in source) return source.areas[region.id]?.name ?? region.displayName ?? region.id;
  return source?.name ?? region.displayName ?? region.id;
}

function compactRegionLabel(name: string) {
  const words = name
    .replace(/['’]/g, "")
    .split(/[^A-Za-z0-9]+/)
    .filter((word) => word && word.toLowerCase() !== "the");
  const [firstWord = name, secondWord] = words;
  const rawCode = secondWord
    ? `${firstWord.slice(0, 2)}${secondWord.slice(0, 1)}`
    : firstWord.slice(0, 3);
  return mergeRepeatedLetters(rawCode.toUpperCase()).padEnd(2, rawCode[0]?.toUpperCase() ?? "?");
}

function mergeRepeatedLetters(label: string) {
  return label.replace(/([A-Z0-9])\1+/g, "$1");
}

function isImportantRegion(area: Area | undefined, units: Unit[], order: Order | undefined, region: VisualMapArea) {
  return !!order || units.length > 0 || !!region.isCustom || !!area?.objective || !!area?.resourceSites || !!area?.capacity;
}

function isEmptyRegion(units: Unit[], order: Order | undefined) {
  return units.length === 0 && !order;
}

function featureIconsNearLabel(area: Area, region: VisualMapArea) {
  const [x, y] = region.label;
  return {
    objective: [x - 34, y + 25] as MapPoint,
    majorObjective: [x - 34, y + 25] as MapPoint,
    resourceSite: [x, y + 25] as MapPoint,
    capacity: [x + (area.resourceSites > 0 ? 34 : 0), y + 25] as MapPoint
  };
}

function loadRegionNameMode(): RegionNameMode {
  const saved = window.localStorage.getItem(showRegionNamesStorageKey);
  if (saved === "true") return "abbreviated";
  if (saved === "false") return "three";
  return regionNameModeOptions.some((option) => option.value === saved) ? saved as RegionNameMode : "abbreviated";
}

function loadNumberSetting(key: string, fallback: number, min: number, max: number) {
  const parsed = Number(window.localStorage.getItem(key));
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
}

function MapEditor({ draft, state, onClose, onDraftChange }: { draft: MapEditorDraft; state: GameState | null; onClose: () => void; onDraftChange: (draft: MapEditorDraft) => void }) {
  const activeArea = draft.areas[draft.activeAreaId] ?? Object.values(draft.areas)[0];
  const activeAreaId = activeArea.id;
  const officialAreas = visualMap.areas.map((area) => area.id);
  const customAreas = Object.values(draft.areas).filter((area) => area.isCustom).map((area) => area.id);
  const areaOptions = [...officialAreas, ...customAreas].filter((id) => draft.areas[id]);

  function updateActiveArea(update: Partial<MapEditorArea>) {
    onDraftChange({
      ...draft,
      areas: {
        ...draft.areas,
        [activeAreaId]: { ...draft.areas[activeAreaId], ...update }
      }
    });
  }

  function updateNoise(update: Partial<MapEditorArea["colorNoise"]>) {
    updateActiveArea({ colorNoise: { ...activeArea.colorNoise, ...update } });
  }

  function addCustomArea() {
    const index = Object.values(draft.areas).filter((area) => area.isCustom).length + 1;
    const id = nextCustomAreaId(draft);
    const firstGreyHex = editorHexTiles.find((tile) => !draft.tileOwners[tile.key]) ?? editorHexTiles[0];
    const nextArea: MapEditorArea = {
      id,
      colorNoise: { hue: 0, intensity: 18 },
      isCustom: true,
      labelHex: firstGreyHex.key,
      name: `New Land ${index}`,
      terrain: mapTerrainTypes.find((terrain) => terrainTheme[terrain]?.areaType === "land") ?? mapTerrainTypes[0],
      unitHexes: []
    };
    onDraftChange({
      ...draft,
      activeAreaId: id,
      areas: { ...draft.areas, [id]: nextArea }
    });
  }

  function handleHexClick(tile: HexTile) {
    if (draft.mode === "label") {
      updateActiveArea({ labelHex: tile.key });
      return;
    }
    if (draft.mode === "units") {
      const unitHexes = activeArea.unitHexes.includes(tile.key)
        ? activeArea.unitHexes.filter((key) => key !== tile.key)
        : [...activeArea.unitHexes, tile.key];
      updateActiveArea({ unitHexes });
      return;
    }
    const tileOwners = { ...draft.tileOwners };
    if (tileOwners[tile.key] === activeAreaId) delete tileOwners[tile.key];
    else tileOwners[tile.key] = activeAreaId;
    onDraftChange({
      ...draft,
      tileOwners
    });
  }

  function resetDraft() {
    onDraftChange(createDefaultMapEditorDraft());
  }

  return (
    <section className="panel map-editor" aria-label="Map editor">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Visual Map Editor</p>
          <h2>Hex Layout</h2>
        </div>
        <div className="editor-actions">
          <button onClick={resetDraft}>Reset</button>
          <button onClick={onClose}>Close</button>
        </div>
      </div>

      <div className="map-editor-layout">
        <aside className="map-editor-controls">
          <label>
            Region
            <select value={activeAreaId} onChange={(event) => onDraftChange({ ...draft, activeAreaId: event.target.value })}>
              {areaOptions.map((areaId) => (
                <option key={areaId} value={areaId}>{editorAreaName(draft.areas[areaId], state)}</option>
              ))}
            </select>
          </label>
          <button onClick={addCustomArea}>New Land</button>

          <div className="segmented">
            {[
              ["paint", "Hexes"],
              ["label", "Name"],
              ["units", "Units"]
            ].map(([mode, label]) => (
              <button
                key={mode}
                className={draft.mode === mode ? "active" : ""}
                onClick={() => onDraftChange({ ...draft, mode: mode as MapEditorMode })}
              >
                {label}
              </button>
            ))}
          </div>

          <label>
            Name
            <input value={activeArea.name} onChange={(event) => updateActiveArea({ name: event.target.value })} />
          </label>
          <label>
            Terrain
            <select value={activeArea.terrain} onChange={(event) => updateActiveArea({ terrain: event.target.value as MapTerrain })}>
              {mapTerrainTypes.map((terrain) => <option key={terrain} value={terrain}>{terrainLabel(terrain)}</option>)}
            </select>
          </label>
          <label className="map-slider editor-slider">
            Hue
            <input max="45" min="-45" onChange={(event) => updateNoise({ hue: Number(event.target.value) })} type="range" value={activeArea.colorNoise.hue} />
            <span>{activeArea.colorNoise.hue}</span>
          </label>
          <label className="map-slider editor-slider">
            Intensity
            <input max="40" min="0" onChange={(event) => updateNoise({ intensity: Number(event.target.value) })} type="range" value={activeArea.colorNoise.intensity} />
            <span>{activeArea.colorNoise.intensity}</span>
          </label>
          <p className="hint">{editorModeHint(draft.mode)}</p>
        </aside>

        <svg className="map-editor-svg" viewBox="0 0 1200 1040" role="application" aria-label="Editable hex map">
          <rect className="map-ocean editor-ocean" width="1200" height="1040" rx="18" />
          <g className="map-editor-hexes">
            {editorHexTiles.map((tile) => {
              const ownerId = draft.tileOwners[tile.key];
              const owner = ownerId ? draft.areas[ownerId] : undefined;
              const isActiveOwner = ownerId === activeAreaId;
              const isLabelHex = activeArea.labelHex === tile.key;
              const unitIndex = activeArea.unitHexes.indexOf(tile.key);
              return (
                <g key={tile.key} className="map-editor-cell" onClick={() => handleHexClick(tile)}>
                  <polygon
                    className={`map-editor-hex ${owner ? owner.terrain : "out"} ${isActiveOwner ? "active-owner" : ""}`}
                    points={tile.points}
                    style={editorHexStyle(owner)}
                  />
                  {isLabelHex && <circle className="editor-label-marker" cx={tile.center[0]} cy={tile.center[1]} r="14" />}
                  {unitIndex >= 0 && (
                    <g className="editor-unit-marker">
                      <circle cx={tile.center[0]} cy={tile.center[1]} r="13" />
                      <text x={tile.center[0]} y={tile.center[1] + 5}>{unitIndex + 1}</text>
                    </g>
                  )}
                </g>
              );
            })}
          </g>
          <g className="map-editor-labels">
            {Object.values(draft.areas).map((area) => {
              const tile = editorHexTiles.find((candidate) => candidate.key === area.labelHex);
              if (!tile || !areaOwnsAnyTile(draft, area.id)) return null;
              return <text key={area.id} x={tile.center[0]} y={tile.center[1]}>{editorAreaName(area, state)}</text>;
            })}
          </g>
        </svg>
      </div>
    </section>
  );
}

function createDefaultMapEditorDraft(): MapEditorDraft {
  const areas = Object.fromEntries(visualMap.areas.map((area) => [area.id, {
    id: area.id,
    colorNoise: { hue: area.colorNoise.hue, intensity: Math.round((Math.abs(area.colorNoise.saturation) + Math.abs(area.colorNoise.lightness)) / 2) },
    isCustom: false,
    labelHex: nearestEditorHex(area.label),
    name: humanizeAreaId(area.id),
    terrain: area.terrain,
    unitHexes: area.unitSlots.map(nearestEditorHex)
  } satisfies MapEditorArea]));
  const tileOwners = Object.fromEntries(editorHexTiles.flatMap((tile) => tile.baseAreaId ? [[tile.key, tile.baseAreaId]] : []));
  return {
    activeAreaId: visualMap.areas[0].id,
    areas,
    mode: "paint",
    tileOwners
  };
}

function loadMapEditorDraft() {
  const fallback = createDefaultMapEditorDraft();
  const saved = window.localStorage.getItem(mapEditorStorageKey);
  if (!saved) return fallback;
  try {
    return { ...fallback, ...JSON.parse(saved) } as MapEditorDraft;
  } catch {
    return fallback;
  }
}

function nearestEditorHex(point: MapPoint) {
  return editorHexTiles.reduce((nearest, tile) => (
    distanceSquared(tile.center, point) < distanceSquared(nearest.center, point) ? tile : nearest
  ), editorHexTiles[0]).key;
}

function distanceSquared(a: MapPoint, b: MapPoint) {
  return (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2;
}

function areaOwnsAnyTile(draft: MapEditorDraft, areaId: string) {
  return Object.values(draft.tileOwners).includes(areaId);
}

function editorAreaName(area: MapEditorArea, state: GameState | null) {
  return area.isCustom ? area.name : state?.areas[area.id]?.name ?? area.name;
}

function editorHexStyle(area?: MapEditorArea): CSSProperties {
  if (!area) return {};
  const brightness = Math.max(72, 100 - Math.round(area.colorNoise.intensity / 2));
  const saturation = 100 + area.colorNoise.intensity;
  return {
    fill: terrainTheme[area.terrain]?.color ?? "#394046",
    "--editor-region-filter": `hue-rotate(${area.colorNoise.hue}deg) saturate(${saturation}%) brightness(${brightness}%)`
  } as CSSProperties;
}

function terrainLabel(terrain: MapTerrain) {
  return terrain[0].toUpperCase() + terrain.slice(1);
}

function humanizeAreaId(id: string) {
  return id.replace(/([A-Z])/g, " $1").replace(/^./, (letter) => letter.toUpperCase());
}

function editorModeHint(mode: MapEditorMode) {
  if (mode === "label") return "Click a hex to make it the name block for the selected region.";
  if (mode === "units") return "Click hexes in preferred order for dropped units. Click again to remove a slot.";
  return "Click hexes to assign them to the selected region, including grey extension hexes at the bottom.";
}

function nextCustomAreaId(draft: MapEditorDraft) {
  let index = 1;
  while (draft.areas[`l${index}`]) index += 1;
  return `l${index}`;
}

function buildEffectiveStateWithMapDraft(state: GameState, draft: MapEditorDraft): GameState {
  const customAreas = Object.fromEntries(Object.values(draft.areas)
    .filter((area) => area.isCustom && areaOwnsAnyTile(draft, area.id))
    .map((area) => [area.id, {
      id: area.id,
      name: area.name,
      type: terrainTheme[area.terrain]?.areaType ?? "land",
      objective: 0,
      resourceSites: 0,
      capacity: 0,
      adjacent: []
    } satisfies Area]));
  if (Object.keys(customAreas).length === 0) return state;

  const adjacency = inferEditorAdjacency(draft);
  const areas = Object.fromEntries(Object.entries({ ...state.areas, ...customAreas }).map(([id, area]) => [
    id,
    { ...area, adjacent: [...new Set([...(area.adjacent ?? []), ...(adjacency[id] ?? [])])].filter((target) => target in state.areas || target in customAreas) }
  ])) as Record<string, Area>;
  const units = { ...state.units };
  for (const id of Object.keys(customAreas)) units[id] ??= [];
  return { ...state, areas, units };
}

function inferEditorAdjacency(draft: MapEditorDraft): Record<string, string[]> {
  const adjacency: Record<string, Set<string>> = {};
  for (const tile of editorHexTiles) {
    const owner = draft.tileOwners[tile.key];
    if (!owner) continue;
    for (const neighborKey of neighboringHexKeys(tile)) {
      const neighborOwner = draft.tileOwners[neighborKey];
      if (!neighborOwner || neighborOwner === owner) continue;
      (adjacency[owner] ??= new Set()).add(neighborOwner);
      (adjacency[neighborOwner] ??= new Set()).add(owner);
    }
  }
  return Object.fromEntries(Object.entries(adjacency).map(([area, targets]) => [area, [...targets]]));
}

function neighboringHexKeys(tile: HexTile) {
  const diagonalColumns = tile.row % 2 === 0 ? [tile.column - 1, tile.column] : [tile.column, tile.column + 1];
  return [
    `${tile.row}:${tile.column - 1}`,
    `${tile.row}:${tile.column + 1}`,
    `${tile.row - 1}:${diagonalColumns[0]}`,
    `${tile.row - 1}:${diagonalColumns[1]}`,
    `${tile.row + 1}:${diagonalColumns[0]}`,
    `${tile.row + 1}:${diagonalColumns[1]}`
  ];
}

function buildVisualAreasFromDraft(draft: MapEditorDraft): VisualMapArea[] {
  const officialAreas = visualMap.areas.map((area) => {
    const edit = draft.areas[area.id];
    if (!edit) return area;
    const ownedTiles = editorHexTiles.filter((tile) => draft.tileOwners[tile.key] === area.id);
    const labelTile = editorHexTiles.find((tile) => tile.key === edit.labelHex);
    const unitSlots = edit.unitHexes
      .map((key) => editorHexTiles.find((tile) => tile.key === key)?.center)
      .filter((point): point is MapPoint => !!point);
    return {
      ...area,
      colorNoise: {
        hue: edit.colorNoise.hue,
        saturation: edit.colorNoise.intensity,
        lightness: -Math.round(edit.colorNoise.intensity / 2)
      },
      label: labelTile?.center ?? area.label,
      terrain: edit.terrain,
      tiles: ownedTiles.length > 0 ? ownedTiles.map((tile) => tile.points) : area.tiles,
      unitSlots: unitSlots.length > 0 ? unitSlots : area.unitSlots
    };
  });
  const customAreas = Object.values(draft.areas)
    .filter((area) => area.isCustom)
    .map((area): VisualMapArea | null => {
      const ownedTiles = editorHexTiles.filter((tile) => draft.tileOwners[tile.key] === area.id);
      const labelTile = editorHexTiles.find((tile) => tile.key === area.labelHex) ?? ownedTiles[0];
      if (!labelTile || ownedTiles.length === 0) return null;
      const unitSlots = area.unitHexes
        .map((key) => editorHexTiles.find((tile) => tile.key === key)?.center)
        .filter((point): point is MapPoint => !!point);
      return {
        id: area.id,
        colorNoise: {
          hue: area.colorNoise.hue,
          saturation: area.colorNoise.intensity,
          lightness: -Math.round(area.colorNoise.intensity / 2)
        },
        displayName: area.name,
        isCustom: true,
        label: labelTile.center,
        orderSlot: labelTile.center,
        shortLabel: area.name,
        terrain: area.terrain,
        type: terrainTheme[area.terrain]?.areaType ?? "land",
        tiles: ownedTiles.map((tile) => tile.points),
        unitSlots: unitSlots.length > 0 ? unitSlots : [labelTile.center]
      };
    })
    .filter((area): area is VisualMapArea => !!area);
  return [...officialAreas, ...customAreas];
}

type Rgb = [number, number, number];

function climateRegionColor(region: VisualMapArea) {
  const local = stableRegionVariation(region.id);
  const base = hexRgb(terrainTheme[region.terrain]?.color ?? "#7c7c72");
  return rgbCss(adjustRgb(base, local.value, local.saturation));
}

function climateTextureOpacity(region: VisualMapArea, patternOpacity: number) {
  const base = patternOpacity / 100;
  if (region.type === "sea") return Math.min(0.42, base * 0.55 + 0.1);
  return Math.min(0.78, Math.max(0.22, base + stableRegionVariation(region.id).texture));
}

function terrainTextureFill(region: VisualMapArea) {
  const texture = terrainTheme[region.terrain]?.texture ?? "none";
  return texture === "none" ? "none" : `url(#${texture}Texture)`;
}

function hexRgb(value: string): Rgb {
  const normalized = value.trim().replace(/^#/, "");
  const expanded = normalized.length === 3 ? normalized.split("").map((part) => part + part).join("") : normalized;
  if (!/^[0-9a-f]{6}$/i.test(expanded)) return [124, 124, 114];
  return [Number.parseInt(expanded.slice(0, 2), 16), Number.parseInt(expanded.slice(2, 4), 16), Number.parseInt(expanded.slice(4, 6), 16)];
}

function stableRegionVariation(id: string) {
  let hash = 0;
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return {
    saturation: (hash % 17) - 8,
    texture: ((hash >> 4) % 13 - 6) / 100,
    value: ((hash >> 8) % 19) - 9
  };
}

function mixRgb(a: Rgb, b: Rgb, amount: number): Rgb {
  const t = clamp01(amount);
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t)
  ];
}

function adjustRgb(color: Rgb, value: number, saturation: number): Rgb {
  const average = (color[0] + color[1] + color[2]) / 3;
  const sat = 1 + saturation / 100;
  return color.map((channel) => clampColor((average + (channel - average) * sat) + value)) as Rgb;
}

function rgbCss(color: Rgb) {
  return `rgb(${color[0]} ${color[1]} ${color[2]})`;
}

function clampColor(value: number) {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
}

function regionBoundaryLines(region: VisualMapArea): Array<[MapPoint, MapPoint]> {
  const edges = new Map<string, [MapPoint, MapPoint]>();
  const counts = new Map<string, number>();
  for (const points of region.tiles) {
    const vertices = parsePolygonPoints(points);
    vertices.forEach((start, index) => {
      const end = vertices[(index + 1) % vertices.length];
      const key = edgeKey(start, end);
      counts.set(key, (counts.get(key) ?? 0) + 1);
      edges.set(key, [start, end]);
    });
  }
  return [...edges.entries()].flatMap(([key, edge]) => counts.get(key) === 1 ? [edge] : []);
}

function isSeaSeaBoundary(region: VisualMapArea, line: [MapPoint, MapPoint], regions: VisualMapArea[]) {
  if (region.terrain !== "sea") return false;
  const key = edgeKey(line[0], line[1]);
  return regions.some((candidate) => (
    candidate.id !== region.id &&
    candidate.terrain === "sea" &&
    candidate.tiles.some((points) => {
      const vertices = parsePolygonPoints(points);
      return vertices.some((start, index) => edgeKey(start, vertices[(index + 1) % vertices.length]) === key);
    })
  ));
}

function parsePolygonPoints(points: string): MapPoint[] {
  return points.split(" ").map((point) => {
    const [x, y] = point.split(",").map(Number);
    return [x, y] as MapPoint;
  });
}

function edgeKey(a: MapPoint, b: MapPoint) {
  const first = `${a[0]},${a[1]}`;
  const second = `${b[0]},${b[1]}`;
  return first < second ? `${first}|${second}` : `${second}|${first}`;
}

function OrderTray({ localOrders, playerId, selectedOrder, state, onDragEnd, onDragStart, onSelect }: {
  localOrders: Record<string, Order>;
  playerId: string;
  selectedOrder: Order | null;
  state: GameState;
  onDragEnd: () => void;
  onDragStart: (order: Order) => void;
  onSelect: (order: Order | null) => void;
}) {
  const player = state.players.find((candidate) => candidate.id === playerId);
  const enabled = !!player && state.pending?.playerKey === player.playerKey;
  const specialLimit = player ? specialOrderLimitFor(state, player.playerKey) : 0;
  const usedSpecial = Object.values(localOrders).filter((order) => order.special).length;
  return (
    <aside className="order-tray" aria-label="Available order tokens">
      <div className="tray-heading">
        <p className="eyebrow">Orders</p>
        <strong>{usedSpecial}/{specialLimit} special</strong>
      </div>
      <div className="special-meter" aria-label={`${usedSpecial} of ${specialLimit} special orders used`}>
        {Array.from({ length: Math.max(1, specialLimit) }, (_, index) => (
          <span key={index} className={index < usedSpecial ? "used" : ""} />
        ))}
      </div>
      {orderKinds.map((kind) => {
        const normalToken = orderTokenPool.find((token) => token.order.kind === kind && !token.order.special);
        const specialToken = orderTokenPool.find((token) => token.order.kind === kind && token.order.special);
        if (!normalToken) return null;
        const normalUsed = countOrder(localOrders, normalToken.order);
        const normalRemaining = Math.max(0, normalToken.count - normalUsed);
        const normalSelected = ordersEqual(selectedOrder, normalToken.order);
        const normalDisabled = !enabled || normalRemaining <= 0;
        const specialUsed = specialToken ? countOrder(localOrders, specialToken.order) : 0;
        const specialRemaining = specialToken ? Math.max(0, specialToken.count - specialUsed) : 0;
        const specialSelected = ordersEqual(selectedOrder, specialToken?.order);
        const specialBlocked = !!specialToken && usedSpecial >= specialLimit && !specialSelected;
        const specialDisabled = !enabled || !specialToken || specialRemaining <= 0 || specialBlocked;
        return (
          <div key={kind} className="tray-group">
            <span className="tray-group-label">{orderShortLabel(kind)}</span>
            <div className="tray-token-row">
              <button
                className={`tray-token ${kind} ${normalSelected ? "selected" : ""}`}
                disabled={normalDisabled}
                draggable={!normalDisabled}
                onDragEnd={onDragEnd}
                onDragStart={(event) => {
                  event.dataTransfer.setData("application/json", JSON.stringify(normalToken.order));
                  event.dataTransfer.effectAllowed = "copy";
                  onDragStart(normalToken.order);
                }}
                onClick={() => onSelect(normalSelected ? null : normalToken.order)}
                title={`${orderLabel(kind)}${normalToken.modifier ? ` ${normalToken.modifier}` : ""}: ${normalRemaining} remaining`}
              >
                <span className="tray-token-stack" aria-hidden="true">
                  {Array.from({ length: Math.max(1, normalRemaining) }, (_, index) => (
                    <span key={index} style={{ "--stack-index": index } as CSSProperties} />
                  ))}
                </span>
                <span className="tray-token-art">
                  <svg viewBox="-24 -24 48 48" aria-hidden="true"><OrderIcon kind={kind} /></svg>
                  {normalToken.modifier && <b>{normalToken.modifier}</b>}
                </span>
                <span className="token-meta">
                  <small>x{normalRemaining}</small>
                </span>
              </button>
              {specialToken && (
                <button
                  className={`buffed-option ${specialSelected ? "selected" : ""}`}
                  disabled={specialDisabled}
                  draggable={!specialDisabled}
                  onDragEnd={onDragEnd}
                  onDragStart={(event) => {
                    event.dataTransfer.setData("application/json", JSON.stringify(specialToken.order));
                    event.dataTransfer.effectAllowed = "copy";
                    onDragStart(specialToken.order);
                  }}
                  onClick={() => onSelect(specialSelected ? null : specialToken.order)}
                  title={`Buffed ${orderLabel(kind)}${specialToken.modifier ? ` ${specialToken.modifier}` : ""}: ${specialRemaining} remaining`}
                >
                  <span className="buffed-stack" aria-hidden="true">
                    {Array.from({ length: Math.max(1, specialRemaining) }, (_, index) => (
                      <span key={index} style={{ "--stack-index": index } as CSSProperties} />
                    ))}
                  </span>
                  <svg viewBox="-24 -24 48 48" aria-hidden="true"><OrderIcon kind={kind} special /></svg>
                  {specialToken.modifier && <b>{specialToken.modifier}</b>}
                </button>
              )}
            </div>
          </div>
        );
      })}
    </aside>
  );
}

function PieceLegend() {
  return (
    <details className="panel compact-panel piece-legend">
      <summary className="panel-heading">
        <p className="eyebrow">Pieces</p>
        <h2>Legend</h2>
      </summary>
      <div className="legend-grid">
        {unitTypes.map((type) => (
          <span key={type}>
            <svg viewBox="-18 -18 36 36" aria-hidden="true"><UnitIcon type={type} /></svg>
            {unitLabel(type)}
          </span>
        ))}
      </div>
      <a className="tool-link compact-tool-link" href="#icon-designer">Icon Designer</a>
    </details>
  );
}

function IconDesigner({ onClose }: { onClose: () => void }) {
  const [selectedTarget, setSelectedTarget] = useState<EditableIconTarget>({ group: "units", key: "infantry", label: unitLabel("infantry") });
  const [designs, setDesigns] = useState(loadIconDesigns);
  const [history, setHistory] = useState<IconDesignLibrary[]>([]);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [saved, setSaved] = useState(false);
  const [importMessage, setImportMessage] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const design = getEditableIconDesign(designs, selectedTarget);
  const targetGroups: Array<{ group: EditableIconTarget["group"]; label: string; targets: EditableIconTarget[] }> = [
    { group: "units", label: "Units", targets: unitTypes.map((key) => ({ group: "units", key, label: unitLabel(key) })) },
    { group: "orders", label: "Action Tokens", targets: orderKinds.map((key) => ({ group: "orders", key, label: orderLabel(key) })) },
    { group: "board", label: "Map & Tracks", targets: boardIconKinds.map((key) => ({ group: "board", key, label: boardIconLabel(key) })) }
  ];

  function remmihr() {
    setHistory((entries) => [...entries, cloneIconDesignLibrary(designs)]);
  }

  function updateSelected(next: IconDesign) {
    setSaved(false);
    setDesigns((current) => setEditableIconDesign(current, selectedTarget, next));
  }

  function updatePrimaryShape(next: IconDesign) {
    const shapes = design.shapes?.length
      ? [{ ...design.shapes[0], points: next.points, closed: next.closed }, ...design.shapes.slice(1)]
      : undefined;
    updateSelected({ ...next, shapes });
  }

  function save() {
    window.localStorage.setItem(unitIconStorageKey, JSON.stringify(designs.units));
    window.localStorage.setItem(orderIconStorageKey, JSON.stringify(designs.orders));
    window.localStorage.setItem(boardIconStorageKey, JSON.stringify(designs.board));
    window.dispatchEvent(new Event(unitIconVersionEvent));
    setSaved(true);
  }

  function resetSelected() {
    remmihr();
    const defaultDesign = selectedTarget.group === "units"
      ? defaultUnitIconDesigns[selectedTarget.key]
      : selectedTarget.group === "orders"
        ? defaultOrderIconDesigns[selectedTarget.key]
        : defaultBoardIconDesigns[selectedTarget.key];
    updateSelected(cloneIconDesign(defaultDesign));
  }

  function clearSelected() {
    remmihr();
    updateSelected({ closed: design.closed, points: [] });
  }

  function undo() {
    setHistory((entries) => {
      const previous = entries.at(-1);
      if (!previous) return entries;
      setDesigns(previous);
      return entries.slice(0, -1);
    });
  }

  async function importFromClipboard() {
    try {
      const clipboardText = await navigator.clipboard.readText();
      const imported = parseClipboardIcon(clipboardText);
      remmihr();
      updateSelected(imported);
      setImportMessage({
        kind: "success",
        text: imported.shapes ? `Imported ${imported.shapes.length} shapes` : `Imported ${imported.points.length} points`
      });
    } catch (error) {
      setImportMessage({
        kind: "error",
        text: error instanceof Error ? error.message : "Could not read an SVG path from the clipboard."
      });
    }
  }

  function addPoint(event: PointerEvent<SVGSVGElement>) {
    remmihr();
    updatePrimaryShape({ ...design, points: [...design.points, pointerToIconPoint(event)] });
  }

  function movePoint(event: PointerEvent<SVGSVGElement>) {
    if (dragIndex === null) return;
    const nextPoints = design.points.map((point, index) => index === dragIndex ? pointerToIconPoint(event) : point);
    updatePrimaryShape({ ...design, points: nextPoints });
  }

  const previewPath = design.shapes?.length
    ? design.shapes.map(iconDesignToPath).join("\n")
    : iconDesignToPath(design);

  return (
    <section id="icon-designer" className="panel icon-designer" aria-label="Icon designer">
      <div className="panel-heading designer-heading">
        <p className="eyebrow">Tool</p>
        <h2>Icon Designer</h2>
        <button onClick={onClose} aria-label="Close icon designer">Close</button>
      </div>
      <div className="designer-shell">
        <aside className="designer-list" aria-label="Unit icons">
          {targetGroups.map((group) => (
            <div key={group.group} className="designer-target-group">
              <strong>{group.label}</strong>
              {group.targets.map((target) => (
                <button
                  key={`${target.group}-${target.key}`}
                  className={selectedTarget.group === target.group && selectedTarget.key === target.key ? "selected" : ""}
                  onClick={() => setSelectedTarget(target)}
                >
                  <svg viewBox="-18 -18 36 36" aria-hidden="true">
                    <IconDesignPaths design={getEditableIconDesign(designs, target)} />
                  </svg>
                  <span>{target.label}</span>
                </button>
              ))}
            </div>
          ))}
        </aside>
        <div className="designer-stage">
          <svg
            className="point-canvas"
            viewBox="-20 -20 40 40"
            onPointerDown={addPoint}
            onPointerMove={movePoint}
            onPointerUp={() => setDragIndex(null)}
            onPointerLeave={() => setDragIndex(null)}
          >
            <defs>
              <pattern id="iconGrid" width="4" height="4" patternUnits="userSpaceOnUse">
                <path d="M4,0 L0,0 L0,4" />
              </pattern>
            </defs>
            <rect x="-20" y="-20" width="40" height="40" />
            <rect className="designer-grid" x="-20" y="-20" width="40" height="40" />
            <path className="designer-axis" d="M-20,0 L20,0 M0,-20 L0,20" />
            <g className="designer-path"><IconDesignPaths design={design} /></g>
            {design.points.map((point, index) => (
              <circle
                key={`${index}-${point[0]}-${point[1]}`}
                className="designer-point"
                cx={point[0]}
                cy={point[1]}
                r="1.35"
                onPointerDown={(event) => {
                  event.stopPropagation();
                  remmihr();
                  setDragIndex(index);
                }}
              />
            ))}
          </svg>
          <div className="designer-preview">
            <svg viewBox="-24 -24 48 48" aria-hidden="true">
              <circle r="18" />
              <IconDesignPaths design={design} />
            </svg>
            <span>{selectedTarget.label}</span>
          </div>
        </div>
        <aside className="designer-controls" aria-label="Icon controls">
          <label className="toggle">
            <input
              checked={design.closed}
              onChange={(event) => {
                remmihr();
                updatePrimaryShape({ ...design, closed: event.target.checked });
              }}
              type="checkbox"
            />
            Closed shape
          </label>
          <button onClick={undo} disabled={history.length === 0}>Undo</button>
          <button onClick={importFromClipboard}>Import from Clipboard</button>
          {importMessage && <span className={`designer-import-message ${importMessage.kind}`}>{importMessage.text}</span>}
          <button onClick={clearSelected} disabled={design.points.length === 0}>Clear</button>
          <button onClick={resetSelected}>Reset</button>
          <button className="primary" onClick={save}>Save</button>
          {saved && <span className="designer-saved">Saved</span>}
          <textarea readOnly value={previewPath} aria-label="SVG path" />
        </aside>
      </div>
    </section>
  );
}

function FeatureIcons({ area, icons, fallback }: { area: Area; icons?: { objective?: MapPoint; majorObjective?: MapPoint; resourceSite?: MapPoint; capacity?: MapPoint }; fallback: MapPoint }) {
  const objective = area.objective === 2 ? icons?.majorObjective : icons?.objective;
  const resourceSite = icons?.resourceSite;
  const capacity = icons?.capacity;
  const resourceSiteCount = Math.min(area.resourceSites, 3);
  const capacityCount = Math.min(area.capacity, 3);
  return (
    <g className="feature-icons">
      {area.objective > 0 && (
        <g className="feature-marker objective-marker" transform={`translate(${objective?.[0] ?? fallback[0] - 28} ${objective?.[1] ?? fallback[1]})`}>
          <FeatureIcon kind={area.objective === 2 ? "majorObjective" : "objective"} />
        </g>
      )}
      {Array.from({ length: resourceSiteCount }, (_, index) => (
        <g key={`resourceSite-${index}`} className="feature-marker resourceSite-marker" transform={`translate(${(resourceSite?.[0] ?? fallback[0]) + index * 15 - (resourceSiteCount - 1) * 7.5} ${resourceSite?.[1] ?? fallback[1]})`}>
          <FeatureIcon kind="resourceSite" />
        </g>
      ))}
      {Array.from({ length: capacityCount }, (_, index) => (
        <g key={`capacity-${index}`} className="feature-marker capacity-marker" transform={`translate(${(capacity?.[0] ?? fallback[0] + 26) + index * 15 - (capacityCount - 1) * 7.5} ${capacity?.[1] ?? fallback[1]})`}>
          <FeatureIcon kind="capacity" />
        </g>
      ))}
    </g>
  );
}

function FeatureIcon({ kind }: { kind: "majorObjective" | "objective" | "resourceSite" | "capacity" }) {
  return <IconDesignPaths design={getBoardIconDesign(kind)} />;
}

function SvgUnits({ areaId, interaction, units, slots, onUnitSelect }: {
  areaId: string;
  interaction: InteractionMode;
  units: Unit[];
  slots: MapPoint[];
  onUnitSelect: (areaId: string, unit: Unit, index: number) => void;
}) {
  const isAdvanceSource = (interaction.type === "selectingUnits" || interaction.type === "selectingAdvanceDestination") && interaction.from === areaId;
  const selectedUnits = isAdvanceSource ? interaction.selectedUnits : [];
  const radius = isAdvanceSource ? 24 : 16;
  const [centerX, centerY] = slots[0];
  return (
    <g className={`svg-units ${isAdvanceSource ? "expanded" : ""}`}>
      {units.map((unit, index) => {
        const selected = isUnitSelected(selectedUnits, unit.type, index);
        const assigned = isUnitAssignedToAdvance(interaction, areaId, unit.type, index);
        const slot = slots[index % slots.length];
        const x = isAdvanceSource
          ? centerX + Math.cos((Math.PI * 2 * index) / Math.max(units.length, 1) - Math.PI / 2) * 56
          : slot[0];
        const y = isAdvanceSource
          ? centerY + Math.sin((Math.PI * 2 * index) / Math.max(units.length, 1) - Math.PI / 2) * 42 - (selected ? 16 : 0)
          : slot[1];
        return (
          <g
            key={`${unit.playerKey}-${unit.type}-${index}`}
            className={`unit-token ${isAdvanceSource && !assigned ? "selectable" : ""} ${selected ? "selected" : ""} ${assigned ? "assigned" : ""}`}
            onClick={(event) => {
              if (!isAdvanceSource || assigned) return;
              event.stopPropagation();
              onUnitSelect(areaId, unit, index);
            }}
            onPointerDown={(event) => {
              if (isAdvanceSource) event.stopPropagation();
            }}
            style={{ "--playerKey": playerTheme[unit.playerKey].color } as CSSProperties}
          >
            <circle className="unit-hitbox" cx={x} cy={y} r={radius + 11} />
            <circle cx={x} cy={y} r={radius} />
            <g className="unit-icon" transform={`translate(${x} ${y}) scale(${radius / 18})`}>
              <UnitIcon type={unit.type} />
            </g>
          </g>
        );
      })}
    </g>
  );
}

function UnitIcon({ type }: { type: UnitType }) {
  return <IconDesignPaths design={getUnitIconDesign(type)} />;
}

function OrderAnchorMarker({ playerKey, position, onOpen }: { playerKey: PlayerKey; position: MapPoint; onOpen: () => void }) {
  return (
    <g className="order-anchor-marker" role="button" aria-label={`Choose order for ${playerTheme[playerKey].label}`} tabIndex={0} transform={`translate(${position[0]} ${position[1]})`} onClick={(event) => { event.stopPropagation(); onOpen(); }} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onOpen(); } }}>
      <circle className="order-anchor-hitbox" r="25" />
      <circle className="order-anchor-disc" r="14" />
      <text y="5">{playerTheme[playerKey].sigil}</text>
    </g>
  );
}

function RadialOrderMenu({ currentOrder, localOrders, position, specialLimit, onChoose, onClose }: { currentOrder?: Order; localOrders: Record<string, Order>; position: MapPoint; specialLimit: number; onChoose: (order: Order) => void; onClose: () => void }) {
  const radius = 72;
  const center: MapPoint = [Math.min(visualMap.width - 94, Math.max(94, position[0])), Math.min(visualMap.height - 94, Math.max(94, position[1]))];
  return (
    <g className="radial-order-menu" role="menu" aria-label="Choose an order" onClick={(event) => event.stopPropagation()}>
      <circle className="radial-menu-backdrop" cx={center[0]} cy={center[1]} r="91" />
      {orderFamilies.map((family) => {
        const radians = family.angle * Math.PI / 180;
        const x = center[0] + Math.cos(radians) * radius;
        const y = center[1] + Math.sin(radians) * radius;
        const available = family.variants.find((variant) => canUseOrder(localOrders, variant.order, specialLimit, currentOrder ? Object.keys(localOrders).find((area) => localOrders[area] === currentOrder) : undefined));
        const order = currentOrder?.kind === family.kind ? currentOrder : available?.order ?? family.variants[0].order;
        const disabled = !available && currentOrder?.kind !== family.kind;
        return (
          <g key={family.kind} className={`radial-order-action ${family.kind} ${disabled ? "disabled" : ""} ${currentOrder?.kind === family.kind ? "current" : ""}`} role="menuitem" aria-disabled={disabled} aria-label={`${family.label}, shortcut ${family.shortcut}`} tabIndex={disabled ? -1 : 0} transform={`translate(${x} ${y})`} onClick={() => { if (!disabled) { onChoose(order); onClose(); } }} onKeyDown={(event) => { if (!disabled && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); onChoose(order); onClose(); } }}>
            <title>{family.label} ({family.shortcut})</title>
            <circle r="25" />
            <g className="order-icon"><OrderIcon kind={family.kind} special={order.special} /></g>
            <text className="radial-shortcut" x="18" y="20">{family.shortcut}</text>
          </g>
        );
      })}
      <g className="radial-close" role="button" aria-label="Close order menu" tabIndex={0} transform={`translate(${center[0]} ${center[1]})`} onClick={onClose} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") onClose(); }}><circle r="18" /><text y="5">×</text></g>
    </g>
  );
}

function SvgOrder({ hidden, local, order, x, y, onOpen, onRemove, onDragStart }: { hidden?: boolean; local?: boolean; order: Order; x: number; y: number; onOpen?: () => void; onRemove?: () => void; onDragStart?: () => void }) {
  return (
    <g
      className={`svg-order ${order.kind} ${hidden ? "hidden-order" : ""} ${local ? "local-order" : ""}`}
      {...(onDragStart ? { draggable: "true" } : {})}
      onClick={(event) => {
        if (!onOpen) return;
        event.stopPropagation();
        onOpen();
      }}
      onContextMenu={(event) => { if (onRemove) { event.preventDefault(); event.stopPropagation(); onRemove(); } }}
      onDragStart={(event) => { if (onDragStart) { event.dataTransfer.setData("application/json", JSON.stringify(order)); event.dataTransfer.effectAllowed = "move"; onDragStart(); } }}
      onPointerDown={(event) => {
        if (onOpen) event.stopPropagation();
      }}
    >
      <circle cx={x} cy={y} r="24" />
      {hidden ? <FaceDownIcon x={x} y={y} /> : (
        <g className="order-icon" transform={`translate(${x} ${y})`}>
          <OrderIcon kind={order.kind} special={order.special} />
        </g>
      )}
      {!hidden && orderModifierLabel(order) && (
        <g className="modifier-badge" transform={`translate(${x + 17} ${y + 17})`}>
          <circle r="9" />
          <text y="4">{orderModifierLabel(order)}</text>
        </g>
      )}
    </g>
  );
}

function FaceDownIcon({ x, y }: { x: number; y: number }) {
  return (
    <g className="facedown-icon" transform={`translate(${x} ${y})`}>
      <IconDesignPaths design={getBoardIconDesign("facedown")} />
    </g>
  );
}

function OrderIcon({ kind, special }: { kind: OrderKind; special?: boolean }) {
  return (
    <>
      <IconDesignPaths design={getOrderIconDesign(kind)} />
      {special && <g className="special-star"><IconDesignPaths design={getBoardIconDesign("special")} /></g>}
    </>
  );
}

function LegacyBoard({ state, selectedArea, onSelect }: { state: GameState; selectedArea: string; onSelect: (area: string) => void }) {
  return (
    <div className="legacy-board">
      {Object.values(state.areas).map((area) => {
        const units = state.units[area.id] ?? [];
        const owner = state.control[area.id] ?? units[0]?.playerKey;
        const order = state.orders[area.id];
        const isSelected = selectedArea === area.id;
        return (
          <button
            key={area.id}
            className={`area-card ${area.type} ${isSelected ? "selected" : ""}`}
            onClick={() => onSelect(area.id)}
            style={{ "--playerKey": owner ? playerTheme[owner].color : "#8a745d" } as CSSProperties}
          >
            <span className="area-glow" />
            <span className="area-topline">
              <strong>{area.name}</strong>
              {area.objective > 0 && <span className="objective">{area.objective === 2 ? gameBundle.ui.features.majorObjective : gameBundle.ui.features.objective}</span>}
            </span>
            <span className="tokens">
              {area.resourceSites > 0 && <span>{area.resourceSites} {gameBundle.ui.features.resource.toLowerCase()}</span>}
              {area.capacity > 0 && <span>{area.capacity} {gameBundle.ui.features.capacity.toLowerCase()}</span>}
              {area.type === "sea" && <span>sea</span>}
            </span>
            <UnitStack units={units} />
            {order && <span className={`order ${order.kind}`}>{order.special ? "Special " : ""}{order.kind}</span>}
          </button>
        );
      })}
    </div>
  );
}

function UnitStack({ units }: { units: Unit[] }) {
  if (units.length === 0) return <span className="empty-area">Unoccupied</span>;
  return (
    <span className="unit-stack">
      {units.map((unit, index) => (
        <span key={`${unit.playerKey}-${unit.type}-${index}`} className="unit" style={{ "--playerKey": playerTheme[unit.playerKey].color } as CSSProperties}>
          <span>{playerTheme[unit.playerKey].sigil}</span>
          {unitLabel(unit.type)}
        </span>
      ))}
    </span>
  );
}

function InfluenceBoard({ compact, state }: { compact?: boolean; state: GameState }) {
  const active = new Set(state.players.map((player) => player.playerKey));
  const tracks = [
    {
      id: "turnOrder",
      label: gameBundle.ui.tracks.turnOrder,
      note: "Turn order",
      playerKeys: state.tracks.turnOrder,
      icon: "initiative"
    },
    {
      id: "combatOrder",
      label: gameBundle.ui.tracks.combatOrder,
      note: "Combat ties",
      playerKeys: state.tracks.combatOrder,
      icon: "combat"
    },
    {
      id: "specialOrderOrder",
      label: gameBundle.ui.tracks.specialOrderOrder,
      note: "Special orders",
      playerKeys: state.tracks.specialOrderOrder,
      icon: "orders"
    }
  ] as const;

  const content = (
    <div className="influence-table">
      {tracks.map((track) => (
        <div key={track.id} className="influence-row">
          <div className="influence-track-label">
            <span className="influence-track-icon" aria-hidden="true">
              <InfluenceIcon kind={track.icon} />
            </span>
            <span>
              <strong>{track.label}</strong>
              <small>{track.note}</small>
            </span>
          </div>
          <div className="influence-slots">
            {track.playerKeys.map((playerKey, index) => (
              <span
                key={playerKey}
                className={`influence-token ${active.has(playerKey) ? "active" : "inactive"} ${index === 0 ? "leader" : ""}`}
                style={{ "--playerKey": playerTheme[playerKey].color } as CSSProperties}
                title={`${index + 1}. ${playerTheme[playerKey].label} - ${track.label}`}
              >
                <b>{playerTheme[playerKey].sigil}</b>
                <em>{index + 1}</em>
              </span>
            ))}
          </div>
        </div>
      ))}
    </div>
  );

  if (compact) {
    return (
      <details className="panel compact-panel influence-board compact-side-panel">
        <summary className="panel-heading influence-heading">
          <p className="eyebrow">Influence</p>
          <h2>Resource Tracks</h2>
        </summary>
        {content}
      </details>
    );
  }

  return (
    <section className="panel influence-board" aria-label="Influence board">
      <div className="panel-heading influence-heading">
        <p className="eyebrow">Influence</p>
        <h2>Resource Tracks</h2>
      </div>
      {content}
    </section>
  );
}

function InfluenceIcon({ kind }: { kind: "initiative" | "combat" | "orders" }) {
  return (
    <svg viewBox="-16 -16 32 32" aria-hidden="true">
      <IconDesignPaths design={getBoardIconDesign(kind)} />
    </svg>
  );
}

function PlayerPanel({ compact, state, me }: { compact?: boolean; state: GameState; me?: GameState["players"][number] }) {
  const content = (
    <div className="playerKey-list">
      {state.players.map((player) => (
        <div key={player.id} className="playerKey-row" style={{ "--playerKey": playerTheme[player.playerKey].color } as CSSProperties}>
          <span className="sigil">{playerTheme[player.playerKey].sigil}</span>
          <div>
            <strong>{playerTheme[player.playerKey].label}</strong>
            <span>{player.name}{player.id.startsWith("ai-") ? " - dummy AI" : ""}</span>
          </div>
          <b>{state.tracks.score[player.playerKey]}</b>
        </div>
      ))}
    </div>
  );

  if (compact) {
    return (
      <details className="panel compact-panel scoreboard-panel compact-side-panel">
        <summary className="panel-heading">
          <p className="eyebrow">{gameBundle.ui.playerPlural}</p>
          <h2>{me ? playerTheme[me.playerKey].label : gameBundle.ui.playerPlural}</h2>
        </summary>
        {content}
      </details>
    );
  }

  return (
    <section className="panel scoreboard-panel">
      <div className="panel-heading">
        <p className="eyebrow">{gameBundle.ui.playerPlural}</p>
        <h2>{me ? `You are ${playerTheme[me.playerKey].label}` : "Lobby"}</h2>
      </div>
      {content}
    </section>
  );
}

function OrdersPanel({ localOrders, playerId, state }: { localOrders: Record<string, Order>; playerId: string; state: GameState }) {
  const player = state.players.find((candidate) => candidate.id === playerId);
  const specialLimit = player ? specialOrderLimitFor(state, player.playerKey) : 0;
  const usedSpecial = Object.values(localOrders).filter((order) => order.special).length;
  const placements = getLegalOrderPlacements(state, playerId);
  const placed = placements.filter((placement) => localOrders[placement.area]).length;
  return (
    <details className="panel compact-panel orders-card" open={state.phase === "planning"}>
      <summary className="panel-heading">
        <p className="eyebrow">Orders</p>
        <h2>{state.phase === "planning" ? `${placed}/${placements.length} drafted` : "Tray"}</h2>
      </summary>
      <div className="order-progress">
        <strong>{placed}/{placements.length}</strong>
        <span>orders placed</span>
      </div>
      <div className="special-line">
        <span>Special orders</span>
        <strong>{usedSpecial}/{specialLimit}</strong>
      </div>
      <p className="hint">Use the physical tray on the board. Drag a token onto a highlighted territory, or click a token then click a territory.</p>
    </details>
  );
}

function commandHint(state: GameState, playerId: string, interaction: InteractionMode, localOrders: Record<string, Order>): string {
  if (!state.pending) return state.winner ? `${playerTheme[state.winner].label} wins.` : "No active command.";
  const actor = playerTheme[state.pending.playerKey].label;
  if (state.phase === "planning") {
    const placements = getLegalOrderPlacements(state, playerId);
    const missing = placements.filter((placement) => !localOrders[placement.area]).length;
    return `${actor} must assign hidden orders. ${missing} territor${missing === 1 ? "y needs" : "ies need"} a token.`;
  }
  if (state.phase === "disrupt") {
    if (interaction.type === "selectingDisruptTarget") return `${actor} is disrupting from ${state.areas[interaction.from].name}. Choose a highlighted target order.`;
    return `${actor} may disrupt from a highlighted territory, or skip.`;
  }
  if (state.phase === "advance") {
    if (interaction.type === "selectingUnits" || interaction.type === "selectingAdvanceDestination") {
      const selectedCount = interaction.selectedUnits.length;
      const queuedCount = interaction.moves.length;
      return selectedCount > 0
        ? `${actor} is advanceing from ${state.areas[interaction.from].name}. Click a highlighted destination to move.`
        : `${actor} is advanceing from ${state.areas[interaction.from].name}. ${queuedCount > 0 ? "Assign more units or resolve this Advance order." : "Choose units to assign for this Advance order."}`;
    }
    return `${actor} may advance. Next click: choose one highlighted advance source, or skip.`;
  }
  if (state.phase === "gather") return `${actor} may collect resource from a highlighted territory, or skip.`;
  return `${actor} is resolving ${state.pending.type}.`;
}

function ActionPanel({ interaction, localOrders, state, playerId, myAreas, selectedArea, warning, canRedo, canUndo, onInteraction, onSubmit, onSubmitLocalOrders, onClearLocalOrders, onRedo, onUndo, onDefaultOrders, onAutoplay }: {
  interaction: InteractionMode;
  localOrders: Record<string, Order>;
  state: GameState;
  playerId: string;
  myAreas: string[];
  selectedArea: string;
  warning: string;
  canRedo: boolean;
  canUndo: boolean;
  onInteraction: (mode: InteractionMode) => void;
  onSubmit: (command: Command) => void;
  onSubmitLocalOrders: () => void;
  onClearLocalOrders: () => void;
  onRedo: () => void;
  onUndo: () => void;
  onDefaultOrders: () => void;
  onAutoplay: () => void;
}) {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [area, setArea] = useState("");
  const [unit, setUnit] = useState<UnitType>("infantry");
  const [orderKind, setOrderKind] = useState<OrderKind>("advance");
  const myTurn = state.players.some((player) => player.id === playerId && player.playerKey === state.pending?.playerKey);

  useEffect(() => {
  if (selectedArea) {
      setFrom(selectedArea);
      setArea(selectedArea);
    }
  }, [selectedArea]);

  const requiredOrders = getOwnOccupiedAreas(state, playerId);
  const missingOrders = requiredOrders.filter((ownedArea) => !localOrders[ownedArea]);
  const selectedUnits = interaction.type === "selectingUnits" || interaction.type === "selectingAdvanceDestination" ? interaction.selectedUnits : [];
  const unitSource = interaction.type === "selectingUnits" || interaction.type === "selectingAdvanceDestination" ? interaction.from : "";
  const advanceMoves = unitSource ? currentAdvanceMoves(interaction, unitSource) : [];
  const sourceUnits = unitSource ? (state.units[unitSource] ?? []).filter((unit) => unit.playerKey === state.pending?.playerKey) : [];
  const legalDisruptActions = getLegalDisruptActions(state, playerId);
  const legalAdvanceActions = getLegalAdvanceActions(state, playerId).filter((action) => action.destinations.length > 0);
  const legalGatherActions = getLegalGatherActions(state, playerId);
  const commandGuidance = commandHint(state, playerId, interaction, localOrders);

  return (
    <section className="panel action-card current-command">
      <div className="panel-heading">
        <p className="eyebrow">Command</p>
        <h2>{state.pending ? `${playerTheme[state.pending.playerKey].label}: ${state.pending.type}` : phaseLabel(state.phase)}</h2>
      </div>
      <p className="command-hint">{commandGuidance}</p>

      {warning && <p className="warning">{warning}</p>}

      {state.phase === "planning" ? (
        <>
          <div className="order-progress">
            <strong>{requiredOrders.length - missingOrders.length}/{requiredOrders.length}</strong>
            <span>orders placed</span>
          </div>
          <button className="primary" disabled={!myTurn || missingOrders.length > 0} onClick={onSubmitLocalOrders}>Submit Orders</button>
          {missingOrders.length > 0 && <p className="hint">Assign {missingOrders.length} more order{missingOrders.length === 1 ? "" : "s"} before submitting.</p>}
          <div className="planning-edit-actions">
            <button disabled={!canUndo} onClick={onUndo}>Undo</button>
            <button disabled={!canRedo} onClick={onRedo}>Redo</button>
            <button disabled={Object.keys(localOrders).length === 0} onClick={onClearLocalOrders}>Clear</button>
          </div>
          <button className="ghost" disabled={!myTurn} onClick={onDefaultOrders}>Quick Demo Orders</button>
        </>
      ) : (
        <>
          {state.phase === "reveal" && <button className="primary" onClick={() => onSubmit({ type: "revealOrders", playerId })}>Reveal Orders</button>}
          {state.phase === "disrupt" && (
            <>
              <p className="hint">{interaction.type === "selectingDisruptTarget" ? "Choose one highlighted enemy order." : `${legalDisruptActions.length} disrupt source${legalDisruptActions.length === 1 ? "" : "s"} available.`}</p>
              <button disabled={!myTurn} onClick={() => onSubmit({ type: "skipDisrupt", playerId })}>Skip Disrupt</button>
            </>
          )}
          {state.phase === "advance" && (
            <div className="stack">
              <p className="hint">{unitSource ? selectedUnits.length > 0 ? "Click one highlighted destination to move." : advanceMoves.length > 0 ? "Assign more units or resolve this Advance order." : "Click the map units to assign them." : `${legalAdvanceActions.length} advance source${legalAdvanceActions.length === 1 ? "" : "s"} available.`}</p>
              {unitSource && (
                <>
                  <p className="hint board-first-note">Assign units to one or more adjacent destinations, then resolve this Advance order.</p>
                  {advanceMoves.length > 0 && (
                    <div className="advance-plan">
                      {advanceMoves.map((move, index) => (
                        <span key={`${move.to}-${index}`}>{move.units.length} to {state.areas[move.to].name}</span>
                      ))}
                    </div>
                  )}
                  <div className="unit-picker">
                    {sourceUnits.map((unit, index) => {
                      const key = `${unit.type}-${index}`;
                      const selected = isUnitSelected(selectedUnits, unit.type, index);
                      const assigned = isUnitAssignedToAdvance(interaction, unitSource, unit.type, index);
                      return (
                        <button
                          key={key}
                          className={`${selected ? "unit-choice selected" : "unit-choice"} ${assigned ? "assigned" : ""}`}
                          disabled={assigned}
                          onClick={() => onInteraction(toggleSelectedUnit(interaction, unit.type, index))}
                        >
                          <span><svg viewBox="-16 -16 32 32" aria-hidden="true"><UnitIcon type={unit.type} /></svg></span>{unitLabel(unit.type)}
                        </button>
                      );
                    })}
                  </div>
                </>
              )}
              <button
                className="primary"
                disabled={!myTurn || !unitSource || advanceMoves.length === 0}
                onClick={() => {
                  if (!unitSource) return;
                  onSubmit(advanceDraftsToCommand(playerId, unitSource, advanceMoves));
                  onInteraction({ type: "selectingAdvanceSource" });
                }}
              >
                Resolve Advance Order
              </button>
              <button disabled={!myTurn} onClick={() => onSubmit({ type: "skipAdvance", playerId })}>Skip Advance</button>
            </div>
          )}
          {state.phase === "gather" && (
            <div className="stack">
              <p className="hint">{legalGatherActions.length} gather order{legalGatherActions.length === 1 ? "" : "s"} available.</p>
              <button disabled={!myTurn} onClick={() => onSubmit({ type: "skipGather", playerId })}>Skip Gather</button>
            </div>
          )}
        </>
      )}

      <button className="ghost" disabled={!myTurn} onClick={onAutoplay}>Auto-play My Step · Space</button>
    </section>
  );
}

function CombatCardsPanel({ me }: { me?: GameState["players"][number] }) {
  if (!me) return null;
  return (
    <details className="panel compact-panel">
      <summary className="panel-heading">
        <p className="eyebrow">{gameBundle.ui.combatCardPlural}</p>
        <h2>Hand</h2>
      </summary>
      <div className="card-hand">
        {me.hand.map((cardId) => {
          const card = combatCardsById[cardId];
          const used = me.usedCombatCards.includes(cardId);
          return (
            <button
              key={cardId}
              className={`playerKey-card ${used ? "used" : ""}`}
              style={{
                "--playerKey": playerTheme[me.playerKey].color,
                "--card-background": playerTheme[me.playerKey].cardStyle.background,
                "--card-foreground": playerTheme[me.playerKey].cardStyle.foreground,
                "--card-accent": playerTheme[me.playerKey].cardStyle.accent
              } as CSSProperties}
            >
              <strong>{card?.name ?? cardId}</strong>
              <span>{card?.strength ?? "?"}</span>
            </button>
          );
        })}
      </div>
      <p className="hint">Combat card choice will plug into this hand once card effects are implemented.</p>
    </details>
  );
}

function CombatOverlay({ combat, me, state, onSubmit }: {
  combat: NonNullable<GameState["combat"]>;
  me: GameState["players"][number];
  state: GameState;
  onSubmit: (command: Command) => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const [selectedCard, setSelectedCard] = useState("");
  const [usedOpen, setUsedOpen] = useState(false);
  const overlayRef = useRef<HTMLDivElement>(null);
  const [drawerBounds, setDrawerBounds] = useState<CSSProperties>({});
  const involved = me.playerKey === combat.attacker || me.playerKey === combat.defender;
  const committed = combat.committedPlayerKeys.includes(me.playerKey);
  const available = me.hand.filter((card) => !me.usedCombatCards.includes(card));
  const opponent = me.playerKey === combat.attacker ? combat.defender : combat.attacker;
  const opponentCommitted = combat.committedPlayerKeys.includes(opponent);
  const attackerTotal = combat.attackerStrength ?? combat.attackerBaseStrength;
  const defenderTotal = combat.defenderStrength ?? combat.defenderBaseStrength;

  useEffect(() => {
    const warTable = overlayRef.current?.parentElement;
    if (!warTable) return;
    const updateDrawerBounds = () => {
      const bounds = warTable.getBoundingClientRect();
      setDrawerBounds({
        left: Math.max(6, bounds.left),
        width: Math.max(0, Math.min(bounds.width, window.innerWidth - Math.max(6, bounds.left) - 6))
      });
    };
    updateDrawerBounds();
    const observer = new ResizeObserver(updateDrawerBounds);
    observer.observe(warTable);
    window.addEventListener("resize", updateDrawerBounds);
    window.addEventListener("scroll", updateDrawerBounds, true);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", updateDrawerBounds);
      window.removeEventListener("scroll", updateDrawerBounds, true);
    };
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isTypingTarget(event.target)) return;
      if (event.key === " ") {
        event.preventDefault();
        if (combat.status === "revealed" && involved) onSubmit({ type: "continueCombat", playerId: me.id });
        else setExpanded((value) => !value);
      } else if (event.key === "Escape") setExpanded(false);
      else if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        event.preventDefault();
        const index = Math.max(0, available.indexOf(selectedCard));
        const offset = event.key === "ArrowRight" ? 1 : -1;
        setSelectedCard(available[(index + offset + available.length) % available.length] ?? "");
      } else if (/^[1-7]$/.test(event.key)) {
        setSelectedCard(available[Number(event.key) - 1] ?? selectedCard);
      } else if (event.key === "Enter") {
        if (combat.status === "revealed" && involved) onSubmit({ type: "continueCombat", playerId: me.id });
        else if (selectedCard && !committed) onSubmit({ type: "playCombatCard", playerId: me.id, cardId: selectedCard });
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [available.join("|"), combat.status, committed, involved, me.id, onSubmit, selectedCard]);

  const status = combat.status === "revealed"
    ? "Cards revealed"
    : committed
      ? opponentCommitted ? "Revealing cards…" : "Waiting for opponent…"
      : involved ? `Choose a ${gameBundle.ui.combatCardLabel.toLowerCase()}` : "Combatants are choosing…";

  return (
    <div ref={overlayRef} className={`combat-overlay ${expanded ? "expanded" : "collapsed"}`} style={{ "--combat-accent": playerTheme[me.playerKey].color } as CSSProperties}>
      <div className="combat-status-strip" aria-live="polite">
        <PlayerKeyBadge playerKey={combat.attacker} />
        <strong>{playerTheme[combat.attacker].label}</strong>
        <b>{attackerTotal}</b><span className="combat-blade">⚔</span><b>{defenderTotal}</b>
        <strong>{playerTheme[combat.defender].label}</strong>
        <PlayerKeyBadge playerKey={combat.defender} />
        <span className="combat-territory">{state.areas[combat.area]?.name}</span>
        <em>{status}</em>
      </div>

      {combat.status === "revealed" ? (
        <section className="combat-reveal" style={drawerBounds} aria-label={`Revealed ${gameBundle.ui.combatCardPlural.toLowerCase()}`}>
          <div className="revealed-cards">
            <CombatCard cardId={combat.chosenCards[combat.attacker] ?? ""} playerKey={combat.attacker} />
            <span>VS</span>
            <CombatCard cardId={combat.chosenCards[combat.defender] ?? ""} playerKey={combat.defender} />
          </div>
          <div className="combat-result">
            <div><span>Battle won by</span><strong>{combat.winner ? playerTheme[combat.winner].label : "—"}</strong></div>
            <b>{attackerTotal} — {defenderTotal}</b>
            <button className="primary" disabled={!involved} onClick={() => onSubmit({ type: "continueCombat", playerId: me.id })}>{involved ? "OK" : "Combatants continue"}</button>
          </div>
        </section>
      ) : committed || !involved ? (
        <button className="combat-collapsed-bar" style={drawerBounds} onClick={() => setExpanded((value) => !value)}>
          <PlayerKeyBadge playerKey={me.playerKey} />
          <span><strong>{committed ? "Card chosen" : status}</strong><small>{opponentCommitted ? "Opponent ready" : "Opponent choosing…"}</small></span>
          <b>{expanded ? "Hide" : "Show"}</b>
        </button>
      ) : (
        <section className="combat-hand-drawer" style={drawerBounds}>
          <button className="combat-drawer-toggle" aria-label={expanded ? "Hide combat hand" : "Show combat hand"} onClick={() => setExpanded((value) => !value)}>{expanded ? "⌄" : "⌃"}</button>
          <header>
            <PlayerKeyBadge playerKey={me.playerKey} />
            <div><span>Choose a {gameBundle.ui.combatCardLabel}</span><strong>{playerTheme[me.playerKey].label} · {available.length} available</strong></div>
            <button className="ghost used-card-button" onClick={() => setUsedOpen((value) => !value)}>Used cards ({me.usedCombatCards.length})</button>
          </header>
          {usedOpen && <div className="used-card-popover">{me.usedCombatCards.length ? me.usedCombatCards.map((card) => <CombatCard key={card} cardId={card} playerKey={me.playerKey} disabled />) : <span>No cards used yet.</span>}</div>}
          <div className="combat-hand" role="listbox" aria-label={`Available ${gameBundle.ui.combatCardPlural.toLowerCase()}`}>
            {available.map((cardId, index) => (
              <CombatCard
                key={cardId}
                cardId={cardId}
                playerKey={me.playerKey}
                index={index}
                count={available.length}
                selected={selectedCard === cardId}
                onClick={() => setSelectedCard((current) => current === cardId ? "" : cardId)}
                onDoubleClick={() => onSubmit({ type: "playCombatCard", playerId: me.id, cardId })}
              />
            ))}
          </div>
          <footer>
            <span>← → browse · 1–7 select · Enter play · Space hide</span>
            <button className="ghost" disabled={!selectedCard} onClick={() => setSelectedCard("")}>Clear selection</button>
            <button className="primary" disabled={!selectedCard} onClick={() => onSubmit({ type: "playCombatCard", playerId: me.id, cardId: selectedCard })}>Play Card</button>
          </footer>
        </section>
      )}
    </div>
  );
}

function PlayerKeyBadge({ playerKey }: { playerKey: PlayerKey }) {
  return <span className="playerKey-badge" style={{ "--playerKey-color": playerTheme[playerKey].color } as CSSProperties} aria-label={`${playerTheme[playerKey].label} sigil`}>{playerTheme[playerKey].sigil}</span>;
}

function CombatCard({ cardId, playerKey, index = 0, count = 1, selected, disabled, onClick, onDoubleClick }: {
  cardId: string;
  playerKey: PlayerKey;
  index?: number;
  count?: number;
  selected?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  onDoubleClick?: () => void;
}) {
  const card = combatCardsById[cardId];
  const strength = card?.strength ?? "?";
  const offset = index - (count - 1) / 2;
  const name = card?.name ?? cardId;
  return (
    <button
      className={`combat-card ${selected ? "selected" : ""} ${disabled ? "used" : ""}`}
      disabled={disabled}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      role="option"
      aria-selected={selected}
      aria-label={`${name}, strength ${strength}`}
      style={{
        "--card-rotate": `${offset * 3.2}deg`,
        "--card-rise": `${Math.abs(offset) * 5}px`,
        "--playerKey-color": playerTheme[playerKey].color,
        "--card-background": playerTheme[playerKey].cardStyle.background,
        "--card-foreground": playerTheme[playerKey].cardStyle.foreground,
        "--card-accent": playerTheme[playerKey].cardStyle.accent
      } as CSSProperties}
    >
      <b className="card-strength">{strength}</b>
      <span className="card-sigil">{playerTheme[playerKey].sigil}</span>
      <span className="card-art" aria-hidden="true"><i>{card?.symbol ?? "◆"}</i></span>
      <strong>{name}</strong>
      <span className="card-icons">{Number(strength) >= 4 ? "⚔ ⚔" : "⚔"} · {Number(strength) <= 2 ? "▰" : "—"}</span>
      <small>{card?.text ?? "No ability in the current bundle."}</small>
    </button>
  );
}

function AreaPanel({ area, state }: { area?: Area; state: GameState }) {
  if (!area) return null;
  const units = state.units[area.id] ?? [];
  return (
    <details className="panel compact-panel area-panel">
      <summary className="panel-heading">
        <p className="eyebrow">Selected Area</p>
        <h2>{area.name}</h2>
      </summary>
      <div className="detail-grid">
        <span>{area.type}</span>
        <span>{area.objective === 2 ? gameBundle.ui.features.majorObjective : area.objective === 1 ? gameBundle.ui.features.objective : `No ${gameBundle.ui.features.objective.toLowerCase()}`}</span>
        <span>{area.resourceSites} {gameBundle.ui.features.resource.toLowerCase()}</span>
        <span>{area.capacity} {gameBundle.ui.features.capacity.toLowerCase()}</span>
      </div>
      <p className="hint">Adjacent: {area.adjacent.map((id) => state.areas[id]?.name ?? id).join(", ")}</p>
      <UnitStack units={units} />
    </details>
  );
}

function LogPanel({ state }: { state: GameState }) {
  return (
    <details className="panel compact-panel">
      <summary className="panel-heading">
        <p className="eyebrow">{gameBundle.ui.logLabel}</p>
        <h2>Game Log</h2>
      </summary>
      <ol className="log">
        {state.log.slice(-8).map((entry, index) => <li key={`${entry}-${index}`}>{entry}</li>)}
      </ol>
    </details>
  );
}

async function createGameRequest() {
  const response = await fetch(`${api}/games`, { method: "POST" });
  if (!response.ok) throw new Error("Could not create game.");
  return response.json() as Promise<{ gameId: string; seed: string }>;
}

async function sendCommand(gameId: string, command: Command) {
  const response = await fetch(`${api}/games/${gameId}/commands`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(command)
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? "Command failed.");
  return result.state as GameState;
}

async function loadGame(gameId: string, playerId: string) {
  const response = await fetch(`${api}/games/${gameId}?playerId=${playerId}`);
  return response.ok ? response.json() as Promise<GameState> : null;
}

function nextBotCommand(state: GameState, humanPlayerId: string): Command | null {
  if (state.phase === "reveal") return { type: "revealOrders", playerId: humanPlayerId };
  if (state.combat?.status === "choosing") {
    const bot = state.players.find((player) => player.id.startsWith("ai-") && (player.playerKey === state.combat?.attacker || player.playerKey === state.combat?.defender) && !state.combat?.committedPlayerKeys.includes(player.playerKey));
    const cardId = bot?.hand.find((card) => !bot.usedCombatCards.includes(card));
    return bot && cardId ? { type: "playCombatCard", playerId: bot.id, cardId } : null;
  }
  if (!state.pending) return null;
  const player = state.players.find((candidate) => candidate.playerKey === state.pending?.playerKey);
  if (!player?.id.startsWith("ai-")) return null;
  return nextPlayerKeyCommand(state, player.id, player.playerKey);
}

function impossibleActionSkipCommand(state: GameState): Command | null {
  if (!state.pending) return null;
  const player = state.players.find((candidate) => candidate.playerKey === state.pending?.playerKey);
  if (!player) return null;
  if (state.pending.type === "disrupt" && getLegalDisruptActions(state, player.id).every((action) => action.targets.length === 0)) {
    return { type: "skipDisrupt", playerId: player.id };
  }
  if (state.pending.type === "advance" && getLegalAdvanceActions(state, player.id).every((action) => action.destinations.length === 0)) {
    return { type: "skipAdvance", playerId: player.id };
  }
  if (state.pending.type === "gather" && getLegalGatherActions(state, player.id).length === 0) {
    return { type: "skipGather", playerId: player.id };
  }
  return null;
}

function nextPlayerKeyCommand(state: GameState, playerId: string, playerKey: PlayerKey): Command | null {
  if (state.pending?.playerKey !== playerKey && state.phase !== "reveal") return null;
  if (state.phase === "reveal") return { type: "revealOrders", playerId };
  if (state.pending?.type === "placeOrders") return { type: "placeOrders", playerId, orders: demoOrders(state, playerKey) };
  if (state.pending?.type === "disrupt") return { type: "skipDisrupt", playerId };
  if (state.pending?.type === "advance") return advanceCommand(state, playerId, playerKey) ?? { type: "skipAdvance", playerId };
  if (state.pending?.type === "gather") {
    const area = Object.keys(state.orders).find((candidate) => state.orders[candidate]?.kind === "gather" && hasPlayerKeyUnit(state, candidate, playerKey));
    return area ? { type: "gather", playerId, area } : { type: "skipGather", playerId };
  }
  return null;
}

function demoOrders(state: GameState, playerKey: PlayerKey): Record<string, Order> {
  const occupied = Object.keys(state.units).filter((area) => hasPlayerKeyUnit(state, area, playerKey));
  const advanceArea = occupied.find((area) => state.areas[area].adjacent.some((target) => canMoveType(state, area, target, playerKey))) ?? occupied[0];
  return Object.fromEntries(occupied.map((area, index) => {
    const order: Order = area === advanceArea
      ? { kind: "advance", special: index === 0 }
      : state.areas[area].type === "sea"
        ? { kind: "support" }
        : { kind: "gather" };
    return [area, order];
  }));
}

function advanceCommand(state: GameState, playerId: string, playerKey: PlayerKey): Command | null {
  const from = Object.keys(state.orders).find((area) => state.orders[area]?.kind === "advance" && hasPlayerKeyUnit(state, area, playerKey));
  if (!from) return null;
  const unit = state.units[from]?.find((candidate) => candidate.playerKey === playerKey);
  if (!unit) return null;
  const to = state.areas[from].adjacent.find((target) => canMoveType(state, from, target, playerKey, unit.type));
  if (!to) return null;
  return { type: "advance", playerId, from, moves: [{ to, units: [unit.type] }] };
}

function canMoveType(state: GameState, from: string, to: string, playerKey: PlayerKey, unitType?: UnitType): boolean {
  const fromArea = state.areas[from];
  const toArea = state.areas[to];
  if (!fromArea || !toArea) return false;
  if (!fromArea.adjacent.includes(to)) return false;
  const movingType = unitType ?? state.units[from]?.find((unit) => unit.playerKey === playerKey)?.type;
  if (!movingType) return false;
  if (movingType === "fleet") return toArea.type === "sea";
  return toArea.type === "land";
}

function getOwnOccupiedAreas(state: GameState, playerId: string): string[] {
  const player = state.players.find((candidate) => candidate.id === playerId);
  if (!player) return [];
  return Object.keys(state.units).filter((area) => hasPlayerKeyUnit(state, area, player.playerKey));
}

function getAreasWithOwnOrder(state: GameState, playerId: string, orderKind: OrderKind): string[] {
  const player = state.players.find((candidate) => candidate.id === playerId);
  if (!player) return [];
  return Object.keys(state.orders).filter((area) => state.orders[area]?.kind === orderKind && hasPlayerKeyUnit(state, area, player.playerKey));
}

function getAdjacentAreas(state: GameState, areaId: string): string[] {
  return state.areas[areaId]?.adjacent ?? [];
}

function safeParseOrder(payload: string): Order | null {
  try {
    const parsed = JSON.parse(payload) as Partial<Order>;
    return parsed.kind && orderKinds.includes(parsed.kind) ? { kind: parsed.kind, special: !!parsed.special || undefined } : null;
  } catch {
    return null;
  }
}

function isTypingTarget(target: EventTarget | null) {
  return target instanceof HTMLElement && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));
}

function specialOrderLimitFor(state: GameState, playerKey: PlayerKey): number {
  const index = state.tracks.specialOrderOrder.indexOf(playerKey);
  if (index < 0) return 0;
  return index <= 1 ? 3 : index <= 3 ? 2 : 1;
}

function getValidDisruptTargets(state: GameState, from: string): string[] {
  return getAdjacentAreas(state, from).filter((area) => {
    const order = state.orders[area];
    return !!order && order.kind !== "advance" && order.kind !== "defend";
  });
}

function getValidAdvanceDestinations(state: GameState, from: string, selectedUnits: UnitType[] = []): string[] {
  const playerKey = state.units[from]?.[0]?.playerKey;
  if (!playerKey) return [];
  return getAdjacentAreas(state, from).filter((area) => {
    if (selectedUnits.length === 0) return canMoveType(state, from, area, playerKey);
    return selectedUnits.every((unitType) => canMoveType(state, from, area, playerKey, unitType));
  });
}

function areaTooltip(area: Area, units: Unit[], order: Order | undefined, controller: PlayerKey | undefined, hiddenOrder: boolean): string {
  const objective = area.objective === 2
    ? gameBundle.ui.features.majorObjective
    : area.objective === 1
      ? gameBundle.ui.features.objective
      : `no ${gameBundle.ui.features.objective.toLowerCase()}`;
  const unitSummary = units.length === 0
    ? "none"
    : units.map((unit) => `${playerTheme[unit.playerKey].label} ${unitLabel(unit.type)}`).join(", ");
  const orderSummary = order
    ? hiddenOrder ? "face-down order" : `${order.special ? "special " : ""}${orderLabel(order.kind)}`
    : "none";
  return [
    area.name,
    `Type: ${area.type}`,
    `Feature: ${objective}`,
    `${gameBundle.ui.features.resource}: ${area.resourceSites}`,
    `${gameBundle.ui.features.capacity}: ${area.capacity}`,
    `Units: ${unitSummary}`,
    `Order: ${orderSummary}`,
    `Controller: ${controller ? playerTheme[controller].label : "none"}`
  ].join("\n");
}

function getAreaHighlight(state: GameState, playerId: string, interaction: InteractionMode, areaId: string): string {
  if (interaction.type === "placingOrder" && getLegalOrderPlacements(state, playerId).some((placement) => placement.area === areaId)) return "actionable";
  if (interaction.type === "selectingDisruptSource" && getLegalDisruptActions(state, playerId).some((action) => action.from === areaId)) return "actionable";
  if (interaction.type === "selectingDisruptTarget" && getLegalDisruptActions(state, playerId).some((action) => action.from === interaction.from && action.targets.includes(areaId))) return "targetable";
  if (interaction.type === "selectingAdvanceSource" && getLegalAdvanceActions(state, playerId).some((action) => action.from === areaId && action.destinations.length > 0)) return "actionable";
  if (
    (interaction.type === "selectingUnits" || interaction.type === "selectingAdvanceDestination") &&
    interaction.selectedUnits.length > 0 &&
    getLegalAdvanceDestinationsForDraft(state, playerId, interaction).includes(areaId)
  ) {
    return `${hasEnemyUnitsForPlayer(state, playerId, areaId) ? "combat-target" : "targetable"} advance-destination`;
  }
  if (interaction.type === "selectingGather" && getLegalGatherActions(state, playerId).some((action) => action.area === areaId)) return "actionable";
  return "";
}

function isActionSpotlightActive(state: GameState, interaction: InteractionMode) {
  if (state.phase === "planning" && interaction.type === "placingOrder") return true;
  if (state.phase === "disrupt" && (interaction.type === "selectingDisruptSource" || interaction.type === "selectingDisruptTarget")) return true;
  if (state.phase === "advance" && (interaction.type === "selectingAdvanceSource" || interaction.type === "selectingUnits" || interaction.type === "selectingAdvanceDestination")) return true;
  if (state.phase === "gather" && interaction.type === "selectingGather") return true;
  return false;
}

function getLegalAdvanceDestinationsForSelection(state: GameState, playerId: string, from: string, selectedUnits: UnitType[]): string[] {
  const action = getLegalAdvanceActions(state, playerId).find((candidate) => candidate.from === from);
  if (!action || selectedUnits.length === 0) return [];
  return action.destinations.filter((destination) => selectedUnits.every((unitType) => action.unitDestinations[unitType]?.includes(destination)));
}

function getLegalAdvanceDestinationsForDraft(state: GameState, playerId: string, interaction: Extract<InteractionMode, { type: "selectingUnits" | "selectingAdvanceDestination" }>): string[] {
  const selectedUnits = selectedUnitTypes(interaction.selectedUnits);
  const destinations = getLegalAdvanceDestinationsForSelection(state, playerId, interaction.from, selectedUnits);
  const combatDestination = interaction.moves.find((move) => hasEnemyUnitsForPlayer(state, playerId, move.to))?.to;
  return combatDestination
    ? destinations.filter((destination) => destination === combatDestination || !hasEnemyUnitsForPlayer(state, playerId, destination))
    : destinations;
}

function currentAdvanceSelections(interaction: InteractionMode, from: string): UnitSelection[] {
  if ((interaction.type === "selectingUnits" || interaction.type === "selectingAdvanceDestination") && interaction.from === from) return interaction.selectedUnits;
  return [];
}

function currentAdvanceMoves(interaction: InteractionMode, from: string): AdvanceDraft[] {
  if ((interaction.type === "selectingUnits" || interaction.type === "selectingAdvanceDestination") && interaction.from === from) return interaction.moves;
  return [];
}

function toggleSelectedUnit(interaction: InteractionMode, unitType: UnitType, index: number): InteractionMode {
  if (interaction.type !== "selectingUnits" && interaction.type !== "selectingAdvanceDestination") return interaction;
  const selectedIndex = interaction.selectedUnits.findIndex((unit) => unit.type === unitType && unit.index === index);
  const selectedUnits = selectedIndex >= 0
    ? interaction.selectedUnits.filter((_, currentIndex) => currentIndex !== selectedIndex)
    : [...interaction.selectedUnits, { type: unitType, index }];
  return { type: "selectingUnits", from: interaction.from, selectedUnits, moves: interaction.moves };
}

function selectedUnitTypes(selectedUnits: UnitSelection[]): UnitType[] {
  return selectedUnits.map((unit) => unit.type);
}

function isUnitSelected(selectedUnits: UnitSelection[], unitType: UnitType, index: number): boolean {
  return selectedUnits.some((unit) => unit.type === unitType && unit.index === index);
}

function isUnitAssignedToAdvance(interaction: InteractionMode, from: string, unitType: UnitType, index: number): boolean {
  return currentAdvanceMoves(interaction, from).some((move) => move.units.some((unit) => unit.type === unitType && unit.index === index));
}

function isAdvanceInteraction(interaction: InteractionMode): interaction is Extract<InteractionMode, { type: "selectingUnits" | "selectingAdvanceDestination" }> {
  return interaction.type === "selectingUnits" || interaction.type === "selectingAdvanceDestination";
}

function projectedAdvanceUnits(state: GameState, interaction: InteractionMode, areaId: string): Unit[] {
  const units = state.units[areaId] ?? [];
  if (!isAdvanceInteraction(interaction) || interaction.from === areaId) return units;
  const sourceUnits = state.units[interaction.from] ?? [];
  const arrivingUnits = interaction.moves
    .filter((move) => move.to === areaId)
    .flatMap((move) => unitsForSelections(sourceUnits, move.units));
  return arrivingUnits.length > 0 ? [...units, ...arrivingUnits] : units;
}

function unitsForSelections(sourceUnits: Unit[], selections: UnitSelection[]): Unit[] {
  return selections.flatMap((selection) => {
    const unit = sourceUnits[selection.index];
    return unit?.type === selection.type ? [unit] : [];
  });
}

function advanceDraftsToMoves(drafts: AdvanceDraft[]): Array<{ to: string; units: UnitType[] }> {
  return drafts.map((draft) => ({ to: draft.to, units: selectedUnitTypes(draft.units) }));
}

function advanceDraftsToCommand(playerId: string, from: string, drafts: AdvanceDraft[]): Command {
  const moves = advanceDraftsToMoves(drafts);
  if (moves.length === 1) return { type: "advance", playerId, from, to: moves[0].to, units: moves[0].units };
  return { type: "advance", playerId, from, moves };
}

function orderGlyph(kind: OrderKind): string {
  return { advance: "➜", defend: "◆", support: "✚", disrupt: "☇", gather: "♛" }[kind];
}

function orderLabel(kind: OrderKind): string {
  return {
    advance: "Advance",
    defend: "Defend",
    support: "Support",
    disrupt: "Disrupt",
    gather: "Gather"
  }[kind];
}

function orderShortLabel(kind: OrderKind): string {
  return {
    advance: "Advance",
    defend: "Def",
    support: "Support",
    disrupt: "Disrupt",
    gather: "Resource"
  }[kind];
}

function orderModifierLabel(order: Order): string {
  if (order.kind === "advance") return order.special ? "+1" : "-1";
  if (order.kind === "defend") return order.special ? "+2" : "+1";
  if (order.kind === "support") return order.special ? "+1" : "+0";
  return "";
}

function hasPlayerKeyUnit(state: GameState, area: string, playerKey: PlayerKey): boolean {
  return state.units[area]?.some((unit) => unit.playerKey === playerKey) ?? false;
}

function hasEnemyUnitsForPlayer(state: GameState, playerId: string, area: string): boolean {
  const player = state.players.find((candidate) => candidate.id === playerId);
  return !!player && (state.units[area] ?? []).some((unit) => unit.playerKey !== player.playerKey);
}

function firstOccupiedArea(state: GameState | null, playerKey: PlayerKey): string | undefined {
  if (!state) return undefined;
  return Object.keys(state.units).find((area) => hasPlayerKeyUnit(state, area, playerKey));
}

function botId(playerKey: PlayerKey) {
  return `ai-${playerKey}`;
}

function phaseLabel(phase: GameState["phase"]) {
  return phase.replace(/^\w/, (letter) => letter.toUpperCase());
}

function loadIconDesigns(): IconDesignLibrary {
  return {
    units: loadUnitIconDesigns(),
    orders: loadOrderIconDesigns(),
    board: loadBoardIconDesigns()
  };
}

function loadUnitIconDesigns(): Record<UnitType, IconDesign> {
  const saved = safeParseIconDesigns(window.localStorage.getItem(unitIconStorageKey), unitTypes);
  return Object.fromEntries(unitTypes.map((type) => [type, saved[type] ?? cloneIconDesign(defaultUnitIconDesigns[type])])) as Record<UnitType, IconDesign>;
}

function loadOrderIconDesigns(): Record<OrderKind, IconDesign> {
  const saved = safeParseIconDesigns(window.localStorage.getItem(orderIconStorageKey), orderKinds);
  return Object.fromEntries(orderKinds.map((kind) => [kind, saved[kind] ?? cloneIconDesign(defaultOrderIconDesigns[kind])])) as Record<OrderKind, IconDesign>;
}

function loadBoardIconDesigns(): Record<BoardIconKind, IconDesign> {
  const saved = safeParseIconDesigns(window.localStorage.getItem(boardIconStorageKey), boardIconKinds);
  return Object.fromEntries(boardIconKinds.map((kind) => [kind, saved[kind] ?? cloneIconDesign(defaultBoardIconDesigns[kind])])) as Record<BoardIconKind, IconDesign>;
}

function getUnitIconDesign(type: UnitType): IconDesign {
  return safeParseIconDesigns(window.localStorage.getItem(unitIconStorageKey), unitTypes)[type] ?? defaultUnitIconDesigns[type];
}

function getOrderIconDesign(kind: OrderKind): IconDesign {
  return safeParseIconDesigns(window.localStorage.getItem(orderIconStorageKey), orderKinds)[kind] ?? defaultOrderIconDesigns[kind];
}

function getBoardIconDesign(kind: BoardIconKind): IconDesign {
  return safeParseIconDesigns(window.localStorage.getItem(boardIconStorageKey), boardIconKinds)[kind] ?? defaultBoardIconDesigns[kind];
}

function getEditableIconDesign(designs: IconDesignLibrary, target: EditableIconTarget): IconDesign {
  if (target.group === "units") return designs.units[target.key];
  if (target.group === "orders") return designs.orders[target.key];
  return designs.board[target.key];
}

function setEditableIconDesign(designs: IconDesignLibrary, target: EditableIconTarget, design: IconDesign): IconDesignLibrary {
  if (target.group === "units") return { ...designs, units: { ...designs.units, [target.key]: design } };
  if (target.group === "orders") return { ...designs, orders: { ...designs.orders, [target.key]: design } };
  return { ...designs, board: { ...designs.board, [target.key]: design } };
}

function safeParseIconDesigns<T extends string>(value: string | null, allowed: readonly T[]): Partial<Record<T, IconDesign>> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value) as Partial<Record<T, IconDesign>>;
    return Object.fromEntries(Object.entries(parsed).filter(([type, design]) => allowed.includes(type as T) && isIconDesign(design))) as Partial<Record<T, IconDesign>>;
  } catch {
    return {};
  }
}

function isIconDesign(value: unknown): value is IconDesign {
  if (!value || typeof value !== "object") return false;
  const candidate = value as IconDesign;
  return typeof candidate.closed === "boolean"
    && Array.isArray(candidate.points)
    && candidate.points.every(isMapPoint)
    && (candidate.shapes === undefined || (Array.isArray(candidate.shapes) && candidate.shapes.every(isIconShape)));
}

function isIconShape(value: unknown): value is IconShape {
  if (!value || typeof value !== "object") return false;
  const candidate = value as IconShape;
  return typeof candidate.closed === "boolean" && Array.isArray(candidate.points) && candidate.points.every(isMapPoint);
}

function isMapPoint(value: unknown): value is MapPoint {
  return Array.isArray(value) && value.length === 2 && value.every((coordinate) => typeof coordinate === "number" && Number.isFinite(coordinate));
}

function iconDesignToPath(design: IconDesign): string {
  if (design.points.length === 0) return "";
  const [first, ...rest] = design.points;
  return [`M${formatPoint(first)}`, ...rest.map((point) => `L${formatPoint(point)}`), design.closed && design.points.length > 2 ? "Z" : ""].filter(Boolean).join(" ");
}

function IconDesignPaths({ design }: { design: IconDesign }) {
  const shapes = (design.shapes?.length ?? 0) > 0
    ? design.shapes!
    : [{ points: design.points, closed: design.closed }];
  return <>{shapes.map((shape, index) => (
    <path
      key={index}
      d={iconDesignToPath(shape)}
      style={{
        fill: shape.fill,
        stroke: shape.stroke,
        strokeWidth: shape.strokeWidth,
        strokeLinecap: shape.strokeLinecap,
        strokeLinejoin: shape.strokeLinejoin
      }}
    />
  ))}</>;
}

function parseClipboardIcon(value: string): IconDesign {
  const trimmed = value.trim();
  if (!trimmed) throw new Error("The clipboard is empty.");

  if (trimmed.startsWith("<")) {
    const svg = /^<svg[\s>]/i.test(trimmed) ? trimmed : `<svg xmlns="http://www.w3.org/2000/svg">${trimmed}</svg>`;
    const document = new DOMParser().parseFromString(svg, "image/svg+xml");
    if (document.querySelector("parsererror")) throw new Error("The clipboard does not contain valid SVG.");
    const shapes = Array.from(document.querySelectorAll("path")).map((path) => {
      const pathData = path.getAttribute("d")?.trim();
      if (!pathData) throw new Error("Every imported SVG path must contain path data.");
      const shape = parseStraightPath(pathData);
      const inheritedAttribute = (name: string) => {
        let element: Element | null = path;
        while (element) {
          if (element.hasAttribute(name)) return element.getAttribute(name) ?? undefined;
          element = element.parentElement;
        }
        return undefined;
      };
      return {
        ...shape,
        fill: inheritedAttribute("fill"),
        stroke: inheritedAttribute("stroke"),
        strokeWidth: inheritedAttribute("stroke-width"),
        strokeLinecap: inheritedAttribute("stroke-linecap") as CSSProperties["strokeLinecap"],
        strokeLinejoin: inheritedAttribute("stroke-linejoin") as CSSProperties["strokeLinejoin"]
      };
    });
    if (shapes.length === 0) throw new Error("The SVG does not contain any paths.");
    return { points: shapes[0].points, closed: shapes[0].closed, shapes };
  }

  return parseStraightPath(trimmed);
}

function parseStraightPath(pathData: string): IconShape {
  const tokens = pathData.match(/[a-zA-Z]|[-+]?(?:\d*\.\d+|\d+\.?)(?:e[-+]?\d+)?/gi) ?? [];
  const separators = pathData.replace(/[a-zA-Z]|[-+]?(?:\d*\.\d+|\d+\.?)(?:e[-+]?\d+)?/gi, "");
  if (/[^\s,]/.test(separators)) throw new Error("The clipboard contains invalid SVG path data.");

  const points: MapPoint[] = [];
  let command = "";
  let index = 0;
  let x = 0;
  let y = 0;
  let closed = false;
  const readNumber = () => {
    const token = tokens[index++];
    if (token === undefined || /[a-z]/i.test(token)) throw new Error(`SVG command ${command} is missing a coordinate.`);
    return Number(token);
  };

  while (index < tokens.length) {
    if (/[a-z]/i.test(tokens[index])) command = tokens[index++];
    if (!command) throw new Error("SVG path data must start with a move command.");
    const relative = command === command.toLowerCase();
    switch (command.toUpperCase()) {
      case "M":
      case "L": {
        const nextX = readNumber();
        const nextY = readNumber();
        x = relative ? x + nextX : nextX;
        y = relative ? y + nextY : nextY;
        points.push([roundIconCoordinate(x), roundIconCoordinate(y)]);
        if (command.toUpperCase() === "M") command = relative ? "l" : "L";
        break;
      }
      case "H":
        x = relative ? x + readNumber() : readNumber();
        points.push([roundIconCoordinate(x), roundIconCoordinate(y)]);
        break;
      case "V":
        y = relative ? y + readNumber() : readNumber();
        points.push([roundIconCoordinate(x), roundIconCoordinate(y)]);
        break;
      case "Z":
        closed = true;
        command = "";
        break;
      default:
        throw new Error(`SVG command ${command} is not supported. Use straight-line M, L, H, V, and Z commands.`);
    }
  }

  if (points.length === 0) throw new Error("The SVG path does not contain any points.");
  return { points, closed };
}

function formatPoint(point: MapPoint): string {
  return `${roundIconCoordinate(point[0])},${roundIconCoordinate(point[1])}`;
}

function roundIconCoordinate(value: number): number {
  return Math.round(value * 10) / 10;
}

function pointerToIconPoint(event: PointerEvent<SVGSVGElement>): MapPoint {
  const rect = event.currentTarget.getBoundingClientRect();
  return [
    roundIconCoordinate(((event.clientX - rect.left) / rect.width) * 40 - 20),
    roundIconCoordinate(((event.clientY - rect.top) / rect.height) * 40 - 20)
  ];
}

function cloneIconDesign(design: IconDesign): IconDesign {
  return {
    closed: design.closed,
    points: design.points.map((point) => [...point] as MapPoint),
    shapes: design.shapes?.map((shape) => ({ ...shape, points: shape.points.map((point) => [...point] as MapPoint) }))
  };
}

function cloneIconDesigns(designs: Record<UnitType, IconDesign>): Record<UnitType, IconDesign> {
  return Object.fromEntries(unitTypes.map((type) => [type, cloneIconDesign(designs[type])])) as Record<UnitType, IconDesign>;
}

function cloneOrderIconDesigns(designs: Record<OrderKind, IconDesign>): Record<OrderKind, IconDesign> {
  return Object.fromEntries(orderKinds.map((kind) => [kind, cloneIconDesign(designs[kind])])) as Record<OrderKind, IconDesign>;
}

function cloneIconDesignLibrary(designs: IconDesignLibrary): IconDesignLibrary {
  return {
    units: cloneIconDesigns(designs.units),
    orders: cloneOrderIconDesigns(designs.orders),
    board: Object.fromEntries(boardIconKinds.map((kind) => [kind, cloneIconDesign(designs.board[kind])])) as Record<BoardIconKind, IconDesign>
  };
}

function unitLabel(type: UnitType) {
  return { infantry: "Infantry", cavalry: "Cavalry", fleet: "Fleet", artillery: "Artillery Engine" }[type];
}

function boardIconLabel(kind: BoardIconKind) {
  return {
    majorObjective: gameBundle.ui.features.majorObjective,
    objective: gameBundle.ui.features.objective,
    resourceSite: gameBundle.ui.features.resource,
    capacity: gameBundle.ui.features.capacity,
    initiative: gameBundle.ui.tracks.turnOrder,
    combat: gameBundle.ui.tracks.combatOrder,
    orders: gameBundle.ui.tracks.specialOrderOrder,
    facedown: "Face-down Order",
    special: "Special Order Star"
  }[kind];
}

createRoot(document.getElementById("root")!).render(<App />);

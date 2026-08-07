export type PlayerKey = string;

export type Phase =
  | "lobby"
  | "setup"
  | "event"
  | "planning"
  | "reveal"
  | "disrupt"
  | "advance"
  | "gather"
  | "cleanup"
  | "complete";

export type AreaType = "land" | "sea" | "port";
export type UnitType = "infantry" | "cavalry" | "fleet" | "artillery";
export type OrderKind = "advance" | "defend" | "support" | "disrupt" | "gather";

export type Order = {
  kind: OrderKind;
  special?: boolean;
};

export type Unit = {
  playerKey: PlayerKey;
  type: UnitType;
  routed?: boolean;
};

export type Area = {
  id: string;
  name: string;
  type: AreaType;
  objective: 0 | 1 | 2;
  resourceSites: number;
  capacity: number;
  adjacent: string[];
  portOf?: string;
};

export type Player = {
  id: string;
  name: string;
  playerKey: PlayerKey;
  ready: boolean;
  resource: number;
  hand: string[];
  usedCombatCards: string[];
};

export type Tracks = {
  round: number;
  score: Record<PlayerKey, number>;
  capacity: Record<PlayerKey, number>;
  turnOrder: PlayerKey[];
  combatOrder: PlayerKey[];
  specialOrderOrder: PlayerKey[];
  threat: number;
};

export type GameState = {
  id: string;
  seed: string;
  phase: Phase;
  players: Player[];
  areas: Record<string, Area>;
  units: Record<string, Unit[]>;
  orders: Record<string, Order>;
  control: Record<string, PlayerKey>;
  tracks: Tracks;
  log: string[];
  pending: PendingAction | null;
  combat: CombatState | null;
  winner: PlayerKey | null;
};

export type CombatState = {
  area: string;
  attacker: PlayerKey;
  defender: PlayerKey;
  attackerBaseStrength: number;
  defenderBaseStrength: number;
  chosenCards: Partial<Record<PlayerKey, string>>;
  committedPlayerKeys: PlayerKey[];
  status: "choosing" | "revealed";
  winner?: PlayerKey;
  attackerStrength?: number;
  defenderStrength?: number;
};

export type PendingAction =
  | { type: "placeOrders"; playerKey: PlayerKey }
  | { type: "disrupt"; playerKey: PlayerKey }
  | { type: "advance"; playerKey: PlayerKey }
  | { type: "gather"; playerKey: PlayerKey }
  | { type: "combat"; playerKey: PlayerKey };

export type LegalOrderPlacement = {
  area: string;
  currentOrder?: Order;
};

export type LegalDisruptAction = {
  from: string;
  targets: string[];
};

export type LegalAdvanceAction = {
  from: string;
  units: UnitType[];
  destinations: string[];
  unitDestinations: Partial<Record<UnitType, string[]>>;
};

export type LegalGatherAction = {
  area: string;
  amount: number;
};

export type AdvanceMove = {
  to: string;
  units: UnitType[];
};

export type AdvanceCommand =
  | { type: "advance"; playerId: string; from: string; moves: AdvanceMove[] }
  | { type: "advance"; playerId: string; from: string; to: string; units: UnitType[] };

export type Command =
  | { type: "join"; playerId: string; name: string; playerKey: PlayerKey }
  | { type: "ready"; playerId: string; ready: boolean }
  | { type: "start" }
  | { type: "startCombatTest"; playerId: string }
  | { type: "placeOrders"; playerId: string; orders: Record<string, Order> }
  | { type: "revealOrders"; playerId: string }
  | { type: "skipDisrupt"; playerId: string }
  | { type: "disrupt"; playerId: string; from: string; target: string }
  | { type: "skipAdvance"; playerId: string }
  | AdvanceCommand
  | { type: "skipGather"; playerId: string }
  | { type: "gather"; playerId: string; area: string }
  | { type: "playCombatCard"; playerId: string; cardId: string }
  | { type: "continueCombat"; playerId: string };

export type Event =
  | { type: "gameCreated"; gameId: string; seed: string }
  | { type: "playerJoined"; player: Player }
  | { type: "playerReadyChanged"; playerId: string; ready: boolean }
  | { type: "gameStarted"; playerKeys: PlayerKey[] }
  | { type: "combatTestStarted"; playerKeys: PlayerKey[]; attacker: PlayerKey; defender: PlayerKey; support: PlayerKey }
  | { type: "ordersPlaced"; playerKey: PlayerKey; orders: Record<string, Order> }
  | { type: "ordersRevealed" }
  | { type: "orderRemoved"; area: string }
  | { type: "logMessage"; message: string }
  | { type: "unitsMoved"; from: string; to: string; units: Unit[]; playerKey: PlayerKey }
  | { type: "combatStarted"; combat: CombatState }
  | { type: "combatCardChosen"; playerKey: PlayerKey; cardId: string }
  | { type: "combatEnded" }
  | { type: "combatResolved"; area: string; attacker: PlayerKey; defender: PlayerKey; winner: PlayerKey; attackerStrength: number; defenderStrength: number }
  | { type: "resourceCollected"; playerKey: PlayerKey; area: string; amount: number }
  | { type: "resourceAdjusted"; playerKey: PlayerKey; amount: number; reason: string }
  | { type: "capacityUpdated"; capacity: Record<PlayerKey, number> }
  | { type: "phaseChanged"; phase: Phase; pending: PendingAction | null }
  | { type: "roundAdvanced"; round: number }
  | { type: "scoreUpdated"; score: Record<PlayerKey, number>; winner: PlayerKey | null };

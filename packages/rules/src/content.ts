import type { AreaType, OrderKind, UnitType } from "./types.js";

export type CombatCardDefinition = {
  id: string;
  name: string;
  strength: number;
  symbol?: string;
  text?: string;
};

export type StartingUnitPlacement = {
  area: string;
  units: UnitType[];
};

export type CardStyleDefinition = {
  background: string;
  foreground: string;
  accent: string;
};

export type TerrainDefinition = {
  id: string;
  color: string;
  texture: "snow" | "grass" | "rock" | "field" | "sand" | "wave" | "none";
  areaType: "land" | "sea";
};

export type PlayerKeyDefinition = {
  id: string;
  name: string;
  description?: string;
  emblem: string;
  color: string;
  cardStyle?: CardStyleDefinition;
  startingUnits: StartingUnitPlacement[];
  cards: CombatCardDefinition[];
};

export type BundleAreaDefinition = {
  id: string;
  name: string;
  shortName?: string;
  type: AreaType;
  objective: 0 | 1 | 2;
  resourceSites: number;
  capacity: number;
  terrain: string;
  adjacent: string[];
};

export type GameModeDefinition = {
  name: string;
  description?: string;
  playerKeys: string[];
  areaIds?: string[];
  minPlayers?: number;
  maxPlayers?: number;
  scoreTarget?: number;
  allowedOrderKinds?: OrderKind[];
  allowSpecialOrders?: boolean;
  allowedUnitTypes?: UnitType[];
  orderLabels?: Partial<Record<OrderKind, string>>;
  startingUnits?: Record<string, StartingUnitPlacement[]>;
  openingMoves?: Record<string, { from: string; to: string }>;
};

export type GameBundle = {
  schemaVersion: 1;
  id: string;
  name: string;
  description: string;
  ui: {
    title: string;
    eyebrow: string;
    subtitle: string;
    playerLabel: string;
    playerPlural: string;
    combatCardLabel: string;
    combatCardPlural: string;
    threatLabel: string;
    boardAriaLabel: string;
    logLabel: string;
    features: {
      majorObjective: string;
      objective: string;
      resource: string;
      capacity: string;
    };
    tracks: {
      turnOrder: string;
      combatOrder: string;
      specialOrderOrder: string;
    };
  };
  rules: {
    minPlayers: number;
    maxPlayers: number;
    initialResource: number;
    initialCapacity: number;
    initialThreat: number;
    scoreTarget: number;
    maxRounds: number;
    modes?: Record<string, GameModeDefinition>;
  };
  testScenario?: {
    attackerFrom: string;
    defenderArea: string;
    supportArea: string;
  };
  players: PlayerKeyDefinition[];
  map: {
    visual: {
      hexRadius: number;
      origin: [number, number];
      editorRows: number;
      viewBox: string;
      width: number;
      height: number;
    };
    terrains: TerrainDefinition[];
    columns: number;
    rows: number;
    areas: BundleAreaDefinition[];
    grid: string[][];
    adjacencyMode?: "grid" | "explicit";
    connections?: [string, string][];
  };
};

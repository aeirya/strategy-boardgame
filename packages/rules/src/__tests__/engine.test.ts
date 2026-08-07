import { describe, expect, it } from "vitest";
import { createInitialState, decide, getLegalAdvanceActions, getLegalOrderPlacements, getLegalDisruptActions, hasAnyLegalAction, reduceEvents } from "../engine.js";
import type { Command, GameState, PlayerKey, Order } from "../types.js";

const players: Array<[string, PlayerKey]> = [
  ["p1", "adur"],
  ["p2", "mihr"],
  ["p3", "wahram"]
];

function run(state: GameState, command: Command): GameState {
  return reduceEvents(state, decide(state, command));
}

function startedGame(): GameState {
  let state = createInitialState("test", "seed");
  for (const [playerId, playerKey] of players) {
    state = run(state, { type: "join", playerId, name: playerKey, playerKey });
    state = run(state, { type: "ready", playerId, ready: true });
  }
  return run(state, { type: "start" });
}

function legalOrders(state: GameState, playerKey: PlayerKey, order: Order = { kind: "advance" }) {
  return Object.fromEntries(
    Object.entries(state.units)
      .filter(([, units]) => units.some((unit) => unit.playerKey === playerKey))
      .map(([area]) => [area, order])
  );
}

function placeAllOrders(state: GameState, ordersByPlayerKey: Record<PlayerKey, Order>): GameState {
  let next = state;
  for (const [playerId, playerKey] of players) {
    next = run(next, { type: "placeOrders", playerId, orders: legalOrders(next, playerKey, ordersByPlayerKey[playerKey]) });
  }
  return next;
}

describe("rules engine", () => {
  it("starts with 3-6 ready players and enters planning", () => {
    const state = startedGame();
    expect(state.phase).toBe("planning");
    expect(state.pending).toEqual({ type: "placeOrders", playerKey: "adur" });
    expect(state.units.adurGate).toHaveLength(2);
  });

  it("requires one order in each occupied area", () => {
    const state = startedGame();
    expect(() => decide(state, { type: "placeOrders", playerId: "p1", orders: { adurGate: { kind: "advance" } } })).toThrow(/exactly one order/i);
  });

  it("enforces special order limits from the special-order priority track", () => {
    const state = startedGame();
    const orders = legalOrders(state, "wahram", { kind: "advance", special: true });
    expect(() => decide(state, { type: "placeOrders", playerId: "p3", orders })).toThrow(/not this player's order/i);
  });

  it("reveals hidden orders after all players place them", () => {
    let state = startedGame();
    state = placeAllOrders(state, {
      adur: { kind: "advance", special: true },
      mihr: { kind: "advance" },
      wahram: { kind: "advance" },
      anahid: { kind: "advance" },
      xwarrah: { kind: "advance" },
      tishtar: { kind: "advance" }
    });
    expect(state.phase).toBe("reveal");
    state = run(state, { type: "revealOrders", playerId: "p1" });
    expect(state.phase).toBe("advance");
    expect(state.pending).toEqual({ type: "advance", playerKey: "adur" });
  });

  it("validates movement adjacency", () => {
    let state = startedGame();
    state = placeAllOrders(state, {
      adur: { kind: "advance", special: true },
      mihr: { kind: "advance" },
      wahram: { kind: "advance" },
      anahid: { kind: "advance" },
      xwarrah: { kind: "advance" },
      tishtar: { kind: "advance" }
    });
    state = run(state, { type: "revealOrders", playerId: "p1" });
    expect(() => decide(state, { type: "advance", playerId: "p1", from: "adurGate", moves: [{ to: "mihrCourt", units: ["infantry"] }] })).toThrow(/not adjacent/i);
  });

  it("resolves simple combat and updates score", () => {
    let state = startedGame();
    state = {
      ...state,
      units: {
        ...state.units,
        whitePass: [{ playerKey: "adur", type: "cavalry" }],
        crossroads: [{ playerKey: "mihr", type: "infantry" }]
      },
      orders: {}
    };
    state = placeAllOrders(state, {
      adur: { kind: "advance", special: true },
      mihr: { kind: "defend" },
      wahram: { kind: "advance" },
      anahid: { kind: "advance" },
      xwarrah: { kind: "advance" },
      tishtar: { kind: "advance" }
    });
    state = run(state, { type: "revealOrders", playerId: "p1" });
    state = run(state, { type: "advance", playerId: "p1", from: "whitePass", moves: [{ to: "crossroads", units: ["cavalry"] }] });
    expect(state.combat?.status).toBe("choosing");
    expect(state.units.crossroads).toEqual(expect.arrayContaining([
      expect.objectContaining({ playerKey: "adur", type: "cavalry" }),
      expect.objectContaining({ playerKey: "mihr", type: "infantry" })
    ]));
    state = run(state, { type: "playCombatCard", playerId: "p1", cardId: "adur-vanguard" });
    state = run(state, { type: "playCombatCard", playerId: "p2", cardId: "mihr-seer" });
    expect(state.control.crossroads).toBe("adur");
    expect(state.tracks.score.adur).toBeGreaterThanOrEqual(2);
  });

  it("starts the combat fixture with enemies in neighboring areas", () => {
    let state = startedGame();
    state = { ...state, phase: "lobby", pending: null, combat: null };
    state = run(state, { type: "startCombatTest", playerId: "p1" });
    expect(state.phase).toBe("advance");
    expect(state.pending).toEqual({ type: "advance", playerKey: "adur" });
    expect(state.units.whitePass).toEqual(expect.arrayContaining([expect.objectContaining({ playerKey: "adur" })]));
    expect(state.units.crossroads).toEqual(expect.arrayContaining([expect.objectContaining({ playerKey: "mihr" })]));
    expect(state.combat).toBeNull();
  });

  it("skips a player with no disrupt orders", () => {
    let state = startedGame();
    state = placeAllOrders(state, {
      adur: { kind: "advance" },
      mihr: { kind: "disrupt" },
      wahram: { kind: "disrupt" },
      anahid: { kind: "disrupt" },
      xwarrah: { kind: "disrupt" },
      tishtar: { kind: "disrupt" }
    });
    state = run(state, { type: "revealOrders", playerId: "p1" });
    expect(state.phase).toBe("disrupt");
    expect(state.pending).toEqual({ type: "disrupt", playerKey: "mihr" });
    expect(state.log).toContain("Ādur has no disrupt orders; skipped.");
  });

  it("advances when no player has valid disrupt orders", () => {
    let state = startedGame();
    state = placeAllOrders(state, {
      adur: { kind: "advance" },
      mihr: { kind: "advance" },
      wahram: { kind: "advance" },
      anahid: { kind: "advance" },
      xwarrah: { kind: "advance" },
      tishtar: { kind: "advance" }
    });
    state = run(state, { type: "revealOrders", playerId: "p1" });
    expect(state.phase).toBe("advance");
    expect(state.pending).toEqual({ type: "advance", playerKey: "adur" });
    expect(state.log).toContain("No disrupt orders remain; advancing to advance.");
  });

  it("skips gather when no gather orders exist", () => {
    let state = startedGame();
    state = placeAllOrders(state, {
      adur: { kind: "advance" },
      mihr: { kind: "advance" },
      wahram: { kind: "advance" },
      anahid: { kind: "advance" },
      xwarrah: { kind: "advance" },
      tishtar: { kind: "advance" }
    });
    state = run(state, { type: "revealOrders", playerId: "p1" });
    state = run(state, { type: "skipAdvance", playerId: "p1" });
    state = run(state, { type: "skipAdvance", playerId: "p2" });
    state = run(state, { type: "skipAdvance", playerId: "p3" });
    expect(state.phase).toBe("planning");
    expect(state.log).toContain("No gather resource orders remain; advancing to cleanup.");
  });

  it("skips advance when no advance orders exist", () => {
    let state = startedGame();
    state = placeAllOrders(state, {
      adur: { kind: "gather" },
      mihr: { kind: "gather" },
      wahram: { kind: "gather" },
      anahid: { kind: "gather" },
      xwarrah: { kind: "gather" },
      tishtar: { kind: "gather" }
    });
    state = run(state, { type: "revealOrders", playerId: "p1" });
    expect(state.phase).toBe("gather");
    expect(state.pending).toEqual({ type: "gather", playerKey: "adur" });
    expect(state.log).toContain("No advance orders remain; advancing to gather.");
  });

  it("never auto-skips planning", () => {
    const state = startedGame();
    expect(state.phase).toBe("planning");
    expect(state.pending).toEqual({ type: "placeOrders", playerKey: "adur" });
    expect(hasAnyLegalAction({ ...state, units: {} }, "adur", "planning")).toBe(false);
  });

  it("exposes pure legal-action helpers for the UI", () => {
    let state = startedGame();
    expect(getLegalOrderPlacements(state, "p1").map((placement) => placement.area).sort()).toEqual(["adurGate", "westernSea"].sort());
    state = placeAllOrders(state, {
      adur: { kind: "disrupt" },
      mihr: { kind: "advance" },
      wahram: { kind: "advance" },
      anahid: { kind: "advance" },
      xwarrah: { kind: "advance" },
      tishtar: { kind: "advance" }
    });
    state = run(state, { type: "revealOrders", playerId: "p1" });
    expect(getLegalDisruptActions(state, "p1").map((action) => action.from).sort()).toEqual(["adurGate", "westernSea"].sort());
    state = run(state, { type: "skipDisrupt", playerId: "p1" });
    expect(getLegalAdvanceActions(state, "p2").length).toBeGreaterThan(0);
  });

  it("does not count blocked disrupt or advance orders as legal actions", () => {
    let state = startedGame();
    state = {
      ...state,
      phase: "disrupt",
      pending: { type: "disrupt", playerKey: "adur" },
      orders: { adurGate: { kind: "disrupt" }, westernSea: { kind: "advance" } }
    };
    expect(hasAnyLegalAction(state, "adur", "disrupt")).toBe(false);

    state = {
      ...state,
      phase: "advance",
      pending: { type: "advance", playerKey: "adur" },
      units: {
        ...state.units,
        covenantFields: [{ playerKey: "adur", type: "fleet" }]
      },
      orders: { covenantFields: { kind: "advance" } }
    };
    expect(hasAnyLegalAction(state, "adur", "advance")).toBe(false);
  });

  it("applies disrupt restrictions and special defend disrupts", () => {
    let state = startedGame();
    state = {
      ...state,
      phase: "disrupt",
      pending: { type: "disrupt", playerKey: "adur" },
      units: {
        ...state.units,
        adurGate: [{ playerKey: "adur", type: "infantry" }],
        westernSea: [{ playerKey: "wahram", type: "fleet" }],
        whitePass: [{ playerKey: "mihr", type: "infantry" }]
      },
      orders: {
        adurGate: { kind: "disrupt" },
        westernSea: { kind: "support" },
        whitePass: { kind: "defend" }
      }
    };

    expect(() => decide(state, { type: "disrupt", playerId: "p1", from: "adurGate", target: "westernSea" })).toThrow(/not reachable/i);
    expect(() => decide(state, { type: "disrupt", playerId: "p1", from: "adurGate", target: "whitePass" })).toThrow(/cannot be disrupted/i);

    state = { ...state, orders: { ...state.orders, adurGate: { kind: "disrupt", special: true } } };
    state = run(state, { type: "disrupt", playerId: "p1", from: "adurGate", target: "whitePass" });
    expect(state.orders.whitePass).toBeUndefined();
  });

  it("transfers resource when disrupting a gather resource order", () => {
    let state = startedGame();
    state = {
      ...state,
      phase: "disrupt",
      pending: { type: "disrupt", playerKey: "adur" },
      units: {
        ...state.units,
        adurGate: [{ playerKey: "adur", type: "infantry" }],
        whitePass: [{ playerKey: "mihr", type: "infantry" }]
      },
      orders: {
        adurGate: { kind: "disrupt" },
        whitePass: { kind: "gather" }
      }
    };

    state = run(state, { type: "disrupt", playerId: "p1", from: "adurGate", target: "whitePass" });
    expect(state.players.find((player) => player.playerKey === "adur")?.resource).toBe(6);
    expect(state.players.find((player) => player.playerKey === "mihr")?.resource).toBe(4);
  });

  it("collects one resource plus resourceSite icons when gathering", () => {
    let state = startedGame();
    state = {
      ...state,
      phase: "gather",
      pending: { type: "gather", playerKey: "mihr" },
      orders: { mihrCourt: { kind: "gather" } }
    };

    state = run(state, { type: "gather", playerId: "p2", area: "mihrCourt" });
    expect(state.players.find((player) => player.playerKey === "mihr")?.resource).toBe(7);
  });

  it("uses artillery strength only when attacking a objective or majorObjective", () => {
    let state = startedGame();
    state = {
      ...state,
      units: {
        ...state.units,
        whitePass: [{ playerKey: "adur", type: "artillery" }],
        crossroads: [{ playerKey: "mihr", type: "infantry" }]
      },
      orders: {}
    };
    state = placeAllOrders(state, {
      adur: { kind: "advance" },
      mihr: { kind: "defend" },
      wahram: { kind: "advance" },
      anahid: { kind: "advance" },
      xwarrah: { kind: "advance" },
      tishtar: { kind: "advance" }
    });
    state = run(state, { type: "revealOrders", playerId: "p1" });
    const events = decide(state, { type: "advance", playerId: "p1", from: "whitePass", moves: [{ to: "crossroads", units: ["artillery"] }] });
    expect(events).toContainEqual(expect.objectContaining({
      type: "combatStarted",
      combat: expect.objectContaining({ attackerBaseStrength: 3 })
    }));

    state = {
      ...state,
      units: {
        ...state.units,
        adurGate: [{ playerKey: "adur", type: "artillery" }],
        westernSea: [{ playerKey: "mihr", type: "fleet" }]
      },
      orders: { adurGate: { kind: "advance" }, westernSea: { kind: "defend" } }
    };
    expect(() => decide(state, { type: "advance", playerId: "p1", from: "adurGate", moves: [{ to: "westernSea", units: ["artillery"] }] })).toThrow(/cannot move/i);
  });

  it("adds friendly adjacent support to combat strength", () => {
    let state = startedGame();
    state = {
      ...state,
      phase: "advance",
      pending: { type: "advance", playerKey: "adur" },
      units: {
        ...state.units,
        whitePass: [{ playerKey: "adur", type: "cavalry" }],
        covenantFields: [{ playerKey: "adur", type: "infantry" }],
        crossroads: [{ playerKey: "mihr", type: "infantry" }]
      },
      orders: {
        whitePass: { kind: "advance" },
        covenantFields: { kind: "support", special: true },
        crossroads: { kind: "defend", special: true }
      }
    };

    const events = decide(state, { type: "advance", playerId: "p1", from: "whitePass", moves: [{ to: "crossroads", units: ["cavalry"] }] });
    expect(events).toContainEqual(expect.objectContaining({
      type: "combatStarted",
      combat: expect.objectContaining({ attackerBaseStrength: 3, defenderBaseStrength: 3 })
    }));
  });

  it("prevents advances that exceed the current capacity limit", () => {
    const base = startedGame();
    const state: GameState = {
      ...base,
      phase: "advance",
      pending: { type: "advance", playerKey: "adur" },
      tracks: {
        ...base.tracks,
        capacity: { ...base.tracks.capacity, adur: 0 }
      },
      units: {
        ...base.units,
        adurGate: [
          { playerKey: "adur", type: "infantry" },
          { playerKey: "adur", type: "infantry" },
          { playerKey: "adur", type: "infantry" }
        ],
        tishtarTower: [{ playerKey: "adur", type: "infantry" }, { playerKey: "adur", type: "infantry" }],
        covenantFields: [{ playerKey: "adur", type: "infantry" }, { playerKey: "adur", type: "infantry" }],
        whitePass: []
      },
      orders: { adurGate: { kind: "advance" } }
    };

    expect(() => decide(state, { type: "advance", playerId: "p1", from: "adurGate", moves: [{ to: "whitePass", units: ["infantry", "infantry"] }] })).toThrow(/capacity/i);
  });

  it("allows one advance order to split units among adjacent friendly and empty areas", () => {
    let state = startedGame();
    state = {
      ...state,
      phase: "advance",
      pending: { type: "advance", playerKey: "adur" },
      units: {
        ...state.units,
        adurGate: [
          { playerKey: "adur", type: "infantry" },
          { playerKey: "adur", type: "cavalry" },
          { playerKey: "adur", type: "artillery" }
        ],
        tishtarTower: [{ playerKey: "adur", type: "infantry" }],
        whitePass: []
      },
      orders: { adurGate: { kind: "advance" } }
    };

    state = run(state, {
      type: "advance",
      playerId: "p1",
      from: "adurGate",
      moves: [
        { to: "tishtarTower", units: ["infantry"] },
        { to: "whitePass", units: ["cavalry"] }
      ]
    });

    expect(state.units.adurGate).toEqual([{ playerKey: "adur", type: "artillery" }]);
    expect(state.units.tishtarTower.filter((unit) => unit.playerKey === "adur")).toHaveLength(2);
    expect(state.units.whitePass).toEqual([{ playerKey: "adur", type: "cavalry" }]);
  });

  it("still accepts the single-destination advance command shape", () => {
    let state = startedGame();
    state = {
      ...state,
      phase: "advance",
      pending: { type: "advance", playerKey: "adur" },
      units: {
        ...state.units,
        adurGate: [{ playerKey: "adur", type: "infantry" }, { playerKey: "adur", type: "cavalry" }],
        whitePass: []
      },
      orders: { adurGate: { kind: "advance" } }
    };

    state = run(state, { type: "advance", playerId: "p1", from: "adurGate", to: "whitePass", units: ["infantry"] });

    expect(state.units.adurGate).toEqual([{ playerKey: "adur", type: "cavalry" }]);
    expect(state.units.whitePass).toEqual([{ playerKey: "adur", type: "infantry" }]);
  });

  it("lists friendly adjacent areas as legal advance destinations", () => {
    const state = {
      ...startedGame(),
      phase: "advance" as const,
      pending: { type: "advance" as const, playerKey: "adur" as const },
      units: {
        ...startedGame().units,
        adurGate: [{ playerKey: "adur" as const, type: "infantry" as const }],
        tishtarTower: [{ playerKey: "adur" as const, type: "infantry" as const }]
      },
      orders: { adurGate: { kind: "advance" as const } }
    };

    expect(getLegalAdvanceActions(state, "p1").find((action) => action.from === "adurGate")?.destinations).toContain("tishtarTower");
  });

  it("rejects a split advance that enters more than one enemy-occupied area", () => {
    const base = startedGame();
    const state: GameState = {
      ...base,
      phase: "advance",
      pending: { type: "advance", playerKey: "adur" },
      units: {
        ...base.units,
        adurGate: [{ playerKey: "adur", type: "infantry" }, { playerKey: "adur", type: "cavalry" }],
        tishtarTower: [{ playerKey: "mihr", type: "infantry" }],
        whitePass: [{ playerKey: "wahram", type: "infantry" }]
      },
      orders: { adurGate: { kind: "advance" } }
    };

    expect(() => decide(state, {
      type: "advance",
      playerId: "p1",
      from: "adurGate",
      moves: [
        { to: "tishtarTower", units: ["infantry"] },
        { to: "whitePass", units: ["cavalry"] }
      ]
    })).toThrow(/only one enemy/i);
  });

  it("updates capacity from controlled capacity icons during cleanup", () => {
    let state = startedGame();
    state = {
      ...state,
      phase: "gather",
      pending: { type: "gather", playerKey: "wahram" },
      orders: {},
      control: {
        ...state.control,
        adurGate: "adur",
        whitePass: "adur",
        crossroads: "adur"
      }
    };

    state = run(state, { type: "skipGather", playerId: "p3" });
    expect(state.tracks.round).toBe(2);
    expect(state.tracks.capacity.adur).toBe(3);
    expect(state.phase).toBe("planning");
  });
});

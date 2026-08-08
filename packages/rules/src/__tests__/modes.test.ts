import { describe, expect, it } from "vitest";
import { createInitialState, decide, reduceEvents } from "../engine.js";
import { applyGameModeState, prepareGameModeCommand, validateGameModeCommand } from "../modes.js";
import type { Command, GameState, PlayerKey } from "../types.js";

const modeId = "three-houses";
const players: Array<[string, PlayerKey]> = [
  ["p1", "adur"],
  ["p2", "mihr"],
  ["p3", "wahram"]
];

function run(state: GameState, submitted: Command): GameState {
  const command = prepareGameModeCommand(state, submitted, modeId);
  validateGameModeCommand(state, command, modeId);
  return applyGameModeState(reduceEvents(state, decide(state, command)), command, modeId);
}

function startedModeGame(): GameState {
  let state = createInitialState("three-houses-test", "seed");
  for (const [playerId, playerKey] of players) {
    state = run(state, { type: "join", playerId, name: playerKey, playerKey });
    state = run(state, { type: "ready", playerId, ready: true });
  }
  return run(state, { type: "start" });
}

describe("optional game modes", () => {
  it("starts Three Houses with only the two simple land unit types", () => {
    const state = startedModeGame();

    expect(state.phase).toBe("planning");
    expect(state.units.adurGate).toEqual([{ playerKey: "adur", type: "infantry" }]);
    expect(state.units.whitePass).toEqual([
      { playerKey: "adur", type: "infantry" },
      { playerKey: "adur", type: "cavalry" }
    ]);
    expect(state.units.mihrCourt).toHaveLength(1);
    expect(state.units.covenantFields).toHaveLength(2);
    expect(state.units.wahramHold).toHaveLength(1);
    expect(state.units.redRoad).toHaveLength(2);
    expect(state.units.westernSea).toEqual([]);
    expect(state.control.crossroads).toBeUndefined();
    expect(state.tracks.score.adur).toBe(2);
    expect(state.tracks.score.mihr).toBe(2);
    expect(state.tracks.score.wahram).toBe(2);
  });

  it("forces each opening frontier to march only toward the neutral Crossroads", () => {
    let state = startedModeGame();

    expect(state.areas.whitePass.adjacent).toEqual(["crossroads"]);
    expect(state.areas.covenantFields.adjacent).toEqual(["crossroads"]);
    expect(state.areas.redRoad.adjacent).toEqual(["crossroads"]);
    expect(state.areas.anahidGarden.adjacent).toEqual([]);

    state = run(state, {
      type: "placeOrders",
      playerId: "p1",
      orders: {
        adurGate: { kind: "gather", special: true },
        whitePass: { kind: "support", special: true }
      }
    });

    expect(state.orders.adurGate).toEqual({ kind: "defend" });
    expect(state.orders.whitePass).toEqual({ kind: "advance" });
  });

  it("rejects players and orders outside the selected mode", () => {
    const state = startedModeGame();

    expect(() => validateGameModeCommand(state, {
      type: "join",
      playerId: "p4",
      name: "Anahid",
      playerKey: "anahid"
    }, modeId)).toThrow(/does not use that player/i);

    expect(() => validateGameModeCommand(state, {
      type: "placeOrders",
      playerId: "p1",
      orders: {
        adurGate: { kind: "gather" },
        whitePass: { kind: "advance" }
      }
    }, modeId)).toThrow(/only allows/i);
  });
});

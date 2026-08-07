import { describe, expect, it } from "vitest";
import { canUseOrder, commitHistory, createHistory, cycleOrder, moveOrder, placeOrder, redoHistory, removeOrder, undoHistory } from "./planningOrders";

describe("planning order drafts", () => {
  it("cycles variants only when inventory and special allowance permit it", () => {
    expect(cycleOrder({ kind: "advance" }, 1, {}, 1)).toEqual({ kind: "advance", special: true });
    expect(cycleOrder({ kind: "advance" }, 1, { a: { kind: "defend", special: true } }, 1)).toEqual({ kind: "advance" });
    expect(cycleOrder({ kind: "advance", special: true }, -1, {}, 1)).toEqual({ kind: "advance" });
  });

  it("restores inventory when replacing and removing an order", () => {
    const placed = placeOrder(createHistory().present, "a", { kind: "advance", special: true });
    expect(canUseOrder(placed.orders, { kind: "advance", special: true }, 3)).toBe(false);
    expect(canUseOrder(placed.orders, { kind: "advance", special: true }, 3, "a")).toBe(true);
    expect(canUseOrder(removeOrder(placed, "a").orders, { kind: "advance", special: true }, 3)).toBe(true);
  });

  it("moves and replaces using one draft mutation", () => {
    const start = { orders: { a: { kind: "advance" as const }, b: { kind: "disrupt" as const } }, positions: {} };
    expect(moveOrder(start, "a", "b").orders).toEqual({ b: { kind: "advance" } });
  });

  it("undoes and redoes placement, replacement, move, and clear snapshots", () => {
    let history = createHistory();
    history = commitHistory(history, placeOrder(history.present, "a", { kind: "advance" }));
    history = commitHistory(history, placeOrder(history.present, "a", { kind: "defend" }));
    history = commitHistory(history, moveOrder(history.present, "a", "b"));
    history = commitHistory(history, { orders: {}, positions: {} });
    history = undoHistory(history);
    expect(history.present.orders).toEqual({ b: { kind: "defend" } });
    history = redoHistory(history);
    expect(history.present.orders).toEqual({});
  });
});

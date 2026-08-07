import type { Order, OrderKind } from "@tabletop/rules";

export type OrderVariant = {
  order: Order;
  count: number;
  modifier?: string;
  strength: number;
};

export type OrderFamily = {
  kind: OrderKind;
  label: string;
  shortLabel: string;
  shortcut: string;
  angle: number;
  variants: OrderVariant[];
};

export type PlanningDraft = Record<string, Order>;

export type DraftSnapshot = {
  orders: PlanningDraft;
  positions: Record<string, [number, number]>;
};

export type DraftHistory = {
  past: DraftSnapshot[];
  present: DraftSnapshot;
  future: DraftSnapshot[];
};

export const orderFamilies: OrderFamily[] = [
  { kind: "advance", label: "Advance", shortLabel: "Advance", shortcut: "1", angle: 144, variants: [
    { order: { kind: "advance" }, count: 2, modifier: "-1", strength: 0 },
    { order: { kind: "advance", special: true }, count: 1, modifier: "+1", strength: 1 }
  ] },
  { kind: "defend", label: "Defend", shortLabel: "Defend", shortcut: "2", angle: 270, variants: [
    { order: { kind: "defend" }, count: 2, modifier: "+1", strength: 0 },
    { order: { kind: "defend", special: true }, count: 1, modifier: "+2", strength: 1 }
  ] },
  { kind: "support", label: "Support", shortLabel: "Support", shortcut: "3", angle: 324, variants: [
    { order: { kind: "support" }, count: 2, modifier: "+0", strength: 0 },
    { order: { kind: "support", special: true }, count: 1, modifier: "+1", strength: 1 }
  ] },
  { kind: "disrupt", label: "Disrupt", shortLabel: "Disrupt", shortcut: "4", angle: 216, variants: [
    { order: { kind: "disrupt" }, count: 2, strength: 0 },
    { order: { kind: "disrupt", special: true }, count: 1, strength: 1 }
  ] },
  { kind: "gather", label: "Gather Resource", shortLabel: "Gather", shortcut: "5", angle: 36, variants: [
    { order: { kind: "gather" }, count: 2, strength: 0 },
    { order: { kind: "gather", special: true }, count: 1, strength: 1 }
  ] }
];

export function ordersEqual(left?: Order | null, right?: Order | null) {
  return !!left && !!right && left.kind === right.kind && !!left.special === !!right.special;
}

export function familyForShortcut(key: string) {
  return orderFamilies.find((family) => family.shortcut === key);
}

export function countOrder(orders: PlanningDraft, target: Order) {
  return Object.values(orders).filter((order) => ordersEqual(order, target)).length;
}

export function remainingFor(orders: PlanningDraft, variant: OrderVariant, excludingArea?: string) {
  const source = excludingArea ? Object.fromEntries(Object.entries(orders).filter(([area]) => area !== excludingArea)) : orders;
  return Math.max(0, variant.count - countOrder(source, variant.order));
}

export function canUseOrder(orders: PlanningDraft, order: Order, specialLimit: number, excludingArea?: string) {
  const family = orderFamilies.find((candidate) => candidate.kind === order.kind);
  const variant = family?.variants.find((candidate) => ordersEqual(candidate.order, order));
  if (!variant || remainingFor(orders, variant, excludingArea) <= 0) return false;
  if (!order.special) return true;
  const specialUsed = Object.entries(orders).filter(([area, candidate]) => area !== excludingArea && candidate.special).length;
  return specialUsed < specialLimit;
}

export function cycleOrder(order: Order, direction: 1 | -1, orders: PlanningDraft, specialLimit: number, excludingArea?: string) {
  const variants = orderFamilies.find((family) => family.kind === order.kind)?.variants ?? [];
  const index = variants.findIndex((variant) => ordersEqual(variant.order, order));
  const next = variants[index + direction]?.order;
  return next && canUseOrder(orders, next, specialLimit, excludingArea) ? next : order;
}

export function placeOrder(snapshot: DraftSnapshot, area: string, order: Order, position?: [number, number]): DraftSnapshot {
  return {
    orders: { ...snapshot.orders, [area]: order },
    positions: position ? { ...snapshot.positions, [area]: position } : snapshot.positions
  };
}

export function removeOrder(snapshot: DraftSnapshot, area: string): DraftSnapshot {
  const orders = { ...snapshot.orders };
  const positions = { ...snapshot.positions };
  delete orders[area];
  delete positions[area];
  return { orders, positions };
}

export function moveOrder(snapshot: DraftSnapshot, from: string, to: string, position?: [number, number]): DraftSnapshot {
  const moving = snapshot.orders[from];
  if (!moving || from === to) return snapshot;
  const withoutSource = removeOrder(snapshot, from);
  return placeOrder(withoutSource, to, moving, position);
}

export function createHistory(present: DraftSnapshot = { orders: {}, positions: {} }): DraftHistory {
  return { past: [], present, future: [] };
}

export function commitHistory(history: DraftHistory, present: DraftSnapshot, limit = 30): DraftHistory {
  if (JSON.stringify(history.present) === JSON.stringify(present)) return history;
  return { past: [...history.past, history.present].slice(-limit), present, future: [] };
}

export function undoHistory(history: DraftHistory): DraftHistory {
  const present = history.past.at(-1);
  if (!present) return history;
  return { past: history.past.slice(0, -1), present, future: [history.present, ...history.future] };
}

export function redoHistory(history: DraftHistory): DraftHistory {
  const [present, ...future] = history.future;
  if (!present) return history;
  return { past: [...history.past, history.present].slice(-30), present, future };
}

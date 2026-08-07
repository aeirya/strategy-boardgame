import { gameBundle } from "../generated/bundle.js";
import type { Area, PlayerKey, Unit } from "../types.js";

export { gameBundle };

export const playerKeys = gameBundle.players.map((player) => player.id) as PlayerKey[];

export const playerTheme = Object.fromEntries(
  gameBundle.players.map((player) => [player.id, {
    label: player.name,
    sigil: player.emblem,
    color: player.color,
    cardStyle: player.cardStyle ?? {
      background: "#182126",
      foreground: "#f4ead4",
      accent: player.color
    }
  }])
) as Record<PlayerKey, {
  label: string;
  sigil: string;
  color: string;
  cardStyle: { background: string; foreground: string; accent: string };
}>;

export const placeholderAreas = Object.fromEntries(
  gameBundle.map.areas.map((area) => [area.id, {
    id: area.id,
    name: area.name,
    type: area.type,
    objective: area.objective,
    resourceSites: area.resourceSites,
    capacity: area.capacity,
    adjacent: [...area.adjacent]
  }])
) as Record<string, Area>;

export const startingUnits = Object.fromEntries(
  gameBundle.players.map((player) => [player.id, Object.fromEntries(
    player.startingUnits.map((placement) => [placement.area, placement.units.map((type) => ({ playerKey: player.id, type }))])
  )])
) as Record<PlayerKey, Record<string, Unit[]>>;

export const combatCardsById = Object.fromEntries(
  gameBundle.players.flatMap((player) => player.cards.map((card) => [card.id, card]))
);

export function combatCardsFor(playerKey: PlayerKey) {
  return gameBundle.players.find((player) => player.id === playerKey)?.cards ?? [];
}

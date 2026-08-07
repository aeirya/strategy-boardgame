import { gameBundle } from "@tabletop/rules";

export type MapPoint = [number, number];
export type MapTerrain = string;
export type TerrainTheme = { color: string; texture: "snow" | "grass" | "rock" | "field" | "sand" | "wave" | "none"; areaType: "land" | "sea" };

export type HexTile = {
  key: string;
  row: number;
  column: number;
  center: MapPoint;
  points: string;
  baseAreaId?: string;
};

export type VisualMapArea = {
  id: string;
  displayName?: string;
  isCustom?: boolean;
  tiles: string[];
  colorNoise: {
    hue: number;
    saturation: number;
    lightness: number;
  };
  label: MapPoint;
  shortLabel?: string;
  unitSlots: MapPoint[];
  orderSlot: MapPoint;
  icons?: {
    objective?: MapPoint;
    majorObjective?: MapPoint;
    resourceSite?: MapPoint;
    capacity?: MapPoint;
  };
  terrain: MapTerrain;
  type: "land" | "sea" | "port";
};

const mapSource = gameBundle.map;
const areaRows = mapSource.grid;
const areaOrder = mapSource.areas.map((area) => area.id);
const areaById = Object.fromEntries(mapSource.areas.map((area) => [area.id, area]));
const hexRadius = mapSource.visual.hexRadius;
const hexWidth = Math.sqrt(3) * hexRadius;
const rowHeight = hexRadius * 1.5;
const origin = mapSource.visual.origin as MapPoint;
const columnCount = mapSource.columns;
const editorRowCount = mapSource.visual.editorRows;

export const mapTerrainTypes: MapTerrain[] = mapSource.terrains.map((terrain) => terrain.id);
export const terrainTheme = Object.fromEntries(
  mapSource.terrains.map((terrain) => [terrain.id, { color: terrain.color, texture: terrain.texture, areaType: terrain.areaType }])
) as Record<MapTerrain, TerrainTheme>;

export const visualHexGrid = {
  columns: columnCount,
  editorRows: editorRowCount,
  hexRadius,
  hexWidth,
  origin,
  rowHeight
};

export function hexTileKey(row: number, column: number) {
  return `${row}:${column}`;
}

export function hexCenter(row: number, column: number): MapPoint {
  return [origin[0] + column * hexWidth + (row % 2) * (hexWidth / 2), origin[1] + row * rowHeight];
}

export function hexagon(row: number, column: number): string {
  const [cx, cy] = hexCenter(row, column);
  return Array.from({ length: 6 }, (_, index) => {
    const angle = -Math.PI / 2 + index * (Math.PI * 2 / 6);
    return `${Math.round(cx + Math.cos(angle) * hexRadius)},${Math.round(cy + Math.sin(angle) * hexRadius)}`;
  }).join(" ");
}

function distanceSquared(left: MapPoint, right: MapPoint) {
  return (left[0] - right[0]) ** 2 + (left[1] - right[1]) ** 2;
}

function centroid(points: MapPoint[]): MapPoint {
  const [x, y] = points.reduce(([sumX, sumY], [pointX, pointY]) => [sumX + pointX, sumY + pointY], [0, 0]);
  return [x / points.length, y / points.length];
}

function stableNoise(id: string) {
  let hash = 2166136261;
  for (const character of id) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  return {
    hue: ((hash >>> 0) % 61) - 30,
    saturation: (((hash >>> 8) % 41) - 20),
    lightness: (((hash >>> 16) % 29) - 14)
  };
}

const ownedCenters = Object.fromEntries(areaOrder.map((areaId) => [areaId, [] as MapPoint[]])) as Record<string, MapPoint[]>;
const tilesByArea = Object.fromEntries(areaOrder.map((areaId) => [areaId, [] as string[]])) as Record<string, string[]>;

areaRows.forEach((row, rowIndex) => {
  row.forEach((areaId, columnIndex) => {
    ownedCenters[areaId].push(hexCenter(rowIndex, columnIndex));
    tilesByArea[areaId].push(hexagon(rowIndex, columnIndex));
  });
});

function generatedLayout(areaId: string) {
  const centers = ownedCenters[areaId];
  if (centers.length < 2) throw new Error(`Map area ${areaId} needs at least two grid cells for unit and order slots.`);
  const label = centroid(centers);
  const sorted = [...centers].sort((left, right) => distanceSquared(left, label) - distanceSquared(right, label));
  const unitCount = Math.min(4, centers.length - 1);
  const unitSlots = sorted.slice(0, unitCount);
  const orderSlot = sorted.find((point) => !unitSlots.some((slot) => distanceSquared(point, slot) < 0.01)) ?? sorted.at(-1)!;
  const area = areaById[areaId];
  const iconKinds = [
    area.objective === 2 ? "majorObjective" : area.objective === 1 ? "objective" : undefined,
    area.resourceSites > 0 ? "resourceSite" : undefined,
    area.capacity > 0 ? "capacity" : undefined
  ].filter(Boolean) as Array<"majorObjective" | "objective" | "resourceSite" | "capacity">;
  const icons = Object.fromEntries(iconKinds.map((kind, index) => [
    kind,
    [label[0] + (index - (iconKinds.length - 1) / 2) * 48, label[1] + 27] as MapPoint
  ]));
  return { label, unitSlots, orderSlot, icons };
}

export const baseHexAssignments = new Map<string, string>();
areaRows.forEach((row, rowIndex) => {
  row.forEach((areaId, columnIndex) => {
    baseHexAssignments.set(hexTileKey(rowIndex, columnIndex), areaId);
  });
});

export const editorHexTiles: HexTile[] = Array.from({ length: editorRowCount }, (_, row) =>
  Array.from({ length: columnCount }, (_, column) => {
    const key = hexTileKey(row, column);
    return {
      key,
      row,
      column,
      center: hexCenter(row, column),
      points: hexagon(row, column),
      baseAreaId: baseHexAssignments.get(key)
    };
  })
).flat();

export const visualMap = {
  viewBox: mapSource.visual.viewBox,
  width: mapSource.visual.width,
  height: mapSource.visual.height,
  areas: areaOrder.map((areaId) => {
    const area = areaById[areaId];
    return {
      id: areaId,
      terrain: area.terrain,
      type: area.type,
      shortLabel: area.shortName,
      colorNoise: stableNoise(areaId),
      tiles: tilesByArea[areaId],
      ...generatedLayout(areaId)
    } satisfies VisualMapArea;
  })
};

export const visualAreasById = Object.fromEntries(visualMap.areas.map((area) => [area.id, area])) as Record<string, VisualMapArea>;

export type MapIntegrityIssue = {
  areaId: string;
  kind: "adjacency" | "connectivity" | "slot" | "tiles";
  message: string;
};

type AreaAdjacency = Record<string, { adjacent: string[] }>;

export function inspectMapIntegrity(areas: AreaAdjacency): MapIntegrityIssue[] {
  const issues: MapIntegrityIssue[] = [];
  const tileKeysByArea = new Map<string, Set<string>>();
  for (const tile of editorHexTiles) {
    if (!tile.baseAreaId) continue;
    const keys = tileKeysByArea.get(tile.baseAreaId) ?? new Set<string>();
    keys.add(tile.key);
    tileKeysByArea.set(tile.baseAreaId, keys);
  }

  for (const region of visualMap.areas) {
    const ownedKeys = tileKeysByArea.get(region.id) ?? new Set<string>();
    if (ownedKeys.size === 0) issues.push({ areaId: region.id, kind: "tiles", message: "Region owns no hexes." });
    for (const [slotKind, slots] of [["order", [region.orderSlot]], ["unit", region.unitSlots]] as const) {
      slots.forEach((slot, index) => {
        const tile = editorHexTiles.find((candidate) => distanceSquared(candidate.center, slot) < 0.01);
        if (tile?.baseAreaId !== region.id) {
          issues.push({ areaId: region.id, kind: "slot", message: `${slotKind} slot ${index + 1} is outside the region.` });
        }
      });
    }
    if (ownedKeys.size > 0) {
      const visited = new Set<string>();
      const pending = [ownedKeys.values().next().value as string];
      while (pending.length > 0) {
        const key = pending.pop()!;
        if (visited.has(key)) continue;
        visited.add(key);
        const tile = editorHexTiles.find((candidate) => candidate.key === key)!;
        for (const neighbor of neighboringTileKeys(tile)) if (ownedKeys.has(neighbor) && !visited.has(neighbor)) pending.push(neighbor);
      }
      if (visited.size !== ownedKeys.size) issues.push({ areaId: region.id, kind: "connectivity", message: "Region hexes are not one connected group." });
    }
  }

  for (const [areaId, area] of Object.entries(areas)) {
    for (const adjacentId of area.adjacent) {
      if (!areas[adjacentId]) issues.push({ areaId, kind: "adjacency", message: `Unknown adjacent region ${adjacentId}.` });
      else if (!areas[adjacentId].adjacent.includes(areaId)) issues.push({ areaId, kind: "adjacency", message: `Adjacency with ${adjacentId} is not two-way.` });
    }
  }
  return issues;
}

function neighboringTileKeys(tile: HexTile) {
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

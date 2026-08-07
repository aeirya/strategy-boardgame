#!/usr/bin/env node
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve, dirname, relative } from "node:path";

const root = resolve(import.meta.dirname, "..");
const bundleDir = resolve(root, process.argv[2] ?? process.env.GAME_BUNDLE ?? "bundles/eran");
const output = resolve(root, "packages/rules/src/generated/bundle.ts");

const readJson = async (name) => JSON.parse(await readFile(resolve(bundleDir, name), "utf8"));
const [manifest, players, map] = await Promise.all([
  readJson("manifest.json"),
  readJson("players.json"),
  readJson("map.json")
]);

const fail = (message) => {
  throw new Error(`Bundle ${relative(root, bundleDir)}: ${message}`);
};
const unique = (values, label) => {
  const seen = new Set();
  for (const value of values) {
    if (!value || typeof value !== "string") fail(`${label} ids must be non-empty strings.`);
    if (seen.has(value)) fail(`duplicate ${label} id: ${value}`);
    seen.add(value);
  }
  return seen;
};

if (manifest.schemaVersion !== 1) fail("schemaVersion must be 1.");
if (!manifest.id || !manifest.name) fail("manifest needs id and name.");
if (!manifest.ui?.title || !manifest.ui?.playerLabel || !manifest.ui?.combatCardLabel) fail("manifest.ui is incomplete.");
if (!manifest.ui?.features || !manifest.ui?.tracks) fail("manifest.ui needs features and tracks labels.");
if (!Array.isArray(players) || players.length < 2) fail("players.json must contain at least two players.");
if (!Array.isArray(map.areas) || map.areas.length === 0) fail("map.json must contain areas.");
if (!Array.isArray(map.grid) || map.grid.length === 0) fail("map.json must contain a non-empty grid.");

const playerIds = unique(players.map((player) => player.id), "player");
const areaIds = unique(map.areas.map((area) => area.id), "area");
const cardIds = unique(players.flatMap((player) => player.cards?.map((card) => card.id) ?? []), "card");
const areaById = new Map(map.areas.map((area) => [area.id, area]));
const terrainIds = unique((map.terrains ?? []).map((terrain) => terrain.id), "terrain");
const textureIds = new Set(["snow", "grass", "rock", "field", "sand", "wave", "none"]);
if (terrainIds.size === 0) fail("map.json must contain editable terrain definitions.");
for (const terrain of map.terrains) {
  if (!terrain.color || typeof terrain.color !== "string") fail(`terrain ${terrain.id} needs a color.`);
  if (!textureIds.has(terrain.texture)) fail(`terrain ${terrain.id} has unknown texture ${terrain.texture}.`);
  if (!["land", "sea"].includes(terrain.areaType)) fail(`terrain ${terrain.id} needs areaType land or sea.`);
}
const terrainById = new Map(map.terrains.map((terrain) => [terrain.id, terrain]));
for (const area of map.areas) {
  if (!terrainIds.has(area.terrain)) fail(`area ${area.id} references unknown terrain ${area.terrain}.`);
  if (area.type !== "port" && terrainById.get(area.terrain).areaType !== area.type) fail(`area ${area.id} type does not match terrain ${area.terrain}.`);
}

const width = map.grid[0].length;
if (!width || map.grid.some((row) => !Array.isArray(row) || row.length !== width)) fail("map grid must be rectangular.");
for (const [rowIndex, row] of map.grid.entries()) {
  for (const [columnIndex, areaId] of row.entries()) {
    if (!areaIds.has(areaId)) fail(`grid cell ${rowIndex}:${columnIndex} references unknown area ${areaId}.`);
  }
}
for (const areaId of areaIds) {
  if (!map.grid.some((row) => row.includes(areaId))) fail(`area ${areaId} owns no grid cells.`);
}

const neighborCells = (row, column) => {
  const diagonalColumns = row % 2 === 0 ? [column - 1, column] : [column, column + 1];
  return [
    [row, column - 1], [row, column + 1],
    [row - 1, diagonalColumns[0]], [row - 1, diagonalColumns[1]],
    [row + 1, diagonalColumns[0]], [row + 1, diagonalColumns[1]]
  ];
};

const adjacency = new Map([...areaIds].map((id) => [id, new Set()]));
const adjacencyMode = map.adjacencyMode ?? "grid";
if (!["grid", "explicit"].includes(adjacencyMode)) fail(`unknown adjacencyMode ${adjacencyMode}.`);
if (adjacencyMode === "grid") {
  for (let row = 0; row < map.grid.length; row += 1) {
    for (let column = 0; column < width; column += 1) {
      const from = map.grid[row][column];
      for (const [neighborRow, neighborColumn] of neighborCells(row, column)) {
        const to = map.grid[neighborRow]?.[neighborColumn];
        if (to && to !== from) {
          adjacency.get(from).add(to);
          adjacency.get(to).add(from);
        }
      }
    }
  }
}
if (adjacencyMode === "explicit" && !map.connections?.length) fail("explicit adjacencyMode needs connections.");
for (const pair of map.connections ?? []) {
  if (!Array.isArray(pair) || pair.length !== 2) fail("each map connection must contain two area ids.");
  const [left, right] = pair;
  if (!areaIds.has(left) || !areaIds.has(right)) fail(`connection ${left} <-> ${right} references an unknown area.`);
  if (left === right) fail(`connection ${left} cannot target itself.`);
  adjacency.get(left).add(right);
  adjacency.get(right).add(left);
}

// Grid regions should be contiguous; disconnected territories are usually an editing mistake.
for (const areaId of areaIds) {
  const owned = [];
  for (let row = 0; row < map.grid.length; row += 1) {
    for (let column = 0; column < width; column += 1) {
      if (map.grid[row][column] === areaId) owned.push(`${row}:${column}`);
    }
  }
  const ownedSet = new Set(owned);
  const visited = new Set();
  const pending = owned.length ? [owned[0]] : [];
  while (pending.length) {
    const key = pending.pop();
    if (visited.has(key)) continue;
    visited.add(key);
    const [row, column] = key.split(":").map(Number);
    for (const [nextRow, nextColumn] of neighborCells(row, column)) {
      const next = `${nextRow}:${nextColumn}`;
      if (ownedSet.has(next) && !visited.has(next)) pending.push(next);
    }
  }
  if (visited.size !== owned.length) fail(`area ${areaId} has disconnected grid cells.`);
}

for (const player of players) {
  if (!player.name || !player.color || !player.emblem) fail(`player ${player.id} needs name, color, and emblem.`);
  if (!Array.isArray(player.cards) || player.cards.length === 0) fail(`player ${player.id} needs combat cards.`);
  for (const card of player.cards) {
    if (!Number.isFinite(card.strength)) fail(`card ${card.id} needs numeric strength.`);
  }
  for (const placement of player.startingUnits ?? []) {
    const area = areaById.get(placement.area);
    if (!area) fail(`player ${player.id} starts in unknown area ${placement.area}.`);
    for (const unit of placement.units ?? []) {
      if (!["infantry", "cavalry", "fleet", "artillery"].includes(unit)) fail(`unknown unit type ${unit}.`);
      if (unit === "fleet" && area.type !== "sea") fail(`fleet for ${player.id} starts in non-sea area ${area.id}.`);
      if (unit !== "fleet" && area.type === "sea") fail(`${unit} for ${player.id} starts in sea area ${area.id}.`);
    }
  }
}

const scenario = manifest.testScenario;
if (scenario) {
  for (const field of ["attackerFrom", "defenderArea", "supportArea"]) {
    if (!areaIds.has(scenario[field])) fail(`testScenario.${field} references unknown area ${scenario[field]}.`);
  }
  if (!adjacency.get(scenario.attackerFrom).has(scenario.defenderArea)) fail("test combat attacker and defender areas must be adjacent.");
  if (!adjacency.get(scenario.supportArea).has(scenario.defenderArea)) fail("test combat support and defender areas must be adjacent.");
}

const compiledAreas = map.areas.map((area) => ({
  ...area,
  adjacent: [...adjacency.get(area.id)].sort()
}));
const compiled = {
  schemaVersion: 1,
  id: manifest.id,
  name: manifest.name,
  description: manifest.description ?? "",
  ui: manifest.ui,
  rules: manifest.rules,
  testScenario: manifest.testScenario,
  players,
  map: {
    ...map,
    columns: width,
    rows: map.grid.length,
    areas: compiledAreas
  }
};

await mkdir(dirname(output), { recursive: true });
await writeFile(output, `// Generated by scripts/compile-bundle.mjs. Do not edit by hand.\nimport type { GameBundle } from \"../content.js\";\n\nexport const gameBundle: GameBundle = ${JSON.stringify(compiled, null, 2)};\n`);
console.log(`Compiled ${relative(root, bundleDir)} -> ${relative(root, output)}`);

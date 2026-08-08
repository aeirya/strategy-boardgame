# Bundles

A bundle is a directory containing three JSON files:

```text
my-bundle/
├── manifest.json
├── players.json
└── map.json
```

## `manifest.json`

Defines bundle metadata, UI labels, rule limits, and an optional deterministic test scenario.

A bundle may also define small optional gameplay variants under `rules.modes`. A mode can select participating player keys and map areas, override starting units and the score target, restrict the existing unit/order types, relabel those orders for presentation, and define a simple forced opening move. Modes reuse the normal rules engine; they are not scripts or a separate rules DSL.

The bundled Ērān example includes `three-houses`, a compact three-player prototype using only infantry/cavalry and the existing advance/defend mechanics presented as **March** and **Hold**.

## `players.json`

Defines configured player identities and their presentation data, starting units, and combat cards.

The engine calls these entries **player keys**. A bundle may present them with any setting-specific terminology it wants.

## `map.json`

Defines terrain styles, areas, and the editable hex grid.

With the default `"adjacencyMode": "grid"`, the compiler derives two-way area adjacency from touching hexes and verifies that each area occupies one connected group of cells.

For maps whose logical graph intentionally differs from visual hex contact, use:

```json
{
  "adjacencyMode": "explicit",
  "connections": [["area-a", "area-b"]]
}
```

## External bundles

A private bundle does not need to live inside this repository:

```sh
GAME_BUNDLE=../private-bundle pnpm dev
```

Generated bundle code is ignored by Git so compiling an external bundle does not make it part of a normal commit.

# Configurable Board Game MVP

A small server-authoritative, event-sourced tabletop prototype. The public repository contains an original generic demo called **Frontier Council**; setting-specific names, maps, players, labels, palettes, and cards live in replaceable data bundles.

## Stack

- TypeScript monorepo with pnpm
- `packages/rules`: deterministic rules engine
- `apps/server`: Fastify + WebSocket MVP server
- `apps/web`: React + Vite board UI
- Vitest tests

## Run the public bundle

```sh
pnpm install
pnpm test
pnpm dev
```

The bundle compiler runs automatically before `dev`, `build`, `test`, and `typecheck`.

## Bundle layout

A bundle is one ordinary directory with three human-editable JSON files:

```text
my-bundle/
├── manifest.json   # title, UI labels, tracks, limits, test fixture
├── players.json   # player names, colors, card palettes, units, cards
└── map.json        # terrains, regions, hex grid, optional explicit edges
```

Use another bundle without copying it into this repository:

```sh
GAME_BUNDLE=../my-private-bundle pnpm dev
```

Or compile it explicitly:

```sh
pnpm bundle:compile ../my-private-bundle
```

The generated TypeScript file is ignored by Git so compiling private content does not make it eligible for a normal commit.

## Map compilation

The editable map is a rectangular array of region IDs. By default the compiler:

1. validates IDs and references;
2. verifies every region is a connected group of hexes;
3. derives two-way region adjacency from touching hexes;
4. generates label, order, unit, and feature positions at runtime.

For a legacy map whose topology must not be inferred from geometry, set `"adjacencyMode": "explicit"` and list undirected pairs in `connections`.

## Intentionally small design

There is no plugin runtime, database schema, asset pipeline, or general-purpose mod SDK. A bundle is compiled into one typed object before the app starts. Add fields only when a real bundle needs them.

## Content boundary

Keep private or third-party setting bundles outside this repository. `bundles/private/`, the compiled bundle, build output, and context-export copies of compiled content are ignored or excluded. This separation helps prevent accidental publication; it is not legal clearance for distributing any particular content.

## License

This project is licensed under the GNU General Public License v3.0 only (`GPL-3.0-only`). See [`LICENSE`](LICENSE).

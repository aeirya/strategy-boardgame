# Configurable Board Game MVP

A small server-authoritative, event-sourced tabletop prototype. The repository ships with **Ērān**, an original magical-antiquity example bundle; setting-specific names, maps, players, labels, palettes, and cards live in replaceable data bundles.

The main product direction is deliberately simple: **make the current strategy game complete and robust, keep the engine setting-neutral, and generalize only when real bundles prove a need.**

## Project orientation

Before making non-trivial architectural changes, read:

- [`AGENTS.md`](AGENTS.md) — working rules for coding agents, owner preferences, public/private content boundary, and change checklist
- [`docs/project-direction.md`](docs/project-direction.md) — trajectory, design philosophy, Ērān's role, and intended evolution
- [`docs/architecture.md`](docs/architecture.md) — package boundaries and neutral engine vocabulary
- [`docs/bundles.md`](docs/bundles.md) — current human-editable bundle protocol
- [`docs/roadmap.md`](docs/roadmap.md) — near-term work and intentionally deferred generalization

The engine should prefer plain concepts such as **player, area, unit, army, action, card, resource, track, and adjacency**. Setting-specific language belongs in bundles and UI presentation, not core types.

## Stack

- TypeScript monorepo with pnpm
- `packages/rules`: deterministic rules engine
- `apps/server`: Fastify + WebSocket MVP server
- `apps/web`: React + Vite board UI
- Vitest tests

## Run the default bundle

```sh
pnpm install
pnpm test
pnpm dev
```

The bundle compiler runs automatically before `dev`, `build`, `test`, and `typecheck`.

## GitHub Pages demo

The repository includes a GitHub Pages workflow for the Ērān demo:

https://aeirya.github.io/strategy-boardgame/

GitHub Pages cannot run the Fastify/WebSocket server, so the deployed demo uses the same rules engine and UI with a small browser-local transport layer. Games on the Pages build exist only in the current browser tab and are not multiplayer/networked. Local development continues to use the real server.

## Bundle layout

A bundle is one ordinary directory with three human-editable JSON files:

```text
my-bundle/
├── manifest.json   # title, UI labels, tracks, limits, test fixture
├── players.json    # player names, colors, card palettes, units, cards
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

The project should become a better game before it becomes a broader framework.

## Content boundary

Keep private or third-party setting bundles outside this repository. `bundles/private/`, the compiled bundle, build output, and context-export copies of compiled content are ignored or excluded. This separation helps prevent accidental publication; it is not legal clearance for distributing any particular content.

Older private reference material may exist outside the repository. If a useful mechanic is revisited, adapt the mechanic to the current neutral model rather than importing old themed content wholesale.

## License

This project is licensed under the GNU General Public License v3.0 only (`GPL-3.0-only`). See [`LICENSE`](LICENSE).

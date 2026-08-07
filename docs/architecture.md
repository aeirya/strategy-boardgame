# Architecture

## Goal

Keep the engine generic and the game content replaceable without turning the MVP into a plugin framework.

## Core vocabulary

The rules engine should use setting-neutral concepts:

- **player**: a participant and their selected configured player key
- **area**: a board location; it may be land, sea, or port
- **unit**: a movable game piece
- **army**: a group of a player's units in one area
- **action/order**: an instruction placed on an area
- **card**: a data-backed game card
- **resource**: a spendable player value
- **track**: ordered or numeric shared state
- **adjacency**: graph connectivity between areas

Theme-specific words should not become engine types merely because the bundled example uses them.

## Packages

- `packages/rules` owns deterministic game state, commands, events, legality, and bundle-backed board data.
- `apps/server` owns transport and authoritative game instances.
- `apps/web` owns interaction and presentation.
- `scripts/compile-bundle.mjs` validates human-authored bundle JSON and emits the generated typed bundle consumed by the rules package.

## Bundle compilation

Bundles stay ordinary JSON. Compilation is allowed to derive data that is tedious or error-prone to author by hand. Today this includes map adjacency from neighboring hex cells and validation of references, connected areas, unit placement, and test fixtures.

Do not add a generic extension system until a real second use case requires it.

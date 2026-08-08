# Development

For architectural intent and working preferences, read [`../AGENTS.md`](../AGENTS.md) and [`project-direction.md`](project-direction.md) before non-trivial changes.

## Requirements

- Node.js 24 or newer
- pnpm 11.7.0

## Install

```sh
npm install --global pnpm@11.7.0
pnpm install
```

## Start of a coding session

Before changing a subsystem, especially in an agent session, inspect the current tree rather than relying on an older handoff:

```sh
git status --short
git fetch origin
git log --oneline --decorate -10
```

Check whether `master` or another active branch has moved, and look for overlapping work before creating a parallel implementation.

If fixing a bug, reproduce it first when practical and determine whether the failure belongs to the application, environment/toolchain, CI ordering, or runtime configuration.

## Commands

```sh
pnpm dev
pnpm test
pnpm typecheck
pnpm build
pnpm bundle:compile
```

Use a different bundle with either `GAME_BUNDLE=/path/to/bundle` or by passing its path to `pnpm bundle:compile`.

The local `pnpm dev` path runs the real Fastify/WebSocket server. Port `3000` must be available for the server unless the application is deliberately changed to support coordinated configurable ports.

## GitHub Pages

The Pages demo is static and browser-local. It must not become a separate rules implementation.

For a Pages-related change, the important build sequence is equivalent to:

```sh
pnpm bundle:compile
pnpm --filter @tabletop/rules build
VITE_STATIC_BACKEND=1 pnpm --filter @tabletop/web build
```

The deployed demo is intentionally non-networked; real multiplayer remains the server-backed path.

## Before committing

Run:

```sh
pnpm test
pnpm typecheck
pnpm build
git status --short
```

For changes that affect static mode, also verify the Pages/static build path above.

Do not commit generated bundle output, dependency directories, build output, private bundles, or reference archives.

## Before declaring a task finished

A useful completion check is:

- intended behavior verified;
- relevant regression tests pass;
- typecheck/build pass;
- no unexpected generated/private files are staged;
- documentation updated if an architectural or bundle contract changed;
- remaining blockers, if any, are stated explicitly rather than implied.

Prefer a small tested solution over adding speculative infrastructure.

# Development

## Requirements

- Node.js 24 or newer
- pnpm 11.7.0

## Install

```sh
npm install --global pnpm@11.7.0
pnpm install
```

## Commands

```sh
pnpm dev
pnpm test
pnpm typecheck
pnpm build
pnpm bundle:compile
```

Use a different bundle with either `GAME_BUNDLE=/path/to/bundle` or by passing its path to `pnpm bundle:compile`.

## Before committing

Run:

```sh
pnpm test
pnpm typecheck
pnpm build
git status --short
```

Do not commit generated bundle output, dependency directories, build output, private bundles, or reference archives.

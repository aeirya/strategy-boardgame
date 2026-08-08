# Agent guide

This file is the first orientation document for coding agents working on this repository.

Read this file, `docs/project-direction.md`, `docs/architecture.md`, and `docs/roadmap.md` before making architectural changes.

## What this project is

`strategy-boardgame` is a small, configurable strategy board-game / wargame codebase.

The repository has two deliberately separate layers:

1. a **setting-neutral engine and UI architecture**;
2. **bundles** that provide names, presentation, map data, player identities, cards, terrain, and other setting-specific content.

The bundled example game is **Ērān**, an original magical-antiquity setting. It exists to make the repository playable and to exercise the bundle format. It must not define the vocabulary or architecture of the engine.

The repository name is intentionally generic and may change later. Do not build architectural assumptions around the current repository name.

## Central design rule

Keep the engine boring and generic; let bundles be expressive.

Preferred core concepts include:

- `player`
- `area`
- `unit`
- `army`
- `action`
- `actionToken`
- `card`
- `resource`
- `track`
- `map`
- `adjacency` / `connection`

Avoid introducing setting words such as realm, dynasty, house, kingdom, faction, empire, court, or culture into core engine types merely because a bundle uses such language.

A bundle is free to present a `player` as a faction, dynasty, city, corporation, species, army, or anything else.

## Current architectural boundary

The current split is intentional:

- `packages/rules`: deterministic game state and rules
- `apps/server`: authoritative multiplayer transport/runtime
- `apps/web`: presentation and player interaction
- `scripts/compile-bundle.mjs`: validates and compiles human-authored bundle JSON
- `bundles/eran`: the public example/default game content

The server-backed local application is the primary architecture.

GitHub Pages uses a small browser-local transport adapter because Pages cannot run the server. The static demo should reuse the same rules and UI rather than becoming a separate game implementation.

## Bundle philosophy

Bundles should remain easy for a person to edit without specialized tooling.

Today a bundle is a few ordinary JSON files. This simplicity is valuable.

It is acceptable for the compiler to derive mechanical data that humans should not have to maintain manually. Map adjacency is the main example: authors edit the grid; the compiler can derive the graph.

Prefer this pattern:

> simple authored data -> validation/compilation -> derived runtime data

rather than asking bundle authors to duplicate derived information.

Do not introduce a plugin SDK, rules DSL, runtime scripting system, generalized schema framework, or elaborate migration framework pre-emptively.

If a real bundle demonstrates that a new field is needed, add the smallest useful field first.

## Units and action tokens

The long-term direction is for unit types and action-token presentation to become increasingly data-driven.

This is **not** a request to build a generic rules language now.

The intended progression is:

1. make names, labels, symbols, artwork/presentation, and simple numeric properties configurable;
2. keep established mechanics in ordinary engine code while only one ruleset needs them;
3. generalize behavior only when multiple real game bundles require meaningfully different behavior.

See `docs/roadmap.md`.

## Ērān

Ērān is the included original example bundle, not the engine identity.

Its creative direction is a fantasy version of the ancient/classical world: Iranian, Hellenistic, Mediterranean, Central Asian, South Asian, and East Asian inspirations may coexist without pretending to reproduce one exact historical year.

Current player names include Middle Persian / Iranian forms such as:

- Ādur
- Mihr
- Wahrām
- Anāhīd
- Xwarrah
- Tištar

The setting can use historically inspired vocabulary in its UI and content. Core code should continue to say `player`, `area`, `unit`, and similar neutral terms.

Treat Ērān as a creative fantasy setting, not as a strict historical simulation. Historical research can improve it, but avoid making claims of exact historical reconstruction unless they have actually been researched.

## Public-content boundary

An earlier private prototype and private reference material may exist outside this repository. Some of it may be useful as a mechanical reference when evolving the game.

That material is deliberately **not part of this public repository**.

Agents must not:

- import private/reference archives into this repository;
- commit third-party names, maps, artwork, logos, card text, rulebook prose, or other protected expression;
- preserve private reference material in another branch, release, issue attachment, Actions artifact, or generated file;
- assume that deleting a committed file later is equivalent to never publishing it.

If an old private bundle is ever adopted to a newer bundle protocol, port only the intended mechanics/data structure and keep the source/reference archive outside the repository.

The public repository should stand on its own as an original configurable game project.

## Owner preferences for implementation

These preferences are important when deciding between multiple technically valid approaches.

### Prefer the smallest complete solution

Do not overengineer speculative flexibility.

A small implementation that solves the real current need is preferred over a large abstraction designed for hypothetical future games.

When proposing a framework, registry, plugin layer, new service, schema system, or abstraction hierarchy, first ask whether the current project actually needs it.

### Preserve working behavior

The existing playable version is valuable.

For risky refactors:

- understand the current behavior first;
- keep a recoverable Git checkpoint;
- make changes incrementally where practical;
- do not rewrite working subsystems merely to make them theoretically cleaner.

A refactor should leave the project more understandable or enable a concrete feature.

### Test changes yourself

Do not hand a change back with only a theory that it should work.

For code changes, run the relevant tests/builds yourself whenever possible.

The normal baseline is:

```sh
pnpm test
pnpm typecheck
pnpm build
```

For Pages-specific changes, also verify the static web build path.

When a failure appears, first determine whether it is:

- an environment/toolchain problem;
- CI/workflow ordering;
- server/runtime configuration;
- an actual application regression.

Avoid changing application code to compensate for an environment problem unless that is truly the right product behavior.

### Inspect before changing

Before beginning non-trivial work:

```sh
git status --short
git fetch origin
git log --oneline --decorate -10
```

Check recent repository changes and look for overlapping work before creating a competing implementation.

Do not overwrite newer work based on stale assumptions.

### Prefer consolidation over parallel variants

If two paths solve the same problem, try to converge on one understandable path rather than carrying multiple half-equivalent implementations.

Remove temporary debugging/bootstrap machinery after it has served its purpose.

### Keep the data human-readable

Configuration is meant to be edited by humans.

Prefer straightforward JSON and documented fields over encoded blobs, generated source as the source of truth, or configuration that requires a custom editor.

Generated output should be disposable and reproducible from the bundle source.

### Keep communication focused

When reporting work:

- state what changed;
- state what was tested;
- call out any remaining real blocker;
- distinguish confirmed facts from assumptions;
- avoid creating an endless debugging loop around speculative issues.

If everything is green, say so plainly.

## Change decision heuristic

When unsure whether to add abstraction, use this order:

1. Can the existing model express the requirement?
2. Can one small field/function solve it?
3. Does the requirement belong in bundle data or engine mechanics?
4. Is there a second real use case proving generalization is needed?
5. Only then consider a broader abstraction.

## Near-term product trajectory

The priority is to turn the current MVP into a complete, robust, enjoyable game while preserving configurability.

Near-term work should generally favor:

- completing game flow;
- strengthening rules correctness;
- improving combat/action resolution;
- improving map/bundle authoring and validation;
- improving multiplayer lifecycle/reconnection;
- persistence/resume where it provides clear value;
- better regression coverage;
- gradually enriching Ērān as original example content.

The priority is **not** to turn the repository into a universal tabletop platform before the game itself needs that complexity.

## Definition of a good change

A good change usually has these properties:

- the public game still works;
- core vocabulary remains setting-neutral;
- bundle authors do not have to maintain unnecessary derived data;
- code/configuration is understandable without a large framework;
- tests cover important new behavior;
- private/reference material stays outside Git history;
- documentation is updated when the project contract changes.

## Useful documents

- `docs/project-direction.md` — trajectory, philosophy, and intended evolution
- `docs/architecture.md` — package and engine/content boundaries
- `docs/bundles.md` — current bundle protocol
- `docs/development.md` — local workflow
- `docs/roadmap.md` — planned and intentionally deferred work

If code and these documents disagree, do not silently choose one. Inspect recent history, determine which is newer, and update the stale side as part of the work.

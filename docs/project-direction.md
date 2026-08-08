# Project direction

This document explains where the project came from, what it is trying to become, and how to make decisions that stay aligned with that trajectory.

It complements `AGENTS.md`. The short version is:

> Build a good, complete strategy board game first. Keep the engine neutral. Keep setting/content in bundles. Generalize only when a real second use case proves the need.

## 1. Why the project exists

The project started as a working board-game prototype with a strongly themed ruleset and UI. The useful discovery was that most of the underlying implementation could be separated from the setting.

The current repository is the result of deliberately moving toward a generic public engine/content split:

- core mechanics and runtime should use neutral concepts;
- the map, player identities, labels, palettes, cards, and setting should be replaceable data;
- private or third-party reference material should remain outside the public repository;
- the public repository should be independently understandable and playable.

This is not meant to become a generic game-development platform immediately. It is a real playable strategy game whose architecture leaves room for other bundles later.

## 2. What “generic” means here

Generic does **not** mean abstracting every rule behind a plugin interface.

It means the engine should not depend on the current fiction.

Examples:

- `Player`, not `Realm`, `House`, `Dynasty`, or `Faction` as the core concept.
- `Area`, not a historically or fictionally specific word.
- `Unit`, not one hard-coded presentation name.
- `Action`, not a setting-branded token name.
- `Card`, `Resource`, `Track`, and `Adjacency` as neutral primitives.

The concrete game may call these things whatever fits the bundle.

A bundle might present:

```text
player -> dynasty
area -> province
unit -> levy
resource -> xwarrah
```

Another bundle might use completely different language while the engine remains unchanged.

## 3. What should be configurable now

The current bundle format intentionally focuses on high-value content that is easy to author as data:

- game title and labels;
- player identities;
- colors and presentation;
- cards and card palettes;
- starting unit placement;
- terrain definitions;
- map areas;
- hex-grid layout;
- adjacency mode;
- rule limits and deterministic fixture data.

The bundle compiler may validate and derive runtime data.

This is a feature, not an implementation detail. Human authors should describe the game in the simplest useful form and let software derive repetitive information.

## 4. What should not be generalized yet

Several ideas are explicitly deferred:

- a rules DSL;
- runtime bundle scripting;
- plugin loading;
- arbitrary custom event handlers;
- a universal unit-behavior model;
- a universal action-token behavior model;
- a general asset-management system;
- a database-backed bundle registry;
- an editor framework that becomes mandatory for authoring.

These may become reasonable later, but only after concrete requirements appear.

The project should resist the common failure mode where a small working game becomes a framework project and stops becoming a better game.

## 5. Units and actions: intended evolution

There is a real desire for more flexibility here, but the order matters.

### Phase A — presentation/data

Make it possible for bundles to define things such as:

- names;
- labels;
- icons/symbols;
- colors/artwork references;
- simple numeric properties;
- movement domain or category where that is simple data.

### Phase B — proven variation

If a second real bundle needs different mechanical behavior, identify the smallest difference and model that difference explicitly.

Examples might eventually include:

- one unit type being unable to enter some area classes;
- an action having one configurable numeric modifier;
- a bundle enabling/disabling an established mechanic.

### Phase C — only if genuinely needed

Only after several different behaviors exist should the project consider a generalized behavior model.

Do not jump directly from “we may want configurable action tokens” to “we need a scripting language.”

## 6. The map model

The map is one of the clearest examples of the desired architecture.

A human edits a visual/structural representation of the map. The compiler validates it and derives adjacency when appropriate.

This should continue to guide future work:

- source data should be intuitive;
- derived graph/layout data should be generated;
- validation errors should become increasingly useful;
- hand-maintained duplication should be reduced.

A future visual map editor is welcome if it helps author the same transparent bundle data. The JSON should remain a valid source of truth rather than becoming an opaque export format.

## 7. Ērān’s role

Ērān is the default public bundle and the current creative home for the playable game.

The intended setting is magical antiquity rather than one exact historical date. It can draw inspiration from the broad world of ancient Iran, the Hellenistic Mediterranean, neighboring steppe cultures, South Asia, and East Asia.

This deliberately avoids forcing civilizations that did not literally coexist in the same historical year into a false historical claim. The setting can imagine a world in which powers, cultural traditions, and supernatural ideas overlap differently from real history.

The Iranian/Middle Persian-inspired layer gives the game a distinctive identity. Current names such as Ādur, Mihr, Wahrām, Anāhīd, Xwarrah, and Tištar are examples of content that belongs in the bundle rather than in engine code.

The setting can become richer over time through:

- original geography;
- original political relationships;
- original cards and events;
- magical cosmology;
- art direction;
- historically informed terminology where useful.

But the engine should still be able to run a completely unrelated bundle.

## 8. Relationship to historical research

Historical inspiration is encouraged; accidental pseudo-history is not.

When using Middle Persian, Iranian religious vocabulary, military terminology, or ancient political concepts:

- check forms and meanings before presenting them as historical facts;
- distinguish fantasy adaptation from historical reconstruction;
- do not force later terminology into an earlier era without acknowledging the creative choice when that distinction matters;
- prefer evocative, researched inspiration over decorative use of random ancient words.

Accuracy should support the setting, not trap the game into pretending it is a textbook simulation.

## 9. Public/private content boundary

The clean public repository is intentional.

Earlier private reference material may be kept elsewhere for historical reading or possible future mechanical comparison. It is not part of the public project contract.

A future agent encountering such material should treat it as a reference source outside the repository, not something to merge wholesale.

If a useful old mechanic should return:

1. understand the mechanic;
2. express it using the current neutral model;
3. create original public terminology/presentation;
4. add tests;
5. keep source reference material outside Git history.

This separation is also why generated bundle output is ignored.

## 10. Product priorities

The project should become more complete before it becomes more abstract.

A useful priority order is:

1. **Playability and correctness**
   - complete round/game flow;
   - correct legal actions;
   - robust combat and resolution;
   - understandable win/end conditions.

2. **Reliability**
   - regression tests;
   - deterministic rules behavior;
   - reconnection and multiplayer lifecycle;
   - persistence/resume if needed.

3. **Authorability**
   - clear bundle schema;
   - useful compiler errors;
   - easier map authoring;
   - documentation and examples.

4. **Original game identity**
   - stronger Ērān content;
   - coherent terminology;
   - original visual identity;
   - richer cards/events/map.

5. **Generalization**
   - only where multiple real bundles demonstrate a need.

The order can shift for a concrete task, but this is the default trajectory.

## 11. The web/server split

The normal local architecture is server-authoritative:

```text
web UI <-> WebSocket/Fastify server <-> deterministic rules engine
```

This is the path to preserve for real multiplayer behavior.

GitHub Pages is a public demo constraint, not a reason to redesign the game around a static host. The Pages build uses a browser-local transport adapter and is intentionally non-networked.

Avoid allowing the static demo path and the real server path to drift into two independent implementations.

## 12. Working style for future agents

The owner strongly prefers progress that is concrete, tested, and reversible.

### Before work

- inspect current `master` and recent commits;
- check for overlapping changes;
- read the relevant docs;
- reproduce the current behavior when fixing a bug.

### During work

- make the smallest coherent change;
- keep content and engine boundaries clear;
- avoid speculative abstractions;
- preserve working paths while refactoring;
- add focused tests for regressions.

### Before declaring success

Run the relevant checks yourself.

For ordinary repository changes:

```sh
pnpm test
pnpm typecheck
pnpm build
```

For Pages/static changes, verify the Pages build path too.

If CI differs from local behavior, diagnose the reason instead of immediately rewriting the application.

### Reporting

A useful handoff should answer:

- What changed?
- Why was this the smallest appropriate solution?
- What tests/builds passed?
- Is anything actually still blocked?
- Did the public bundle/engine boundary change?
- Does documentation need updating?

## 13. Anti-patterns to avoid

Future agents should be cautious when a proposal sounds like any of these:

> “We may need this someday, so I built a generic framework now.”

> “I changed the entire architecture while fixing one UI bug.”

> “The test failed in CI, so I changed the game rules without checking the CI environment.”

> “The bundle contains derived data because it was easier than updating the compiler.”

> “This example setting calls it a kingdom, so the engine type should be `Kingdom`.”

> “I added both the old and new implementation just in case.”

These are usually signs that the solution is drifting away from the intended project style.

## 14. Signs that generalization is justified

Generalization becomes appropriate when there is evidence such as:

- two real bundles need different values/behavior in the same place;
- duplicated conditional logic is spreading through core code;
- authors repeatedly need to edit source code for what is clearly content data;
- a stable concept has emerged from multiple concrete implementations.

At that point, refactor around the proven concept rather than designing from imagination.

## 15. Current practical baseline

Toolchain:

- Node.js 24
- pnpm 11.7.0
- TypeScript
- React/Vite web UI
- Fastify/WebSocket server
- Vitest

Default bundle:

- `bundles/eran`

Public demo:

- GitHub Pages via `.github/workflows/pages.yml`
- browser-local/non-networked demo mode

License:

- GPL-3.0-only

## 16. A concise decision test

For any proposed change, ask:

> Does this make the current game better or make real bundle authoring simpler, while keeping the engine neutral and the implementation understandable?

If yes, it is probably aligned.

If the main justification is hypothetical future flexibility, defer it or document it in the roadmap instead.

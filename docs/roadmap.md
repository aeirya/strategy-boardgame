# Roadmap

This roadmap is intentionally small. Features should be implemented when the current game or a real second bundle needs them.

## Near term

- improve game-flow completeness and rules coverage
- improve map editing and bundle validation errors
- persist/resume games
- improve multiplayer lobby and reconnection behavior
- add more regression tests around combat and action resolution

## Optional future features

### Data-driven unit types

Allow bundles to define unit names, labels, symbols, presentation, strength, movement domain, and other simple properties. Keep behavior hard-coded until multiple bundles demonstrate a need for a more general rule model.

### Data-driven action tokens

Allow bundles to define action-token names, labels, symbols, presentation, and eventually behavior. The MVP intentionally keeps action behavior in engine code instead of introducing a rules DSL or plugin runtime.

### Bundle migrations

If the bundle schema evolves, add explicit versioned import/migration steps so old human-authored bundles can be upgraded rather than manually rewritten.

### Asset support

Allow bundles to reference optional original/licensed artwork while preserving a complete no-assets fallback.

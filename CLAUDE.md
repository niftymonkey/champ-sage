# Champ Sage — Project Instructions

## Before Committing

Before creating a commit, review `docs/reference/technical-reference.md` and update it with any new discoveries from this session: new API behaviors, data source quirks, parsing gotchas, or architectural insights that took effort to learn and would be painful to rediscover.

## Code Quality

### TypeScript

- Write idiomatic TypeScript. Use the type system properly.
- Never use `any` unless at a boundary with an untyped external API, and even then, type the response as soon as possible.
- Create proper interfaces for data shapes. Don't use intersection hacks (`Type & { extra }`) or unnecessary `as` casts.
- Strict mode is enabled. No implicit any, unused locals, or unused parameters.

### React

- Follow idiomatic React patterns. Components should be small and focused.
- Extract reusable components from the start — if a UI element could appear in more than one place, make it its own component immediately. Don't inline it first and extract later.
- Extract custom hooks when a component has 3+ related useState/useEffect.
- Prefer composition over configuration.
- Pages/containers under 200 lines, presentational components under 50 lines.
- Don't use useEffect for things that aren't external system sync.

### Testing

- **TDD: write tests first, then implementation.** Every time. No exceptions for testable code.
- **Red phase must fail on assertions, not missing modules.** Create the module with stub implementations (empty returns, placeholder values) first so it compiles. Then write tests that fail because the stubs return wrong values. Then implement the real logic and watch them go green.
- Tests verify behavior through public interfaces, not implementation details.
- Mock external dependencies (fetch, Electron IPC via `window.electronAPI`), not internal modules where possible.
- Use factory functions for test fixtures that might be mutated (avoid shared mutable state across tests).

### Scripts

- Avoid writing throwaway inline bash/tsx one-liners for debugging or exploration. If it's useful enough to run, make it a proper TypeScript file in `scripts/`.
- Every script in `scripts/` must have a corresponding `package.json` script entry so it can be run from the project root (e.g., `pnpm check-game`).
- Document new scripts in the "Helper scripts" section of `CONTRIBUTING.md`.

### General

- No throwaway/hardcoded data. Build with real infrastructure from the start.
- Use proper libraries over hand-rolled solutions (e.g., luaparse over regex for Lua parsing).
- When a bug is found, write a failing test first, then fix.

## Project Structure

```text
src/lib/           — Core business logic modules (data-ingest, game-state, etc.)
src/components/    — React components
src/hooks/         — React hooks
electron/          — Electron main process, preload script, build config
scripts/           — Development helper scripts (run with tsx)
docs/             — PRD, implementation plan, research, technical reference
```

## Key Patterns

- **Data ingest** uses luaparse for Lua files, strips wiki markup, classifies entities by game mode
- **Game state** polls Riot API via Electron main process proxy (self-signed cert), injectable fetcher for tests
- **Cache** uses localStorage with versioned keys; dev mode skips cache for hot reload
- **Shell UI** has tabs for each data type with mode/tier filters; filter bars are sticky

## Commands

- `pnpm dev:electron` — run the app (Vite + ow-electron)
- `pnpm test` — run all tests
- `pnpm typecheck` — TypeScript check
- `pnpm check-game` — verify Riot API connectivity
- `pnpm exec tsx scripts/dump-data.ts` — dump all pipeline data for debugging

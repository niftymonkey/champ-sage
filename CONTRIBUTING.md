# Development Guide

## Prerequisites

- [Node.js](https://nodejs.org/) (LTS)
- [pnpm](https://pnpm.io/)
- [Rust](https://rustup.rs/) (stable)
- Tauri v2 system dependencies: see [Tauri Prerequisites](https://tauri.app/start/prerequisites/)

## Getting started

```bash
pnpm install
pnpm tauri dev
```

This starts the Vite dev server and launches the Tauri desktop app. First build compiles ~500 Rust crates and takes a few minutes. Subsequent builds are incremental.

## Commands

| Command            | What it does                                               |
| ------------------ | ---------------------------------------------------------- |
| `pnpm tauri dev`   | Launch the app in development mode                         |
| `pnpm tauri build` | Build a release binary                                     |
| `pnpm test`        | Run tests once                                             |
| `pnpm test:watch`  | Run tests in watch mode                                    |
| `pnpm build`       | Build the frontend only (TypeScript + Vite)                |
| `pnpm check-game`  | Print live game state from Riot API (needs a game running) |

## Developing on WSL2

The app works on WSL2 (Linux build), but the Riot Live Client Data API runs on Windows at `localhost:2999`. By default, WSL2 has its own network namespace and can't reach Windows' localhost.

**Fix: enable mirrored networking (Windows 11).** Create or edit `%USERPROFILE%\.wslconfig`:

```ini
[wsl2]
networkingMode=mirrored
```

Then restart WSL (`wsl --shutdown` from PowerShell). After this, `localhost` inside WSL is the same as Windows' localhost, and the app can reach the Riot API directly.

**Verify it works** (with a game running, even just Practice Tool):

```bash
pnpm check-game
```

This prints your champion, items, teams, and game state. If it can't connect, it'll tell you why.

## Helper scripts

Scripts in `scripts/` are development tools, not part of the app. Run them with `pnpm exec tsx scripts/<name>.ts`.

| Script                   | Shortcut                                       | What it does                                                                                                                                                                                                                                        |
| ------------------------ | ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `check-game.ts`          | `pnpm check-game`                              | Checks Riot API connectivity and prints live game state (champion, items, teams). Use to verify WSL2 networking works. Requires a game running (Practice Tool is fine).                                                                             |
| `dump-data.ts`           | `pnpm exec tsx scripts/dump-data.ts`           | Runs the full data ingest pipeline and prints everything to the console: champions, items, runes, augments grouped by mode/tier. Writes raw JSON to `data-dump/` (gitignored). Use to debug data quality issues — shows the same data the app sees. |
| `check-augment-modes.ts` | `pnpm exec tsx scripts/check-augment-modes.ts` | Fetches CDragon augments and shows how they're classified by mode (Mayhem/Arena/Swarm) based on icon paths. Use when augment mode classification seems wrong.                                                                                       |
| `lcu-monitor.ts`         | `pnpm lcu-monitor`                             | Monitors LCU WebSocket and REST endpoints, logging all events to `data-dump/`. Use to discover new API events during gameplay.                                                                                                                      |
| `discover-candidates.ts` | `pnpm discover-candidates`                     | Uses pickai + benchmarks to find AI model candidates for real-time coaching. Requires `ARTIFICIAL_ANALYSIS_API_KEY` in `.env`. Pass `-- --benchmarks lmarena` for LMArena scores instead.                                                           |
| `audit-augments.ts`      | `pnpm audit-augments`                          | Runs the full data pipeline and checks all Mayhem augment descriptions for residual markup artifacts, suspiciously short descriptions, and missing quest reward stats.                                                                              |
| `test-prompt-quality.ts` | `pnpm exec tsx scripts/test-prompt-quality.ts` | Runs the same coaching scenario 3x with current vs enriched prompts to compare consistency and quality. Use to evaluate prompt changes.                                                                                                             |

## Project structure

```text
src/                  # React frontend (TypeScript)
src-tauri/            # Tauri backend (Rust)
  src/lib.rs          # Rust entry point, plugin initialization
  tauri.conf.json     # Tauri app configuration
  capabilities/       # Permission grants for Tauri plugins
plans/                # PRD, implementation plan, exploration notes
```

## Testing

Tests use Vitest with jsdom and Testing Library. Tauri APIs are mocked in tests since they require the native runtime.

```bash
pnpm test
```

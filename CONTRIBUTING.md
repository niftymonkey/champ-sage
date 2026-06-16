# Development Guide

## Prerequisites

- [Node.js](https://nodejs.org/) (LTS)
- [pnpm](https://pnpm.io/)
- [ow-electron](https://www.npmjs.com/package/@overwolf/ow-electron) installed globally on Windows (`npm install -g @overwolf/ow-electron`)

## Getting started

```bash
pnpm install
pnpm dev:electron
```

This starts the Vite dev server in WSL2 and launches the Electron app on Windows via `ow-electron`. The app connects to LCU and the Riot Live Client Data API automatically when League is running.

## Commands

| Command               | What it does                                                 |
| --------------------- | ------------------------------------------------------------ |
| `pnpm dev:electron`   | Build Electron main process, start Vite + launch ow-electron |
| `pnpm build:electron` | Production build (Electron main + Vite frontend)             |
| `pnpm test`           | Run tests once                                               |
| `pnpm test:watch`     | Run tests in watch mode                                      |
| `pnpm typecheck`      | TypeScript type check                                        |
| `pnpm build`          | Build the frontend only (TypeScript + Vite)                  |
| `pnpm check-game`     | Print live game state from Riot API (needs a game running)   |

## Developing on WSL2

Development happens in WSL2 (editing, git, Claude Code, tests). The Electron app runs on Windows since it needs to display a GUI and interact with League of Legends.

`pnpm dev:electron` handles this automatically:

1. Builds the Electron main process with tsup
2. Starts the Vite dev server on `localhost:1420` (WSL2)
3. Launches `ow-electron` on Windows via PowerShell, pointing at the Vite server

WSL2 and Windows share localhost, so the Vite dev server is accessible from both sides.

### Riot API connectivity

The Riot Live Client Data API runs on Windows at `localhost:2999` during gameplay. Since WSL2 shares localhost with Windows, scripts like `pnpm check-game` can reach it directly.

**Verify it works** (with a game running, even just Practice Tool):

```bash
pnpm check-game
```

## Helper scripts

Scripts in `scripts/` are development tools, not part of the app. Run them with `pnpm exec tsx scripts/<name>.ts`.

| Script                   | Shortcut                                       | What it does                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ------------------------ | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `check-game.ts`          | `pnpm check-game`                              | Checks Riot API connectivity and prints live game state (champion, items, teams). Use to verify networking works. Requires a game running (Practice Tool is fine).                                                                                                                                                                                                                                                                                                                                                                                                             |
| `dump-data.ts`           | `pnpm exec tsx scripts/dump-data.ts`           | Runs the full data ingest pipeline and prints everything to the console: champions, items, runes, augments grouped by mode/tier. Writes raw JSON to `data-dump/` (gitignored). Use to debug data quality issues: shows the same data the app sees.                                                                                                                                                                                                                                                                                                                             |
| `check-augment-modes.ts` | `pnpm exec tsx scripts/check-augment-modes.ts` | Fetches CDragon augments and shows how they're classified by mode (Mayhem/Arena/Swarm) based on icon paths. Use when augment mode classification seems wrong.                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `lcu-monitor.ts`         | `pnpm lcu-monitor`                             | Monitors LCU WebSocket and REST endpoints, logging all events to `data-dump/`. Use to discover new API events during gameplay.                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `discover-candidates.ts` | `pnpm discover-candidates`                     | Uses pickai + benchmarks to find AI model candidates for real-time coaching. Requires `ARTIFICIAL_ANALYSIS_API_KEY` in `.env`. Pass `-- --benchmarks lmarena` for LMArena scores instead.                                                                                                                                                                                                                                                                                                                                                                                      |
| `audit-augments.ts`      | `pnpm audit-augments`                          | Runs the full data pipeline and checks all Mayhem augment descriptions for residual markup artifacts, suspiciously short descriptions, and missing quest reward stats.                                                                                                                                                                                                                                                                                                                                                                                                         |
| `eval-pbe-augments.ts`   | `pnpm eval-pbe`                                | Compares the live vs PBE Mayhem augment roster offline (wiki + CDragon `latest`/`pbe` branches). Reports added/removed/rarity-changed augments, which PBE augments the ingest would drop for missing wiki descriptions, wiki coverage of the PBE roster, and grouping signals (set membership, hardcoded set names now standalone augments). Writes namespaced dumps to `data-dump/{live,pbe,diff}/`. Never touches the app cache, so it is safe to run while playing. Re-run as the wiki catches up to PBE.                                                                   |
| `which-client.ts`        | `pnpm which-client`                            | Prints which League clients are installed and running and the region/patchline each running client reports (region `PBE` = PBE, anything else = live). Discovers installs from `RiotClientInstalls.json`, reads each LCU lockfile, and queries `/riotclient/region-locale`. Use to confirm whether you are actually on live or PBE without trusting the launcher UI. Only reports a region while a client is actually running.                                                                                                                                                 |
| `ow-package-guard.ts`    | `pnpm ow-guard --check`                        | Detects the Overwolf package-manifest outage (the API serving `0.0.0` version stubs that breaks GEP/augment detection). `--check` exits 3 when the outage is present, 0 when healthy. `--serve --port N` auto-discovers the newest live GEP build on Overwolf's CDN (League raises GEP's minimum-allowed version on every patch, so a fixed pin goes stale), reconciles any stale local GEP cache so OWEPM re-downloads it, then serves the corrected manifest. `launch-electron.sh` calls both automatically; run `--check` by hand to see if the outage is currently active. |
| `launch-electron.sh`     | (used by `dev:electron`)                       | Waits for the Vite dev server, then launches ow-electron on Windows via PowerShell. Runs `ow-package-guard.ts` first and, only during an Overwolf package outage, serves a local override manifest and passes `--owepm-packages-url` to ow-electron. Not called directly.                                                                                                                                                                                                                                                                                                      |

## Project structure

```text
src/                  # React frontend (TypeScript)
electron/             # Electron main process + preload
  main.ts             # IPC handlers, LCU connection, GEP, overlay
  preload.ts          # contextBridge for renderer IPC
  tsup.config.ts      # Build config for main + preload
src-tauri/            # Legacy Rust backend (will be removed)
docs/                 # PRD, research, migration plan, technical reference
```

## Architecture

The app uses **ow-electron** (Overwolf's Electron fork) as its runtime:

- **Main process** (`electron/main.ts`): LCU lockfile discovery, HTTP proxying (self-signed certs), LCU WebSocket, coaching log, GEP augment detection, overlay injection, in-game hotkeys
- **Renderer** (`src/`): React + RxJS reactive engine, coaching UI, data ingest pipeline
- **Bridge** (`src/lib/reactive/platform-bridge.ts`): `PlatformBridge` interface abstracts IPC — the renderer doesn't know or care about the runtime
- **GEP bridge** (`src/lib/reactive/gep-bridge.ts`): Augment offer/pick events from Overwolf GEP, deduplicated via RxJS `distinctUntilChanged`

When running as vanilla Electron (no Overwolf features), the app works with voice input and a separate desktop window — no overlay, no GEP, no in-game hotkey.

## Testing

Tests use Vitest with jsdom and Testing Library. Electron APIs are mocked in tests via `window.electronAPI`.

```bash
pnpm test
```

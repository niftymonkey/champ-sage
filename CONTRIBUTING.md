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

| Command            | What it does                                |
| ------------------ | ------------------------------------------- |
| `pnpm tauri dev`   | Launch the app in development mode          |
| `pnpm tauri build` | Build a release binary                      |
| `pnpm test`        | Run tests once                              |
| `pnpm test:watch`  | Run tests in watch mode                     |
| `pnpm build`       | Build the frontend only (TypeScript + Vite) |

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

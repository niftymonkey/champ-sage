# Plan: Tauri to Overwolf Electron Migration

> Source: Issue #59 research (programmatic augment detection) led to the decision to migrate from Tauri to ow-electron for GEP access + in-game overlay capabilities.

## Architectural decisions

Durable decisions that apply across all phases:

- **Runtime**: `@overwolf/ow-electron` replaces Tauri. The app is an Electron app with Overwolf APIs injected. Standard Electron APIs (BrowserWindow, IPC, globalShortcut) work as normal; Overwolf additions live under `app.overwolf.*`.
- **Process model**: Electron main process (Node.js) replaces Tauri's Rust backend. Renderer process (Chromium) replaces Tauri's webview. The React frontend and RxJS reactive engine are unchanged.
- **IPC pattern**: Tauri `invoke` commands become Electron `ipcMain.handle` / `ipcRenderer.invoke` calls. The `TauriBridge` interface is reimplemented as an `ElectronBridge` with the same shape, so the reactive engine doesn't know or care about the runtime.
- **Data sources**: The reactive engine's observable-based architecture stays. GEP becomes a new observable input alongside LCU WebSocket, Live Client Data API, voice input, and manual input.
- **Overlay windows**: Created via `overlayApi.createWindow()` (OSR windows composited into the game's DirectX pipeline). League of Legends uses "standard mode" (visible cursor), so overlays are interactive without mode switching.
- **Hotkeys**: `overlay.hotkeys` API replaces the Windows `WH_KEYBOARD_LL` hook. Supports press/release events, passthrough control, and works during gameplay.
- **Audio capture**: `getUserMedia` in the renderer with `backgroundThrottling: false` replaces Rust `cpal`. AudioWorklet for processing if timer throttling is an issue.
- **Dual-build**: `@overwolf/electron-is-overwolf` enables feature-flagging. Vanilla Electron builds degrade gracefully (no GEP, no overlay, no Overwolf hotkeys).
- **Overwolf packages**: `gep` and `overlay` declared in `package.json` under `overwolf.packages`.
- **Distribution**: Self-hosted (not locked to Overwolf store). Requires own code-signing certificate. Overwolf approval process required for the app.
- **Platform**: Windows-only for GEP/overlay features. Mac/Linux would require the vanilla Electron fallback path.

---

## Phase 1: Electron bootstrap — replace Tauri backend with Node.js

**User stories**: As a user, I can launch the app on ow-electron and get the same coaching experience I had with the Tauri version — LCU connection, live game data, voice input, coaching responses, and coaching logs.

### What to build

Scaffold an ow-electron project alongside the existing Vite + React frontend. Create an Electron main process that reimplements all 8 Tauri Rust commands as Node.js equivalents:

| Tauri command               | Electron equivalent                                                            |
| --------------------------- | ------------------------------------------------------------------------------ |
| `fetch_riot_api`            | `fetch` with custom HTTPS agent (`rejectUnauthorized: false`)                  |
| `discover_lcu`              | `fs.readFileSync` + lockfile parsing (already in `lcu-monitor.ts`)             |
| `fetch_lcu`                 | `fetch` with Basic auth header + TLS skip                                      |
| `connect_lcu_websocket`     | `ws` package with `rejectUnauthorized: false` (already in `lcu-monitor.ts`)    |
| `start_recording`           | `getUserMedia({ audio: true })` in renderer with `backgroundThrottling: false` |
| `stop_recording`            | Stop MediaStream, encode to WAV, return bytes                                  |
| `append_coaching_log`       | `fs.appendFileSync` via IPC                                                    |
| `get_coaching_log_location` | `app.getPath('userData')` via IPC                                              |

Also preserve Tauri push-event semantics used by the bridge:

| Tauri event channel | Electron equivalent                                                                |
| ------------------- | ---------------------------------------------------------------------------------- |
| `lcu-event`         | Main process forwards parsed WebSocket payloads to renderer via `webContents.send` |
| `lcu-disconnect`    | Main process emits disconnect reason to renderer via `webContents.send`            |

Reimplement `tauri-bridge.ts` as an `electron-bridge.ts` that uses `ipcRenderer.invoke` for request/response commands and `ipcRenderer.on` for push events, exposing the same `TauriBridge` interface. The reactive engine, coaching engine, and all business logic remain untouched.

Wire up the Vite dev server to serve the renderer content in development (Electron loads `http://localhost:5173` in dev, built files in production).

### Acceptance criteria

- [ ] ow-electron app scaffolded with `@overwolf/ow-electron` and project structure (main process, renderer, IPC handlers)
- [ ] All 8 Tauri commands reimplemented and working through Electron IPC
- [ ] `lcu-event` and `lcu-disconnect` push-event behavior preserved with Electron IPC
- [ ] `TauriBridge` interface preserved — `electron-bridge.ts` is a drop-in replacement
- [ ] LCU discovery, WebSocket connection, and Live Client Data polling work during a live game
- [ ] Voice input works via `getUserMedia` while the app is unfocused and a game is running
- [ ] Coaching log writes to `app.getPath('userData')/coaching-logs/`
- [ ] All existing TypeScript tests pass (Vitest suite)
- [ ] App launches, connects to LCU, enters a game, and produces coaching responses end-to-end

---

## Phase 2: In-game overlay

**User stories**: As a user, I can see coaching recommendations directly on top of League of Legends without needing a second monitor. I can use a hotkey to trigger voice input while the game has focus.

### What to build

Register League of Legends as a supported game with the overlay API. When the game launches, inject the overlay and create overlay windows for the coaching UI. The main coaching display renders as a click-through overlay (using `passThrough` mode) positioned in a non-intrusive screen region. An interactive settings/details panel can be toggled.

Replace the Windows keyboard hook with `overlay.hotkeys` for push-to-talk. Register a configurable hotkey (default: numpad minus, matching the current binding) that emits press/release events. Wire these events into the existing voice input flow.

The existing desktop BrowserWindow remains available as a configuration/dashboard surface. The overlay windows show the real-time coaching content during gameplay.

### Acceptance criteria

- [ ] Overlay renders on top of League of Legends during gameplay
- [ ] Coaching tips appear as click-through overlay content that doesn't interfere with gameplay
- [ ] Push-to-talk hotkey works via `overlay.hotkeys` while the game has focus
- [ ] Voice input captured and transcribed successfully from in-game hotkey press
- [ ] Overlay can be toggled between click-through (display) and interactive (clickable) modes
- [ ] Desktop window still works for pre-game configuration and post-game review
- [ ] Overlay windows are DPI-aware and positioned correctly at common resolutions

---

## Phase 3: GEP integration — programmatic augment detection

**User stories**: As a user, when augment cards appear in ARAM Mayhem or Arena, the app automatically detects which augments are offered and provides targeted recommendations without requiring voice input or manual selection.

### What to build

Subscribe to Overwolf GEP `augments` and `picked_augment` events for League of Legends. Create a dedicated GEP observable that emits augment offer data (the 3 offered augment names) and augment selection data (which augment the player picked, which slot). This GEP observable merges into the existing `manualInput$` stream using events shaped identically to manual augment events (type: `"augment"`), so all downstream logic (augment selection tracking, context assembly) works unchanged.

When both GEP and voice/manual input are active, GEP takes precedence — if a GEP augment event arrives within a short time window of a voice input for the same augment offer, the voice input is deduplicated to avoid double-processing.

Map GEP augment internal names (e.g., `TFT8_Augment_DefenderTrait`) to the app's augment data model (display names, descriptions, tiers, set membership). Update the coaching context assembler to include detected augment offers, enabling the coaching engine to recommend among the specific 3 options rather than giving generic tier advice.

The manual augment picker and voice input ("I chose X") remain as fallback inputs. When GEP data is unavailable (vanilla Electron build, or GEP not reporting), the app falls back to manual methods.

### Acceptance criteria

- [ ] GEP `augments` feature registered and events received during Mayhem/Arena games
- [ ] Augment offer observable integrated into the reactive engine
- [ ] GEP internal augment names mapped to the app's augment data model
- [ ] Coaching context includes the specific 3 offered augments when GEP data is available
- [ ] Coaching engine produces recommendations referencing the specific offered augments
- [ ] `picked_augment` events update the augment selection state (replacing manual confirmation)
- [ ] Manual augment picker and voice input still work as fallbacks when GEP is unavailable
- [ ] Augment detection works for both ARAM Mayhem and Arena modes

---

## Phase 4: Dual-build support — vanilla Electron fallback

**User stories**: As a user without Overwolf, I can run the app in standalone mode with voice-based augment input and a separate window (no overlay, no GEP). As a developer, I maintain one codebase with two build targets.

### What to build

Add `@overwolf/electron-is-overwolf` to detect the runtime at startup. Feature-flag all Overwolf-specific code paths: GEP subscription, overlay window creation, overlay hotkey registration. When running as vanilla Electron:

- GEP observable emits nothing (silent no-op)
- No overlay windows are created; the desktop BrowserWindow is the only UI
- Global hotkey falls back to `uiohook-napi` (or is disabled with a user-facing message)
- All other functionality (LCU connection, Live Client Data polling, voice input, coaching engine) works normally

Add build scripts for both targets: `build:overwolf` (ow-electron-builder) and `build:standalone` (standard electron-builder). Both produce distributable installers.

### Acceptance criteria

- [ ] `electron-is-overwolf` correctly detects runtime in both build targets
- [ ] Vanilla Electron build launches and works without any Overwolf dependencies
- [ ] All non-Overwolf features work in vanilla build (LCU, Live Client Data, voice input, coaching)
- [ ] ow-electron build includes all features (GEP, overlay, hotkeys)
- [ ] No Overwolf API calls execute in vanilla Electron build (no runtime errors)
- [ ] Both build targets produce installable artifacts
- [ ] One codebase — no feature branches or separate directories for each target

# Reactive Architecture for Champ Sage — Exploration Summary

## Problem

The app currently has a simple polling loop for one API with a basic subscriber pattern (`GameStateManager`). The actual data landscape is much richer — two APIs (Live Client Data + LCU), a WebSocket, manual input, and future voice input. The current architecture can't coordinate these sources, gate polling by game phase, or support output streams for recommendations and notifications. Every future feature (voice, recommendations, TTS, proactive coaching) would require ad-hoc wiring.

## Solution

An RxJS-based reactive layer that unifies all data sources into observable streams, with a three-layer architecture: raw data sources → filtered splits → app-level observables. React components consume the observables through hooks, never touching RxJS directly.

## Inputs (7 data sources)

1. **LCU lockfile discovery** — poll filesystem every 3s, produces connection credentials or disconnected status
2. **LCU WebSocket** — WAMP 1.0 subscription, filtered into: phase transitions, session info, champ select, lobby, matchmaking
3. **LCU REST (initial state)** — one-shot on connect: summoner info, current phase
4. **LCU REST (end-of-game)** — one-shot triggered by PreEndOfGame phase: win/loss, final items, game length
5. **Live Client Data API** — single poll of `/allgamedata` every ~2s during InProgress phase
6. **Manual augment input** — Subject, pushed from augment picker UI
7. **Player intent** — Subject, pushed from voice or text input (placeholder until voice is built)

## App-Level Observables (5)

### 1. `gameLifecycle$` — WHERE you are

Connection status, phase transitions, lobby, matchmaking, session. Drives UI state machine and polling control.

### 2. `liveGameState$` — WHAT is happening in the game

Accumulated snapshot from Live Client Data API polls, champ select, end-of-game stats, augment selections. Uses `scan` inside `switchMap` on InProgress phase so each game gets a fresh pipeline. Read by mode context and context assembler.

### 3. `userInput$` — WHAT the user tells the app

Augment selections and voice/text queries. Triggers recommendation pipeline and updates game state.

### 4. `coaching$` — AI conversational output

Both user-initiated recommendations and proactive suggestions. Conversational in nature — the user might follow up, ask why, or propose alternatives. Consumed by UI coaching panel and TTS.

### 5. `notifications$` — System informational output

Augment available, game detected, mode identified, status alerts, connection issues. Informational — the user glances and moves on. Consumed by UI toasts/badges.

## Key Decisions

- **Full replacement** of GameStateManager, useGameState, useEffectiveGameState, useAugmentSelection. Delete old code, don't deprecate.
- **All LCU operations through Rust** (consistent with Live Client Data API proxy). Rust handles certs, lockfile, WebSocket connection. Tauri events bridge to TypeScript.
- **Rust API surface**: Three commands (`discover_lcu`, `fetch_lcu`, `connect_lcu_websocket`). WebSocket events flow through a single Tauri event channel (`lcu-event`); TypeScript handles all filtering.
- **React hooks as the only bridge** — components never import from RxJS. Hooks: `useGameLifecycle()`, `useLiveGameState()`, `useUserInput()`, `useCoaching()`, `useNotifications()`.
- **Define all streams now, implement what we can.** Output stream interfaces are placeholders refined when their features ship. Input streams for voice are defined-but-empty Subjects.
- **Phase as master switch** — `switchMap` on gameflow phase starts/stops polling groups automatically.
- **Single poll for Live Client Data API** — one `/allgamedata` call every ~2s during InProgress, fan out to streams. Not staggered.
- **State reset between games** — `scan` accumulator lives inside a `switchMap` on InProgress phase. Each game gets a fresh pipeline automatically — no manual reset logic.
- **Lobby and matchmaking events included** — free from the WebSocket, useful for UI even if not needed for coaching.
- **Coaching vs notifications split** — coaching is conversational (user might follow up), notifications are informational (glance and move on). Different UI treatment, different subscriber behavior.
- **Output stream interfaces are intentionally loose** — owning features define the final shape when they ship. Nothing in the architecture prevents future features from defining new streams or reshaping existing ones.

## Error Handling & Recovery

### Live Client Data API poll failures during a game:

1. **Poll fails** — do nothing, wait for next natural 2s cycle
2. **10 consecutive failures (~20s)** — attempt silent transport-layer reconnect. Phase doesn't change, scan state preserved. User doesn't know.
3. **Reconnect fails or 10 more consecutive failures** — surface notification to user ("game data connection lost"), begin backoff retry (30s, then 60s, capped at 60s)
4. **Any retry succeeds** — clear notification, resume normal 2s polling. Self-healed, user never had to act.
5. **Game ends via LCU phase transition** — clear notification, normal end-of-game flow. LCU WebSocket is a separate signal path that still works even if the Live Client Data API is unresponsive.

The user never has to press a button or restart the app. The system either heals itself or the game ends naturally.

### UI for error states:

Deferred to UI polish ticket. The notification stream carries the connection status; the UI ticket determines how to render it (toast, banner, status indicator, etc.).

## Constraints

- LCU lockfile path is environment-specific (WSL2 path differs from native Windows)
- LCU port and auth token change on every client restart
- WebSocket connection must be managed in Rust due to self-signed cert in Tauri webview context
- Output stream interfaces are intentionally loose — owning features define the final shape
- Nothing in the architecture should prevent future features from defining new streams or reshaping existing ones

## Mode Agnosticism

The architecture was designed while building for ARAM Mayhem but was evaluated for compatibility with all planned modes:

- **Summoner's Rift** adds position/role, respawn timers, map terrain changes, dragon/baron objectives, and skill order significance. All of this data is already in the `/allgamedata` poll response — the `scan` accumulator captures it regardless of mode. Proactive coaching for SR (e.g., "dragon spawning soon", "enemy jungler respawned") is a subscriber on `liveGameState$` that pushes to `coaching$`. No architectural changes needed.
- **Arena** has a different augment cadence and round-based 2v2v2v2 structure. The `userInput$` Subject carries augment picks regardless of mode. The `GameMode` interface's `augmentSelectionLevels` handles mode-specific timing.
- **Regular ARAM** has no augments. The `userInput$` stream simply receives no augment events. Everything else works the same.

The streams are mode-agnostic containers. What gets emitted and how it's interpreted depends on the mode module, not the stream structure.

### Open investigation: SR game events

The Riot Messaging Service (RMS) fires events via the LCU WebSocket at URIs like `/riot-messaging-service/v1/message/lol-gsm-server/v1/gsm/game-update/IN_PROGRESS` and `TERMINATED`. During our ARAM monitoring session, we only observed generic game state events. In Summoner's Rift, there may be additional event types for objectives (dragon, baron, tower, inhibitor kills), jungle camps, or other game events that would be valuable for proactive coaching.

**Action needed:** Run the LCU monitor during a Summoner's Rift game and document any additional RMS or game-update events. Update `docs/reference/technical-reference.md` with findings.

## Reference

- Prototype visualization: `data-dump/rx/champ-sage-reactive-architecture.md`
- Prototype TypeScript: `data-dump/rx/champ-sage-reactive.rx.ts`
- LCU API documentation: `docs/reference/technical-reference.md` (LCU section)
- LCU monitor script (spike): `scripts/lcu-monitor.ts`

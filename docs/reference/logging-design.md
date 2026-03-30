# Structured Logging System Design

Design document for issue #53. Captures decisions made during the design exploration session.

## Problem

Logging in Champ Sage is ad-hoc and fragmented: 36 `debugInput$.next()` calls feed a UI-only debug panel, 25 scattered `console.*` calls go nowhere persistent, and two separate IPC-based log files (coaching, GEP) use different formats. There's no way to configure log verbosity, no consistent format, and no simple way for a non-technical user to collect and share diagnostic logs.

## Core Requirements

### Must-have

- Single structured log file (NDJSON) covering all modules and both Electron processes
- Module-tagged, leveled log entries with type-enforced module tags
- File menu for setting log level (error / warn / info / debug / trace) with "Open Log Folder" item
- Log level persisted across restarts, default `info`
- Time-based log rotation (one file per day), auto-prune files older than 5 days
- Full migration: all `debugInput$.next()`, `console.*`, and ad-hoc `logToFile` calls replaced
- App version + log level logged as first entry in every session
- Pretty console output in dev

### Nice-to-have (deferred)

- Per-module log level filtering (achievable later via electron-log hook system)
- Debug panel rewrite or removal (separate follow-up)

## Key Decisions

| Decision                 | Choice                      | Rationale                                                                            |
| ------------------------ | --------------------------- | ------------------------------------------------------------------------------------ |
| Library                  | electron-log                | Purpose-built for Electron; handles main/renderer IPC, file rotation, scoped loggers |
| Log format (file)        | NDJSON                      | Parseable by scripts, jq, and LLMs; unambiguous field extraction                     |
| Log format (console)     | Pretty text                 | Human-readable for dev; electron-log default                                         |
| Single vs multiple files | One primary log file        | GEP raw payloads move to trace level; separate GEP log eliminated                    |
| Log rotation             | Time-based, daily files     | File name tells you the date; 5-day auto-prune on startup                            |
| Level configuration      | File menu with persistence  | Zero friction for non-technical users; env var not required                          |
| Default level            | info                        | Produces a useful diagnostic log without user action                                 |
| Module tags              | Type-enforced union         | Prevents typos that would silently break grep-based diagnosis                        |
| Debug panel              | Stays as-is for now         | Removed in a follow-up PR; `debugInput$` stops being fed                             |
| Process field            | Include `main` / `renderer` | Single file, need to distinguish origin                                              |

## Module Taxonomy

| Tag                  | Scope                                                 |
| -------------------- | ----------------------------------------------------- |
| `app`                | Startup, shutdown, initialization, overlay lifecycle  |
| `engine`             | LCU discovery, WebSocket, polling, error recovery     |
| `game-state`         | Live game state processing                            |
| `coaching:reactive`  | User-initiated LLM queries and responses              |
| `coaching:proactive` | GEP-triggered auto-coaching                           |
| `gep`                | GEP bridge, augment detection, raw event processing   |
| `voice`              | Audio capture, STT transcription, hotkey registration |
| `data-ingest`        | Static data pipeline (champions, items, augments)     |
| `ui`                 | UI-level events worth logging                         |
| `ipc`                | Electron main/renderer IPC                            |

## Migration Audit

Full migration — no `debugInput$.next()`, `console.*`, or ad-hoc `logToFile` calls remain after implementation. Each existing call site was evaluated individually.

### engine.ts (12 debugInput$ calls) — module: engine

| Current call                              | Verdict                    | Level | Reasoning                                                    |
| ----------------------------------------- | -------------------------- | ----- | ------------------------------------------------------------ |
| LCU found/not found                       | Keep                       | info  | Connection state is the session story                        |
| WebSocket connecting/retrying             | Keep                       | info  | Connectivity is critical diagnostic info                     |
| WebSocket connected                       | Keep                       | info  | "                                                            |
| WebSocket disconnected                    | Keep                       | warn  | Something went wrong, app is recovering                      |
| WebSocket connection FAILED               | Keep                       | error | Hard failure                                                 |
| WebSocket event (debug-worthy)            | Keep                       | debug | Internal mechanics, only when diagnosing                     |
| Initial state: phase fetched              | Keep                       | debug | Useful for diagnosing "app joined mid-game"                  |
| Initial state: session fetched            | Keep, lose the JSON detail | debug | Full session JSON is trace at best                           |
| Initial state: phase/session fetch failed | Keep                       | warn  | Recoverable failure                                          |
| Poll OK status                            | Keep                       | debug | Per-tick noise at info, useful for diagnosing polling issues |
| Poll failed                               | Keep                       | warn  | Recoverable failure                                          |

### gep-bridge.ts (4 debugInput$ + 2 GEP log IPC calls) — module: gep

| Current call                            | Verdict | Level | Reasoning                            |
| --------------------------------------- | ------- | ----- | ------------------------------------ |
| GEP bridge initialized                  | Keep    | info  | Lifecycle event                      |
| Augment offer detected                  | Keep    | info  | Core feature event                   |
| Augment picked                          | Keep    | info  | "                                    |
| Failed to parse augment offer           | Keep    | error | Data corruption, needs investigation |
| Raw GEP info update (was separate file) | Keep    | trace | Raw payload, only for deep debugging |
| Raw GEP game event (was separate file)  | Keep    | trace | "                                    |

### useVoiceInput.ts (13 debugInput$ calls) — module: voice

| Current call                          | Verdict | Level | Reasoning                                       |
| ------------------------------------- | ------- | ----- | ----------------------------------------------- |
| Push-to-talk hotkey registered        | Keep    | info  | Lifecycle — confirms voice is wired up          |
| Hotkey pressed/released (keyboard)    | Remove  | —     | Redundant with recording started/stopped        |
| Overlay hotkey pressed/released       | Remove  | —     | Redundant with recording started/stopped        |
| Recording started                     | Keep    | info  | Voice pipeline event                            |
| Recording stopped, transcribing       | Keep    | info  | "                                               |
| Audio captured (duration)             | Keep    | debug | Implementation detail, useful for STT diagnosis |
| Vocab hints                           | Remove  | —     | Never useful in practice                        |
| Transcript result                     | Keep    | info  | Core feature event                              |
| Voice error                           | Keep    | error | Something broke                                 |
| Recording error                       | Keep    | error | "                                               |
| Voice transcript received by coaching | Remove  | —     | Redundant — coaching module logs the query      |

### CoachingInput.tsx (6 debugInput$ + 2 console.\*) — module: coaching:reactive / coaching:proactive

| Current call                 | Verdict                    | Level | Reasoning                                           |
| ---------------------------- | -------------------------- | ----- | --------------------------------------------------- |
| Coaching skipped (reason)    | Keep                       | warn  | Tells you why coaching didn't fire                  |
| Augment selected via text    | Keep                       | info  | Build tracking                                      |
| Coaching query submitted     | Keep                       | info  | Core feature event                                  |
| console.warn skipped         | Merge into logger          | warn  | Already the right level                             |
| console.error coaching error | Merge into logger          | error | Already the right level                             |
| console.warn no API key      | Keep                       | warn  | Important for "friend can't get coaching" diagnosis |
| GEP auto-query submitted     | Keep as coaching:proactive | info  | Distinguishes trigger source                        |
| GEP augment added to build   | Keep as coaching:proactive | info  | Build tracking                                      |

### recommendation-engine.ts (3 logToFile calls) — module: coaching:reactive or coaching:proactive

| Current call                              | Verdict     | Level                                            | Reasoning                                           |
| ----------------------------------------- | ----------- | ------------------------------------------------ | --------------------------------------------------- |
| Coaching request (model, champion, items) | Keep, split | info for summary, trace for full prompts         | Summary is session story; full prompts are firehose |
| Response (timing, tokens, answer)         | Keep, split | info for timing+summary, trace for full response | Same split                                          |
| Error                                     | Keep        | error                                            | Critical diagnostic                                 |

### App.tsx (2 debugInput$ + 4 console.\*) — module: app

| Current call                            | Verdict | Level | Reasoning                              |
| --------------------------------------- | ------- | ----- | -------------------------------------- |
| Game detected (mode, players, augments) | Keep    | info  | Session story                          |
| Mode detection                          | Remove  | —     | Redundant with game detected           |
| console.log STT provider selected       | Keep    | info  | Which voice path is active             |
| console.warn no STT provider            | Keep    | warn  | Explains why voice doesn't work        |
| console.warn GEP bridge init failed     | Keep    | warn  | Explains why auto-augment doesn't work |

### electron/main.ts (18 console.\*) — module: app / engine / gep

| Current call                     | Verdict | Level      | Module |
| -------------------------------- | ------- | ---------- | ------ |
| ow-electron vs vanilla detection | Keep    | info       | app    |
| Log file paths                   | Keep    | info       | app    |
| Overwolf package ready           | Keep    | info       | app    |
| Overlay registered               | Keep    | info       | app    |
| Game launched                    | Keep    | info       | app    |
| Game is elevated (can't inject)  | Keep    | error      | app    |
| Overlay injected                 | Keep    | info       | app    |
| Overlay active                   | Keep    | info       | app    |
| Game exited                      | Keep    | info       | app    |
| Overlay injection error          | Keep    | error      | app    |
| Hotkey registered                | Keep    | info       | voice  |
| GEP: League detected             | Keep    | info       | gep    |
| GEP: Features set                | Keep    | debug      | gep    |
| GEP: Features failed + retry     | Keep    | warn/error | gep    |
| GEP: Features set on retry       | Keep    | info       | gep    |
| GEP: League exited               | Keep    | info       | gep    |
| GEP error                        | Keep    | error      | gep    |
| GEP initialized                  | Keep    | info       | gep    |
| Overlay API not available        | Keep    | warn       | app    |
| GEP API not available            | Keep    | warn       | gep    |

### New log points to add

| What                                          | Level | Module             | Why                                                  |
| --------------------------------------------- | ----- | ------------------ | ---------------------------------------------------- |
| App version + log level on startup            | info  | app                | First line of every log — essential for diagnosis    |
| Log level changed                             | info  | app                | Explains verbosity change mid-file                   |
| Data ingest completed (counts, version)       | info  | data-ingest        | Confirms static data loaded                          |
| Data ingest failed                            | error | data-ingest        | Currently silent                                     |
| Context assembly result                       | debug | coaching:reactive  | Fills gap between "query submitted" and "LLM called" |
| Context assembly returned null                | warn  | coaching:reactive  | Explains why a query produced nothing                |
| Abort signal fired (stale coaching cancelled) | debug | coaching:proactive | Confirms cancellation worked                         |
| WebSocket cleanup on game exit                | debug | engine             | Currently silent but diagnostically useful           |

### Migration totals

- 36 `debugInput$.next()` calls become ~28 logger calls (8 removed as redundant)
- 25 `console.*` calls become ~20 logger calls
- ~8 new log points added for identified gaps
- Separate GEP log file eliminated
- Coaching log file replaced by unified logger

## Constraints

- electron-log does not support per-scope log levels natively; the hook system provides an escape hatch when needed
- Renderer cannot write to filesystem directly; all file I/O goes through electron-log's IPC transport
- Summoner names must never appear in logs (Riot compliance)
- API keys and tokens must be redacted

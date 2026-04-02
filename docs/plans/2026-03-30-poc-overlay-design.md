# POC Overlay Design

## Goal

Prove the overlay concept with functional (not polished) in-game overlay windows. Full design pass deferred to #18.

Three capabilities:

1. Augment offer badges — rank + short reason positioned above each card
2. Stat anvil badges — same treatment, same positioning (GEP sends them through the same `augments` feature)
3. Coaching text strip — brief LLM output in a repositionable panel

## Architecture

### Overlay windows

Two overlay windows created via `overlayApi.createWindow()` after `game-injected`:

**Augment badge window**

- Single transparent, frameless overlay spanning the three card positions
- Three badge slots rendered as React components within one window
- Click-through (`passthrough: "passThrough"`)
- Visible only when `augmentOffer$` fires AND coaching response arrives
- Hidden on `augmentPicked$`
- Position calculated from game window dimensions (see Positioning section)

**Coaching strip window**

- Fixed-width (~400px) rectangular panel, height capped at ~3 lines
- Click-through (`passthrough: "passThrough"`)
- Default position: bottom-left, above chat area
- Position saved to localStorage, persists across sessions
- Visible when coaching text arrives, auto-fades after timeout (~15-20s)
- Scales proportionally on `game-window-changed`

### Edit mode

Hotkey: **Tab** (registered as passthrough so League scoreboard still works — same pattern as Mobalytics).

- Hold Tab: both windows switch to `noPassThrough`, gain visible border/highlight, become draggable
- Release Tab: lock back to click-through
- Badge window: vertical offset adjustment only (horizontal is calculated)
- Coaching strip: freely draggable

### Renderer

Separate Vite entry point (`overlay.html` + `overlay-main.tsx`) — lightweight, no data browser, no voice input. Only renders badges and coaching strip. Imports from `src/lib/reactive/` for stream subscriptions.

## Data flow

```text
Desktop window (existing)                Main process                 Overlay windows (new)
─────────────────────────                ────────────                 ────────────────────
CoachingInput receives                        │
  augmentOffer$ → LLM call                    │
  → coaching response                         │
  → sends via IPC ──────────────────────► relays to ────────────────► overlay renderer
                                          overlay windows             displays badges /
                                                                      coaching strip

GEP events (augmentOffer$,               already sent via             overlay subscribes
  augmentPicked$)                         sendToAllWindows             to same IPC channels
```

- No new data sources needed
- Coaching relay: desktop renderer sends `coaching-response` to main process, main process forwards to overlay windows via existing `sendToAllWindows`
- GEP events already broadcast to all windows
- Edit mode: Shift+Tab hotkey sends `overlay-edit-mode` IPC events to overlay windows on press/release

## Badge content

Each badge displays:

- **Rank number** (1, 2, 3)
- **Short reason string** — from the existing `recommendations` array / coaching response

Same format already shown in the desktop game panel. No LLM prompt changes needed.

## Positioning

### Augment/stat anvil cards

Cards are always centered on screen with consistent spacing. Positions are deterministic based on game resolution.

Positions derived from calibration data (see Phase 0 below). League UI scales proportionally with resolution — measurements at one resolution translate mathematically to others.

On `game-window-changed` events, badge positions recalculate based on new game window dimensions.

### Calibration process (one game)

1. Grid overlay window with coordinate labels (lines every 50px along edges)
2. On `augmentOffer$`: render grid → wait ~1s for everything to paint → capture screenshot → wait ~1-2s → hide grid
3. Screenshots saved automatically to app data directory
4. Play first half at normal resolution, switch resolution mid-game (during death timer)
5. Remaining offers captured at new resolution
6. Post-game: analyze screenshots to derive card position formula

Grid is visible for ~2-3 seconds per offer — brief enough to not disrupt gameplay.

## Implementation phases

### Phase 0: Calibration tooling

- Grid overlay window created on `game-injected`
- Auto-screenshot on `augmentOffer$` (render grid, capture, hide grid)
- Screenshots saved to app data directory with resolution metadata
- Play one calibration game at two resolutions
- Analyze screenshots, derive card position formula

### Phase 1: Overlay window infrastructure

- Create two overlay windows in `initOverlay()` after `game-injected`
- Separate Vite entry point (`overlay.html` + `overlay-main.tsx`)
- IPC relay for coaching responses (desktop window -> main process -> overlay)
- Tab hotkey for edit mode (toggle click-through / draggable)
- Coaching strip position persisted to localStorage

### Phase 2: Augment/stat anvil badges

- Badge component: rank number + short reason string
- Positioned using calibration-derived formula
- Visible on `augmentOffer$` + coaching response arrived
- Hidden on `augmentPicked$`

### Phase 3: Coaching text strip

- Receives coaching responses via IPC relay
- Displays brief text, auto-fades after timeout
- Click-through by default, draggable in edit mode
- Default position above chat area

## Constraints

- Overlay must not obstruct critical game UI (minimap, abilities, health bars)
- Riot overlay policy: no ads, no prohibited data, own visual identity
- Badges are informational only — no automation, no click-for-you
- Stat anvils and augments use identical overlay treatment (same GEP stream, same card positions)

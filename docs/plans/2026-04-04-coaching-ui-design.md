# Coaching UI Design — POC Desktop Window

**Issue:** #17
**Chosen approach:** Variant A (Tactical HUD) — feed-based card layout
**Prototypes:** `docs/prototypes/variant-a-tactical.html`, `docs/prototypes/variant-b-conversation.html`

## Design Principles

- **Coaching output is the product.** It gets the most space.
- **No tabs.** The app has one view that transforms based on game state.
- **No dev clutter by default.** Data browser and debug panel live behind `Ctrl+D`.
- **Mode-agnostic layout.** The coaching feed renders cards of different types depending on what the active mode produces. The layout doesn't change — only the mix of cards.
- **Glanceable during gameplay, readable between games.** Status bar and coaching cards designed for 1-5 second glances on a second monitor.
- **Feed over conversation.** Cards in a reverse-chronological feed, not chat bubbles. Coaching is mostly one-directional (coach speaks, player listens). Cards are visually distinct by type, scannable without reading.

## Why Feed Over Conversation

- Augment offers, voice answers, and game plans arrive unpredictably — a feed handles mixed content types naturally.
- Visually distinct card types (gold border = proactive, blue = voice, green = plan) let you identify advice type before reading.
- In modes without augments, a feed with a single game plan card feels natural. An empty chat feels like the coach went AFK.
- Simpler to implement — scrollable card list with a pinned bar, no message alignment or sender attribution.

## App States

The window has two states: **idle** (no game running) and **in-game** (game detected). Both share the same layout structure but the content transforms.

## Layout Structure

### Status Bar (top, pinned)

Thin persistent bar with essential state. Monospace font, consistent pipe-separated sections.

**In-game order:** `● ARAM MAYHEM 14:22 | Katarina Lv11 | 8•3•12 | 2,840g` ... `Connected | v16.7.1 | ○ Num-`

- Green dot = connected, gray = disconnected
- KDA uses colored numbers (green kills, red deaths, gray assists) with bullet separators to avoid looking like a date
- Voice indicator: empty circle (idle), red filled (recording), with hover tooltip "Hold to ask your coach a question"
- Version tooltip: "League of Legends patch version"
- KDA tooltip: "Kills / Deaths / Assists"
- Gold tooltip: "Current gold"
- All tooltip elements use `cursor: help`

**Idle:** Game-specific info hidden, dot goes gray. Just connection state, version, voice indicator.

### Coaching Feed (main area, scrollable)

Reverse-chronological feed of coaching interactions, newest at top. The feed scrolls between the pinned status bar and pinned enemy strip.

**Card types:**

1. **Opening game plan card** (proactive) — Fires automatically once the first poll returns full player data. Shows initial strategy, enemy comp assessment, and recommended 6-item build path. Gold border to distinguish proactive content.

2. **Augment recommendation cards** (proactive, Mayhem/Arena only) — Three options shown side-by-side (stacking vertically on narrow screens), ranked with per-option reasoning. Rank badges (1/2/3) colored green/yellow/red. Gold border. Only appear when the active game mode includes augment selection.

3. **Voice coaching cards** (reactive) — Player's question shown indented with left border, coach's answer below, with ranked item/build recommendations when applicable. No gold border — these are player-initiated.

The feed naturally adapts to mode without layout changes. ARAM (no augments) shows game plan + voice cards. Mayhem adds augment cards interspersed. Future proactive cards (#67, #69) slot into the same feed with gold borders.

Empty state before any coaching: the feed is empty until the game plan card arrives.

### Enemy Strip (bottom, pinned — or side column on wide screens)

**Narrow/medium width (<1100px):** Pinned bar at the bottom. Five enemy cards in a horizontal row showing champion name, level, and items. Full item names.

**Wide screens (>1100px):** Enemy strip moves to a persistent side column on the right. Vertical list format with more room for item names. Bottom bar hidden.

**Idle state:** Enemy strip is not shown.

### Proactive Content Styling

All coach-initiated content (game plan, augment offers, future item recommendations) gets a gold 1px border and a subtle gold-tinted header background. This visually distinguishes "the coach spoke unprompted" from "you asked a question."

### Hover States

- **Coaching cards:** border brightens subtly; proactive cards' gold border intensifies
- **Augment options:** background brightens; pick option gets stronger green tint
- **Recommendation items:** background brightens
- **Build path items:** background brightens, text goes full white
- **Enemy cards:** border brightens (bottom bar) or background highlights (side column)
- **All status bar tooltips:** `cursor: help` on hover

### Responsive Behavior

- **Narrow (<600px):** Augment options stack vertically, enemy bar wraps to 2 columns, some status bar detail hidden
- **Medium (600-1100px):** Full layout with enemy strip pinned at bottom
- **Wide (>1100px):** Enemy strip moves to side column, feed has readable max-width

## Idle State

When not in a game, the main area shows:

- **Last game summary card** (if a game was played this session): champion, win/loss, KDA, final items, and the last 2-3 coaching exchanges. This card becomes the future entry point for post-game conversation continuation (#84).
- **No game yet:** Empty state with connection status.
- **Data summary:** Patch version, champion/item/augment counts shown below the card.

No enemy strip in idle mode.

## Dev Tools

Data browser tabs (Champions, Items, Runes, Augments, Search) and Debug panel hidden by default. `Ctrl+D` toggles dev mode. Small indicator in status bar when active.

## Component Architecture

### New Components

- **StatusBar** — connection state, game info, voice indicator, tooltips
- **CoachingFeed** — scrollable reverse-chronological card list
- **CoachingCard** — polymorphic card: game plan, augment recommendation, voice Q&A
- **LastGameCard** — idle-state summary of most recent game
- **EnemyStrip** — compact enemy team display (bottom bar variant)
- **EnemySideColumn** — enemy team display for wide screens
- **IdleView** — last game card + ready state
- **InGameView** — coaching feed + enemy strip/column

### Modified Components

- **App.tsx** — remove DataBrowser/tabs, render based on game state (idle vs in-game)
- **CoachingInput.tsx** — refactor to emit coaching cards into the feed rather than managing its own display

### Preserved (behind Ctrl+D)

- **DataBrowser.tsx** and all tab components — unchanged, just hidden by default

### Removed from Default View

- **GameStateView.tsx** — replaced by StatusBar + EnemyStrip + CoachingFeed
- Active player card (duplicated info, now in StatusBar)
- Ally team grid (not useful for coaching)
- Stat grid, rune display, balance overrides (dev-level detail)

## Data Requirements

Everything needed is already available:

- `useLiveGameState()` — champion, level, gold, KDA, items, enemies, game time, game mode
- `CoachingResponse` — answer text + ranked recommendations
- `augmentOffer$` / `augmentPicked$` — GEP augment events
- `eogStats` on `liveGameState$` — end-of-game data for last game card
- `useCoachingMode()` — active mode context

**New data needed:**

- Persisted last-game snapshot (champion, outcome, items, augments, last few coaching exchanges) — survives across the game lifecycle for the idle state card. For the POC this can be in-memory state that resets on app restart. Proper persistence comes with #7 and #84.
- Opening game plan coaching query — a new proactive trigger that fires when the first full player data poll arrives, asking the coach for an initial strategy.

## Out of Scope (POC)

- Post-game conversation continuation (#84)
- Full proactive coaching engine (#67)
- Proactive item recommendations (#69)
- Polished visual design, animations, transitions (Phase 2 #18)
- Game session persistence to SQLite (#7)

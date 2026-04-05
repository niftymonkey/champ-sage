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
- In modes without augments, a feed with a game plan card and voice responses feels natural. An empty chat feels like the coach went AFK.
- Simpler to implement — scrollable card list with pinned bars, no message alignment or sender attribution.

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

### Coaching Feed (center, scrollable)

Reverse-chronological feed of coaching interactions, newest at top. The feed scrolls between the pinned status bar and pinned enemy strip.

**Card types:**

1. **Game plan card** (proactive) — The initial game plan appears as the first feed entry when the game starts. Shows the coach's strategy reasoning and recommended build path. Gold border. When the player later says "update game plan," a voice coaching card appears in the feed with the question and the coach's response explaining what changed — maintaining the chronological narrative of the game.

2. **Augment recommendation cards** (proactive, Mayhem/Arena only) — Three options shown side-by-side (stacking vertically on narrow screens), ranked with per-option reasoning. Rank badges (1/2/3) colored green/yellow/red. Gold border. Only appear when the active game mode includes augment selection.

3. **Voice coaching cards** (reactive) — Player's question shown indented with left border, coach's answer below, with ranked item/build recommendations when applicable. No gold border — these are player-initiated. "Update game plan" queries also appear here as voice cards.

The feed naturally adapts to mode without layout changes. ARAM (no augments) shows game plan + voice cards. Mayhem adds augment cards interspersed. Future proactive cards (#67, #69) slot into the same feed with gold borders.

### Game Plan Panel (right side, persistent during in-game)

A living document that shows the current recommended build and strategy. Not a feed card — a persistent reference panel that you glance at throughout the game.

**Behavior:**

- Auto-generates when game is first detected with full player data (active player + enemies). The response also creates the first feed card.
- Refreshes when the player says "update game plan" — voice pipeline detects this explicit phrase and routes a plan refresh prompt to the LLM.
- Always shows the latest version. The coach explains reasoning for any changes in the response, which appears in the feed as a voice card.
- Contains: strategy summary text and 6-item build path in order.

**Why a side panel and not a feed card:** The game plan is "what should I be doing right now" — a persistent reference. Feed cards are "what just happened" — chronological events. These serve different purposes and deserve different spatial treatment. A static game plan in the feed becomes misleading as soon as game conditions change (a player gets fed, you high-roll augments, lanes swap). The side panel always reflects the current truth.

**Refresh triggers (POC):** Voice command "update game plan" only. Phase 2 may add automatic refresh on meaningful state changes (augment picked, major item completed, significant level thresholds).

**Evolution visualization (Phase 2):** Showing how the plan changed over time (diff view, strikethrough on replaced items) is valuable for post-game review but deferred. For the POC, the panel just shows the current plan.

### Enemy Strip (bottom, pinned)

Always at the bottom, pinned below the scrollable feed. Five enemy cards in a horizontal row, each containing:

- **Header row:** Champion name (left) and level (right-aligned)
- **Body row (flex):** Item names listed vertically on the left (one per line, full names), and item category pills stacked vertically on the right

**Item category pills:** Derived from the item's `stats` data. Each pill represents a stat category the enemy is investing in — e.g., "AP", "Health", "Armor", "M.Pen", "Haste", "Antiheal", "AD", "MR". Only categories present in at least one item are shown. Pills stack vertically, centered in a right-aligned column, one per line. Early game might show 1-2 pills; full build 3-5. This fills the card's horizontal space proportionally and gives an at-a-glance read on what the enemy is building toward.

**Narrow screens (<600px):** Enemy cards wrap to 2 columns.

**Idle state:** Enemy strip is not shown.

### In-Game/Idle Toggle

Floats inside the content area (top-right of the feed), not fixed to the window. Toggles between in-game and idle views. For prototyping only — in the real app, this is driven by game state automatically.

### Proactive Content Styling

All coach-initiated content (game plan feed card, augment offers, future item recommendations) gets a gold 1px border and a subtle gold-tinted header background. This visually distinguishes "the coach spoke unprompted" from "you asked a question." The Game Plan side panel header uses a light purple color to differentiate it from the gold proactive feed cards.

### Status Bar Details

- KDA numbers are color-coded: green (kills), red (deaths), gray (assists) with bullet (•) separators between them
- Pipe (|) separators between all other sections
- All informational elements have tooltips with `cursor: help`: version ("League of Legends patch version"), KDA ("Kills / Deaths / Assists"), gold ("Current gold"), connection dot ("Connected to League client"), voice indicator ("Hold to ask your coach a question")
- Voice indicator: empty circle (idle), red filled (recording)

### Hover States

- **Coaching cards:** border brightens subtly; proactive cards' gold border intensifies
- **Augment options:** background brightens; pick option gets stronger green tint
- **Recommendation items:** background brightens
- **Build path items:** background brightens, text goes full white
- **Enemy cards:** border brightens
- **Enemy item pills:** border brightens on hover

### Responsive Behavior

- **Minimum window width:** 800px enforced via Electron's `BrowserWindow` `minWidth` config. Prevents the UI from reaching unusable states.
- **Narrow (at min-width):** Augment options stack vertically, enemy item names may truncate (tooltips show full names on hover)
- **Medium-wide:** Full layout with enemy strip pinned at bottom
- **Game plan panel:** Always visible on the right side during in-game, never hidden at any viewport size. The feed area compresses to accommodate it.
- **Enemy item names:** Each item has a tooltip with the full item name and `cursor: help`, ensuring truncated names are still readable on hover.

## Idle State

When not in a game, the main area shows:

- **Last game summary card** (if a game was played this session): champion, win/loss, KDA, final items, and the last 2-3 coaching exchanges from the feed. This card becomes the future entry point for post-game conversation continuation (#84).
- **No game yet:** Empty state with connection status.
- **Data summary:** Patch version, champion/item/augment counts shown below the card.

No enemy strip or game plan panel in idle mode.

## Dev Tools

Data browser tabs (Champions, Items, Runes, Augments, Search) and Debug panel hidden by default. `Ctrl+D` toggles dev mode. Small indicator in status bar when active.

## Architecture

### Coaching Feed Data Model

The feed lives as an RxJS `BehaviorSubject<FeedEntry[]>` in the reactive layer (`coachingFeed$`), alongside existing streams like `liveGameState$` and `gameLifecycle$`. This allows:

- Multiple sources (voice coaching, augment coaching, game plan) to push entries
- The last game snapshot to read the feed after the game ends
- Persistence outside React's component lifecycle

**Feed entry types:**

```typescript
interface FeedEntry {
  id: string; // unique, for React keys
  type: "game-plan" | "augment-offer" | "voice-coaching";
  timestamp: number; // game time in seconds
  proactive: boolean; // true = coach-initiated (gold border)
}

interface GamePlanEntry extends FeedEntry {
  type: "game-plan";
  summary: string; // coach's strategy text
  buildPath: string[]; // ordered item names (6 items)
}

interface AugmentOfferEntry extends FeedEntry {
  type: "augment-offer";
  options: Array<{
    name: string;
    rank: number;
    reasoning: string;
  }>;
  picked?: string; // filled in when player picks one
}

interface VoiceCoachingEntry extends FeedEntry {
  type: "voice-coaching";
  question: string;
  answer: string;
  recommendations: Array<{
    name: string;
    reasoning: string;
  }>;
}
```

No cap on entry count. Resource observability can be added later if needed.

### Game Plan Data Model

Separate from the feed, the current game plan lives in `gamePlan$` BehaviorSubject:

```typescript
interface GamePlan {
  summary: string; // strategy reasoning text
  buildPath: string[]; // 6 ordered item names
  updatedAt: number; // game time of last update
}
```

When a game plan response arrives (either initial or from "update game plan"), both `gamePlan$` and `coachingFeed$` are updated from the same LLM response.

### Voice Command Routing

The phrase "update game plan" is detected in the voice pipeline before the question hits normal coaching flow. Detection is simple string matching on the transcript. When detected:

1. A plan-specific prompt is sent to the LLM asking for a full revised build path with reasoning for changes
2. The response updates `gamePlan$` (side panel)
3. A `VoiceCoachingEntry` is pushed to `coachingFeed$` with the question and response (feed narrative)

### Component Architecture

**New Components:**

- **StatusBar** — connection state, game info, voice indicator, tooltips
- **CoachingFeed** — scrollable reverse-chronological card list
- **CoachingCard** — polymorphic card: game plan, augment recommendation, voice Q&A
- **GamePlanPanel** — right side panel showing current plan and build path
- **LastGameCard** — idle-state summary of most recent game
- **EnemyStrip** — compact enemy team display (bottom bar)
- **IdleView** — last game card + ready state
- **InGameView** — coaching feed + game plan panel + enemy strip

**Modified Components:**

- **App.tsx** — remove DataBrowser/tabs, render based on game state (idle vs in-game)
- **CoachingInput.tsx** — refactor to emit feed entries into `coachingFeed$` and detect "update game plan" voice command

**Preserved (behind Ctrl+D):**

- **DataBrowser.tsx** and all tab components — unchanged, just hidden by default

**Removed from Default View:**

- **GameStateView.tsx** — replaced by StatusBar + EnemyStrip + CoachingFeed + GamePlanPanel
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

- `coachingFeed$` — BehaviorSubject accumulating feed entries across a game session
- `gamePlan$` — BehaviorSubject holding the current game plan
- `lastGameSnapshot$` — BehaviorSubject holding the most recent game's snapshot (champion, outcome, KDA, items, augments, feed entries). Full game history kept in memory across the session — feed entries are just strings and small objects, so even dozens of games won't be a concern. Resets on app restart. SQLite persistence replaces this in-memory store when #7 is implemented, enabling #84 (post-game conversation continuation) at the same time.
- Opening game plan prompt — fired when first full player data arrives
- "Update game plan" voice command detection and routing

## Out of Scope (POC)

- Post-game conversation continuation (#84)
- Full proactive coaching engine (#67)
- Proactive item recommendations (#69)
- Automatic plan refresh on state changes (Phase 2)
- Plan evolution visualization / diff view (Phase 2)
- Polished visual design, animations, transitions (Phase 2 #18)
- Game session persistence to SQLite (#7)

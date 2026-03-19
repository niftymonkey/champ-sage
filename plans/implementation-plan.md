# Plan: Champ Sage

> Source PRD: `plans/prd.md`

## Architectural decisions

Durable decisions that apply across all phases:

- **Desktop framework**: Tauri v2 (Rust backend for hotkeys/window/audio, Vite + React frontend)
- **Language**: TypeScript (strict) for all application code; Rust only for Tauri backend surface
- **Package manager**: pnpm
- **Frontend**: React + Tailwind v4 (OKLCH), dark-only theming
- **Testing**: Vitest for unit/integration, Playwright for E2E; TDD by default
- **LLM integration**: Vercel AI SDK (`ai` package); model selected at build time via PickAI, hardcoded as static config
- **Game data**: Local cache (serve immediately, background refresh on launch); Data Dragon, League Wiki Lua, Community Dragon
- **Game state**: Riot Live Client Data API (localhost:2999, self-signed cert); voice/manual input for data the API doesn't expose
- **Conversation state**: App-owned, not LLM-owned; context assembled fresh each request from tracked state + history window; abstracted behind interface for future flexibility
- **Local database**: SQLite for game session persistence and (later) cross-game memory with FTS5
- **Model selection**: Build-time evaluation via PickAI + Evalite; winners committed as static config
- **Riot policy**: No augment win rates, no enemy cooldown tracking, no in-game overlay ads

---

## Phase 1: Desktop Shell + Data Ingest Pipeline

**User stories**: 9 (current data on launch), 10 (background refresh), 21 (dev shell/visualizer), 22 (testable modules)

### What to build

Scaffold the Tauri app (Vite + React + pnpm) and build the Data Ingest Pipeline. The pipeline fetches and normalizes game data from external sources: Data Dragon for champions/items/runes, League Wiki Lua module for augments and set bonuses (stripping wiki markup, parsing Lua tables to JSON), Community Dragon for augment IDs/icons, and League Wiki for ARAM balance overrides. Data is served from a local cache; a background refresh on launch updates the cache with anything new.

The desktop shell starts as a data visualizer — browse and inspect ingested champions, items, augments, and runes to confirm the data is correct and complete. The entity dictionary (all known champion/item/augment names) is exposed as a lookup interface for downstream modules.

### Acceptance criteria

- [ ] Tauri app launches and displays a React-based UI
- [ ] Data Ingest Pipeline fetches from all four sources (Data Dragon, League Wiki Lua, Community Dragon, ARAM overrides)
- [ ] Lua table parsing, wiki markup stripping, and cross-source data merging produce clean JSON
- [ ] Local cache serves data immediately on launch; background refresh updates cache without blocking
- [ ] Desktop shell lets you browse and inspect all ingested data (champions, items, runes, augments with descriptions)
- [ ] Entity dictionary is queryable (lookup by name, fuzzy search)
- [ ] TDD coverage for all parsers, cache behavior, and data merging logic

---

## Phase 2: Mode Module (ARAM Mayhem) + Game State Manager

**User stories**: 2 (auto-detect game state), 3 (contextual augment recs), 4 (item purchase recs)

### What to build

The Mode Module defines ARAM Mayhem behavior: what data sources the mode needs, what decision types it supports (augment selection, item purchase), and what mode-specific context to include (ARAM balance overrides). The Game State Manager polls the Riot Live Client Data API for the active player's champion/level/gold/runes/stats, all players' champions/items/teams/KDA/summoner spells, and game mode/time. It accepts manual input for data the API doesn't expose (augments).

The desktop shell now visualizes live game state — play a game and watch data flow through the state machine in real time. This validates what the Riot API actually provides and identifies gaps that need voice/manual input. Game sessions begin persisting to a local SQLite database (champion, items, augments selected, game mode, timestamps) to accumulate real history for cross-game memory features later.

### Acceptance criteria

- [ ] Mode Module defines ARAM Mayhem decision types and applies ARAM balance overrides from Phase 1 data
- [ ] Game State Manager detects an active game and polls the Riot API for live state
- [ ] Desktop shell displays live game state updating in real time during a game
- [ ] Manual augment input is accepted and reflected in tracked state
- [ ] Game sessions persist to SQLite with champion, items, augments, mode, and timestamps
- [ ] Mode Module implements a shared interface that future modes (Arena, ARAM, SR) can also implement
- [ ] TDD coverage for state transitions, API response normalization, augment accumulation, and mode-specific overrides

---

## Phase 3: Model Evaluation Pipeline

**User stories**: 23 (borrow from review-kit/Evalite)

### What to build

Build-time tooling for selecting the best LLM for coaching recommendations. Stage 1 uses PickAI for candidate discovery, weighted for speed, structured output reliability, reasoning quality, and context capacity. Subsequent stages run candidates against representative coaching prompts using real game states captured from Phase 2. Evaluation criteria are task-specific: response quality, speed, structured output reliability, and coaching relevance. Winners are committed as static configuration consumed by the Recommendation Engine.

The pipeline borrows the funnel pattern from the review-kit project's Evalite integration. It is designed to be re-run when new models are released, prompts change significantly, or scoring methodology is updated.

### Acceptance criteria

- [ ] PickAI candidate discovery runs with coaching-relevant weight criteria
- [ ] Evaluation harness runs candidates against representative coaching prompts with real game state data
- [ ] Scoring covers response quality, speed, structured output reliability, and coaching relevance
- [ ] Winning model(s) committed as static config that the Recommendation Engine can consume
- [ ] Pipeline is re-runnable (not a one-shot script)
- [ ] TDD coverage for scorers and candidate filtering logic

---

## Phase 4: Context Assembler + Recommendation Engine

**User stories**: 8 (unconventional build paths), 12 (text input fallback), 17 (blunt coaching style)

### What to build

The Context Assembler takes the current game state and a parsed intent, then assembles the full context payload for the LLM: champion ability descriptions, item/augment effect descriptions, enemy team data, mode-specific context (balance overrides), and the entity data needed for the decision at hand. It keeps the payload within reasonable size bounds for speed.

The Recommendation Engine takes the assembled payload, constructs a prompt using mode-appropriate templates (system prompt with coaching personality, game context, decision options, output format instructions), calls the model selected in Phase 3 via the Vercel AI SDK, and parses the response into a structured recommendation with ranked options and per-option reasoning.

Text input is the interface for now — type a question in the desktop shell, get a contextual recommendation displayed. This is the first time the full loop works end-to-end with real data, real game state, and an evaluated model.

### Acceptance criteria

- [ ] Context Assembler produces a complete payload from game state + intent + mode context
- [ ] Payload stays within defined size bounds
- [ ] Recommendation Engine constructs prompts using mode-specific templates with blunt coaching tone
- [ ] LLM responses are parsed into structured recommendations (ranked options with reasoning)
- [ ] Text input in the desktop shell triggers the full pipeline and displays the recommendation
- [ ] Recommendations account for champion abilities, current items, augments, and enemy team
- [ ] TDD coverage for context assembly (deterministic given known inputs), prompt construction, and response parsing

---

## Phase 5: Voice Input

**User stories**: 1 (hotkey + speak), 6 (League terminology recognition)

### What to build

Two sub-components: audio capture + STT transcription, and transcript parsing. The STT engine is selected at implementation time based on speed and custom vocabulary support (keyword boosting via Deepgram/AssemblyAI, or prompt hinting via Whisper-based engines). The transcript parser uses the entity dictionary from Phase 1 to fuzzy-match potentially mangled STT output to known champions, items, and augments. It outputs a structured intent: what the user is asking about, which entities they referenced, what decision type this is.

A global hotkey (registered via Tauri) triggers audio capture. The structured intent feeds into the existing Context Assembler pipeline. Voice becomes the primary input path alongside the text fallback from Phase 4.

### Acceptance criteria

- [ ] Global hotkey activates audio capture without alt-tabbing
- [ ] STT engine transcribes speech with acceptable speed and accuracy for gaming context
- [ ] Transcript parser correctly identifies League entities (champions, items, augments) from STT output, including common misrecognitions
- [ ] Parser outputs a structured intent consumed by the Context Assembler
- [ ] End-to-end: press hotkey, speak augment options, receive contextual recommendation
- [ ] Desktop shell shows voice activation state and parsed intent for debugging
- [ ] TDD coverage for transcript parser using a corpus of realistic transcripts (including STT errors)

---

## Phase 6: Conversational Coaching

**User stories**: 5 (open-ended mid-game questions), 11 (conversational continuity)

### What to build

A rolling history window (last 2-3 exchanges) maintained by the Game State Manager, included in context assembly so the LLM can reference what it recommended earlier in the game. The player can ask follow-up questions ("what about if I went tank instead?") and open-ended questions ("their Vayne is shredding me, what should I adjust?").

The app owns the conversation state, not the LLM — context is assembled fresh each time from tracked game state plus the short history window. This approach is abstracted behind an interface so it can be swapped to persistent conversation history or adapted for local LLMs later.

### Acceptance criteria

- [ ] Recent exchanges (last 2-3) are maintained and included in context assembly
- [ ] Follow-up questions reference prior recommendations correctly
- [ ] Open-ended mid-game questions produce actionable advice using current game state
- [ ] History window resets between games
- [ ] Conversation state interface is abstracted for future swap to persistent history or local LLMs
- [ ] TDD coverage for history windowing and context assembly with history included

---

## Phase 7: UI Polish

**User stories**: 7 (always-on-top second monitor), 20 (minimal resources)

### What to build

The final UI layer over the dev shell's state visualizer. Recommendation display shows ranked options with per-option reasoning. Game state summary, voice activation indicator, and text input fallback are refined for daily use. Always-on-top window management is tuned for second-monitor positioning. Resource usage is profiled and optimized to minimize impact on game performance.

### Acceptance criteria

- [ ] Recommendation display clearly shows ranked options with reasoning
- [ ] Always-on-top window works reliably on a second monitor without interfering with the game
- [ ] UI shows game state summary, voice activation state, and text input
- [ ] Memory and CPU usage profiled and within acceptable bounds during gameplay
- [ ] App feels usable for nightly games, not just a dev tool

---

**--- POC Complete ---**

---

## Phase 8: In-Game Overlay

**User stories**: 14 (overlay display)

### What to build

Overwolf integration (or similar technology) for rendering recommendations as an in-game overlay, so the player never has to look away from the game. The overlay displays the same recommendation content as the desktop shell but positioned within the game window. Compliant with Riot's overlay policy (no advertisements).

### Acceptance criteria

- [ ] Recommendations display as an overlay within the game window
- [ ] Overlay positioning is configurable and doesn't obstruct critical game UI
- [ ] Overlay updates in real time as new recommendations arrive
- [ ] Compliant with Riot overlay policy (no ads, no prohibited data)
- [ ] Player can toggle between overlay mode and second-monitor mode

---

## Phase 9: Augment Set Tracking

**User stories**: 15 (set bonus progression in recommendations)

### What to build

Augment set bonus progression calculations added to the Mode Module. Tracks which synergy sets the player is building toward, how many pieces they have, and what completing a set would unlock. Recommendations now factor in whether completing a synergy set is worth taking a weaker individual augment. Set progress is visible in the desktop shell and overlay.

### Acceptance criteria

- [ ] Set bonus progression is tracked as augments are selected
- [ ] Recommendations consider set completion value vs individual augment strength
- [ ] Set progress is visible in the UI (desktop shell and overlay)
- [ ] Context Assembler includes set progression data in LLM payloads
- [ ] TDD coverage for set progression calculations and set-aware recommendation scenarios

---

## Phase 10: Cross-Game Memory

**User stories**: 16 (remember patterns from previous games)

### What to build

SQLite + FTS5 for structured game history search, with sqlite-vec or similar for semantic search if needed. Leverages the game session data that has been accumulating since Phase 2. The coach can now reference past games in recommendations — "last game you went full AP against tanks and it didn't work." The Context Assembler pulls relevant history into the payload when it would inform the current decision.

### Acceptance criteria

- [ ] Game history is searchable via FTS5 (champion, items, augments, mode, outcome)
- [ ] Context Assembler retrieves relevant past games when they would inform the current decision
- [ ] Coach references historical patterns in recommendations when appropriate
- [ ] Historical context does not bloat the LLM payload — relevant games are selected, not dumped
- [ ] TDD coverage for history retrieval, relevance filtering, and context assembly with history

---

## Phase 11: Additional Mode Modules

**User stories**: 19 (Arena mode coaching)

### What to build

New mode modules implementing the same interface established in Phase 2: Arena, regular ARAM, and potentially Summoner's Rift. Each defines its own decision types, data sources, and mode-specific context. Adding a mode means adding a new module, not modifying existing ones. The shared Recommendation Engine and Context Assembler work unchanged.

### Acceptance criteria

- [ ] Arena mode module provides contextual augment and item recommendations
- [ ] Regular ARAM mode module provides item and situational recommendations
- [ ] Each mode implements the shared mode interface without modifying existing modules
- [ ] Game State Manager correctly detects and delegates to the appropriate mode
- [ ] Recommendation Engine and Context Assembler work unchanged with new modes

---

## Phase 12: TTS + Coaching Personality

**User stories**: 13 (TTS output), 18 (personality/style options)

### What to build

TTS output so the player can hear recommendations without looking away during intense moments. Coaching personality selector — blunt (default), educational, or other tones — implemented as system prompt variants in the Recommendation Engine's prompt templates. The player can switch styles in the UI.

### Acceptance criteria

- [ ] TTS reads recommendations aloud with acceptable latency and clarity
- [ ] TTS can be toggled on/off
- [ ] Multiple coaching personalities available (at minimum: blunt, educational)
- [ ] Personality selection changes the tone and style of recommendations
- [ ] Personality is implemented as prompt template variants, not separate recommendation logic

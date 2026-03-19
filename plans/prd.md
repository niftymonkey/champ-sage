# Champ Sage — Product Requirements Document

## Problem Statement

League of Legends players making in-game decisions have no real-time, contextual help. Every existing tool (Mobalytics, Blitz.gg, U.GG, Porofessor) delivers static, statistical recommendations — win rates and tier lists that don't account for the player's actual game state.

This gap is most acute in augment-based modes like ARAM Mayhem and Arena. With 195+ augments across 9 synergy sets, bonuses at 2/3/4 pieces, and augment-champion-item interactions that compound through the game, the "best" choice depends on context no existing tool considers: what you've already accumulated, which synergy sets you're building toward, the enemy team composition, and how your champion's abilities interact with augment effects.

Augments can also fundamentally redirect a champion's build path — most champions have multiple viable playstyles (tank vs DPS, burst vs poke, mage vs healer). Early augment offerings can make an unconventional build suddenly optimal, but no tool helps navigate that pivot. Existing tools lock you into a pre-game build based on win rates.

Beyond augment modes, there is no tool that provides conversational mid-game coaching, voice interaction for ARAM players, or real-time decision support at the moment of choice. The knowledge about champion-augment synergies is tribal — scattered across Reddit posts and YouTube videos, not aggregated in any tool's recommendation engine. ARAM players are broadly underserved, and even frequently-updated tools like Mobalytics have gone months without adding support for newer modes.

## Solution

A voice-first AI coaching assistant that runs as a desktop app alongside League of Legends. The player presses a global hotkey, speaks their situation ("I got Typhoon, Quantum Computing, and Self Destruct — which should I pick?"), and receives a contextual recommendation displayed in an always-on-top window.

The app automatically tracks game state via the Riot Live Client Data API (items, gold, level, enemy team, champion stats) and requires voice input only for data the API doesn't expose (augment choices). It maintains a conversational tone — the player can ask follow-up questions, request item purchase advice, or ask open-ended questions about the game ("their Vayne is shredding me, what should I adjust?").

The coaching style is blunt and decisive by default. Recommendations consider the player's full context: champion abilities, runes, current items, current augments, enemy team composition, and (in future versions) augment set bonus progression and cross-game patterns.

The architecture is mode-agnostic — a shared recommendation engine handles any mode where the player has options to evaluate in context. ARAM Mayhem is the starting mode; the same core extends to Arena, regular ARAM, and Summoner's Rift.

## User Stories

1. As a player, I want to press a global hotkey and speak my augment options so that I can get a recommendation without alt-tabbing out of the game
2. As a player, I want the app to automatically know my champion, items, gold, level, and enemy team so that I don't have to manually enter game state
3. As a player, I want augment recommendations that consider my champion's abilities, runes, current items, and current augments so that I get contextual advice, not generic tier lists
4. As a player, I want item purchase recommendations that account for my full build context and enemy team so that I know what to buy when I'm at the shop
5. As a player, I want to ask open-ended questions mid-game ("their Vayne is shredding me") and get actionable advice so that I can adapt my play in real time
6. As a player, I want the app to correctly understand League-specific terminology when I speak (champion names, augment names, item names) so that voice input works reliably
7. As a player, I want to see recommendations displayed in a small always-on-top window on my second monitor so that I can read advice without looking away from the game
8. As a player, I want the coach to recognize when an early augment makes an unconventional build path optimal so that I'm not locked into a pre-game plan
9. As a player, I want the app to have current game data (champions, items, augments, ARAM overrides) available immediately on launch so that there's no setup delay before I queue up
10. As a player, I want data to refresh in the background when a new patch drops so that recommendations stay accurate without manual intervention
11. As a player, I want the coach to feel conversational — able to reference what it recommended earlier in the game — so that advice builds on prior context rather than starting fresh each time
12. As a player, I want a text input fallback so that I can type instead of speak when voice isn't convenient
13. As a player, I want to hear recommendations via TTS so that I don't have to look at my phone or second monitor during intense moments
14. As a player, I want recommendations displayed as an in-game overlay so that I never have to look away from the game at all
15. As a player, I want augment set bonus progression factored into recommendations so that the coach considers whether completing a synergy set is worth taking a weaker individual augment
16. As a player, I want the coach to remember patterns from my previous games so that advice improves over time ("last game you went full AP against tanks and it didn't work")
17. As a player, I want the coaching style to be blunt and decisive so that I get a clear answer fast, not a hedged analysis
18. As a player, I want personality/style options for the coach so that I can choose between blunt, educational, or other tones
19. As a player, I want the same coaching experience in Arena mode so that I get contextual augment and item advice regardless of which augment-based mode I'm playing
20. As a player, I want the app to use minimal system resources so that it doesn't impact game performance
21. As a developer, I want the desktop shell to serve as a state machine visualizer during development so that I can see all data flowing through the app (Riot API data, parsed state, augments, context payloads, LLM responses) while playing my nightly games
22. As a developer, I want each module to be independently testable so that I can validate behavior in isolation before integration
23. As a developer, I want the model evaluation pipeline to borrow from the existing review-kit evaluation infrastructure so that I don't reinvent the funnel pattern

## Implementation Decisions

### Project Name

**Champ Sage** — "Champion + Sage (wise advisor)." Validated as available across npm, GitHub, all major domain TLDs (.com, .dev, .gg, .ai, .app, .io), and social media. No existing products, trademarks, or gaming-space conflicts.
- Display name: **Champ Sage** (or **ChampSage**)
- Repository / package name: `champ-sage`

### Module Architecture

The system is composed of the following modules. Dependencies are listed to clarify build ordering — a module can only be built/tested once its dependencies exist.

**Data Ingest Pipeline**
- Dependencies: none (foundational)
- Fetches and normalizes game data from external sources (Data Dragon for champions/items/runes, League Wiki Lua module for augments and set bonuses, Community Dragon for augment IDs/icons, League Wiki for ARAM balance overrides)
- Serves from local cache; background refresh on launch updates cache with anything new
- Strips wiki markup from augment descriptions, parses Lua tables to JSON, merges data across sources
- Exposes a lookup interface for champions, items, runes, and augments
- The entity dictionary (all known champion/item/augment names) is used downstream by the voice parser for fuzzy matching

**Desktop Shell**
- Dependencies: none (can be built in parallel with data ingest)
- The Tauri v2 wrapper providing global hotkey registration, always-on-top window management, system tray, and audio capture
- Built early as a development tool — starts as a state machine visualizer showing all data flowing through the app (Riot API data, parsed game state, augment entries, context payloads, LLM responses)
- Each module's output becomes visible in the shell as it's built, enabling dogfooding during nightly games
- The final UI is a polish layer over this foundation, not a separate build

**Mode Module (ARAM Mayhem first)**
- Dependencies: Data Ingest Pipeline
- Defines mode-specific behavior: what data sources the mode needs, what decision types it supports, what mode-specific context to include (ARAM balance overrides, augment set bonuses)
- Each game mode is a separate module implementing the same interface — adding Arena or Summoner's Rift means adding a new module, not modifying existing ones
- For POC: augment selection and item purchase decisions, no set tracking
- For ideal product: augment set bonus progression calculations, set completion recommendations

**Game State Manager**
- Dependencies: Data Ingest Pipeline, Mode Module
- Tracks current game session state by polling the Riot Live Client Data API (port 2999, no auth, localhost, self-signed SSL)
- Automatically captures: active player champion/level/gold/runes/stats, all players' champions/items/teams/KDA/summoner spells, game mode and time
- Accepts manual input for data the API doesn't expose (augments)
- Maintains a rolling window of recent coach interactions (last 2-3 exchanges) for conversational continuity
- The app owns the state, not the LLM — context is assembled fresh each time from tracked state plus the short history window
- This approach should be abstracted behind an interface so it can be swapped to persistent conversation history or adapted for local LLMs later
- Game sessions persist to a local SQLite database as soon as state tracking exists — champion, items, augments, game mode, timestamps. This accumulates real historical data for cross-game memory features rather than starting from zero when those features are built

**Voice Input (STT + Transcript Parser)**
- Dependencies: Data Ingest Pipeline (for entity dictionaries)
- Two sub-components: audio capture + STT transcription, and transcript parsing
- STT engine selection is a research task at implementation time — speed and custom vocabulary support for League-specific terms are the key criteria
- Custom vocabulary approaches include keyword boosting (Deepgram, AssemblyAI) and prompt hinting (Whisper-based engines) — evaluate at implementation time
- The transcript parser maps potentially mangled STT output to known game entities using the entity dictionary from the Data Ingest Pipeline
- Parser outputs a structured intent: what the user is asking about, which entities they referenced, what decision type this is

**Context Assembler**
- Dependencies: Data Ingest Pipeline, Game State Manager, Mode Module, Voice Input
- Given the current game state and a parsed intent, assembles the full context payload for the LLM
- Pulls champion ability descriptions, item/augment effect descriptions, enemy team data, mode-specific context (balance overrides, set progress), and the recent conversation history window
- Responsible for keeping the payload within reasonable size bounds for speed
- The assembly logic is deterministic and highly testable — given a known game state + intent, the output is predictable

**Model Evaluation Pipeline (Build-Time Tooling)**
- Dependencies: Context Assembler (for representative prompt templates and test game states to evaluate models against)
- Borrows heavily from the review-kit evaluation infrastructure, including the Evalite integration
- Multi-stage funnel: Stage 1 uses PickAI for candidate discovery (weighted for speed, structured output, reasoning, context capacity, instruction following, etc. via Artificial Analysis benchmarks and built-in criteria). Subsequent stages run candidates against representative coaching prompts with test game states.
- Evaluation criteria are task-specific: response quality, speed, structured output reliability, and coaching relevance
- Winners are committed as static configuration consumed by the Recommendation Engine
- Re-run when new models are released, prompts change significantly, or scoring methodology is updated

**Recommendation Engine**
- Dependencies: Context Assembler, Model Evaluation Pipeline (must know which model to use)
- Takes an assembled context payload, constructs a prompt using mode-appropriate templates, calls the evaluated LLM, and parses the response into a structured recommendation
- Prompt templates are mode-specific but follow a shared structure: system prompt (coaching personality), game context, decision options, instruction for output format
- Response parsing extracts ranked options with per-option reasoning
- The LLM model used is determined by the Model Evaluation Pipeline, not selected at runtime

**UI (React/TypeScript)**
- Dependencies: all other modules
- The final polish layer over the desktop shell's state visualizer
- Recommendation display (ranked options with reasoning), game state summary, voice activation indicator, text input fallback
- For the ideal product: TTS toggle, overlay mode, coaching personality selector

### Data Flow

1. App launches → Data Ingest Pipeline serves from cache, kicks off background refresh
2. Game detected → Game State Manager begins polling Riot Live Client Data API
3. Player presses hotkey → Voice Input captures audio, transcribes, parses to structured intent
4. Context Assembler pulls game state + intent + mode context + recent history → constructs payload
5. Recommendation Engine builds prompt, calls LLM, parses response → structured recommendation
6. Desktop Shell / UI displays recommendation
7. Player confirms their choice via voice → Game State Manager updates tracked state (e.g., selected augment added)

### Key Technical Decisions

- **TypeScript preferred** for all application code. Rust required only for the Tauri v2 backend surface (hotkeys, window management, audio capture).
- **Desktop framework: Tauri v2.** Chosen for resource efficiency (~20-80MB idle vs Electron's ~100-300MB). Vite + React for the frontend webview.
- **pnpm** for package management. **Vitest** for unit/integration testing. **Vercel AI SDK** (`ai` package) for LLM calls.
- **No throwaway infrastructure.** Modules are built with real data and real integrations from the start, not hardcoded placeholders that get replaced later.
- **Riot Live Client Data API** is the primary source for game state. Voice input fills gaps (augments, any data not exposed by the API). The API uses HTTPS on localhost:2999 with a self-signed certificate.
- **Local cache with background refresh** for game data. The app always has data immediately from the last fetch; new patch data is fetched on launch and merged in the background.
- **App owns the conversation state**, not the LLM. Context is assembled fresh from tracked game state plus a rolling window of recent exchanges. This is abstracted behind an interface for future flexibility (persistent history, local LLMs).
- **LLM model is determined by build-time evaluation**, not runtime selection. The evaluation pipeline borrows from review-kit's funnel pattern with Evalite integration.
- **Augment data is sourced from the League Wiki Lua module** (descriptions, tiers, sets) supplemented by Community Dragon (IDs, icons). Wiki markup is stripped during ingestion.

### Riot Policy Compliance

- Build recommendations, item suggestions, and champion select assistance are explicitly allowed by Riot
- Augment win rate display is prohibited — the app provides contextual reasoning, not win rate data
- Enemy cooldown tracking is prohibited and not part of this app's scope
- In-game overlay advertisements are banned by Riot policy

## Testing Decisions

**Philosophy:** TDD by default. Each module should be built test-first unless there's a specific reason to opt out (voice capture and audio-dependent paths are the primary exception). Tests should verify external behavior through the module's interface, not implementation details.

**Modules with TDD coverage:**

- **Data Ingest Pipeline** — Parser tests for each data source: Lua table → JSON conversion, Data Dragon response normalization, wiki markup stripping, data merging across sources. Cache behavior (serve stale, refresh in background).
- **Mode Module** — Given a game state, verify correct balance overrides and (future) set progress calculations. Decision type enumeration per mode.
- **Game State Manager** — State transitions, augment accumulation, history windowing, Riot API response normalization. Mock the API responses.
- **Transcript Parser** — Given a raw transcript and entity dictionary, verify correct entity identification and intent classification. This is the most testable part of the voice module — use a corpus of realistic transcripts (including STT misrecognitions) as test cases.
- **Context Assembler** — Given known game state + intent, verify the assembled payload contains the correct data in the correct structure. Verify context stays within size bounds.
- **Recommendation Engine** — Prompt construction tests (given context, verify prompt template output). Response parsing tests (given raw LLM text, verify structured recommendation extraction). LLM calls themselves are integration tests, not unit tests.
- **Model Evaluation Pipeline** — Scorer tests (given a model response and expected outcome, verify correct scoring). Candidate discovery criteria validation.

**Modules opted out of TDD:**

- **Desktop Shell** — Platform integration (hotkeys, window management, audio capture) is tested manually. The shell is thin by design.
- **STT transcription** — The audio capture → text transcription path depends on external services and hardware. Tested manually and via integration tests.
- **UI** — Component rendering tests where logic-heavy, but not strict TDD.

## Out of Scope

- **Pre-game decisions** — Rune selection, summoner spell choice, and skill level-up order are out of scope. Players continue using Mobalytics or similar tools for pre-game setup.
- **Augment win rate display** — Prohibited by Riot policy. The app provides contextual reasoning, not statistical win rates.
- **Enemy cooldown tracking** — Prohibited by Riot policy.
- **Brawl mode** — Riot has declared Brawl data completely off-limits for third-party products.
- **Hosted web service / multi-user backend** — The app is local-only for now.
- **Mobile app** — The POC and initial product are desktop-only. Mobile may be revisited if the desktop shell framework (Tauri) supports it.

## Further Notes

### Phase Boundaries

**POC** targets validating both the AI recommendation quality and the voice-first interaction model:
- Desktop shell as state machine visualizer (built early, used throughout development)
- Data ingest pipeline (champions, items, runes, augments, ARAM overrides)
- Game state tracking via Riot Live Client Data API
- Voice input with STT and League-term parsing
- Context assembly and LLM recommendation (single evaluated model)
- ARAM Mayhem mode: augment selection (individual best, no set tracking) and item purchase recommendations
- Open-ended conversational questions
- Text display output in always-on-top window

**Ideal product** builds on the POC foundation:
- Augment set tracking and set bonus progression in recommendations
- TTS output for hands-free advice
- In-game overlay via Overwolf or similar
- Cross-game memory (SQLite + FTS5 for structured game history, sqlite-vec or similar for semantic search if needed)
- Multi-model evaluation with PickAI + Evalite pipeline
- Additional mode modules (Arena, regular ARAM, Summoner's Rift)
- Coaching personality/style options
- Automated patch update detection and data refresh

**Future considerations:**
- Overwolf App Store distribution
- Hosted web service / multi-user support
- Local LLM support (the context assembly abstraction enables this)

### Exploration Document

The full exploration and research findings (including detailed data on the Riot API, augment data sources, STT engine landscape, desktop framework comparison, Overwolf capabilities, PickAI integration patterns, and cross-game memory approaches) are in the `plans/` directory alongside this PRD. That document should be referenced when picking up individual implementation tasks.

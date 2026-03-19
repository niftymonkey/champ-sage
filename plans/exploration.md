# League Buddy — Idea Exploration Summary

## Problem / Opportunity

League of Legends players making in-game decisions — which augment to pick, what item to buy, how to adapt to the enemy team — have no real-time, contextual help. The tools that exist (Mobalytics, Blitz.gg, U.GG, Porofessor) all share the same fundamental limitation: they deliver **static, statistical recommendations** (win rates and tier lists) that don't account for the player's actual game state.

This gap is most acute in augment-based modes like ARAM Mayhem and Arena, where the decision space is enormous. With 195+ augments across 9 synergy sets, bonuses at 2/3/4 pieces, and augment-champion-item interactions that compound through the game, the "best" choice depends heavily on context that no existing tool considers:

- What augments and items you've already accumulated
- Which synergy sets you're building toward (and whether completing one is worth taking a weaker individual augment)
- The enemy team composition and how it should shift your priorities
- Your specific champion's abilities and how they interact with augment effects

This isn't a problem unique to one mode. Any mode with compounding in-game choices — augment selection, item purchasing, build adaptation — benefits from contextual reasoning over static tier lists. ARAM Mayhem is the starting point, but the value extends to Arena, regular ARAM, and potentially Summoner's Rift.

**Specific gaps in the current tool landscape:**

- **No contextual recommendations exist.** Every tool says "this augment has a 58% win rate on this champion." None say "given your current build and the enemy team, pick this one." The combinatorial nature of augment systems makes static tier lists especially inadequate.
- **Augments can redirect your entire build path, but no tool helps navigate that.** Most champions have multiple viable playstyles (tank vs DPS, burst vs poke, mage vs healer, etc.). In augment-based modes, early augment offerings can make an unconventional build path suddenly optimal — but existing tools lock you into a pre-game build based on win rates. A contextual coach could recognize that your first augment makes a poke Miss Fortune stronger than the usual AD burst build, and adjust all subsequent recommendations accordingly.
- **No mid-game decision support.** Augment selection happens at death/respawn under time pressure. Existing overlays show pre-imported builds but don't help at the moment of decision. Web-based tools require alt-tabbing out of the game.
- **No voice interaction for ARAM or augment-based modes.** STATUP.GG offers voice coaching but only for Summoner's Rift ranked play. No tool lets you speak your situation and get advice back.
- **No conversational coaching.** Players can't ask follow-up questions ("their Vayne is shredding me, what should I adjust?"). Every tool is a one-way information display.
- **Synergy knowledge is tribal and scattered.** The best champion+augment combo knowledge lives in Reddit posts and YouTube videos. No tool aggregates and reasons over this knowledge in real time.
- **ARAM players are underserved broadly.** Most tools are built for ranked Summoner's Rift. ARAM is an afterthought. Augment-based modes like Mayhem and Arena are an afterthought of an afterthought — even Riot's own API doesn't expose Mayhem data.
- **Slow or absent support for new modes.** Even frequently-updated tools like Mobalytics have gone months without adding Mayhem-specific support. When Riot launches or updates a game mode, players who want tooling are left waiting on third-party roadmaps.

## Target Users

- League of Legends players across any game mode
- Players who want contextual, in-the-moment advice rather than pre-game build guides
- Initially the developer; eventually distributed to others

## Core Requirements

### Must-Have (Ideal Product)

- **Voice-first interaction** via global hotkey — speak to the coach without leaving the game
- **Augment selection recommendations** — "I got these three options, which is best for my current build"
- **Item purchase recommendations** — "what should I buy next" given champion, runes, items, augments, enemy team
- **Open-ended conversational questions** — "their Vayne is shredding me, what do I do"
- **Automatic game state tracking** via Riot Live Client Data API (items, gold, level, enemy team) where possible, voice fallback where not
- **STT parsing that handles League-specific terminology** — champion names, augment names, item names, game-specific terms
- **Augment set tracking** — factor set bonus progression into augment recommendations
- **Cross-game memory** — coach remembers patterns from previous games
- **Blunt, decisive coaching style** as default, with personality/style options later
- **In-game overlay** via Overwolf or similar for displaying recommendations without leaving the game
- **TTS output** — hear recommendations without looking away from the game
- **Data ingest pipeline** — champions, items, runes, augments, ARAM overrides; automated updates on new patches
- **LLM model selection via PickAI** — speed-biased, with multi-model fallback
- **Mode-agnostic architecture** — core engine works across game modes, each mode is a pluggable module

### Must-Have (POC)

- Voice input via global hotkey with STT
- STT parsing that handles League-specific terminology accurately
- Augment selection recommendations (individual best, no set tracking)
- Item purchase recommendations
- Open-ended conversational questions
- Desktop app with always-on-top window (stepping stone toward overlay)
- Data ingest on app launch (champions, items, runes, augments, ARAM overrides)
- One LLM model selected via PickAI (speed-biased)
- Text display output

### Nice-to-Have (Future)

- Multi-model fallback with PickAI managing selection
- Rune/summoner spell/skill order advice (currently handled by Mobalytics)
- Hosted web service / multi-user support
- Personality/style options for the coach

## Key Decisions Made

| Decision | Outcome | Rationale |
|----------|---------|-----------|
| Platform | Desktop app (Tauri vs Electron TBD) | Needs global hotkey + always-on-top window; player has multiple monitors |
| Primary input | Voice via global hotkey | Can't alt-tab out of game; voice is fastest mid-game input |
| Language | TypeScript preferred | Developer preference; viable for full stack including vector DB work |
| LLM provider | Not locked in; speed is top priority | Open to any provider; PickAI library handles model selection with latency as a benchmark criterion |
| Data fetch | Fetch on launch, serve from local cache | App always has data immediately from last fetch; background refresh on launch updates cache with anything new |
| Game state | Riot Live Client Data API if it works, voice fallback | Minimize manual input; API could eliminate item/gold/level/enemy tracking |
| Starting mode | ARAM Mayhem | Most decision complexity (augments + items); core engine generalizes to other modes |
| Distribution | Local app, BYOK for now | Hosted service considered for the future |
| Coach personality | Blunt and decisive as default | More style options later |

## Research Findings

### Riot Live Client Data API

Two separate local APIs exist:

**Game Client API (port 2999)** — Available during active gameplay, no authentication required, localhost only, self-signed SSL certificate.

Data available automatically during gameplay:
- **Active player:** Champion, level, current gold, full rune page, complete stat block (AD, AP, armor, MR, attack speed, ability haste, etc.), ability levels
- **All 10 players:** Champion names, teams, items (with IDs/names/slots), level, KDA, summoner spells, keystone rune + trees
- **Game info:** Game mode, game time, map

Data NOT available:
- **Augments** — not exposed for any mode. Voice input is required for augment choices.
- Ability cooldowns (deliberate Riot policy)
- Enemy gold (only active player's gold is exposed)
- Detailed stats for other players (only active player gets the full stat block)
- Minimap positions / coordinates

**LCU API (random port)** — Separate API for the League Client (lobby/champion select). Requires per-session auth via lockfile. Provides champion select state, but is officially unsupported and can change without notice.

**Mode support:** The Game Client API runs whenever the game client is active, including ARAM, Mayhem, and Arena. Data structure is the same across modes, though some fields (e.g., position) are empty in non-SR modes.

**Policy restrictions to be aware of:**
- "Products cannot display win rates for Augments or Arena Mode items"
- Brawl mode data is completely off-limits for third-party products
- Enemy cooldown tracking is prohibited
- Build recommendations, item suggestions, and champion select assistance are explicitly allowed

**Implication for UX:** Game state (items, gold, level, enemy team composition, champion stats) can be tracked automatically. Augment choices must come from the user via voice. This is a clean split.

### Augment Data Sources

Mayhem augment data is confirmed available from multiple sources:

**Primary: League Wiki Lua Module**
- `wiki.leagueoflegends.com/en-us/Module:MayhemAugmentData/data?action=raw`
- ~200+ augment entries with: description (full effect text), tier (Silver/Gold/Prismatic), set membership, and notes
- Format: Lua tables — parseable to JSON. Descriptions contain wiki markup that needs stripping.
- Note: the wiki migrated from `leagueoflegends.fandom.com` to `wiki.leagueoflegends.com` (fandom URLs return 403)

**Supplementary: Community Dragon**
- `cherry-augments.json` contains both Arena and Mayhem augments mixed together. Mayhem augments identifiable by `Kiwi/` in icon paths.
- Provides: numeric IDs, display names, icon paths, rarity. Does NOT include descriptions or set membership.
- `kiwi.bin.json` (~1MB) has deeper augment definitions but uses localization keys instead of actual text.

**Set bonus data:** Available from the wiki's `ARAM:_Mayhem/Augment_Sets` page — all 9 sets with member augments and bonus descriptions at 2/3/4 thresholds.

**Best approach:** Wiki Lua module for content (descriptions, tiers, sets), Community Dragon for IDs and icons, wiki Augment Sets page for set bonus details.

### Speech-to-Text Landscape

The critical differentiator is **custom vocabulary support** — League terminology (Morellonomicon, Cho'Gath, Navori, etc.) will be misrecognized by general STT.

**Approaches to custom vocabulary:**
- **Keyword boosting** (Deepgram, AssemblyAI) — explicitly supply a term list with intensity weights; the model actively listens for those terms. Purpose-built for domain-specific jargon.
- **Prompt hinting** (Whisper-based: OpenAI API, Groq) — a `prompt` parameter (224 token limit) hints at spelling of unusual words. Helps but less reliable than keyword boosting.
- **Web Speech API** — has a `grammars` API but it's poorly supported in practice (Chrome ignores it). Also unavailable in Tauri (it's a browser API).

**Speed comparison for short utterances (5-15s):**

| Engine | Latency | Custom Vocab | Local? | Pricing |
|--------|---------|-------------|--------|---------|
| Deepgram (streaming) | ~300ms | Keyword boosting (strong) | No | ~$0.54/hr with keyterms |
| Groq Whisper (batch) | ~340ms | Prompt hinting (moderate) | No | $0.04/hr |
| Local Whisper (CPU) | 1-5s | Prompt hinting (moderate) | Yes | Free (compute only) |
| OpenAI Whisper API | 3s+ | Prompt hinting (moderate) | No | $0.36/hr |
| Web Speech API | 200-800ms | Broken in practice | No (sends to Google) | Free |
| AssemblyAI (streaming) | 200-500ms | Word boost (strong) | No | ~$0.19/hr with keyterms |

**Key tradeoff:** Keyword boosting (Deepgram, AssemblyAI) gives the best accuracy for game terms. Prompt hinting (Groq) is simpler and cheaper but less reliable for novel vocabulary.

### Desktop App Frameworks

**Resource usage comparison (running alongside a game):**

| Metric | Tauri v2 | Electron |
|--------|----------|----------|
| Idle RAM | ~20-80 MB | ~100-300 MB |
| Installer size | ~3-10 MB | ~80-150 MB |
| Cold start | <0.5s | 1-2s |
| Backend language | Rust | Node.js/TypeScript |
| Frontend | Any web framework (React/TS) | Any web framework (React/TS) |

Both frameworks support global hotkeys (built-in), always-on-top windows, and system tray. Both work with League's default borderless windowed mode. Neither can overlay on exclusive fullscreen.

**Tauri tradeoffs:** Significantly lighter resource footprint. Requires Rust for backend logic (hotkeys, window management, audio capture). WebView2 on Windows has known issues with microphone permissions — audio capture is more reliable on the Rust side.

**Electron tradeoffs:** Full TypeScript top to bottom. Higher resource usage. Larger installer. More mature ecosystem with deeper documentation.

**Other frameworks considered:** Neutralinojs (lacks global hotkey support), Wails/Go (Go backend less attractive given TS preference). Neither is a strong candidate.

### Overwolf and In-Game Overlays

**Overwolf capabilities:**
- Renders web-based UI (HTML/CSS/JS) on top of games via Chromium Embedded Framework or Electron fork
- React + TypeScript fully supported with community boilerplates
- Game Events Provider (GEP) for League exposes: match state, player info, items, level, K/D/A, team composition, summoner spells, champion select events
- Apps distributed via Overwolf App Store (review process required)
- Two frameworks: Overwolf Native (CEF, tighter integration) and Overwolf Electron (more flexible)

**Riot policy (as of 2025):**
- Build recommendations, item suggestions, champion select assistance: **allowed**
- In-game overlay advertisements: **banned**
- Enemy ult/summoner/jungle timers: **banned**
- In-game overlay advertisements are banned by Riot policy
- Riot does not have an exclusive Overwolf partnership; each app must comply independently

**Alternative to Overwolf:** Build a standalone desktop app (Tauri/Electron) with a transparent always-on-top window. More control, no app store gatekeeping, but you handle overlay rendering and lose built-in game event integration and distribution.

### LLM Model Selection via PickAI

**How PickAI works:** TypeScript library (zero dependencies) that pulls from the models.dev catalog (3,700+ models, 90+ providers). Pipeline: fetch catalog → filter by capabilities → score against weighted criteria → return ranked recommendations.

**Built-in scoring criteria:** costEfficiency, recency, contextCapacity, outputCapacity, knowledgeFreshness. All use min-max normalization.

**Custom criteria via `minMaxCriterion()`:** Bring external benchmark data as additional scoring dimensions:
- **Artificial Analysis** — objective benchmarks (MMLU, GPQA, HumanEval) plus throughput/latency metrics. Requires API key.
- **LMArena** — crowdsourced human preference ELO scores. Free.
- Both can be blended with built-in criteria at configurable weights.

**Relevant capabilities for this use case:**
- Speed: Artificial Analysis throughput metrics as a custom criterion
- Structured output: filterable (`structuredOutput: true`)
- Tool calling: filterable (`toolCall: true`)
- Reasoning: filterable (`reasoning: true`)
- Context capacity: built-in criterion
- Cost: built-in criterion

**Multi-phase selection pattern:** Chain `find()` and `recommend()` with different profiles for different contexts — e.g., fast/cheap models for real-time gameplay advice vs higher-quality reasoning models for post-game analysis or complex strategic questions.

**Six built-in purpose profiles** (Cheap, Balanced, Quality, Coding, Creative, Reasoning) serve as starting points; custom profiles can be composed for this specific use case.

### Cross-Game Memory

Most queries for a gaming coach ("last game as Jinx against tanks", "win rate with sustain builds on this champion") are **structured queries**, not semantic ones. Champion, items, augments, enemy comp, mode, outcome — these are filterable fields.

**Approaches evaluated:**

| Approach | Query Latency | Complexity | TS Support | Best For |
|----------|-------------|-----------|-----------|---------|
| SQLite + FTS5 | <1ms structured, 1-5ms FTS | Low | Excellent (`better-sqlite3`) | Structured game data queries |
| SQLite + sqlite-vec | +10-50ms (with local embeddings) | Medium | Good | Adding semantic search later |
| LanceDB | 1-25ms + embedding time | Medium | Good (official TS client) | Standalone embedded vector DB |
| Vectra | 1-2ms + embedding time | Low | Excellent (TS-first) | Simple vector-only search |
| ChromaDB | 5-50ms + server overhead | High | Weak (Python server, HTTP client) | Not recommended for desktop app |
| Mem0/Zep | Hundreds of ms (LLM calls) | Very High | Mixed | Not recommended — solves a different problem |

**Key insight:** Game data arrives pre-structured from the Riot API. Memory frameworks designed for extracting facts from unstructured conversations (Mem0, Zep) add latency and complexity without meaningful benefit. Structured storage with optional semantic search is the right fit.

**Progression path:** Start with SQLite + FTS5 (sub-millisecond, zero external dependencies). Add sqlite-vec for semantic similarity on game narratives when/if needed. LanceDB is a viable alternative to sqlite-vec if a standalone vector DB is preferred.

## Constraints / Boundaries

- **Speed is paramount** — recommendations must feel near-instant for mid-game use; applies to STT, LLM, and all infrastructure choices
- **BYOK for now** — user provides own API keys; hosted service is a future consideration
- **Mode-agnostic architecture required** — Mayhem may be temporary; nothing should be wasted if it goes away
- **Pre-game decisions out of scope** — runes, summoner spells, skill order stay with Mobalytics for now
- **Riot policy compliance** — build recommendations are allowed; augment win rate display, enemy cooldown tracking, and in-game ads are not

## Open Questions

1. What does the ideal UX look like given the automatic/manual data split? (Game state is automatic; augments require voice input)
2. How should the coach handle build path pivots — when early augments suggest abandoning the conventional build?
3. When/how to transition from BYOK to hosted service?

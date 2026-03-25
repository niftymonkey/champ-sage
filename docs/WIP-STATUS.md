# WIP Status — Coaching Engine (Issue #11)

**Branch:** feat/11-coaching-engine
**Last updated:** 2026-03-24

## Current Focus: Augment Data Quality

Testing revealed that poor coaching recommendations stem from incomplete/garbled augment data, not model reasoning. The model reasons correctly when given correct data.

### Key Finding

The "Quest: Urf's Champion" augment description says "Complete a quest, receive The Golden Spatula" but doesn't include what The Golden Spatula actually gives (+90 AD, +60% AS, +25% crit, +15% omnivamp, +40 armor/MR, +350 HP, etc.). Without these stats, the model reasoned "CDR/mana removal is low value on Bel'Veth" — correct reasoning, wrong data.

### Prompt Enrichment Test Results

Script: `scripts/test-prompt-quality.ts` — runs same scenario 3x with current vs enriched prompts.

**Current prompt:** Inconsistent (2/3 Protein Shake, 1/3 Urf's Champion). Model admitted "no augment text provided" for Urf's Champion. Guessed wrong.

**Enriched prompt (champion role + team analysis + augment role tags):** Consistent reasoning. All 3 runs correctly identified Urf's Champion as bad for auto-attack champions. But still wrong answer because the augment description didn't reveal the actual reward stats.

**Conclusion:** Both prompt quality AND data quality need fixing. Enrichment improves consistency but can't fix missing data.

### Next Steps (in order)

1. **Fix augment descriptions** — better wiki markup stripping to preserve mechanical details already in the raw data. Most augments have good info, we're just garbling it with bad template handling.

2. **Hardcode quest augment rewards** — only 9 quest augments exist. Manually add reward item stats (e.g., Golden Spatula's full stat block). These rarely change.

3. **Audit all 202 augments** — check for other augments where the description is incomplete or misleading after markup fixes. Look for patterns where we need to dig deeper.

4. **Implement prompt enrichments** — champion role summary, game phase, team composition analysis, augment role tags. Test script proved these improve consistency. ~188 extra tokens, negligible cost.

5. **Context compression** — replace verbose item/ability descriptions with concise tags. Test showed enriched prompt used FEWER tokens (1088 vs 1198) despite adding more structured knowledge.

### Data Quality Analysis

Raw wiki data (`Module:MayhemAugmentData/data`):

- 202 Mayhem augments total
- 9 quest augments with `{{ii|ItemName}}` reward references
- 126 total item references across all augments via `{{ii|...}}` templates
- Wiki templates not fully handled: `{{sbc|...}}`, `{{cai|Ability|Champ}}`, `{{ii|Item}}`, `{{nie|...}}`, `{{fd|...}}`, `{{g|...}}`
- After current markup fixes: 3/202 still have artifacts

### Brainstorm Context

`docs/champ-sage-coaching-brainstorm.md` — core insight: "LLM should be reasoning engine, not knowledge base. Move knowledge into structured data."

The prompt enrichment test validated this. When given champion role ("melee DPS carry, auto-attack focused") and augment role tags ("sustain/scaling", "high-risk DPS", "ability spam/CDR"), the model made better decisions even without perfect augment data.

## What's Built (complete list)

### AI Pipeline (src/lib/ai/)

- model-config.ts — GPT-5.4 mini via Vercel AI SDK v6
- context-assembler.ts — builds CoachingContext from LiveGameState + LoadedGameData
- prompts.ts — mode-aware system prompt (KIWI detection), strict length rules, per-card re-roll mechanic (3 rounds, independent per card)
- recommendation-engine.ts — generateText with Output.object, logs to data-dump/coaching-{timestamp}.log
- schemas.ts — CoachingResponse structured output schema
- types.ts — CoachingContext, CoachingQuery, CoachingResponse, CoachingExchange

### Voice Integration

- Low-level keyboard hook (WH_KEYBOARD_LL) on Windows for in-game hotkey
- Voice transcripts trigger coaching pipeline via playerIntent$ subscription
- Whisper API with vocab hints from in-game champion names

### Data Enrichment

- ensureAbilities() — fetches champion abilities from DDragon on game start
- Item descriptions with stats in coaching context
- lcuGameMode — KIWI detection for Mayhem-specific prompts
- Wiki markup cleanup (pipes, meta-references stripped)
- findInText() for augment name extraction with prefix-stripped matching

### UI

- Game tab: top (game info + augment slots), middle (coaching display), bottom (team details)
- Coaching display: latest question/answer only, voice-first (no text input)
- Debug panel with per-session log buffers, copy-all

### Infrastructure

- Per-session coaching log files
- Mode detection logging
- discover-candidates.ts — PickAI model selection
- test-prompt-quality.ts — A/B prompt comparison script

## ARAM Mayhem Testing Results

### What worked

- Hotkey works in-game with low-level keyboard hook (WH_KEYBOARD_LL)
- Voice transcription working, transcripts trigger coaching pipeline
- Item build advice is contextual (Kraken → BOTRK on Bel'Veth, Serrated Dirk → Collector on MF)
- Tactical advice references specific teammates (save Nunu snowball for Diana)
- Response times mostly 1.2–2.5s, occasional outlier at 6.8s
- Conversation history flows naturally across exchanges
- Mode correctly detected as KIWI
- Champion abilities, item descriptions, balance overrides all in context
- Augment descriptions now injected when fuzzy match finds them
- Re-roll flow works (keep one, re-roll two, report results)

### What didn't work

- Model recommended "Upgrade Collector" augment when player didn't have/wasn't building Collector (item-upgrade augment confusion — now addressed in prompt)
- Model recommended Urf's Champion based on "CDR/mana removal" without knowing the reward is The Golden Spatula with massive stats (data gap — quest reward stats not in description)
- Model recommended Protein Shake for Bel'Veth over Glass Cannon/Urf's Champion because it didn't know Bel'Veth is an auto-attack DPS carry (champion role not in prompt — enrichment tested, proven effective)
- Re-roll advice initially said "re-roll" in Phase 2 when no re-rolls were left (fixed with per-card re-roll rules)
- Augment picker UI disappeared because mode detection didn't match "KIWI" (fixed)
- Some augments not matched by fuzzy search ("Quest: Urf's Champion" prefix issue — fixed)

### User experience observations

- Alt-tab workflow was unusable — voice mode solved this
- Text input removed in favor of voice-only coaching display
- Response verbosity was too high initially — strict length rules in prompt helped
- Player wants to just say augment names without explaining they're augments — the system should infer this from context

## Fixes Applied This Session

1. KIWI mode detection — aramMayhemMode.matches() accepts "KIWI"
2. Prefix matching — "Urf's Champion" matches "Quest: Urf's Champion"
3. Wiki markup cleanup — 43 garbled descriptions down to 3 (bare pipes, meta-references)
4. Per-card re-roll rules — three rounds with independent re-rolls per card
5. Game tab layout — three fixed sections (top/coaching/bottom)
6. Voice-to-coaching wiring — playerIntent$ subscription in CoachingInput
7. Auto-scroll — instant instead of smooth in debug panel
8. Debug panel status cards — scan output buffer for latest connection/phase
9. Per-session log files — timestamped instead of append-only
10. Mode/augment debug indicators — visible on game status line
11. Low-level keyboard hook (WH_KEYBOARD_LL) — works during fullscreen games
12. Hotkey state recovery — auto-reset stale recording state
13. Coaching display simplified — latest exchange only, no text input, voice-first
14. Augment selection tracking from voice — "I chose X" pattern detection
15. findInText() — new entity extraction method (scans text for known names vs old search which matched query against names)

## Known Issues

- 3/202 augments still have garbled descriptions (wiki template edge cases)
- 9 quest augments missing reward stats (e.g., Golden Spatula stats not in description)
- Voice-selected augments not synced with augment picker UI (two tracking mechanisms)
- No augment set bonus tracking (model doesn't see set progress)
- Accidental voice triggers (no minimum duration filter)
- Model relies on training data for augment synergies and meta knowledge
- Champion role not included in prompt (model guesses from abilities)
- No game phase awareness in prompt
- No team composition analysis in prompt

## How to Resume

```bash
git checkout feat/11-coaching-engine
git pull
```

Key files to read:

- This file (docs/WIP-STATUS.md)
- docs/coaching-engine.md — technical design
- docs/champ-sage-coaching-brainstorm.md — brainstorm on knowledge vs reasoning
- scripts/test-prompt-quality.ts — prompt comparison test script

Start with: fixing wiki markup templates ({{ii}}, {{sbc}}, {{cai}}, etc.) in src/lib/data-ingest/parsers/wiki-markup.ts, then hardcode the 9 quest augment rewards.

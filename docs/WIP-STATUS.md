# WIP Status — Coaching Engine (Issue #11)

**Branch:** feat/11-coaching-engine
**Last updated:** 2026-03-24

## Current Focus: Live Testing

All planned coaching quality improvements are implemented. Ready for live ARAM Mayhem testing to validate the improvements in-game.

## Prompt Enrichment Improvements (this session)

These are the changes made on top of the initial working coaching engine to improve recommendation quality. Each was motivated by a specific failure observed during live ARAM Mayhem testing.

### Improvement 1: Wiki Markup Parser Rewrite

**Problem:** 43 of 202 augment descriptions were garbled by residual wiki markup. Templates like `{{ii|The Golden Spatula}}`, `{{fd|0.5}}`, `{{sbc|Quest:}}` were either stripped incorrectly or left artifacts. Nested templates like `{{as|{{fd|3.5}}% bonus AD}}` broke the catch-all regex entirely.

**Fix:** Rewrote `src/lib/data-ingest/parsers/wiki-markup.ts` with inside-out iterative template resolution. Instead of a single regex pass, the parser repeatedly resolves innermost templates (no nesting) until none remain. Added explicit handlers for 15+ template types: `ii`, `fd`, `sbc`, `cai`, `ai`, `g`, `nie`, `si`, `bi`, `rd`, `ap`, `ft`, `iis`, `recurring`, plus a fallback for unknown templates.

**Result:** 0/202 augments have markup artifacts. All mechanical details preserved in plain text.

**Files:** `src/lib/data-ingest/parsers/wiki-markup.ts`, `wiki-markup.test.ts` (40 tests)

### Improvement 2: Dynamic Quest Augment Reward Stats

**Problem:** Quest augments say "you receive The Golden Spatula" but don't include what the item gives. The model saw "CDR/mana removal" for Urf's Champion and recommended against it for Bel'Veth — correct reasoning, but the real reward is a massive stat stick (+90 AD, +125 AP, +60% AS, etc.).

**Fix:** Created `src/lib/data-ingest/sources/quest-augment-rewards.ts` that dynamically enriches quest augment descriptions at app startup. It detects quest augments (name starts with "Quest:"), finds the reward item name after "Reward:" in the description, looks it up in the DDragon items database, and appends a human-readable stat block. No hardcoded stats — if Riot changes item stats next patch, we pick up new values automatically.

**Design decision:** Initially hardcoded reward stats, but user correctly identified this as fragile. Rewrote to be fully dynamic. When multiple items share a name (e.g., 4 variants of "The Golden Spatula" across game modes), we pick the variant with the highest total stat value (Mayhem rewards are the beefiest).

**Result:** All 5 Mayhem quest augments now show reward item stats. Model can reason about whether Golden Spatula's massive stats justify the 18-takedown quest.

**Files:** `src/lib/data-ingest/sources/quest-augment-rewards.ts`, `quest-augment-rewards.test.ts` (8 tests)

### Improvement 3: Chosen Augment Description Re-injection

**Problem:** After choosing an augment, subsequent coaching queries only showed the augment name in the prompt — not its description. If you chose "Quest: Icathia's Fall" and later asked "what should I build?", the model didn't see the build constraint ("must buy Hollow Radiance and Sunfire Aegis") unless it happened to scroll back through conversation history.

**Fix:** Changed `currentAugments` from `string[]` to `CoachingItem[]` (name + description + sets). When you say "I chose X", the component looks up the full augment description (including quest reward stats) from gameData. Every subsequent prompt includes the full description under "Current Augments."

**Design principle:** Structured, always-present context beats hoping the model remembers something from conversation history. The model is a reasoning engine, not a memory system.

**Result:** Build constraints, reward stats, and mechanical details for chosen augments are visible in every coaching request, not buried in history.

**Files:** `src/lib/ai/types.ts`, `src/lib/ai/prompts.ts`, `src/components/CoachingInput.tsx`, `prompts.test.ts`

### Improvement 4: Augment Set Bonus Context

**Problem:** The model saw set names on augments (e.g., "Sets: Snowday") but had no idea what set bonuses existed or how close the player was to unlocking one. If you had 1 Snowday augment and a second was offered, the model couldn't factor in that picking it would unlock "Mark deals 30% increased damage."

**Fix:** Added `augmentSets` to `CoachingContext` (the set bonus definitions). The prompt builder now:

1. Shows a "Set Progress" section listing active bonuses and next thresholds for sets the player has augments in
2. Annotates offered augments with set bonus impact — "UNLOCKS: [bonus description]" when picking would hit a threshold, or "2/4" progress when it wouldn't

**Result:** Model can reason about set stacking. A mediocre augment that completes a strong set bonus can now correctly beat a standalone better augment.

**Files:** `src/lib/ai/prompts.ts`, `src/lib/ai/types.ts`, `src/lib/ai/context-assembler.ts`, `prompts.test.ts` (24 tests)

### Improvement 5: Champion Stat Profile

**Problem:** Model recommended Protein Shake (sustain) over Glass Cannon for Bel'Veth because it didn't know Bel'Veth is an auto-attack carry. Champion abilities were in the prompt, but the model had to infer playstyle from ability descriptions.

**Deeper problem:** A static role label ("DPS carry") would be wrong in many cases. Bel'Veth CAN pivot to tank with the right augments (e.g., Goliath) and the right team comp (no frontline). Sona cannot. The model needs to know what a champion is CAPABLE of, not what it SHOULD do.

**Fix:** Added a champion stat profile to `CoachingContext.champion.statProfile`, derived entirely from DDragon data at runtime:

- Range type (Melee vs Ranged with distance)
- DDragon tags (Fighter, Mage, Tank, etc.)
- Key base stats with per-level growth: HP, AD, AS, Armor, MR
- Resource type (Mana, Energy, None)

The model sees `Bel'Veth: Melee | Fighter | HP: 610 (+105/lvl) | Armor: 32 (+4.7/lvl)` and can reason: high defensive base stats + melee = viable tank pivot. It sees `Sona: Ranged (550) | Support, Mage | HP: 550 (+91/lvl) | Armor: 26 (+4.2/lvl)` and knows tank build is inefficient.

**Design principle:** Provide capabilities, not role prescriptions. The model derives the optimal playstyle from stat profile + current items + augments + team comp + what's being offered.

**Result:** Model can distinguish "Bel'Veth with Goliath and no team tanks → lean into tank" from "Sona with Goliath → still not a tank." No static role labels that would fight against contextual adaptation.

**Files:** `src/lib/ai/context-assembler.ts`, `src/lib/ai/types.ts`, `src/lib/ai/prompts.ts`, `context-assembler.test.ts` (16 tests), `prompts.test.ts`

## Prompt Enrichment Evaluation Status

| #   | Enrichment                            | Status              | Outcome                                                                                                                                                  |
| --- | ------------------------------------- | ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Augment role tags from set membership | Evaluated, skipped  | Clean descriptions + set bonus context make explicit role tags redundant. Model can infer augment roles from descriptions.                               |
| 2   | Champion stat profile                 | Implemented         | Stat profile provides capabilities without prescribing role. Model reasons about build viability from base stats + game context.                         |
| 3   | Game phase awareness                  | Evaluated, skipped  | Game time already in prompt. No observed failures from phase confusion. Model handles timing fine from existing data. Revisit if testing reveals issues. |
| 4   | Team composition analysis             | Implemented         | Role breakdown with gap detection + enemy damage profile with resistance guidance (all AD/AP/mixed).                                                     |
| 5   | Context compression                   | Evaluated, deferred | Prompts are ~1,000-1,300 tokens — well within budget. No latency issues. Will revisit if we move to local/open-weight models or see token pressure.      |

## What's Built (complete list)

### AI Pipeline (src/lib/ai/)

- model-config.ts — GPT-5.4 mini via Vercel AI SDK v6
- context-assembler.ts — builds CoachingContext from LiveGameState + LoadedGameData, includes champion stat profile
- prompts.ts — mode-aware system prompt (KIWI detection), strict length rules, per-card re-roll mechanic, set bonus progress, chosen augment re-injection, team analysis, explicit Mayhem mode label
- recommendation-engine.ts — generateText with Output.object, logs to data-dump/coaching-{timestamp}.log
- schemas.ts — CoachingResponse structured output schema
- types.ts — CoachingContext (with augmentSets, CoachingItem with sets), CoachingQuery, CoachingResponse, CoachingExchange

### Voice Integration

- Low-level keyboard hook (WH_KEYBOARD_LL) on Windows for in-game hotkey
- Voice transcripts trigger coaching pipeline via playerIntent$ subscription
- Whisper API with vocab hints from in-game champion names

### Data Enrichment

- ensureAbilities() — fetches champion abilities from DDragon on game start
- Item descriptions with stats in coaching context
- lcuGameMode — KIWI detection for Mayhem-specific prompts
- Wiki markup parser — inside-out iterative template resolution, 15+ template types, handles arbitrary nesting
- findInText() for augment name extraction with prefix-stripped matching
- Dynamic quest augment reward stat injection from DDragon items database
- Chosen augment descriptions re-injected into every prompt (not just names)
- Augment set bonus definitions and progress tracking in prompt
- Champion stat profile (range, tags, base stats, growth rates) in prompt

### UI

- Game tab: top (game info + augment slots), middle (coaching display), bottom (team details)
- Coaching display: latest question/answer only, voice-first (no text input)
- Debug panel with per-session log buffers, copy-all

### Infrastructure

- Per-session coaching log files
- Mode detection logging
- discover-candidates.ts — PickAI model selection
- test-prompt-quality.ts — A/B prompt comparison script
- audit-augments.ts — checks all 202 augments for markup artifacts
- preview-prompts.ts — shows full assembled prompts for test scenarios, optionally runs through model
- consistency-test.ts — runs scenarios 3x each to check response consistency

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
- Model recommended Urf's Champion based on "CDR/mana removal" without knowing the reward is The Golden Spatula with massive stats (FIXED — dynamic quest reward stats)
- Model recommended Protein Shake for Bel'Veth over Glass Cannon/Urf's Champion because it didn't know Bel'Veth is an auto-attack DPS carry (FIXED — champion stat profile)
- Re-roll advice initially said "re-roll" in Phase 2 when no re-rolls were left (fixed with per-card re-roll rules)
- Augment picker UI disappeared because mode detection didn't match "KIWI" (fixed)
- Some augments not matched by fuzzy search ("Quest: Urf's Champion" prefix issue — fixed)

### User experience observations

- Alt-tab workflow was unusable — voice mode solved this
- Text input removed in favor of voice-only coaching display
- Response verbosity was too high initially — strict length rules in prompt helped
- Player wants to just say augment names without explaining they're augments — the system should infer this from context

## Fixes Applied (all sessions)

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
15. findInText() — new entity extraction method (scans text for known names)

## Coaching Quality Improvements

Each improvement below was motivated by a specific failure observed during live ARAM Mayhem testing. The core principle: the LLM is a reasoning engine, not a knowledge base — we provide structured knowledge, it provides contextual decisions. See the "Prompt Enrichment Improvements" section above for full details on each.

1. **Wiki markup parser rewrite** — Inside-out iterative template resolution with 15+ explicit template types. Reduced garbled augment descriptions from 43/202 to 0/202. The model can't reason about augments if it can't read their descriptions.

2. **Dynamic quest augment reward stats** — Quest augments say "you receive The Golden Spatula" but don't say what it gives. Reward item stats are now looked up from the DDragon items database at startup and appended to the description. Fully dynamic — no hardcoded stats that go stale between patches.

3. **Chosen augment description re-injection** — Previously, after choosing an augment, the model only saw the name in subsequent prompts. Now the full description (including quest reward stats and build constraints) is re-injected into every coaching request. Structured, always-present context beats hoping the model remembers something from conversation history.

4. **Augment set bonus context** — The model saw set names on augments but had no idea what the set bonuses were or how close you were to unlocking one. Now shows: active set bonuses, progress toward next threshold, and "UNLOCKS: [bonus]" annotations on offered augments that would complete a set.

5. **Champion stat profile** — Instead of a static role label ("DPS carry") that would bias the model, we inject the champion's raw capabilities: melee/ranged, DDragon tags, base HP/AD/AS/Armor/MR with per-level growth rates. The model sees that Bel'Veth _can_ tank (melee, Fighter, 610 HP, +105/lvl, +4.7 armor/lvl) without being told she _should_. The role decision comes from the model reasoning about stat profile + current items + augments + team comp.

6. **Team composition analysis** — Ally team role breakdown with gap detection ("no Marksman, Support") and enemy damage profile with resistance guidance ("all AD — stack armor", "heavily AP — favor magic resist", "mixed"). The model knows when your team needs a tank before you ask.

7. **Context compression** — (not yet evaluated, pending)

## Known Issues

- Voice-selected augments not synced with augment picker UI (two tracking mechanisms)
- Accidental voice triggers (no minimum duration filter)
- Model relies on training data for augment synergies and meta knowledge

## How to Resume

```bash
git checkout feat/11-coaching-engine
git pull
```

Key files to read:

- This file (docs/WIP-STATUS.md)
- docs/coaching-engine.md — technical design
- docs/champ-sage-coaching-brainstorm.md — brainstorm on knowledge vs reasoning
- scripts/test-prompt-quality.ts — original A/B prompt comparison (pre-improvement baseline)
- scripts/preview-prompts.ts — view full assembled prompts with all improvements
- scripts/consistency-test.ts — run scenarios 3x to verify response consistency
- scripts/audit-augments.ts — augment data quality checker

Next: live test in ARAM Mayhem. If results are good, close out enrichment work and move to remaining known issues or new features.

Continue with: evaluating prompt enrichments #3 (game phase awareness), #4 (team composition analysis), #5 (context compression).

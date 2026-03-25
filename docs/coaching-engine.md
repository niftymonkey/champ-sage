# Coaching Engine — Technical Design

How the AI coaching pipeline works, from voice input to displayed response.

## Pipeline Overview

```
Voice Input (Num- hotkey)
    ↓
Rust audio capture (cpal, 16-bit PCM)
    ↓
Whisper API transcription (with vocab hints)
    ↓
playerIntent$ reactive stream
    ↓
CoachingInput component
    ↓
Context Assembly (game state + static data → CoachingContext)
    ↓
Augment Name Extraction (fuzzy match transcript against catalog)
    ↓
Prompt Construction (system prompt + user prompt)
    ↓
LLM Call (GPT-5.4 mini via Vercel AI SDK, structured output)
    ↓
Display response (latest exchange only, no scroll)
```

## Model

**GPT-5.4 mini** (OpenAI), selected via PickAI candidate discovery with Artificial Analysis benchmarks.

Selection criteria weights: reasoning (GPQA) = 3, speed (tok/s) = 3, quality = 2, instruction following = 2, cost = 1, recency = 1.

Key stats: GPQA 0.875, 230 tok/s, $0.75/M input, 400K context. Observed response times: 1.2–3.5s.

Called via Vercel AI SDK v6 `generateText` with `Output.object` for structured JSON responses. Max output tokens: 1024.

## Inputs to the LLM

Every coaching request sends two prompts: a system prompt and a user prompt.

### System Prompt

Sets the coaching personality and rules. Assembled by `buildSystemPrompt()` based on the detected game mode.

**Always included:**

- Coaching identity ("League of Legends coaching AI")
- Context consideration list (abilities, items, augments, enemies, allies, mode, timing)
- Strict response length rules (1–2 sentences for simple questions, 3–4 bullets for tactical)
- Blunt tone directive

**Included when game mode is KIWI (ARAM Mayhem):**

- Augment mechanic explanation (3 choices at levels 1, 7, 11, 15)
- Augments ≠ items clarification
- Per-card re-roll rules with three rounds
- Upgrade-augment build compatibility check
- Directive to use augment descriptions from the Augment Options section

### User Prompt

Assembled by `buildUserPrompt()` from `CoachingContext` + `CoachingQuery`. Sections:

1. **Game Mode** — `KIWI`, `ARAM`, `CLASSIC`, etc.
2. **Game Time** — formatted as `M:SS`
3. **Champion** — name, level, full ability descriptions (passive + Q/W/E/R with descriptions, fetched per-champion from DDragon on game start)
4. **Balance Overrides** — ARAM-specific damage/healing/shielding modifiers (e.g., "Damage dealt: -10%, Damage taken: +5%")
5. **Current Items** — name + full description with stats for each item the player owns
6. **Current Augments** — names of augments the player has already chosen (tracked from voice input via "I chose X" detection)
7. **Ally Team** — champion names
8. **Enemy Team** — champion names + their current items (names only, not descriptions)
9. **Conversation History** — all prior question/answer exchanges in this game session
10. **Augment Options** (conditional) — when augment names are detected in the question, their full descriptions, tiers, and set memberships are injected from the catalog
11. **Question** — the player's actual question

## Context Assembly

`assembleContext()` in `context-assembler.ts` transforms live game state + static game data into a `CoachingContext`:

- **Champion abilities**: Looked up from `LoadedGameData.champions` by name. Populated by `ensureAbilities()` which fetches per-champion DDragon data (10 parallel requests) when a game starts.
- **Item descriptions**: Looked up from `LoadedGameData.items` by item ID. The Live Client Data API provides item IDs, the static data provides descriptions.
- **Balance overrides**: From `Champion.aramOverrides` in the static data (sourced from League Wiki ChampionData Lua module).
- **Enemy items**: Names from the Live Client Data API. Descriptions not included for enemies (token budget).

## Augment Name Extraction

When the player asks a question, `extractAugmentOptions()` in `CoachingInput` runs `gameData.dictionary.findInText(question)` to detect augment names in the transcript.

`findInText()` scans the text for known entity names (augments, items, champions) using:

- Direct substring matching (case-insensitive, punctuation-stripped)
- Prefix-stripped matching for names like "Quest: Urf's Champion" → matches "Urf's Champion"
- Longest-match-first to prefer "Upgrade Collector" over "Collector"
- Minimum 4-character names to avoid false positives

Matched augment names are looked up in `LoadedGameData.augments` for full descriptions, tiers, and set memberships. These are injected into the user prompt as the "Augment Options Being Offered" section.

## Structured Output

The LLM response is parsed into a `CoachingResponse` via JSON schema:

```typescript
interface CoachingResponse {
  answer: string; // Direct answer text
  recommendations: Array<{
    name: string; // Augment/item name
    reasoning: string; // Why this is recommended
  }>; // Empty array if not a choice question
}
```

The schema is enforced via Vercel AI SDK's `Output.object({ schema })` which uses the LLM's structured output mode.

## Conversation History

All exchanges within a game session are accumulated in `CoachingInput` component state. The full history is sent with every request so the model can reference prior advice.

History is NOT capped — a typical ARAM Mayhem game generates 5–15 exchanges, well within the 400K token context window.

History resets when a new game starts (detected via phase transition to ChampSelect or None).

## Augment Selection Tracking

When the player says "I chose X" / "I picked X" / "I took X", the `CoachingInput` component:

1. Regex-matches the selection pattern
2. Runs `findInText` on the augment name
3. Adds it to `chosenAugments` state
4. Injects it into `CoachingContext.currentAugments` on subsequent requests

This is separate from the augment picker UI (which uses the reactive `manualInput$` stream). Voice-reported selections are tracked in the coaching component; UI-picked selections are tracked in App.tsx.

## Re-Roll Advisory Logic

The system prompt encodes the ARAM Mayhem re-roll mechanic:

- **Round 1**: Player presents 3 augments. Model picks the best, tells player to re-roll the other two.
- **Round 2**: Player reports 2 new augments. Model now has 3 cards (1 kept + 2 new). If a new one beats the kept one, model tells player to use the kept card's re-roll. Otherwise, take the kept one.
- **Round 3** (optional): If the kept card was re-rolled, player reports 1 new augment. Model picks the best of the 3 final cards. No more re-rolls.

The model is instructed that the player may only report NEW cards and must remember which was kept from prior rounds.

## Data Sources

| Data                                     | Source                                                                   | When Fetched                               |
| ---------------------------------------- | ------------------------------------------------------------------------ | ------------------------------------------ |
| Champion names, levels, items, teams     | Riot Live Client Data API (port 2999, polled every 2s during InProgress) | Real-time during game                      |
| Champion abilities (passive + QWER)      | DDragon per-champion endpoint                                            | Once per game start (10 parallel requests) |
| Item descriptions and stats              | DDragon bulk items endpoint                                              | App launch (cached)                        |
| Augment names, descriptions, tiers, sets | League Wiki Lua module (Mayhem + Arena)                                  | App launch (cached)                        |
| Augment IDs and icons                    | Community Dragon                                                         | App launch (cached, merged with wiki data) |
| ARAM balance overrides                   | League Wiki ChampionData Lua module                                      | App launch (cached)                        |
| Game mode (KIWI/CLASSIC/CHERRY)          | LCU WebSocket session events                                             | Real-time via reactive engine              |

## Known Limitations

- **Augment descriptions have residual markup artifacts** — 3 of 202 augments still have garbled text from wiki template edge cases
- **Voice-selected augments not synced with augment picker UI** — two separate tracking mechanisms
- **Model relies on training data for game knowledge** — augment synergies, meta builds, and champion matchup knowledge come from GPT-5.4 mini's training data, not from our data pipeline
- **No augment set bonus tracking** — the model doesn't see set progress (e.g., "you have 2/3 Firecracker augments")
- **Accidental voice triggers** — no minimum duration or confidence filter on STT transcripts

## Logging

Each coaching request/response is logged to `data-dump/coaching-{timestamp}.log` via the Rust `append_coaching_log` command. Each app session gets its own timestamped log file.

Log entries include: model, question, champion, items, augments, mode, enemies, history count, full system prompt, full user prompt, response time, token usage, answer text, and recommendations.

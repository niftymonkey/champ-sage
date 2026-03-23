# WIP Status — Coaching Engine (Issue #11)

**Branch:** feat/11-coaching-engine
**Last updated:** 2026-03-23

## What's built

### AI Pipeline (src/lib/ai/)

- **model-config.ts** — GPT-5.4 mini selected via PickAI discovery (reasoning=3, speed=3, quality=2, IF=2, cost=1, recency=1)
- **context-assembler.ts** — Builds CoachingContext from LiveGameState + LoadedGameData. Includes champion abilities, item descriptions with stats, ARAM balance overrides, enemy/ally teams with items.
- **prompts.ts** — Mode-aware system prompt. Detects Mayhem via `lcuGameMode === "KIWI"` and adds augment mechanic rules (3 choices, re-rolls, augment ≠ item). Strict response length rules.
- **recommendation-engine.ts** — Calls LLM via Vercel AI SDK v6 `generateText` with `Output.object` for structured responses. Logs to `data-dump/coaching.log` via Rust command.
- **schemas.ts** — `CoachingResponse` with `answer` string + `recommendations[]` array
- **types.ts** — `CoachingContext`, `CoachingQuery` (with history + augmentOptions), `CoachingResponse`, `CoachingExchange`

### Data Enrichment

- **ensure-abilities.ts** — Fetches champion abilities from DDragon for in-game champions (10 parallel requests) on game start. Called from App.tsx when players first appear.
- **Item descriptions** — Context assembler looks up full item descriptions from gameData by item ID, not just names.
- **lcuGameMode** — Added to LiveGameState, extracted from LCU session WebSocket events. Distinguishes KIWI (Mayhem) from regular ARAM.

### UI (src/components/)

- **CoachingInput.tsx** — Text input on Game tab. Conversation history displayed as chat log. Fuzzy-matches augment names from user's question against catalog and injects descriptions as structured augment options. Clears on submit.
- **GameStateView.tsx** — Uses `assembleContext()` instead of inline context building. Passes `gameData` to CoachingInput.

### Supporting

- **discover-candidates.ts** script — PickAI + AA benchmarks for model selection (`pnpm discover-candidates`)
- **Coaching log** — `data-dump/coaching.log` written via `append_coaching_log` Rust command
- **Debug panel noise filtering** — Chat, loot, honor, clash, cosmetics events excluded from buffer

## Test results from gameplay

### Practice Tool SR (worked well)

- Item recommendations are contextual and build-path coherent
- Conversation history carries through naturally
- Response times 2.2-2.7s
- Tactical advice (when to roam) is useful
- Champion abilities and item descriptions flowing into prompts correctly

### ARAM Mayhem (issues found)

1. **Augment/item name confusion** — "Upgrade Infinity Edge" (an augment) was interpreted as "buy/upgrade the item Infinity Edge". System prompt now has Mayhem rules explaining augments ≠ items, but this is UNTESTED.
2. **Verbosity** — Responses still too long despite strict length rules in system prompt. Needs further prompt iteration.
3. **Alt-tab is unusable** — Computer is too slow for alt-tab workflow during real games. Voice mode is the #1 blocker for further testing.

## What to do next

### Immediate: Voice mode (STT)

The user cannot test coaching during real games without voice input. This is the top priority. Check issue #4 for STT engine selection requirements. Key criteria: speed and League-specific vocabulary support.

### After voice: Return here and iterate

- Test augment recommendations in real Mayhem games
- Verify augment fuzzy matching works with real augment names
- Iterate on prompt verbosity
- Test re-roll advice flow

## How to resume this branch

```bash
git checkout feat/11-coaching-engine
# Pop the WIP commit to get changes as unstaged
git reset HEAD~1
# Delete this file before the real commit
rm docs/WIP-STATUS.md
```

## Files changed since last real commit

### New files

- src/lib/data-ingest/ensure-abilities.ts
- src/lib/data-ingest/ensure-abilities.test.ts

### Modified files

- src-tauri/src/lib.rs (append_coaching_log command, expanded noise prefixes)
- src/App.tsx (ensureAbilities call on game start)
- src/components/CoachingInput.tsx (gameData prop, augment fuzzy matching, conversation history UI)
- src/components/DataBrowser.tsx (passes gameData to GameStateView)
- src/components/DebugPanel.tsx (copy all buttons, llm source color)
- src/components/GameStateView.tsx (uses assembleContext, passes gameData to CoachingInput)
- src/hooks/**tests**/useLiveGameState.test.ts (lcuGameMode field)
- src/lib/ai/context-assembler.ts (item descriptions, lcuGameMode)
- src/lib/ai/context-assembler.test.ts (updated for CoachingItem shape, lcuGameMode)
- src/lib/ai/prompts.ts (mode-aware system prompt, Mayhem rules, response length rules)
- src/lib/ai/prompts.test.ts (updated for new prompt API, Mayhem tests)
- src/lib/ai/recommendation-engine.ts (log file via Tauri invoke, generalized from augment-specific)
- src/lib/ai/types.ts (CoachingItem, lcuGameMode, CoachingExchange, generalized types)
- src/lib/reactive/engine.ts (lcuGameMode extraction from session, noise filtering)
- src/lib/reactive/streams.ts (lcuGameMode in default state, llm debug source)
- src/lib/reactive/types.ts (lcuGameMode on LiveGameState)

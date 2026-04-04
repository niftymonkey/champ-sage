# Tiered Context Delivery — Design Document

Issue #68. Explored 2026-04-03/04.

## Problem

Every coaching LLM call rebuilds full context from scratch: champion abilities, all item descriptions, enemy builds, augments, team analysis, plus conversation history flattened as text. This causes:

- **Signal dilution**: the LLM wades through repeated static context to find what matters, leading to inconsistencies (e.g., double-MR recommendations without acknowledging overlap)
- **No conversational continuity**: prior exchanges are pasted as quoted text, not real assistant messages — the LLM doesn't treat its own prior reasoning as something to be consistent with
- **Token waste**: thousands of tokens re-sent every call, no prompt caching benefit
- **No change awareness**: the LLM can't distinguish newly purchased items from ones held all game

## Core Decision: Real Multi-Turn Conversation

Convert from single-turn `generateText()` with pasted history to a real multi-turn message array, the same architecture as ChatGPT/Claude conversations:

```
system:    coaching rules + static game data
user:      [first question with full state snapshot]
assistant: [response]
user:      [state update + next question]
assistant: [response]
...
```

The LLM sees its own prior responses as `assistant` messages and maintains coherence across the session. The message array grows over the game and is sent in full on each call. At 400k context window (GPT-5.4 mini), token budget is a non-issue for any game session length.

Prompt caching benefits: the system prompt and early messages form a stable prefix that gets cache hits on subsequent calls, reducing cost and latency.

## System Prompt (Set Once Per Game)

Contains everything that doesn't change mid-game:

**Behavioral rules:**

- Coaching persona and data priority instructions
- Item awareness rules (don't recommend owned items)
- Gold awareness rules (NOTE: needs tweaking — separate follow-up)
- Response format rules (concise, lead with recommendation)
- Augment re-roll mechanics (included if mode supports augment-selection)
- Instruction to flag concerns noticed in state updates (build gaps, missing resistances) briefly at end of responses

**Static game data:**

- Champion abilities and base stats
- Rune setup
- Game mode and balance overrides (if applicable to mode)
- All 10 champions in the match (names, tags/roles)

**Mode-awareness:** Use the `GameMode` interface to decide what to include. No hardcoded mode strings. If `mode.decisionTypes` includes `augment-selection`, include augment rules. If the mode matches ARAM, include balance overrides. Everything is driven by the mode interface.

## State Snapshots (Per User Message)

Every user turn includes a full state snapshot — not a diff. Research (Laban et al., arXiv:2505.06120) shows LLMs degrade significantly when tracking accumulated state across many diffs in multi-turn conversations. Full snapshots re-anchor the model to ground truth each turn, at negligible token cost (~100-200 tokens, cached as input).

The system prompt tells the LLM to expect a `[Game State]` block before each question.

**Every message format:**

```
[Game State]
Player Champion: Ahri (Level 12)
KDA: 5/3/8
Items: Zhonya's Hourglass (Active: Stasis for 2.5s), Rabadon's Deathcap
Gold: 800
Stats: 250 AP, 120 Armor, 40 MR, 40 AH, 350 MS, 2200 HP
Augments: Jeweled Gauntlet, Ethereal Blades

Ally Team: Garen, Lux, Jinx, Thresh
Enemy Team:
- Zed (Level 12): 180 AD, 75 Armor, 42 MR, 380 MS, 2000 HP — Duskblade, Edge of Night
- Garen (Level 13): 145 AD, 180 Armor, 72 MR, 370 MS, 2800 HP — Thornmail, Sunfire Aegis
...
```

**POV:** Neutral/agnostic phrasing throughout. "Items:" not "Your items." "Enemy Team:" not "They have."

**Message history:** All messages are kept in the array (no sliding window or summarization). At 400k context window, even a 30-exchange game session (~12k tokens total) is well within budget. If quality degrades in long sessions during playtesting, summarization can be added later via a cheap LLM call to compress evicted messages.

### Player Champion Stats

- **Source:** Live Client Data API (`activePlayer.stats`) — exact computed values including temporary buffs, rune effects, everything
- No calculation needed; use API values directly

### Enemy Champion Stats

- **Source:** Computed approximation from base stats + per-level growth + item bonuses
- **Formula:** `stat = base + (growth × (level-1) × (0.7025 + 0.0175 × (level-1))) + Σ(item stat bonuses)`
- **Data sources:** Champion base stats from Data Dragon (`ChampionStats`), item stats from Data Dragon (`Item.stats`), player level and items from Live Client Data API (`PlayerInfo`)
- **Computation strategy:** Reactive — recalculate on every game state poll, store in memory. No calculation at question time.
- **Limitations:** Won't capture temporary buffs (Baron, elixirs, ability steroids, stacking passives). Accurate for permanent build stats.

### Player Item Display

- Name + passives/actives only (e.g., "Zhonya's Hourglass (Active: Stasis for 2.5s)")
- Flat stat contributions are already reflected in the computed stats — no need to repeat them
- Descriptions needed because passives/actives affect what the LLM should recommend next

## Proactive Coaching

### Event-based triggers (existing)

- Augment offers (GEP event) — already implemented
- Stat anvil offers — already working via same GEP event as augments

### Opportunistic coaching (new)

- No new trigger infrastructure. Instead, the system prompt instructs the LLM to flag concerns it notices in state updates (build gaps, missing resistances, unused gold) briefly at the end of its response.
- This keeps coaching intelligence in the prompt, not in trigger logic.
- Stays within Riot compliance: build/purchase observations are allowed; tactical map actions are not.

### Cancelled proactive requests

- When a proactive augment/stat anvil request is cancelled (player picked before LLM responded), remove the orphaned question from the message array entirely
- No replacement statement needed — the next turn's full state snapshot will show the chosen augment/stat anvil in the player's current state

## Mode-Awareness

Use the `GameMode` interface throughout — no hardcoded mode checks against strings like "KIWI" or "ARAM."

- `mode.decisionTypes` determines whether augment rules appear in system prompt
- `mode.matches()` determines whether balance overrides are included
- `filterItemsByMode()` and `filterAugmentsByMode()` filter game data appropriately

Requires concrete `GameMode` implementations for at least three modes: ARAM Mayhem (existing), straight ARAM (no augments/sets, but has balance overrides), and Classic/Summoner's Rift (no augments, no balance overrides). The design must not be specific to any one mode.

## Out of Scope

- **Cross-game player preferences** — tracked as #82. Within-game learning happens naturally via conversation thread.
- **Coaching tone calibration** — already improved via ranked recommendations schema (`name` + `reasoning` per recommendation). Further tweaks are prompt iteration once multi-turn is in place.
- **Patch notes / meta context injection** — referenced in #68 acceptance criteria and #61. Separate work.
- **Build trajectory tracking** — the multi-turn conversation should naturally improve build coherence (LLM sees its own prior recommendations). Iterate if still a problem.

## Key Implementation Notes

- `assembleContext()` will likely be split or replaced: static data goes into system prompt builder, state snapshots/diffs become a separate concern
- `buildSystemPrompt()` and `buildUserPrompt()` need significant rework to support message array construction
- `getCoachingResponse()` switches from `generateText()` (single turn) to a message-array-based call
- Conversation state (message array) lives per game session, reset on new game
- All messages kept in array (no sliding window) — 400k context window handles any game session length
- If quality degrades in very long sessions, add summarization later via cheap LLM call
- Enemy stat computation is a new module that subscribes to game state updates

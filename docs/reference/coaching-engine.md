# Coaching Engine — Prompt Architecture

How the LLM-powered coaching pipeline builds prompts, dispatches calls, and accumulates conversation history. Restructured in #108 from a monolithic-prompt design into per-feature modules.

## The shape

```text
MatchSession
  ├── baseContext (mode, champion, runes, item catalog, roster) ← buildBaseContext()
  ├── messages[] (cumulative across the match — prose-only history)
  ├── phase ("champ-select" | "in-game" | "post-game")
  └── ask(feature, input)
        │
        ├── system = baseContext + feature.buildTaskPrompt(input) + personality.suffix()
        ├── user   = feature.buildUserMessage(input)   ← state snapshot + question
        ├── runFeatureCall(...)                         ← race-with-retry, abort, model
        ├── feature.extractResult(raw)                  ← optional post-processing
        └── messages.push(prose)                        ← feature.summarizeForHistory(result)
```

## Building blocks

**`CoachingFeature<TIn, TOut>`** (`src/lib/ai/feature.ts`) — every feature implements one. Owns:

- `buildTaskPrompt(input)` — feature-specific instructions appended after base context
- `buildUserMessage(input)` — the user turn (state snapshot + question)
- `outputSchema` — per-feature JSON schema (with field-level enums where structural correctness matters; see #109)
- `extractResult(raw)` — normalize raw output (usually identity)
- `summarizeForHistory(result)` — required prose summary that goes into `messages[]`
- `supportedPhases` — which match phases this feature can run in

Today's features (`src/lib/ai/features/`):

| Feature       | Output                                                           | Notes                                                                                          |
| ------------- | ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `augment-fit` | `{ recommendations: [{name, fit, reasoning}] }`                  | No `.answer` — UI renders per-card badges                                                      |
| `game-plan`   | `{ answer, buildPath: [{name, category, targetEnemy, reason}] }` | Schema enum-locks `name` to player's item catalog (factory: `createGamePlanFeature(gameData)`) |
| `item-rec`    | `{ answer, recommendations }`                                    | Owns the destination + component format rule                                                   |
| `voice-query` | `{ answer, recommendations }`                                    | Open-ended; deliberately doesn't force the format                                              |

**`MatchSession`** (`src/lib/ai/match-session.ts`) — the dispatch boundary. Holds `messages[]` cumulatively across phases, exposes `ask()`, `transitionTo(phase, systemPrompt)`, and lower-level `addUserMessage`/`addAssistantMessage` for fixture replay. Throws if a feature is asked in a phase it doesn't support.

**`buildBaseContext`** (`src/lib/ai/base-context.ts`) — feature-agnostic foundation. Coaching persona, item awareness, gold awareness, conversation format explainer, mode name, champion profile + abilities + runes, item catalog, match roster. Anything per-feature lives in the feature's task prompt instead.

**`PersonalityLayer`** (`src/lib/ai/personality.ts`) — thin suffix appended after the task prompt. `briefPersonality` (default) carries the brevity / lead-with-recommendation / no-overexplaining rules. `noopPersonality` is a structural fallback. New personalities (#24) replace the suffix without touching feature prompts.

**`runFeatureCall`** (`src/lib/ai/recommendation-engine.ts`) — the only place we actually call the LLM. Race-with-retry (#102), abort propagation, optional injected `model` (production uses `createCoachingModel(apiKey)`; the eval harness injects an OpenRouter-backed model — same code path, different provider).

## Why this instead of the old design

**Before:** one `buildGameSystemPrompt` produced a single monolithic prompt for every coaching call. One `coachingResponseSchema` was shared across every feature. Augment offers, voice queries, and game plans all dragged the entire prompt — including each other's rules.

**The pain it caused:**

- **Cross-feature rule pollution.** Every voice question carried the augment fit-rating rules; every augment offer carried the destination+component item-format rules. The base context (item catalog, roster, abilities) is unchanged — what got pruned is the per-feature _instructions_ leaking into other features' prompts.
- **Schema fragility.** `CoachingResponse.buildPath: BuildPathItem[] | null` was populated only for game-plan, but every other call had to declare it. Adding a new field broke every call type.
- **#109-class correctness bugs.** Augment names leaked into `buildPath` during active augment offers because game-plan saw augment-offer context in the shared snapshot. The shared schema couldn't enum-lock `name` per-feature.
- **Untestable in isolation.** Changing voice-query behavior risked regressing augment-fit because they shared everything.

**After:**

- Each feature owns its task prompt, schema, and output type. Changes to one feature's prompt can't accidentally affect another's.
- Game-plan's schema applies a string enum to `buildPath[].name`, restricting it to the player's actual item catalog. Augment names are rejected at decode time, not after the fact.
- `MatchSession` makes history cumulative across champ-select → in-game → post-game without features needing to coordinate.
- The eval harness reuses the production code path through `session.ask` (#112). Anything that ships in production also runs in eval.

## Where to extend

- **New LLM-driven feature** — add a directory under `src/lib/ai/features/<name>/` with `index.ts` (the feature object), `prompt.ts` (task prompt), `schema.ts` (output schema), `scorers.ts` (eval scorers). Wire it into the call site (e.g. `CoachingPipeline.tsx`).
- **New personality** — add to `src/lib/ai/personality.ts` and surface via `personality-store.ts` + `PersonalityToggle.tsx`. Tracked in #24.
- **New phase wiring** (champ-select, post-game) — `MatchSession.transitionTo` is ready; per-phase features need `supportedPhases: ["champ-select"]` etc. Tracked in #70 (champ-select) and #84 (post-game follow-up).

## Re-roll advisory logic (ARAM Mayhem)

The augment-fit feature has to reason about a multi-round mechanic the model doesn't otherwise know about:

- **Round 1**: player presents 3 augments. Pick the best, advise re-rolling the other two.
- **Round 2**: player reports 2 new augments — but there are 3 cards in play (1 kept + 2 new). If a new one beats the kept one, advise spending the kept card's re-roll. Otherwise, take the kept one.
- **Round 3** (optional): if the kept card was re-rolled, player reports 1 new augment. Pick the best of the 3 final cards. No re-rolls remain.

The model only sees NEW cards each turn — it has to remember which card was kept from prior rounds via conversation history. This is encoded in the augment-fit task prompt; cumulative `messages[]` on `MatchSession` is what makes it work across rounds.

## Data sources

The LLM doesn't fetch anything itself — `MatchSession` is handed a pre-assembled snapshot. Where each piece comes from:

| Data                                     | Source                                                                   | When fetched                               |
| ---------------------------------------- | ------------------------------------------------------------------------ | ------------------------------------------ |
| Champion names, levels, items, teams     | Riot Live Client Data API (port 2999, polled every 2s during InProgress) | Real-time during game                      |
| Champion abilities (passive + QWER)      | DDragon per-champion endpoint                                            | Once per game start (10 parallel requests) |
| Item descriptions and stats              | DDragon bulk items endpoint                                              | App launch (cached)                        |
| Augment names, descriptions, tiers, sets | League Wiki Lua module (Mayhem + Arena)                                  | App launch (cached)                        |
| Augment IDs and icons                    | Community Dragon                                                         | App launch (cached, merged with wiki data) |
| ARAM balance overrides                   | League Wiki ChampionData Lua module                                      | App launch (cached)                        |
| Game mode (KIWI/CLASSIC/CHERRY)          | LCU WebSocket session events                                             | Real-time via reactive engine              |

## Known limitations

- **Augment descriptions have residual markup artifacts** — 3 of 202 augments still have garbled text from wiki template edge cases. The model usually reads through them, but they show up verbatim if quoted.
- **Model relies on training data for game knowledge** — augment synergies, meta builds, and matchup knowledge come from the model's training, not our data pipeline. Stale meta = stale advice.
- **No augment set bonus tracking** — the model doesn't see set progress (e.g. "you have 2/3 Firecracker augments"). It can infer from the chosen list but isn't given a tally.
- **No filtering on voice transcripts** — accidental hotkey presses produce empty/noise transcripts that still hit the LLM.

## Related references

- `docs/reference/technical-reference.md` — implementation gotchas, OpenAI strict-mode rules, eval scorer patterns.
- `docs/reference/eval-scoring-criteria.md` — what each scorer measures.
- `docs/reference/evalite-reference.md` — how to run + interpret evals.
- `docs/plans/2026-04-19-per-feature-llm-prompts-design.md` — the design doc that drove this refactor (#108).

# Per-Feature LLM Prompts on a Unified MatchSession

Date: 2026-04-19
Related issue: [#108](https://github.com/niftymonkey/champ-sage/issues/108)

## Context

Every LLM-driven feature in champ-sage routes through one monolithic system prompt (`buildGameSystemPrompt` at `src/lib/ai/prompts.ts`) and one output schema (`coachingResponseSchema` at `src/lib/ai/schemas.ts`). Augment fit-rating, item recommendations, game plan, and voice Q&A all share the same prompt with a conditional augment block and all receive the same `CoachingResponse` shape with optional fields. Differentiation happens only in user-message text.

This document plans the refactor to per-feature prompts and per-feature schemas on a single shared conversation session whose history spans the full match lifecycle.

## Problem

- **Token waste.** Every voice "what should I buy?" carries augment fit-rating rules; every augment offer carries the full two-tier item catalog.
- **Schema smell.** `CoachingResponse.buildPath?` is populated only for game plan; `recommendations` is ignored by some features. Shared-shape + optional-field anti-pattern.
- **Cross-contamination.** Prior structured output lingers in multi-turn history when an unrelated feature asks its next question.
- **Blocks focused evals.** Scorers can't isolate feature quality; the #99 build-path scorers never shipped because of this.
- **Doesn't scale** to champ-select coaching (#70), post-game follow-up (#84), proactive engine (#67, #69), or personality selector (#24).

## Goal

Each LLM-driven feature owns:

- a focused task prompt
- its user-message builder
- its output schema
- optional post-processing

…while sharing a single `MatchSession` whose base context (champion, items, roster, mode rules, preferences, patch notes, past games) and accumulated conversation history are available to every feature.

## Architecture at a glance

### Anatomy of one LLM call (end-state)

```
┌───────────────────────────────────────────────────┐
│  MatchSession (one per match, cumulative history) │
│    baseContext : string                           │
│    messages[]  : [user, assistant, user, ...]     │
└─────────────────────┬─────────────────────────────┘
                      │  session.ask(feature, input)
                      ▼
┌───────────────────────────────────────────────────┐
│  CoachingFeature<TInput, TOutput>                 │
│    buildTaskPrompt(input)  → string               │
│    buildUserMessage(input) → string               │
│    outputSchema                                   │
│    extractResult(raw, meta) → TOutput             │
└─────────────────────┬─────────────────────────────┘
                      │  compose
                      ▼
┌───────────────────────────────────────────────────┐
│  OpenAI call                                      │
│    system   = baseContext + taskPrompt            │
│    messages = [...prior turns, new user turn]     │
│    schema   = feature.outputSchema                │
└───────────────────────────────────────────────────┘
```

Key idea: the session owns **continuity** (base context + message history). The feature owns **what this particular call is about** (task prompt, user-message shape, output schema). Every call to `ask()` glues the two together and hands the combined thing to the LLM.

### Current state (end of Phase 2)

One shared "kitchen-sink" feature. Every call site passes the same feature and gets back the same `CoachingResponse` shape — only the input text differs.

```
game-plan auto-fire  ─┐
voice Q&A             ├─▶ session.ask(coachingFeature, { stateSnapshot, question })
augment offer        ─┘
                              │
                              ▼
                 coachingFeature (kitchen-sink, one for all call types)
                 ├─ buildTaskPrompt  = ALL remaining feature rules
                 │                     (item-rec format, proactive, item pool,
                 │                      augment fit, synergy coaching)
                 ├─ buildUserMessage = [Game State] + [Question]
                 └─ outputSchema     = coachingResponseSchema (shared shape)
```

### Target state (end of Phase 3)

Four per-feature modules. The call site picks the right one; each feature carries only the rules and state it needs.

```
game-plan auto-fire  ─▶ session.ask(gamePlanFeature,    ...)
augment offer        ─▶ session.ask(augmentFitFeature,  ...)
voice "what buy"     ─▶ session.ask(itemRecFeature,     ...)
voice other          ─▶ session.ask(voiceQueryFeature,  ...)

  Each feature owns:
    ├─ buildTaskPrompt    : only its own rules
    ├─ buildUserMessage   : its own (feature-scoped) state snapshot  ← #109 defense
    └─ outputSchema       : its own (Phase 4)
```

### Phase map — what each phase wires up

```
P0 ✓  rebase onto main (absorb #99 artifacts)
P1 ✓  CoachingFeature contract + session.ask() plumbing (kitchen-sink feature)
P2 ✓  split system prompt into baseContext + featureRules (kitchen-sink holds rules)
P3    split kitchen-sink → 4 features; feature-scoped state snapshots (#109 defense)
P4    per-feature schemas; enum-lock buildPath to item catalog (#109 guarantee);
      retire CoachingResponse
P5    store .answer prose in history (not full JSON)
P6    personality-prefix infrastructure (no-op default, unblocks #24)
P7    MatchSession phases: champ-select → in-game → post-game
P8    migrate eval harness into per-feature dirs; land deferred #99 scorers
P9    sweep + docs + PR
```

## Design

### MatchSession: one session, three phases, cumulative history

A session spans `champ-select → in-game → post-game`. Message history is cumulative across all three phases. Base context is recomputed on phase transitions (new `GameState` at match start, EOG stats at end), but `messages[]` is never truncated.

```ts
type MatchPhase = "champ-select" | "in-game" | "post-game";

interface MatchSession {
  readonly phase: MatchPhase;
  readonly baseContext: string; // recomputed on phase transitions
  readonly messages: ModelMessage[]; // cumulative across phases
  readonly personality: PersonalityLayer;

  transitionTo(phase: MatchPhase, inputs: BaseContextInputs): void;

  ask<TIn, TOut>(
    feature: CoachingFeature<TIn, TOut>,
    input: TIn,
    options?: { signal?: AbortSignal }
  ): Promise<TOut>;
}
```

Each `ask()` call internally:

1. Composes `system = personality.prefix + baseContext + feature.buildTaskPrompt(input)`.
2. Builds the user message: `[Game State]\n{snapshot}\n\n[Question]\n{feature.buildUserMessage(input)}`.
3. Appends the full user turn (state + question verbatim) to `session.messages`.
4. Calls the LLM with composed `system` + cumulative `messages` + `feature.outputSchema`.
5. Appends the assistant turn to `session.messages` as `.answer` prose only — the structured JSON envelope is not stored. The LLM references prior _content_ on future turns, not prior _schema_; structured fields were for UI rendering.
6. Returns `feature.extractResult(rawOutput)`.

Both sides of every turn (state, question, answer prose) remain visible to the LLM. Only the structured output envelope is collapsed for history.

### CoachingFeature contract

```ts
interface CoachingFeature<TInput, TOutput> {
  id: string; // "augment-fit" | "game-plan" | "item-rec" | "voice-query" | ...
  supportedPhases: readonly MatchPhase[];

  buildTaskPrompt(input: TInput): string;
  buildUserMessage(input: TInput): string;

  outputSchema: JsonSchema<TOutput>;
  extractResult(raw: TOutput): TOutput;

  /** Assistant content stored in shared history. Default: result.answer */
  summarizeForHistory?(result: TOutput): string;
}
```

Features declare `supportedPhases`. `session.ask()` rejects off-phase calls. `voice-query` supports all three; `champ-select-analysis` only `["champ-select"]`; `post-game-followup` only `["post-game"]`.

### Base context: flat, required, typed

No optional `extensions?` object. End-state-shaped, empty states captured inside typed fields.

```ts
interface BaseContextInputs {
  phase: MatchPhase;
  mode: GameMode;
  gameData: LoadedGameData;

  // Phase-specific data, nullable (not optional) — typed intent visible up-front
  champSelect: ChampSelectSnapshot | null;
  gameState: GameState | null;
  eogStats: EndOfGameStats | null;

  // Cross-game data, always present with meaningful empty defaults
  playerPreferences: PlayerPreferences; // #82
  patchNotes: PatchNotes; // #61
  pastGames: PastGameSummary[]; // #20
}

function buildBaseContext(inputs: BaseContextInputs): string;
```

Moves out of `buildGameSystemPrompt` into `buildBaseContext`:

- Coaching persona + response brevity rules
- Champion profile + abilities + runes + balance overrides
- Match roster (ally/enemy teams with tags)
- Item catalog sections (both tiers)
- State snapshot format explainer
- Player preferences, patch notes, past-game summaries (once #82 / #61 / #20 land)

Moves OUT of base into feature task prompts:

- `ITEM_RECOMMENDATIONS_RULE` (destination + component) → `item-rec`
- `PROACTIVE AWARENESS` rules (grievous wounds, MR checks) → `item-rec` and `passive-observation`
- `AUGMENT FIT RATING` block → `augment-fit`
- `SYNERGY COACHING` block → `augment-fit`
- `ITEM POOL USAGE` rule → `item-rec`

### Per-feature schemas retire `CoachingResponse`

| Feature                 | Output shape                                                              |
| ----------------------- | ------------------------------------------------------------------------- |
| `augment-fit`           | `{ recommendations: Array<{name, fit, reasoning}> }`                      |
| `game-plan`             | `{ answer, buildPath: BuildPathItem[] }`                                  |
| `item-rec`              | `{ answer, recommendations: Array<{name, fit, reasoning}> }`              |
| `voice-query`           | `{ answer, recommendations?: [...] }` (freeform, recs optional by intent) |
| `passive-observation`   | `{ observation, severity: "fyi" \| "important" }` (#67)                   |
| `champ-select-analysis` | `{ compAnalysis, suggestions?: [...] }` (#70)                             |
| `post-game-followup`    | `{ answer, recommendations?: [...] }` (#84)                               |

The `retried` flag (#102) moves out of schemas into an engine-level wrapper the race-with-retry helper adds.

### Personality layer (#24)

```ts
interface PersonalityLayer {
  id: "blunt" | "educational" | ...;
  prefix(): string;
}
```

Prepended to `system` on every `ask()` call. Switching personality does not invalidate the session; only affects the next `ask()`. Default `"blunt"` is a no-op prefix, shipping the infrastructure without behavior change.

### Proposed directory layout

```
src/lib/ai/
  session.ts                    # MatchSession, transitionTo, ask()
  base-context.ts               # buildBaseContext(inputs: BaseContextInputs)
  feature.ts                    # CoachingFeature interface + generic engine call
  personality.ts                # PersonalityLayer (#24)
  features/
    augment-fit/                # prompt + schema + buildUserMessage + scorers + fixtures
      index.ts
      prompt.ts
      schema.ts
      scorers.ts
      fixtures/
    game-plan/                  # moved from game-plan-query.ts, incl. #99 work
      index.ts
      prompt.ts
      schema.ts
      scorers.ts                # where the deferred #99 eval work lands
      fixtures/
    item-rec/
    voice-query/
    passive-observation/        # future (#67)
    champ-select-analysis/      # future (#70)
    post-game-followup/         # future (#84)
```

Feature co-location: prompt + schema + scorers + fixtures ship together. When a feature is added or changed, everything it needs lives in one directory.

### Preserved infra

- `augment-coaching.ts` controller (lifecycle/debounce/abort) keeps its shape; its `submitQuery` callback becomes `session.ask(augmentFitFeature, …)`.
- `race-with-retry.ts` wraps feature calls inside the engine; every feature gets retry for free.
- `state-formatter.ts` stays feature-agnostic.
- `item-catalog.ts` moves unchanged into base-context's item catalog section.

### Proactive engine integration (#67, #69)

The proactive coaching engine detects decision points and calls the same API:

```ts
proactiveEngine.on("shop-moment", async (ctx) => {
  const result = await session.ask(itemRecFeature, {
    trigger: "shop-moment",
    ctx,
  });
  overlay.showPrimary(result);
});
```

Whether a feature runs reactively (voice triggers it) or proactively (engine triggers it) is invisible to the feature itself — same prompt, same schema, same `ask()`.

## Critical files

Modify:

- `src/lib/ai/prompts.ts` → split into `base-context.ts` + per-feature task prompts under `features/`
- `src/lib/ai/schemas.ts` → split into per-feature schemas; retire `CoachingResponse`
- `src/lib/ai/types.ts` → per-feature output types; keep `BuildPathItem`, `Recommendation`, `FitRating`
- `src/lib/ai/conversation-session.ts` → evolves into `session.ts` with `transitionTo()` and `ask()`
- `src/lib/ai/recommendation-engine.ts` → becomes generic `runFeatureCall()` behind `session.ask()`
- `src/lib/ai/game-plan-query.ts` → becomes `features/game-plan/`
- `src/lib/ai/augment-offer-formatter.ts` → consumed by `features/augment-fit/`
- `src/components/CoachingPipeline.tsx` → replace direct `getMultiTurnCoachingResponse` calls with `session.ask(feature, input)`; add phase transitions
- `src/components/coaching/*` consumers of `CoachingResponse` → typed per feature
- `src/lib/ai/coaching.eval.ts` → retire shared `EvalOutput`; scorers/fixtures move into feature directories

New:

- `src/lib/ai/feature.ts`
- `src/lib/ai/session.ts`
- `src/lib/ai/base-context.ts`
- `src/lib/ai/personality.ts`
- `src/lib/ai/features/{augment-fit,game-plan,item-rec,voice-query}/`

## Migration strategy

Staged, no big-bang. Each step is independently shippable.

1. **Land #99 first on its own PR.** Don't entangle it with this refactor. Its artifacts (`game-plan-query.ts`, `BuildPathItem`) are the template for feature-level extraction.
2. **Introduce `Feature` + `session.ask()` behind the existing `CoachingResponse` schema.** One shared schema, one "kitchen-sink" feature, no behavior change. Plumbing only. Migrates all call sites in `CoachingPipeline.tsx` to `session.ask(...)`.
3. **Split the system prompt.** Pull feature-specific rules out of base; create `features/augment-fit/prompt.ts` with its own task prompt but still using the shared schema. Swap in the GEP augment path to call it. Measure token drop.
4. **Introduce per-feature schemas one feature at a time.** Order: augment-fit → game-plan → item-rec → voice-query. Each conversion is local, typed, and testable.
5. **Switch assistant history storage to `.answer` only** once all features own their schemas.
6. **Add personality layer (#24) as a no-op default.** Ships infrastructure for the personality-selector issue; no UI yet.
7. **Introduce `MatchSession.transitionTo()` and `champ-select` / `post-game` phases.** Wire champ-select detection to instantiate the session early and transition into `in-game` when the match starts. Post-game transition fires on EOG.
8. **Migrate eval harness to feature directories.** `coaching.eval.ts` disassembles; each feature directory owns its scorers and fixtures. The deferred #99 scorers land here as part of `features/game-plan/`.

Each step is a PR.

## Verification

- `pnpm typecheck` — schemas/feature types flow through consumers.
- `pnpm test` — existing suite green; new unit tests cover:
  - `session.ask(feature, input)` composes `system` correctly (base + personality + task) without mutating `messages`.
  - Phase transitions rebuild base context but preserve `messages[]` cumulatively.
  - Assistant turns store `.answer` not JSON.
  - Each feature module: prompt asserts, schema shape, `extractResult` edge cases, `supportedPhases` enforcement.
- `pnpm dev:electron` manual smoke:
  - Opening game plan renders (game-plan feature)
  - Augment offer → fit ratings (augment-fit feature)
  - Voice "what should I buy?" (item-rec feature)
  - Voice "what's the combo" (voice-query feature)
  - Token counts per call drop meaningfully vs `main`
- Run `evalite` after per-feature schemas land: confirm existing scorers still score, then land the #99 follow-up scorers (`scoreBuildPathStructure`, `scoreCounterTargeting`, `scoreCategoryDiversity`, `scoreReasonBrevity`) inside `features/game-plan/scorers.ts`.

## Out of scope for this ticket

- New LLM features (champ-select coaching #70, post-game follow-up #84, proactive engine #67/#69, personality UI #24) — this refactor prepares the ground; their implementations are their own tickets.
- Persistence of `MatchSession` to SQLite (#7 / #20) — the session object is designed to be serializable, but persistence ships separately.
- Model switching per feature — out of scope; all features stay on the single configured model.

## Cross-cutting preservation

- Race-with-retry (#102) wraps feature calls in the engine.
- Abort signals thread through `ask(feature, input, { signal })`.
- Overlay relay (`window.electronAPI.sendCoachingResponse`) stays on the feature's raw output; each feature's schema is what the overlay renders.

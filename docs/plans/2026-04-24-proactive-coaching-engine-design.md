# Proactive Coaching Engine — Path Forward

Date: 2026-04-24
Related issue: [#67](https://github.com/niftymonkey/champ-sage/issues/67)
Related ticket: [#69](https://github.com/niftymonkey/champ-sage/issues/69) (proactive item purchase recommendations — subsumed by this work)

## Purpose of this doc

Capture the research + design decisions from the planning session on 2026-04-23 so work on #67 can be picked up later without losing context. This is a **path-forward design**, not an implementation plan. Actual implementation happens across multiple PRs, phased.

---

## 1. Problem & intent

All current coaching is reactive (voice/text query → LLM). The product vision identifies **proactive coaching** — unprompted advice at decision points — as the primary interaction model and the main differentiator from a generic chatbot. Only two proactive triggers exist today:

- The opening game-plan auto-fire (`src/components/CoachingPipeline.tsx:193-212`)
- The GEP augment-offer controller (`src/components/CoachingPipeline.tsx:544-602`)

There is no mode-agnostic framework for registering new decision points. `GameMode.decisionTypes` is already declared (`src/lib/mode/types.ts:38-41`) but has no dispatcher. Nothing drives item-purchase advice or passive observations.

This doc defines the framework, the decision types to land, the feature modules required, and — crucially — the **overlay vs UI surface split** that informs every design choice downstream.

---

## 2. What's already there (reuse, don't rebuild)

| Primitive                                                                   | Location                                                                | Role                                                                                |
| --------------------------------------------------------------------------- | ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `CoachingFeature<TIn, TOut>` contract                                       | `src/lib/ai/feature.ts:26-57`                                           | Per-feature prompt + schema + user-message builder                                  |
| `MatchSession.ask(feature, input, {signal})`                                | `src/lib/ai/match-session.ts:141`                                       | Composes system + messages, calls LLM, appends history                              |
| `runFeatureCall()` race-with-retry                                          | `src/lib/ai/recommendation-engine.ts:27`                                | Every feature gets retry for free                                                   |
| `createAugmentCoachingController` (debounce + abort)                        | `src/lib/ai/augment-coaching.ts:42-101`                                 | Template for the trigger scheduling pattern                                         |
| `augmentOffer$`, `augmentPicked$`                                           | `src/lib/reactive/gep-bridge.ts:28, 33`                                 | Input streams for the augment trigger                                               |
| `liveGameState$`                                                            | `src/lib/reactive/streams.ts:28`                                        | Input stream for game-state-driven triggers                                         |
| `coachingFeed$`, `pushCoachingExchange`, `pushAugmentOffer`, `pushGamePlan` | `src/lib/reactive/coaching-feed.ts`                                     | UI surface writes                                                                   |
| `GameMode.decisionTypes`                                                    | `src/lib/mode/types.ts:38-41`                                           | Already declared: `"augment-selection" \| "item-purchase" \| "open-ended-coaching"` |
| `buildBaseContext`                                                          | `src/lib/ai/base-context.ts:25-97`                                      | Compliance rules + item awareness + gold awareness live here                        |
| Per-feature compliance pattern                                              | `src/lib/ai/features/game-plan/prompt.ts:13-18` + `schema.ts` enum lock | Three-layer enforcement to mirror in new features                                   |

See also `docs/plans/2026-04-19-per-feature-llm-prompts-design.md:271-285` — the earlier refactor explicitly sketched this integration: `proactiveEngine.on("shop-moment", ctx => session.ask(itemRecFeature, { trigger, ctx }))`. The groundwork is done.

---

## 3. Design principle: Overlay vs UI split

**This is the single most important concept to carry forward.** Every in-game info surface is categorized by three questions:

1. **Must the player act within ~10 seconds?** If yes → overlay mandatory.
2. **Does Riot's native UI already give the player enough?** If yes → we shouldn't duplicate it.
3. **Who initiated the info — player or coach?** Player-initiated answers have to appear where the player is looking (in-game → overlay by default). Coach-initiated proactive info is almost always build/purchase (compliance) — rarely urgent, fits UI with optional overlay.

**The resulting breakdown:**

| Surface                                   | Act-in-10s?                 | Verdict                                                                                       |
| ----------------------------------------- | --------------------------- | --------------------------------------------------------------------------------------------- |
| Augment fit (3-box overlay above anvil)   | Yes                         | **Overlay-only.** UI barely needed.                                                           |
| Past augments picked                      | No                          | **UI reference** (low prominence).                                                            |
| Voice Q&A answer                          | Yes (just asked)            | **Configurable overlay.** User sizes/hides; falls back to desktop UI for second-screen users. |
| Item-purchase options (shop moment)       | Yes while in shop           | **Small overlay near shop.** UI holds fuller reasoning.                                       |
| Passive observation ("consider grievous") | No — actionable _next_ shop | **UI primary.** Overlay opt-in.                                                               |
| Game plan narrative                       | No — reference              | **UI only.**                                                                                  |
| Build path                                | No — reference              | **UI only** (maybe tiny "next item" overlay line at shop).                                    |
| Post-game / stats / history               | No                          | **UI only.**                                                                                  |

**Pattern underneath:** most features have a _moment-critical view_ (overlay — tiny, one decision, auto-dismiss) and a _reference view_ (UI — dense, contextual, historical). Same underlying data, two presentations.

**Design principle:**

> Every in-game info surface is **overlay-capable** (can be summoned as an overlay). Only a small critical few are **overlay-default** (appear without user opt-in). Everything else is UI-first with a toggle to promote.

Defaults: augment fit, active-decision strip. Opt-in: voice Q&A overlay, item-purchase overlay, passive-observation overlay. This handles single-screen users (they opt more into overlay) without cluttering second-screen users.

**Consequence for AC item 3 of #67** ("Augment offer coaching routes to primary UI slot"): the "primary UI slot" is the **active-decision overlay**, not a panel in the desktop UI. Augments don't need a new desktop-UI slot — the native 3-box overlay is already sufficient. A _reference_ view of past augments in the UI is a separate concern (covered by [#114](https://github.com/niftymonkey/champ-sage/issues/114)).

---

## 4. Coaching philosophy: options, not imperatives

Recurring principle from the discussion. All purchase/augment advice is framed as "**these are strong options**" with per-option reasoning. Mirror the `augment-fit` feature's shape:

- ✅ "Zhonya's is a strong choice because X. Rabadon's also works because Y."
- ❌ "Buy Zhonya's."

This applies to `itemRecFeature` prompt tuning (today it leans prescriptive) and to anything new proactive ships. Compliance benefit: "options with reasoning" stays on the right side of the Riot line even at the edges.

---

## 5. Passive observations: LLM reasons, app doesn't pattern-match

Earlier draft of this plan had hardcoded detectors (`enemy-ap-heavy.ts`, `healing-without-grievous.ts`). **Rejected.** The app should feed the LLM a rich deterministic state snapshot and let the LLM decide what's worth saying.

- **App's job:** detect _checkpoint moments_ (deterministic timing — player died, item completed, level up).
- **LLM's job:** given the snapshot + trigger reason, decide whether to speak and what about.
- Schema allows null/empty observation ("nothing worth saying right now").

No periodic tick for now (per user — revisit only if the app feels insufficiently proactive). Only event-driven checkpoints.

Benefits:

- Infinitely extensible without new code (new patterns surface automatically as the LLM gets better state)
- Avoids codifying hardcoded "rules" that go stale with patches
- Compliance is handled by the one task prompt, not duplicated across N pattern files

---

## 6. Architecture

```
┌────────────────────────────────────────────────────┐
│ ProactiveEngine                                    │
│   triggers: DecisionPointTrigger[]                 │
│   scheduler: debounce + per-trigger cooldown +     │
│              global min-gap + abort-on-supersede   │
│   onFire(trigger, ctx) → trigger.handle(ctx,signal)│
└────────────────────────────────────────────────────┘
              ▲
              │ registers triggers whose decisionType ∈ mode.decisionTypes
              │ (passive-observation always registered regardless of mode)
              │
┌────────────────────────────────────────────────────┐
│ GameMode.decisionTypes (already declared)          │
│   aramMayhem: [augment-selection, item-purchase,   │
│                open-ended-coaching]                │
│   aram/classic: [item-purchase, open-ended-coaching] │
└────────────────────────────────────────────────────┘
```

### DecisionPointTrigger contract

```ts
interface DecisionPointTrigger<TCtx = unknown> {
  id: string; // "augment-offer", "item-purchase-shop", ...
  decisionType: DecisionType | "passive-observation";
  source$: Observable<TCtx>; // when to fire
  debounceMs: number; // merge bursts
  cooldownMs: number; // min gap between fires of THIS trigger
  handle(ctx: TCtx, signal: AbortSignal): Promise<void>;
}
```

Engine responsibilities:

1. Filter to triggers matching `mode.decisionTypes` (plus always-on passive).
2. Debounce each `source$`.
3. Enforce per-trigger cooldown + global min-gap (default 15s) between any two fires.
4. Hold an `AbortController` per trigger; abort on supersede or game end.
5. Call `trigger.handle(ctx, signal)` — handlers invoke `session.ask(feature, input, { signal })` and push to the feed.

### Trigger inventory

| Trigger                     | Decision type         | Source                                                               | Handler                                           | Status                                             |
| --------------------------- | --------------------- | -------------------------------------------------------------------- | ------------------------------------------------- | -------------------------------------------------- |
| `augment-offer`             | `augment-selection`   | `augmentOffer$` / `augmentPicked$`                                   | existing `augmentFitFeature`                      | **Migrate** from `createAugmentCoachingController` |
| `item-purchase-shop`        | `item-purchase`       | `liveGameState$` filtered by death→respawn + gold jump               | `itemRecFeature` with `trigger: "shop-moment"`    | **New**                                            |
| `item-purchase-gold`        | `item-purchase`       | `liveGameState$` filtered by gold ≥ cheapest missing build-path item | `itemRecFeature` with `trigger: "gold-available"` | **New**                                            |
| `checkpoint-death`          | `passive-observation` | `liveGameState$` filtered by `activePlayer.deaths` increment         | `passiveObservationFeature`                       | **New**                                            |
| `checkpoint-item-completed` | `passive-observation` | `liveGameState$` filtered by new completed item in inventory         | `passiveObservationFeature`                       | **New**                                            |
| `checkpoint-level-up`       | `passive-observation` | `liveGameState$` filtered by `activePlayer.level` increment          | `passiveObservationFeature`                       | **New**                                            |

---

## 7. New feature module: `passive-observation`

Location: `src/lib/ai/features/passive-observation/`

**Input:**

```ts
interface PassiveObservationInput {
  snapshot: GameSnapshot;
  checkpoint: "death" | "item-completed" | "level-up";
  evidence: string; // short, deterministic (e.g. "died to Veigar" or "completed Kraken Slayer")
}
```

**Output:**

```ts
interface PassiveObservationResult {
  observation: string | null; // null = nothing worth saying
  severity: "fyi" | "important";
  recommendations: Array<{ name: string; fit: FitRating; reasoning: string }>; // optional items
}
```

- Schema enum-locks `recommendations[].name` to item catalog (same pattern as `game-plan/schema.ts`).
- Task prompt mirrors `item-rec` compliance clauses verbatim: build-only, no map/tactical, no power-spike alerts, "options not imperatives."
- `extractResult` collapses null observations to a sentinel that the feed-push step skips (don't show empty cards).
- Summaries-for-history: if observation is null, skip adding to history (no-op turn).

---

## 8. Item-purchase trigger detection

Deterministic state watchers on `liveGameState$`, no LLM calls:

**`item-purchase-shop`:**

- Watch `activePlayer.currentGold` jumps of > 300 while `activePlayer.deaths` incremented within last ~15s.
- Signals "returned to shop after death" (ARAM-compatible — death is the shop moment). SR with recall-to-base will need a different detector, deferred per mode.

**`item-purchase-gold`:**

- Watch `currentGold >= N` where N = cheapest incomplete item in current build path (from `gamePlan$`).
- Skip if any purchase happened in last 10s (gold would drop).
- Cooldown: 60s per trigger (no spamming).

Both triggers live in `src/lib/ai/proactive/triggers/item-purchase.ts` as RxJS operators on `liveGameState$`.

---

## 9. Checkpoint trigger detection

Simple RxJS `pairwise` + filter operators on `liveGameState$`:

- **death**: `prev.activePlayer.deaths < curr.activePlayer.deaths`
- **item-completed**: new completed item appears in `activePlayer.items` (filter by `item.completed === true`)
- **level-up**: `prev.activePlayer.level < curr.activePlayer.level`

Per-trigger cooldowns:

- death: 30s (don't spam on back-to-back deaths)
- item-completed: no cooldown (each unique item is a distinct event)
- level-up: no cooldown (each level is distinct)

Global min-gap on the engine (default 15s) handles cross-trigger spam.

---

## 10. Rate limiting (three layers, all in engine)

1. **Per-trigger debounce** — merges state-change bursts (e.g. RxJS `debounceTime`).
2. **Per-trigger cooldown** — minimum gap between fires of the same trigger.
3. **Global min-gap** — default 15s between any two proactive fires. Prevents two triggers colliding after one state change.

Plus **abort-on-supersede**: newer trigger of same type cancels in-flight LLM call (reuses the pattern from `createAugmentCoachingController`).

---

## 11. Compliance

Three-layer enforcement mirrors what's already in `base-context.ts:30-38` + per-feature schema enums + post-hoc validators:

1. **Task prompt** explicitly names prohibited categories from `CLAUDE.md`: no tactical map actions, no power-spike alerts, no enemy cooldown/ultimate tracking, no enemy summoner spell tracking, no de-anonymizing, no Brawl data.
2. **Schema enum lock** on any item name referenced.
3. **Post-hoc validator** catches LLM slip-ups not expressible in schema (e.g. "boots uniqueness" rule in game-plan).

Every new task prompt gets a compliance audit before merge.

---

## 12. UI wiring (minimal for #67 — full overlay UI is [#18](https://github.com/niftymonkey/champ-sage/issues/18))

For this ticket the engine writes to the existing feed via `pushCoachingExchange` with new `source` values. The dedicated overlay UI components are [#18](https://github.com/niftymonkey/champ-sage/issues/18)'s problem.

Changes needed in `src/lib/reactive/coaching-feed-types.ts:45`:

```ts
source: "voice" | "augment" | "plan" | "item-rec" | "observation";
```

Existing `proactive: source !== "voice"` rule in `pushCoachingExchange` gives the gold-border proactive styling for free.

Overlay relay (`window.electronAPI.sendCoachingResponse`) already exists for augment + game-plan paths; the new triggers piggyback on that relay. Overlay UI redesign is out of scope for #67.

---

## 13. What's explicitly NOT in #67

Flagged so we don't let scope creep derail the PR:

- **Overlay UI components / active-decision strip** — [#18](https://github.com/niftymonkey/champ-sage/issues/18)
- **Coaching strip overlay rework** (positioning, drag, hover states) — [#86](https://github.com/niftymonkey/champ-sage/issues/86)
- **Augment display rework** (owned-augments view, feed consolidation) — [#114](https://github.com/niftymonkey/champ-sage/issues/114)
- **Build path as decision tree** — separate game-plan evolution ticket
- **Splitting game-plan narrative from build path** — possible future refactor; current `{ answer, buildPath }` schema is already UI-splittable
- **Periodic observation tick** — deferred; revisit if the app feels insufficiently proactive
- **SR-specific shop detection** (recall-to-base) — deferred with ARAM-first approach
- **Champ-select coaching** — [#70](https://github.com/niftymonkey/champ-sage/issues/70)
- **Post-game follow-up** — [#84](https://github.com/niftymonkey/champ-sage/issues/84)
- **Personality selector** — [#24](https://github.com/niftymonkey/champ-sage/issues/24)

---

## 14. Implementation order (phased PRs)

Each phase is independently shippable and reviewable.

### Phase 1: Framework + augment migration

**PR 1** — no new user-visible behavior.

- `src/lib/ai/proactive/engine.ts` — `ProactiveEngine` class
- `src/lib/ai/proactive/types.ts` — `DecisionPointTrigger` interface
- `src/lib/ai/proactive/engine.test.ts` — TDD: debounce, cooldown, global min-gap, abort-on-supersede, mode filtering
- `src/lib/ai/proactive/triggers/augment-offer.ts` — wrap existing `createAugmentCoachingController` logic into a trigger
- `src/components/CoachingPipeline.tsx` — replace the augment controller effect with engine instantiation in the session-init effect (lines 94-143 as lifecycle anchor)
- Behavior parity test vs pre-migration augment flow

### Phase 2: Item-purchase triggers

**PR 2** — new user-visible behavior.

- `src/lib/ai/proactive/triggers/item-purchase.ts` — shop-moment + gold-available detectors (RxJS operators + handler)
- `src/lib/ai/proactive/triggers/item-purchase.test.ts` — synthetic `liveGameState$` fixtures
- `src/lib/ai/features/item-rec/index.ts` — accept `trigger: "voice" | "shop-moment" | "gold-available"` in input
- `src/lib/ai/features/item-rec/prompt.ts` — tune for "options not imperatives" (audit current language; add explicit "present 2+ strong alternatives" clause)
- `src/lib/reactive/coaching-feed-types.ts:45` — add `"item-rec"` to source union
- Manual smoke: play ARAM, die, verify shop-moment fires within ~5s of respawn

### Phase 3: Checkpoint-driven passive observations

**PR 3** — the LLM-driven proactive piece.

- `src/lib/ai/features/passive-observation/` — feature module (prompt, schema, index, test)
- `src/lib/ai/proactive/triggers/checkpoints.ts` — death / item-completed / level-up triggers
- `src/lib/ai/proactive/triggers/checkpoints.test.ts`
- `src/lib/reactive/coaching-feed-types.ts:45` — add `"observation"` to source union
- `src/lib/ai/coaching.eval.ts` — add `proactive-observation` fixture category
- Run `pnpm eval` before committing (per `feedback_eval_before_commit.md`)
- Manual smoke: full game with several deaths + completed items; verify observations surface with reasonable cadence and compliance

---

## 15. Verification (full-sweep after Phase 3)

- `pnpm typecheck` — clean
- `pnpm test` — all green
- `pnpm dev:electron` manual smoke:
  1. Augment offer during Mayhem → fit ratings (parity with pre-migration)
  2. ARAM death → respawn → item-purchase options card appears within ~5s
  3. Play through several deaths/items/levels → observations surface; most are useful, some are `null` (LLM restraint)
  4. Spam state changes → confirm no two proactive cards fire within 15s global min-gap
- `pnpm eval` — existing scorers still pass; new proactive-observation fixtures score as expected
- Compliance audit: re-read CLAUDE.md compliance section against every new task prompt; confirm no trigger path can produce tactical-map advice

---

## 16. Open questions / decisions to revisit

- **Engine lifecycle anchor.** Currently planning to instantiate `ProactiveEngine` in the session-init effect (`CoachingPipeline.tsx:94-143`). Needs a cleanup path on mode change / game end — mirror the existing `sessionRef` reset pattern.
- **Observation suppression heuristics.** If the LLM returns `observation: null` too often, consider prompt tweaks. If too rarely, add cooldown or severity filter.
- **Mode-specific shop detection** (SR recall-to-base, Arena round boundaries). Not in #67, but the trigger interface should be extensible enough that a mode can supply its own trigger implementation.
- **"Primary UI slot" language in #67 AC.** This doc interprets it as the active-decision _overlay_ (per the overlay/UI split). If a reviewer disagrees, pause and re-align before starting Phase 1.

---

## 17. Memory / session context

Saved feedback memories that should guide this work:

- **Options not imperatives** — purchase/augment advice is always multi-option with reasoning (not prescriptive)
- **LLM reasons, app doesn't pattern-match** — for proactive observations, feed snapshot and let the LLM decide content
- **Overlay vs UI split principle** — captured in section 3 above

User's WIP note at time of writing: redesigning the desktop UI with the future product in mind via a cloud design tool. The "active decision surface" concept from section 3 should be reflected in that design work so the UI leaves room for it (even though building it is not in #67).

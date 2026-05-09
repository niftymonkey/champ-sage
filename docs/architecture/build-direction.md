# Build-Direction Signal

Architecture for issue #126 — player declares build direction in champ-select and mid-game; enemy directions are inferred from purchased items. Both signals share a vocabulary and feed coaching prompts.

## Scope

One PR, two mechanisms, shared taxonomy.

- **Player side (declared):** hard-toggle picker on the player's own slot in champ-select, mid-game pivot control on `GamePlanPanel`. Per-game live state. Resets at champ-select start. Not in settings.
- **Enemy side (inferred):** replaces the DDragon-stereotype tag on `EnemyStrip` with an item-derived reading. Cold-start = stereotype; evidence overrides as completed items accumulate.
- **Coaching prompts:** both signals thread into `gameplan`, plan-revision, and `item-rec` via `MatchSession` prompt-context. Same vocabulary on both sides.

## Modules

All four new modules are category-1 (in-process). No ports, no adapters. Internal seams only — tests cross the function/component interface directly.

### `src/lib/build-direction/taxonomy.ts`

Single source of truth for the vocabulary.

```ts
type BuildDirection = "ad" | "ap" | "tank" | "supp";
type ConfidenceLevel = "stereotype" | "low" | "high";

const ALL_DIRECTIONS: readonly BuildDirection[];

function label(d: BuildDirection): string; // "AD" / "AP" / "Tank" / "Support"
function stereotypeFromClassTag(ddragonTag: string): BuildDirection | null;
```

Starts at the 4-value DDragon-aligned set. If prompt quality forces a richer set (`ad-bruiser` / `ap-burst` / `enchanter` / etc.) later, widening the enum is cheap. Narrowing it once features depend on the rich values is expensive — this is the lower-risk starting point.

**Hides:** enum membership, DDragon-tag → stereotype mapping, display labels.
**Leverage:** every consumer (picker, inference, stream, strip, prompts) imports from here. No risk of two consumers disagreeing on what `tank` means.
**Locality:** vocabulary changes are one file.
**Test surface:** unit tests on the helpers; no I/O.

The existing `src/lib/champion-class.ts` is replaced by this module. `primaryClassTag()` callsites migrate to `stereotypeFromClassTag()`.

### `src/lib/build-direction/inference.ts`

Pure function. The entire stereotype-vs-evidence policy lives here.

```ts
interface DirectionReading {
  direction: BuildDirection;
  confidence: ConfidenceLevel;
}

interface EnemyInferenceInput {
  stereotype: BuildDirection; // never null at call site
  itemsOwned: Item[]; // from game state
  previousReading?: DirectionReading; // hysteresis
}

function inferEnemyDirection(input: EnemyInferenceInput): DirectionReading;
```

**Algorithm:**

1. Filter `itemsOwned` to **completed items** — `item.into === undefined || item.into.length === 0`. Components are ignored. This uses the data-ingest item tree directly rather than a cost-threshold proxy, so it's accurate on items with unusual cost shapes.
2. Bucket each completed item into `ad` / `ap` / `tank` / `supp` from its stat bonuses (AD/lethality → ad; AP → ap; armor+MR+HP → tank; gold-gen / heal-shield-power → supp).
3. Majority bucket wins. Ties are broken in favour of the stereotype.
4. Confidence ladder: 0 completed items → `stereotype`; 1 → `low`; 2+ aligned → `high`.
5. Hysteresis: a new direction only replaces `previousReading.direction` if its bucket beats the previous bucket by ≥1 completed item — prevents flicker when a Bel'Veth grabs a Glacial Buckler component before the Goliath augment commits.

**Hides:** completed-item rule, the bucket scoring, the confidence ladder, the flicker policy.
**Leverage:** EnemyStrip and the prompt-context observable both call this and trust the result.
**Locality:** every "why did the strip flip" or "why is the LLM seeing tank for an AP Malph" question starts here. Tuning the thresholds is one file.
**Test surface:** pure function, table-driven tests. Cases: cold-start = stereotype; one completed item = low confidence in evidence direction; conflicting evidence = stereotype tie-break; flicker resistance with `previousReading`.

### `src/lib/build-direction/stream.ts`

Reactive shim over the existing `enemy-stats-reactive` layer.

```ts
function enemyDirectionStream(
  enemyStats$: Observable<EnemyStatsByPlayer>,
  gameData: LoadedGameData
): Observable<Map<PlayerSlot, DirectionReading>>;
```

**Hides:** per-slot mapping; previous-reading memory for hysteresis (closed-over via `scan`); cold-start construction of stereotype from `gameData.champions`.

**Leverage:** EnemyStrip subscribes for UI; MatchSession's prompt-context observable subscribes for LLM. Both get the same per-slot map with the same flicker policy.

**Locality:** all reactive plumbing for enemy direction is one file. Replace inference algorithm? Edit `inference.ts`. Change stream policy (e.g. throttle direction changes)? Edit here.

**Test surface:** marble tests with a simulated `enemyStats$` source. Asserts on emitted maps, not internal scan state.

### `src/components/BuildDirectionPicker.tsx`

Reusable presentational component.

```ts
interface BuildDirectionPickerProps {
  value: BuildDirection | null;
  onChange: (next: BuildDirection) => void;
  champion?: Champion; // for stereotype-aware default highlight
  orientation?: "horizontal" | "vertical";
  size?: "compact" | "default";
}
```

Pill-toggle row. Used by `ChampSelectSurface` (player's `isMine` slot) and `GamePlanPanel` (mid-game pivot control). One component, two callers, zero divergence risk.

**Test surface:** clicking a pill calls `onChange` with the right value; arrow-key navigation cycles directions.

## Modules deliberately NOT created

- **`player-build-direction-store`** — vanishes under the deletion test. It's a `BehaviorSubject<BuildDirection | null>` keyed by gameId. Folded as a field on `MatchSession` (which already represents per-game live state).
- **`build-direction-prompt-context`** — just TypeScript fields on the existing MatchSession prompt-context type. No body to hide.
- **`plan-revision-trigger`** — existing `CoachingPipeline` mechanism. New event source feeds it; no new module.

## MatchSession + CoachingPipeline integration

**New fields on the prompt-context shape MatchSession exposes:**

```ts
playerBuildDirection: BuildDirection | null;
enemyBuildDirections: Array<{
  slot: PlayerSlot;
  direction: BuildDirection;
  confidence: ConfidenceLevel;
}>;
```

**New observable on MatchSession (used by CoachingPipeline + UI):**

```ts
playerBuildDirection$: BehaviorSubject<BuildDirection | null>;
setPlayerBuildDirection(next: BuildDirection): void;
```

**Plan-revision trigger:**

```ts
matchSession.playerBuildDirection$
  .pipe(
    distinctUntilChanged(),
    skip(1), // ignore initial value
    filter(() => gameState.phase === "in-game")
  )
  .subscribe(() => requestPlanRevision({ reason: "player-pivoted-build" }));
```

Event-driven, not polled. Champ-select declarations don't trigger revisions because we're still pre-game. First mid-game declaration _does_ (`skip(1)` covers the initial value).

**Feature consumers:** `gameplan`, `item-rec`, plan-revision read the new fields from prompt-context and render via `taxonomy.label()`. No new module — just new lines in existing prompt assembly.

## Persistence

- Player-declared direction: per-game live state on MatchSession. Resets at champ-select start.
- Enemy-inferred direction: ephemeral. Always re-derived from current items.
- Decision log: `playerBuildDirection` added as an optional field on `PlanDecision` so post-game can reflect on declared direction vs actual final build.

## UI behaviour notes

- `EnemyStrip` swaps the stereotype tag silently as evidence accumulates. No animation. Confidence is rendered as a muted color when `confidence === "stereotype"`, normal color otherwise. Game state is busy enough.
- `BuildDirectionPicker` highlights the champion's stereotype as the implicit default when `value` is null — no commitment until the player explicitly picks.

## Compliance

Build-direction context for `item-rec` and `gameplan` is squarely on the allowed side of the Riot/Overwolf line (build/item recommendations are explicitly permitted). None of this surfaces tactical map state, enemy ability timing, or power-spike alerts.

## Test strategy

TDD throughout. Test surfaces:

- `taxonomy.ts` — pure unit tests on helpers.
- `inference.ts` — pure unit tests, table-driven; covers cold-start, evidence accumulation, tie-break, hysteresis.
- `stream.ts` — RxJS marble tests with simulated `enemyStats$`.
- `BuildDirectionPicker` — React component tests on click + keyboard.
- `MatchSession` — extends existing tests with new field assertions.
- `CoachingPipeline` — asserts plan-revision triggers fire on mid-game direction change but not on champ-select declaration.

## Open question deferred

Per-game-mode hysteresis tuning was considered (ARAM games pivot faster than Summoner's Rift). YAGNI — start with one global rule. Revisit if telemetry shows ARAM strip flicker.

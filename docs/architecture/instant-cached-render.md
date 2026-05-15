# Instant Cached Render — Architecture Notes

Architect-deep output for issue #129. The user-visible promise: every surface renders the last-known values instantly on tab-nav AND on cold launch, and only re-renders when the underlying data actually changes. When a refresh is happening behind the scenes (e.g. LCU just connected and we're re-pulling match history), the existing pulsing-dots affordance signals it.

**Headline decision: adopt SWR and `useSyncExternalStore`. Don't hand-roll a cache primitive.** The first draft of this doc proposed a bespoke `CachedSubject<T>` + `DecisionLogCache` module set. Stress-testing that against industry-standard React caching showed it was reinventing SWR for no real reason — the "we need RxJS-shaped caches for project consistency" argument doesn't survive the observation that *cached fetched data and live event streams are conceptually different things and the codebase already conflates them only because no better tool was reached for*.

## The architectural split

Two distinct data shapes; two distinct primitives.

| Shape | Examples | Primitive |
|---|---|---|
| **Live event streams** — "what's happening right now" | `liveGameState$`, `gameLifecycle$`, `coachingFeed$`, `gamePlan$`, `playerBuildDirection$`, `lcuCredentials$` | RxJS `BehaviorSubject` (existing) consumed via `useSyncExternalStore` (new) |
| **Cached fetched data** — "the last-known answer to a question we periodically re-ask" | match history list, decision-log queries, last-game meta | **SWR**, with localStorage cache provider, configured trigger-driven |

Most React+WebSocket apps do exactly this split. Live feeds via WebSocket/EventSource subscriptions; cached server data via React Query / SWR. They compose cleanly because they answer different questions.

## Pre-deletion candidates (revised)

### Surviving

1. **SWR as a dependency** — owns the cached-fetch surface end-to-end: dedup by key, sync hydration from localStorage, `data + isValidating + error` triplet, `mutate(key)` for trigger-driven invalidation. Without it, every store reimplements stale-while-revalidate. Concentrates across all cached-fetch consumers; battle-tested implementation; ~4.5KB gzipped.
2. **`localStorageProvider`** — a single SWR cache provider configured at the app root. ~10 LOC. Reads localStorage synchronously during `SWRConfig` render; writes back on `beforeunload` and on each `mutate`. Delivers the "render cached on cold launch" promise.
3. **Migration of `useMatchHistory`, `useDecisionLogQuery`** — become thin `useSWR` wrappers. The existing `MatchHistoryStore` keeps its trigger logic but loses its in-memory cache; the cache moves to SWR. The decision-log IPC stays as-is; the renderer-side cache moves to SWR.
4. **Adoption of `useSyncExternalStore`** for every hook that subscribes to a `BehaviorSubject` — `useLastGameSnapshot`, `useGamePlan`, `useLcuConnected`, `useLiveGameState`, `useGameLifecycle`, `usePostGameReady`, `usePlayerBuildDirection`, `useCoachingFeed`. They all currently use `useState + useEffect`, which is the React 17 pattern and is technically prone to tearing under concurrent rendering. One small `useBehaviorSubject(subject)` helper concentrates the pattern.

### Dropped (relative to v1 of this doc)

- **`CachedSubject<T>` primitive.** Was reinventing SWR. SWR + `localStorageProvider` does the same job with battle-tested code, smaller footprint per feature, and the same `isValidating` semantic the UI already wants.
- **`DecisionLogCache` module.** Was reinventing per-key cache dedup + invalidation fan-out. SWR handles both natively (array keys for canonicalization, `mutate(predicate)` for fan-out).
- **`useCachedSubject(subject)` hook.** Replaced by `useSWR` for cached fetches and `useBehaviorSubject(subject)` for live streams.
- **`src/lib/cache/` boundary.** No new module needed. SWR is the boundary. A 5-line `localStorageProvider` lives next to `App.tsx`, not in its own folder.
- **Custom `CacheStatus` discriminated union.** SWR's `data + isLoading + isValidating + error` shape covers everything we need and matches what every React developer who's ever used SWR already knows.

### Also dropped from earlier framing

- **A separate `LastGameMetaStore`** — `mergeMeta()` already does this as a pure derivation. Pure functions don't earn modules.
- **A unified `UIStateStore`** for filters/scroll/active-tab — five components, none on the critical path. Per-component `useLocalStorageState(key, default)` only on AugmentList filters and DataBrowser tab if asked. Skip the rest.

## Dependency categories

- **localStorage** → Category 2 (local-substitutable). jsdom's localStorage is the test stand-in. SWR's `provider` option already supports injecting a fake `Map` for tests; we don't even need our own seam.
- **IPC bridge** (`window.electronAPI.decisionLogQuery`, `onDecisionLogUpdated`) → Category 3 (remote but owned). The fetcher passed to `useSWR` is the seam. Production fetcher calls electronAPI; tests pass an in-memory fetcher. Two real adapters; the seam is real.
- **LCU bridge** (already wrapped by `MatchHistoryStore`) → unchanged.
- **Clock** → Category 1, in-process; SWR has its own internal timing logic and we don't need to inject it.

## How SWR fits the existing system

### Match history

`MatchHistoryStore` keeps its job: it owns LCU credentials, fetches the list, parses it, retries on `ECONNREFUSED`, knows about puuid caching. **What changes**: it stops being a `BehaviorSubject` consumed via a custom hook. Instead it exposes a single `fetchMatches(): Promise<MatchSummary[]>` method, and the renderer calls it via `useSWR("match-history", () => store.fetchMatches())`.

The triggers — LCU credentials available, `gameEnded$` — become `mutate("match-history")` calls inside the store's existing subscriptions.

```ts
// inside MatchHistoryStore (illustrative)
inputs.lcuCredentials$.subscribe((creds) => {
  if (creds !== null) mutate("match-history");
});
inputs.gameEnded$.subscribe(() => mutate("match-history"));
```

### Decision log

`useDecisionLogQuery(query)` becomes:

```ts
function useDecisionLogQuery(query: DecisionQuery) {
  const { data = [], error, isLoading, isValidating } = useSWR(
    ["decision-log", query],          // array key — SWR handles deep-equal canonicalization
    ([, q]) => window.electronAPI.decisionLogQuery(q)
  );
  const summary = useMemo(() => summarizeGame(data), [data]);
  return { records: data, summary, error, isLoading, isValidating };
}
```

The IPC `onDecisionLogUpdated` listener wires once at app root and fans out via `mutate`:

```ts
// once, near the SWR provider
window.electronAPI.onDecisionLogUpdated(() => {
  mutate((key) => Array.isArray(key) && key[0] === "decision-log");
});
```

### Live event streams (build direction, last-game snapshot, game plan, lifecycle, etc.)

These stay as `BehaviorSubject`s — they're not fetches, they're event streams emitted by the engine layer. They don't need SWR. They DO need `useSyncExternalStore` for tearing safety:

```ts
function useBehaviorSubject<T>(subject: BehaviorSubject<T>): T {
  return useSyncExternalStore(
    (cb) => {
      const sub = subject.subscribe(cb);
      return () => sub.unsubscribe();
    },
    () => subject.getValue(),
    () => subject.getValue(),  // SSR snapshot — irrelevant here but required by API
  );
}
```

Every existing hook (`useLastGameSnapshot`, `useGamePlan`, etc.) becomes a one-liner around this helper.

## SWR configuration

```tsx
function localStorageProvider(): Cache {
  const map = new Map<string, unknown>(
    JSON.parse(localStorage.getItem("champ-sage:swr-cache:v1") ?? "[]"),
  );
  // Persist on unload AND on every mutation — beforeunload alone is unreliable in Electron.
  const persist = () => {
    try {
      localStorage.setItem(
        "champ-sage:swr-cache:v1",
        JSON.stringify([...map.entries()]),
      );
    } catch {
      // Quota exceeded or storage disabled — degrade silently.
    }
  };
  window.addEventListener("beforeunload", persist);
  return new Map(
    Object.assign(map, {
      set(key: string, value: unknown) {
        Map.prototype.set.call(this, key, value);
        persist();
        return this;
      },
    }),
  ) as Cache;
}

<SWRConfig
  value={{
    provider: localStorageProvider,
    revalidateOnFocus: false,        // Electron app, no relevant focus signal
    revalidateOnReconnect: false,    // we trigger ourselves
    revalidateIfStale: false,        // explicit triggers only
    revalidateOnMount: false,        // cached value is the answer; mutate() refreshes
    dedupingInterval: 0,             // we control timing via mutate
    shouldRetryOnError: false,       // MatchHistoryStore already has retry logic
  }}
>
  <App />
</SWRConfig>
```

The configuration above is the entire freshness contract — no automatic revalidation; only explicit `mutate()` calls from RxJS subscriptions in the engine layer cause refetches.

## Persistence layout

Single localStorage key: `champ-sage:swr-cache:v1`. SWR serializes the entire cache `Map` as `[[key, value], ...]`. The `:v1` suffix lets us bust the cache on schema changes — bump on incompatible shape changes; on next launch the old key is ignored, the cache starts cold, and the trigger subscriptions populate it.

Decision-log queries get array keys (`["decision-log", query]`). SWR's stable serialization handles canonicalization for object-shape queries (it sorts keys recursively).

Size: ~100 matches at ~1KB + ~5 active decision-log queries at ~25KB each ≈ 250KB. Comfortable inside the 5–10MB budget.

## Hook contract

For cached fetches:
```ts
const { data, isLoading, isValidating, error } = useSWR(key, fetcher);
```
Surfaces consume `isValidating` directly to drive `<LoadingDots />`. On cold launch with cached data, first render returns `data: cachedValue, isLoading: false, isValidating: true` — exactly the affordance #129 calls for.

For live streams:
```ts
const lastGame = useBehaviorSubject(lastGameSnapshot$);
```
Sync, no loading state, no flash. Same shape as today; just tearing-safe.

## LCU connection pill behavior

Pill stays unchanged — it reflects live LCU state, not cache state. The "refreshing" affordance is the existing `<LoadingDots />` inside data sections, driven by SWR's `isValidating`. **Drop the `lcuConnected` gates on stat-strip rows in IdleSurface** — that's the bug the user explicitly called out. Cached values render regardless of LCU; the dots appear when LCU connects and a `mutate("match-history")` fires.

## Answers to the original numbered questions (revised)

1. **Cache primitive shape** — SWR. Don't roll our own.
2. **Persistence location** — localStorage via SWR's `provider`. Same as before; the mechanism is library-provided.
3. **Freshness model** — Trigger-driven only. SWR configured with all auto-revalidation off; `mutate()` calls from RxJS streams in the engine.
4. **LCU connection pill** — Unchanged; `isValidating` drives the dots inside data sections.
5. **`src/lib/cache/` boundary** — None. SWR is the boundary. The 10-line provider lives at the app root.
6. **Decision log** — Renderer-side via `useSWR` with array keys. IPC stays in main as the source of truth.
7. **Hook init contract** — `useSWR` for cached fetches; `useBehaviorSubject` (built on `useSyncExternalStore`) for live streams. Two well-known shapes, no bespoke union.
8. **Local UI state** — Defer. Per-component `useLocalStorageState` if asked, on AugmentList filters and DataBrowser tab specifically. No store.
9. **Phased rollout** — see below.

## Home tab coverage matrix

The acceptance test for #129 is the Home tab rendering its full content from cache on cold launch. Element-by-element, here's where each piece lands:

| Element | Source | Phase | Cold-launch from cache |
|---|---|---|---|
| Last 7 days (W-L) | `useMatchHistory().windowStats` | 1 | ✓ |
| Avg KDA + total K/D/A | same `windowStats` | 1 | ✓ |
| Coaching moments + match count | `useDecisionLogQuery({ kind: "recent-games", n: 50 })` | 2 | ✓ |
| Connection pill | `useGameLifecycle()` (live; not cached) | 3 (tearing-safety) | n/a — live |
| Last game — visibility gate | flips to `meta.gameId !== null` (Phase 1+2 fix) | 1 | ✓ |
| Last game — champion / W-L / KDA / duration / mode | `useLastGameMeta()` (match-history priority) | 1 | ✓ |
| Last game — Q&A snippet | derived from decision-log `VoiceDecision` records (Phase 2 fix) | 2 | ✓ |
| Recent games × 5 | `useMatchHistory().recentGames(5)` | 1 | ✓ |
| OFFLINE_HINT gates | dropped — cached values render regardless of LCU state | 1 | ✓ |

The two **fix** entries in the matrix are renderer-side adjustments that ship with their respective phases — no new persistence boundary needed. The original first draft of this doc treated them as a Phase 4 snapshot-persistence concern; closer reading of the merge chain showed the data is already in match-history + decision log.

### LastGameBlock fix detail

Today: `IdleSurface` gates the block on `useLastGameSnapshot() !== null`, and `LastGameBlock` reads `snapshot.recentExchanges[0]` for the Q&A snippet. `lastGameSnapshot$` is in-memory only, so on cold launch the entire block disappears.

Phase 1 fix: visibility gate flips to `useLastGameMeta().gameId !== null`. The merged metadata supplies `gameId` from match-history (Phase 1) or the decision-log takeaway (Phase 2), so any prior session's last game keeps the block visible.

Phase 2 fix: Q&A snippet falls back to `summary.byKind.voice[0]` (most-recent voice decision) when `snapshot.recentExchanges` is empty. `VoiceDecision` records carry the same `question`/`answer` shape; the decision-log query already exposes them via `summarizeGame()`. `lastGameSnapshot$` itself stays unchanged — it's a pure session-level event source.

## Phased rollout

Each phase is independently shippable.

### Phase 1 — SWR + localStorage provider + match history

Add SWR. Configure `localStorageProvider`. Migrate `useMatchHistory` to `useSWR("match-history", fetcher)`. Wire `mutate("match-history")` into `MatchHistoryStore`'s existing LCU-credentials and `gameEnded$` subscriptions. Drop the `loading: true` initial state. Drop `lcuConnected` gates on IdleSurface stat-strip and recent-games rows. Flip the LastGameBlock visibility gate from `lastGame !== null` to `meta.gameId !== null`.

**User-visible win**: Home tab renders Last 7 Days / Avg KDA / Recent Games instantly on every launch from prior session, regardless of LCU state. The Last game block stays visible across restarts (champion, W-L, KDA, duration, mode all from cached match-history). When LCU connects, pulsing dots appear in the stat-strip until the refresh resolves. Tab-nav flash between Home and History is gone.

**Test surface**: SWR has its own integration tests. Our tests are at the `useMatchHistory` hook (render-with-cache, render-without-cache, mutate-triggers-revalidate) and at the IdleSurface (no `LoadingDots` on remount with cache; `LoadingDots` appear during a triggered refresh; LastGameBlock visible after restart with no snapshot).

### Phase 2 — Decision log via SWR

Migrate `useDecisionLogQuery` to `useSWR(["decision-log", query], fetcher)`. Wire `onDecisionLogUpdated` once at the app root to fan out `mutate(predicate)`. Update `LastGameBlock` to fall back to `summary.byKind.voice[0]` when `snapshot.recentExchanges` is empty.

**User-visible win**: Coaching Moments stat on Home and the entire PostGameSurface render instantly on every nav. Last game Q&A snippet renders from cache after restart, sourced from the decision log's voice records. Cold launch shows the most-recently-completed game's recap; the IPC fetch in the background updates only if records changed.

### Phase 3 — `useSyncExternalStore` migration for live-stream hooks

Add `useBehaviorSubject(subject)` helper. Migrate `useLastGameSnapshot`, `useGamePlan`, `useLcuConnected`, `useLiveGameState`, `useGameLifecycle`, `usePostGameReady`, `usePlayerBuildDirection`, `useCoachingFeed` to use it.

**User-visible win**: Tearing-safe under concurrent rendering. Smaller, more idiomatic hook bodies. No behavior change for callers.

### Phase 4 *(optional)* — localStorage persistence for live-stream subjects

If `lastGameSnapshot$`, `gamePlan$`, or `playerBuildDirection$` need to survive app restart, add a small `withLocalStoragePersistence(subject, key, validate)` operator (~20 LOC). Apply selectively. Don't apply uniformly — coaching feed for an in-flight game shouldn't survive a restart.

**Skip if**: SWR-cached match history + decision log already cover the surfaces. The takeaway records in the decision log are typically the right source for "what happened last game."

### Phase 5 *(optional)* — UI state persistence

Per-component `useLocalStorageState(key, default)` on AugmentList filters and DataBrowser active tab. ~15 LOC hook. No store.

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| Schema drift — saved cache shape changes between releases | `:v1` key suffix on the SWR cache. Bump on breaking changes; old cache is ignored, system starts cold, triggers populate. |
| Storage quota exceeded | `localStorageProvider`'s `persist()` swallows errors and degrades to in-memory. The cache is a *cache*; losing it is acceptable. |
| Stale data confusion (e.g. "Last 7 days: 8-2" from three days ago) | Phase 1 ships without a "stale since" annotation. If users complain, add a small `<time dateTime>` annotation as a follow-up. The cached value is correct *for the data we have*. |
| `useSWR` re-fires on remount despite `revalidateOnMount: false` | Verify behavior in Phase 1 tests. SWR's docs are explicit that `revalidateOnMount: false` + present cached `data` skips the fetch. If we hit edge cases, fall back to passing `fallbackData` from a one-off cache lookup. |
| RxJS subscriptions calling `mutate` outside a React tree | `mutate` is exported standalone from `swr` and works outside hooks. Verified. |
| `useSyncExternalStore` snapshot identity | The function passed as the third (snapshot) argument must return a stable reference for unchanged values. `BehaviorSubject.getValue()` returns the same reference until the next `next()` call, so this is satisfied automatically. |
| Cache poisoning from a corrupt write | `localStorageProvider` wraps JSON parsing in try/catch; corrupt cache → start with empty `Map`. |

## Rejected alternatives

- **Custom `CachedSubject<T>` + `DecisionLogCache` + `useCachedSubject`** *(this doc's own first draft)* — reinvents SWR. Larger LOC, no battle-testing, no devtools, requires ad-hoc training for new contributors. Replaced by SWR.
- **TanStack Query.** Same problem space, more powerful (devtools, infinite queries, mutations with optimistic UI). 13KB vs SWR's 4.5KB. For Champ Sage's ~6 cache entries, the additional features don't earn their weight, and the simpler `data + isValidating` shape SWR exposes is a better fit for the trigger-driven model.
- **Apollo / RTK Query / Relay.** Designed for normalized entity caches over GraphQL or REST collections. Champ Sage has snapshot-shaped data, not entities. Wrong shape.
- **Jotai `atomWithStorage` / Zustand `persist`.** Sync-hydrating localStorage atoms — appealing for single values, but no stale-while-revalidate semantics and no fetcher dedup. Would need to rebuild SWR on top.
- **Main-process electron-store for the cache.** Async-only at the IPC boundary; would force at least one render cycle without cached data on cold launch. Defeats the point.
- **React 19 `use()` + Suspense + native cache.** Suspense flips control to React's scheduler; pairing it with long-lived RxJS streams requires bridge layers we'd otherwise avoid. Compelling for new greenfield apps, not a fit retrofitting an existing engine layer.
- **Lift surfaces to never-unmount via display:none.** User explicitly vetoed. Also doesn't fix cold-launch flash, only nav flash.

## Prior art

This design is "**SWR for the cached-fetch surface, RxJS+`useSyncExternalStore` for the live-stream surface**." The split is the same one used by every React app that combines server state with WebSocket/EventSource feeds. Reference patterns: SWR's official docs on `provider` and `mutate`, React's official `useSyncExternalStore` guidance for external store integration, and the long-standing community pattern of treating live event streams and cached fetches as separate primitives.

## Test surface

Tests cross the interface.

- **`localStorageProvider`** — small unit test: hydrate from a populated key, persist on `set`, swallow quota errors.
- **`useSWR`-wrapped hooks** (`useMatchHistory`, `useDecisionLogQuery`) — integration tests with SWR's test utilities. Assert: cached value renders on first render with `isLoading: false`; `mutate(key)` triggers revalidation; failed fetcher leaves cached value intact and surfaces error.
- **`useBehaviorSubject`** — single test: returns initial `getValue()` synchronously; updates on `next()`.
- **`MatchHistoryStore`** existing tests — unchanged in spirit; the store's external interface narrows to a `fetchMatches()` method, which is easier to test than a `BehaviorSubject` lifecycle.
- **Surface tests** (IdleSurface, PostGameSurface) — interaction tests asserting no `<LoadingDots />` on a remount with hydrated cache; dots appear during a triggered revalidation.

Tests assert on observable outcomes through the public interface, not SWR internals or BehaviorSubject internals.

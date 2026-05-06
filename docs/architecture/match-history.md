# Match History — Architecture Notes

Architect-deep output for Phase 5c (match-history aggregation). Captures the module shape, the dependencies, and the deferrals so the next commit doesn't relitigate them.

## Pre-deletion candidates

### Surviving

1. **`match-history` module** — unified module owning LCU fetch + parse + reactive store. Without it, every consumer (IdleSurface today; post-game and per-champion later) would handle puuid resolution, raw LCU schema, champion-id-to-name mapping, and fetch lifecycle. Concentrates.
2. **Pure aggregator functions** — `windowStats(matches, opts)`, `recentGames(matches, n)`, future `perChampion(matches)`. Exported alongside types; same shape as `summarizeGame` for the decision log.
3. **`useMatchHistory` hook** — renderer convenience. Without it, every consuming surface manages its own subscription + state.

### Dropped

- **Separate fetcher / parser modules.** Folded into the match-history module. Two modules with one consumer each is indirection, not a seam. Single cohesive module mirrors `engine.ts`.
- **Disk persistence.** LCU fetch is ~50ms for 20 matches; persistence adds a storage adapter + hydrate + serialization for negligible value. Single-machine, single-user, near-zero offline use case. In-memory only.
- **Decision-log joiner.** The IdleSurface's "coach interventions" stat needs only **total decisions in the last N days**, which is a flat decision-log time-window query. No per-match alignment required for v1. Punt the joiner until a consumer needs per-match counts.
- **Synthetic-vs-Riot gameId reconciliation.** Same reason — only matters for per-match joining. Deferred.

## Dependency categories

- **LCU access** → existing `PlatformBridge.fetchLcu`. Category 2 (local-substitutable). Port already exists at the bridge; this module consumes it. No new port.
- **DDragon champion data** → `gameData.champions` (in-process, already in renderer state). Category 1.
- **Clock** → `Date.now`, injectable for windowed-stats tests. Category 1.
- **LCU lifecycle signals** → consume existing engine subjects (`liveGameState$.eogStats` change, `gameflowPhase$`). Category 1 in-process subscriptions.

No new external port at this module's interface — all dependencies are consumed via existing seams.

## Module shape

```
src/lib/match-history/
  ├── types.ts       — MatchSummary, WindowStats, RecentGameRow
  ├── aggregate.ts   — pure: windowStats(), recentGames()
  ├── parse.ts       — pure: lcuMatchToSummary(raw, gameData)
  └── store.ts       — createMatchHistoryStore({ bridge, gameData$, lcuReady$ })
                       returns { matches$, error$, refresh() }
src/hooks/useMatchHistory.ts
```

All renderer-side. No `electron/match-history/` (unlike decision log) — LCU is already proxied through bridge IPC.

## Interface

- **`createMatchHistoryStore(deps)`** — single entry. Takes the existing bridge + game-data observable + LCU-ready signal. Returns:
  - `matches$: Observable<MatchSummary[]>` — BehaviorSubject under the hood; replays the last-known list to new subscribers.
  - `error$: Observable<Error | null>` — last fetch error, cleared on success.
  - `refresh(): void` — manual re-fetch trigger.
- Auto-fetches on LCU-ready transition and on `eogStats` arrival.
- **Pure aggregators** — clock-free. `windowStats(matches, { days, now })` returns `{ wins, losses, totalGames, avgKDA }`. `recentGames(matches, n)` returns the first N sorted by `gameCreation` desc.
- **`useMatchHistory()` hook** — singleton store; hook subscribes; returns `{ matches, loading, error, refresh, windowStats(opts), recentGames(n) }`. Stat helpers are memoized convenience.

## Leverage / locality

- **Leverage:** IdleSurface stat strip = three lines (`const { wins, losses, avgKDA } = useMatchHistory().windowStats({ days: 7 })`). Recent games list = one line. Future per-champion stat lands as a new pure function alongside, no module changes. Future post-game tab can pull the row for the just-ended game from the same store.
- **Locality:** LCU schema in `parse.ts`. Re-fetch policy in `store.ts`. Summarization math in `aggregate.ts`. Tests cross the seam at the store (with a faked bridge) for reactive paths and at the pure functions for the math.

## Decisions to lock in

1. **Module home:** all renderer-side under `src/lib/match-history/`.
2. **Refresh triggers:** on LCU connect, on `eogStats` arrival, on manual `refresh()`. No periodic polling.
3. **Window defaults:** 7 days for stat strip; 20 for recent-games list. Configurable per call.
4. **gameId mismatch / per-match join:** deferred. The recent-games row shows match data only, no per-match coach count. The "Coach interventions" stat is the global decision-log count over the same window.

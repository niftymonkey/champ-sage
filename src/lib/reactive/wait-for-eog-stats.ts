/**
 * Resolve the first non-null `eogStats` emission on a `liveGameState$`
 * stream, or `null` after a timeout.
 *
 * Why this exists: the LCU emits `/lol-end-of-game/v1/eog-stats-block`
 * a few hundred milliseconds AFTER `activePlayer` becomes null at game
 * end. The post-game-takeaway pipeline (and the last-game snapshot
 * capture) need the authoritative `result` from the eog payload — using
 * the synchronous `liveGameState.eogStats` at the activePlayer-null
 * transition reads as `null` and stamps every match as a defeat.
 *
 * Pulled out of the React component so the timing logic can be tested
 * with deterministic streams + fake timers instead of a renderer.
 */

import { Observable, filter, map, race, take, timer } from "rxjs";
import type { EogStats, LiveGameState } from "./types";

export interface WaitForEogStatsOptions {
  /** Milliseconds to wait before resolving to `null`. Default 10_000. */
  readonly timeoutMs?: number;
}

export function waitForEogStats(
  liveGameState$: Observable<LiveGameState>,
  options: WaitForEogStatsOptions = {}
): Observable<EogStats | null> {
  const timeoutMs = options.timeoutMs ?? 10_000;
  return race(
    liveGameState$.pipe(
      map((s) => s.eogStats),
      filter((eog): eog is EogStats => eog !== null),
      take(1)
    ),
    timer(timeoutMs).pipe(map(() => null))
  );
}

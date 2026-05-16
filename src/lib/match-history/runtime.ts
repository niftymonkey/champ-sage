import { BehaviorSubject } from "rxjs";
import type { LoadedGameData } from "../data-ingest";
import { gameEnded$, lcuCredentials$, lcuReady$ } from "../reactive";
import { createElectronBridge } from "../reactive/electron-bridge";
import { invalidateKey } from "../cache/swr-bridge";
import { createMatchHistoryStore, type MatchHistoryStore } from "./store";

/** SWR cache key for the match-history list. Shared with `useMatchHistory`. */
export const MATCH_HISTORY_KEY = "match-history";

/**
 * Process-wide singleton for match-history. Initialized once at app
 * startup with the loaded game data; the hook reads from it.
 *
 * Game data flows in through `setMatchHistoryGameData` rather than the
 * store taking it as a constructor parameter — DDragon loads
 * asynchronously after the store starts, so a Subject is the right
 * shape for "the latest data we know about."
 */
const gameData$ = new BehaviorSubject<LoadedGameData | null>(null);
let store: MatchHistoryStore | null = null;

export function setMatchHistoryGameData(data: LoadedGameData | null): void {
  gameData$.next(data);
}

export function getMatchHistoryStore(): MatchHistoryStore {
  if (store === null) {
    store = createMatchHistoryStore({
      bridge: createElectronBridge(),
      gameData$,
      lcuCredentials$,
      lcuReady$,
      gameEnded$,
      invalidate: () => invalidateKey(MATCH_HISTORY_KEY),
    });
  }
  return store;
}

/** Test-only — drop the singleton so the next getter rebuilds it. */
export function __resetMatchHistoryRuntimeForTesting(): void {
  if (store) {
    store.dispose();
    store = null;
  }
  gameData$.next(null);
}

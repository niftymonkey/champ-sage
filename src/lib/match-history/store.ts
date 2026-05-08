import { BehaviorSubject, Observable, Subject, Subscription } from "rxjs";
import type { PlatformBridge } from "../reactive/platform-bridge";
import type { LoadedGameData } from "../data-ingest";
import { lcuMatchToSummary } from "./parse";
import type { MatchSummary } from "./types";

export interface MatchHistoryStoreInputs {
  /** Platform IPC bridge — provides LCU credentials + fetch. */
  bridge: PlatformBridge;
  /** Renderer-side game data; needed to resolve championId → name. */
  gameData$: Observable<LoadedGameData | null>;
  /**
   * Fires when LCU credentials are first available (or change). The store
   * uses this to know when to (re)fetch. Pass an Observable that emits
   * the latest credentials, or undefined / null when LCU is offline.
   */
  lcuCredentials$: Observable<{ port: number; token: string } | null>;
  /**
   * Fires when a game has just ended (eogStats arrived). The store
   * refreshes match-history shortly after so the new game appears.
   */
  gameEnded$: Observable<void>;
}

export interface MatchHistoryStoreOptions {
  /** How many matches to fetch per refresh. Default 20. */
  pageSize?: number;
}

export interface MatchHistoryStore {
  matches$: Observable<MatchSummary[]>;
  error$: Observable<Error | null>;
  refresh(): void;
  dispose(): void;
}

const DEFAULT_PAGE_SIZE = 100;

/**
 * Reactive match-history store. Holds the most recent N matches in
 * memory and refreshes them on:
 *   - LCU credentials becoming available (initial load + reconnect)
 *   - `gameEnded$` firing (a new match just hit the player's history)
 *   - Manual `refresh()` calls (debug button, future settings affordance)
 *
 * The store does not persist to disk — LCU is fast and almost always
 * up while Champ Sage runs alongside the game client. If the LCU is
 * offline, `matches$` keeps the last-known list and `error$` reports
 * the failure.
 */
export function createMatchHistoryStore(
  inputs: MatchHistoryStoreInputs,
  options: MatchHistoryStoreOptions = {}
): MatchHistoryStore {
  const pageSize = options.pageSize ?? DEFAULT_PAGE_SIZE;
  const matches$ = new BehaviorSubject<MatchSummary[]>([]);
  const error$ = new BehaviorSubject<Error | null>(null);
  const refresh$ = new Subject<void>();

  let creds: { port: number; token: string } | null = null;
  let gameData: LoadedGameData | null = null;
  let puuid: string | null = null;
  let inFlight = false;
  let pendingRefresh = false;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let retryAttempt = 0;

  const subs = new Subscription();

  // The LCU lockfile appears a few seconds before the HTTPS server is
  // ready to accept connections. We get credentials immediately on
  // discovery and the first fetch reliably fails with ECONNREFUSED.
  // Retry on transient connection failures with exponential backoff
  // until the server is up; bail on permanent errors (auth, malformed
  // payload) since those won't fix themselves.
  const TRANSIENT =
    /ECONNREFUSED|CONNECTION_FAILED|fetch failed|ENOTFOUND|ETIMEDOUT/i;
  const RETRY_DELAYS_MS = [2_000, 4_000, 8_000, 16_000, 30_000];

  const cancelRetry = (): void => {
    if (retryTimer !== null) {
      clearTimeout(retryTimer);
      retryTimer = null;
    }
    retryAttempt = 0;
  };

  const scheduleRetry = (): void => {
    if (creds === null) return;
    if (retryAttempt >= RETRY_DELAYS_MS.length) return;
    const delay = RETRY_DELAYS_MS[retryAttempt];
    retryAttempt += 1;
    retryTimer = setTimeout(() => {
      retryTimer = null;
      if (creds !== null) runFetch();
    }, delay);
  };

  const fetchPuuid = async (): Promise<string> => {
    if (puuid) return puuid;
    // Snapshot creds before any await — `lcuCredentials$` can null it
    // out mid-fetch on disconnect, and the next dereference would NPE.
    const c = creds;
    if (!c) throw new Error("LCU credentials unavailable");
    const raw = await inputs.bridge.fetchLcu(
      c.port,
      c.token,
      "/lol-summoner/v1/current-summoner"
    );
    const parsed = JSON.parse(raw) as { puuid?: string };
    if (typeof parsed?.puuid !== "string" || parsed.puuid.length === 0) {
      throw new Error("Current-summoner payload missing puuid");
    }
    puuid = parsed.puuid;
    return puuid;
  };

  const resolveChampionName = (championId: number): string | null => {
    if (!gameData) return null;
    for (const c of gameData.champions.values()) {
      if (c.key === championId) return c.name;
    }
    return null;
  };

  const resolveItemName = (itemId: number): string | null => {
    if (!gameData) return null;
    return gameData.items.get(itemId)?.name ?? null;
  };

  const doFetch = async (): Promise<void> => {
    // Snapshot creds before any await; same TOCTOU reasoning as above.
    const c = creds;
    if (!c) {
      error$.next(new Error("LCU credentials unavailable"));
      return;
    }
    const summonerPuuid = await fetchPuuid();
    const endpoint = `/lol-match-history/v1/products/lol/${summonerPuuid}/matches?begIndex=0&endIndex=${pageSize - 1}`;
    const raw = await inputs.bridge.fetchLcu(c.port, c.token, endpoint);
    const parsed = JSON.parse(raw) as {
      games?: { games?: unknown[] };
    };
    const rawGames = parsed?.games?.games ?? [];
    const summaries: MatchSummary[] = [];
    for (const g of rawGames) {
      const m = lcuMatchToSummary(g, resolveChampionName, resolveItemName);
      if (m !== null) summaries.push(m);
    }
    summaries.sort((a, b) => b.gameCreation - a.gameCreation);
    matches$.next(summaries);
    error$.next(null);
  };

  const runFetch = (): void => {
    if (inFlight) {
      pendingRefresh = true;
      return;
    }
    inFlight = true;
    doFetch()
      .then(() => {
        cancelRetry();
      })
      .catch((err: unknown) => {
        const e = err instanceof Error ? err : new Error(String(err));
        error$.next(e);
        if (TRANSIENT.test(e.message)) {
          scheduleRetry();
        } else {
          cancelRetry();
        }
      })
      .finally(() => {
        inFlight = false;
        if (pendingRefresh) {
          pendingRefresh = false;
          runFetch();
        }
      });
  };

  subs.add(
    inputs.lcuCredentials$.subscribe((next) => {
      const wasOffline = creds === null;
      creds = next;
      if (creds === null) {
        // LCU went away — keep last-known matches, just stop trying.
        puuid = null;
        cancelRetry();
        return;
      }
      if (wasOffline) runFetch();
    })
  );

  subs.add(
    inputs.gameData$.subscribe((next) => {
      const wasMissing = gameData === null;
      gameData = next;
      // If matches were already fetched without DDragon data (e.g. the
      // LCU connected before DDragon finished loading), every row will
      // have fallen back to "Champion <id>". Re-fetch once data lands so
      // those rows resolve to real champion names.
      if (wasMissing && gameData !== null && creds !== null) {
        runFetch();
      }
    })
  );

  subs.add(
    inputs.gameEnded$.subscribe(() => {
      if (creds) runFetch();
    })
  );

  subs.add(
    refresh$.subscribe(() => {
      if (creds) runFetch();
    })
  );

  return {
    matches$: matches$.asObservable(),
    error$: error$.asObservable(),
    refresh: () => refresh$.next(),
    dispose: () => {
      cancelRetry();
      subs.unsubscribe();
      matches$.complete();
      error$.complete();
      refresh$.complete();
    },
  };
}

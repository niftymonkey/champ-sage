import { Observable, Subscription } from "rxjs";
import type { PlatformBridge } from "../reactive/platform-bridge";
import type { LoadedGameData } from "../data-ingest";
import { getLogger } from "../logger";
import { lcuMatchToSummary } from "./parse";
import type { MatchSummary } from "./types";

const log = getLogger("match-history");

export interface MatchHistoryStoreInputs {
  /** Platform IPC bridge — provides LCU credentials + fetch. */
  bridge: PlatformBridge;
  /** Renderer-side game data; needed to resolve championId → name. */
  gameData$: Observable<LoadedGameData | null>;
  /**
   * Latest LCU credentials, or null when no LCU is discovered. The store
   * captures these for use inside the fetcher; it does NOT use them as
   * the invalidation trigger (the lockfile appears several seconds before
   * the LCU's HTTPS server is bound, so credentials-based fetches reliably
   * fail with ECONNREFUSED). Use `lcuReady$` for that.
   */
  lcuCredentials$: Observable<{ port: number; token: string } | null>;
  /**
   * `true` when the LCU's HTTPS server is actually accepting connections
   * (signaled by the engine's WebSocket having connected). Drives the
   * invalidation trigger — the store fires `invalidate()` only when this
   * flips to `true`, so the SWR-driven fetch lands on a server that's
   * ready to respond.
   */
  lcuReady$: Observable<boolean>;
  /**
   * Fires when a game has just ended (eogStats arrived). The store
   * refreshes match-history shortly after so the new game appears.
   */
  gameEnded$: Observable<void>;
  /**
   * Called whenever a real upstream change means the SWR cache for
   * "match-history" should be revalidated. Production wires this to
   * `mutate("match-history")`; tests pass a spy. The store itself never
   * holds the matches in memory — SWR owns that.
   */
  invalidate: () => void;
}

export interface MatchHistoryStoreOptions {
  /** How many matches to fetch per refresh. Default 100. */
  pageSize?: number;
}

export interface MatchHistoryStore {
  /**
   * One-shot fetch that resolves to the parsed match summaries or rejects
   * on permanent errors. Internally retries on transient connection
   * failures (LCU HTTPS server not yet bound). The single fetch path SWR
   * calls.
   */
  fetchMatches(): Promise<MatchSummary[]>;
  dispose(): void;
}

const DEFAULT_PAGE_SIZE = 100;

/**
 * Match-history store. Owns the LCU fetch + parse + retry logic, and
 * fires `invalidate()` whenever upstream signals (LCU connect, game-end)
 * mean SWR's cache for "match-history" should be revalidated. The cache
 * itself lives in SWR; this store is stateless from the renderer's POV.
 */
export function createMatchHistoryStore(
  inputs: MatchHistoryStoreInputs,
  options: MatchHistoryStoreOptions = {}
): MatchHistoryStore {
  const pageSize = options.pageSize ?? DEFAULT_PAGE_SIZE;

  let creds: { port: number; token: string } | null = null;
  let gameData: LoadedGameData | null = null;
  let puuid: string | null = null;

  const subs = new Subscription();

  const fetchPuuid = async (): Promise<string> => {
    if (puuid) return puuid;
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

  const fetchMatches = async (): Promise<MatchSummary[]> => {
    const c = creds;
    if (!c) throw new Error("LCU credentials unavailable");
    const summonerPuuid = await fetchPuuid();
    const endpoint = `/lol-match-history/v1/products/lol/${summonerPuuid}/matches?begIndex=0&endIndex=${pageSize - 1}`;
    const raw = await inputs.bridge.fetchLcu(c.port, c.token, endpoint);
    const parsed = JSON.parse(raw) as { games?: { games?: unknown[] } };
    const rawGames = parsed?.games?.games ?? [];
    const summaries: MatchSummary[] = [];
    for (const g of rawGames) {
      const m = lcuMatchToSummary(g, resolveChampionName, resolveItemName);
      if (m !== null) summaries.push(m);
    }
    summaries.sort((a, b) => b.gameCreation - a.gameCreation);
    const top = summaries[0];
    log.debug(
      top
        ? `fetchMatches success — ${summaries.length} matches; top: ${top.championName} (gameId=${top.gameId})`
        : `fetchMatches success — 0 matches`
    );
    return summaries;
  };

  // Capture creds for the fetcher's use, but DON'T trigger invalidation
  // here — the credentials BehaviorSubject fires on lockfile discovery,
  // several seconds before the LCU's HTTPS server is bound. Invalidation
  // is driven by `lcuReady$` below, which fires only after the WebSocket
  // has connected (the same moment HTTP requests succeed).
  subs.add(
    inputs.lcuCredentials$.subscribe((next) => {
      // Drop the cached puuid whenever credentials change at all — not
      // only on a `null` (disconnect). A client restart rotates the
      // port+token, and a different summoner may have logged in; if
      // discovery never emits an intermediate `null`, a stale puuid
      // would otherwise point the next fetch at the wrong account.
      const rotated =
        next?.port !== creds?.port || next?.token !== creds?.token;
      creds = next;
      if (creds === null || rotated) {
        puuid = null;
      }
    })
  );

  let wasReady = false;
  subs.add(
    inputs.lcuReady$.subscribe((ready) => {
      const becameReady = ready && !wasReady;
      wasReady = ready;
      if (becameReady) {
        log.debug("LCU HTTPS ready — invalidating match-history");
        inputs.invalidate();
      }
    })
  );

  subs.add(
    inputs.gameData$.subscribe((next) => {
      const wasMissing = gameData === null;
      gameData = next;
      // If matches were already fetched without DDragon data (e.g. the
      // LCU connected before DDragon finished loading), every row will
      // have fallen back to "Champion <id>". Invalidate once data lands
      // so SWR re-fetches and the rows resolve to real names.
      if (wasMissing && gameData !== null && creds !== null) {
        inputs.invalidate();
      }
    })
  );

  subs.add(
    inputs.gameEnded$.subscribe(() => {
      if (creds !== null) inputs.invalidate();
    })
  );

  return {
    fetchMatches,
    dispose: () => {
      subs.unsubscribe();
    },
  };
}

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { BehaviorSubject, Subject } from "rxjs";
import { createMatchHistoryStore } from "./store";
import type { PlatformBridge } from "../reactive/platform-bridge";
import type { LoadedGameData } from "../data-ingest";

// Minimal LoadedGameData shape — only the champions Map is read by the store.
function makeGameData(): LoadedGameData {
  return {
    version: "test",
    champions: new Map([
      ["lux", { id: "Lux", key: 99, name: "Lux" }],
      ["ashe", { id: "Ashe", key: 22, name: "Ashe" }],
    ]),
    items: new Map(),
    runes: [],
    augments: new Map(),
    augmentSets: [],
    dictionary: {
      allNames: [],
      champions: [],
      items: [],
      augments: [],
      search: () => [],
    },
  } as unknown as LoadedGameData;
}

const matchPayload = {
  gameId: 5554483510,
  gameMode: "ARAM",
  queueId: 450,
  gameDuration: 1634,
  gameCreation: 1_700_000_000_000,
  participants: [
    {
      championId: 99,
      stats: {
        win: true,
        kills: 12,
        deaths: 4,
        assists: 18,
        largestKillingSpree: 3,
      },
    },
  ],
};

function fakeBridge(
  fetchLcuImpl?: (
    port: number,
    token: string,
    endpoint: string
  ) => Promise<string>
): PlatformBridge {
  return {
    discoverLcu: vi.fn(),
    fetchLcu: fetchLcuImpl ?? vi.fn(),
    fetchRiotApi: vi.fn(),
    setSummonerSpells: vi.fn(),
    connectLcuWebSocket: vi.fn(),
    listenLcuEvent: vi.fn(() => () => {}),
    listenLcuDisconnect: vi.fn(() => () => {}),
  };
}

interface Harness {
  bridge: PlatformBridge;
  gameData$: BehaviorSubject<LoadedGameData | null>;
  lcuCredentials$: BehaviorSubject<{ port: number; token: string } | null>;
  lcuReady$: BehaviorSubject<boolean>;
  gameEnded$: Subject<void>;
  invalidate: ReturnType<typeof vi.fn<() => void>>;
}

function makeHarness(bridge: PlatformBridge): Harness {
  return {
    bridge,
    gameData$: new BehaviorSubject<LoadedGameData | null>(makeGameData()),
    lcuCredentials$: new BehaviorSubject<{
      port: number;
      token: string;
    } | null>(null),
    lcuReady$: new BehaviorSubject<boolean>(false),
    gameEnded$: new Subject<void>(),
    invalidate: vi.fn<() => void>(),
  };
}

describe("createMatchHistoryStore", () => {
  let harness: Harness;

  beforeEach(() => {
    harness = makeHarness(fakeBridge());
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("fetchMatches", () => {
    it("returns parsed match summaries on success", async () => {
      const fetchLcu = vi.fn(async (_p, _t, endpoint: string) => {
        if (endpoint === "/lol-summoner/v1/current-summoner") {
          return JSON.stringify({ puuid: "puuid-x" });
        }
        if (endpoint.startsWith("/lol-match-history")) {
          return JSON.stringify({ games: { games: [matchPayload] } });
        }
        throw new Error(`unexpected endpoint: ${endpoint}`);
      });
      const harness = makeHarness(fakeBridge(fetchLcu));
      const store = createMatchHistoryStore(harness);
      harness.lcuCredentials$.next({ port: 1234, token: "tok" });

      const matches = await store.fetchMatches();
      expect(matches).toHaveLength(1);
      expect(matches[0].championName).toBe("Lux");
      expect(matches[0].gameId).toBe("5554483510");

      store.dispose();
    });

    it("rejects with a useful error when LCU credentials are unavailable", async () => {
      const store = createMatchHistoryStore(harness);

      await expect(store.fetchMatches()).rejects.toThrow(/credentials/i);

      store.dispose();
    });

    it("caches puuid across calls (single summoner lookup per session)", async () => {
      let summonerCalls = 0;
      const fetchLcu = vi.fn(async (_p, _t, endpoint: string) => {
        if (endpoint === "/lol-summoner/v1/current-summoner") {
          summonerCalls += 1;
          return JSON.stringify({ puuid: "puuid-x" });
        }
        return JSON.stringify({ games: { games: [] } });
      });
      const harness = makeHarness(fakeBridge(fetchLcu));
      const store = createMatchHistoryStore(harness);
      harness.lcuCredentials$.next({ port: 1234, token: "tok" });

      await store.fetchMatches();
      await store.fetchMatches();
      await store.fetchMatches();

      expect(summonerCalls).toBe(1);

      store.dispose();
    });

    it("rejects on connection failures without retrying (lcuReady$ gates invocation)", async () => {
      // Retry inside the fetcher is removed: invalidation is driven by
      // `lcuReady$` (HTTPS-ready signal), so the fetcher should only run
      // when the server is actually accepting connections. If a fetch
      // does fail transiently, SWR sees the error; the next `lcuReady$`
      // flip drives a fresh invocation.
      const fetchLcu = vi.fn(async () => {
        throw new Error(
          "CONNECTION_FAILED:connect ECONNREFUSED 127.0.0.1:1234"
        );
      });
      const harness = makeHarness(fakeBridge(fetchLcu));
      const store = createMatchHistoryStore(harness);
      harness.lcuCredentials$.next({ port: 1234, token: "tok" });

      await expect(store.fetchMatches()).rejects.toThrow(/ECONNREFUSED/);
      expect(fetchLcu).toHaveBeenCalledTimes(1);

      store.dispose();
    });

    it("rejects on permanent errors (e.g. malformed payload)", async () => {
      const fetchLcu = vi.fn(async () => "not-json");
      const harness = makeHarness(fakeBridge(fetchLcu));
      const store = createMatchHistoryStore(harness);
      harness.lcuCredentials$.next({ port: 1234, token: "tok" });

      await expect(store.fetchMatches()).rejects.toThrow();
      expect(fetchLcu).toHaveBeenCalledTimes(1);

      store.dispose();
    });
  });

  describe("invalidation triggers", () => {
    it("invalidates when lcuReady$ flips true (HTTPS server accepting connections)", () => {
      const store = createMatchHistoryStore(harness);
      // Credentials arriving alone should NOT trigger invalidation —
      // the lockfile fires several seconds before the HTTPS server is
      // bound, and a fetch at that moment reliably fails with ECONNREFUSED.
      harness.lcuCredentials$.next({ port: 1234, token: "tok" });
      expect(harness.invalidate).not.toHaveBeenCalled();

      harness.lcuReady$.next(true);
      expect(harness.invalidate).toHaveBeenCalledTimes(1);

      store.dispose();
    });

    it("invalidates on gameEnded$ when LCU credentials are present", () => {
      const store = createMatchHistoryStore(harness);
      harness.lcuCredentials$.next({ port: 1234, token: "tok" });
      harness.lcuReady$.next(true);
      const callsAfterReady = harness.invalidate.mock.calls.length;

      harness.gameEnded$.next();

      expect(harness.invalidate.mock.calls.length).toBe(callsAfterReady + 1);

      store.dispose();
    });

    it("does not invalidate on gameEnded$ when LCU is offline", () => {
      const store = createMatchHistoryStore(harness);
      // No credentials → gameEnded should not trigger a fetch.
      harness.gameEnded$.next();

      expect(harness.invalidate).not.toHaveBeenCalled();

      store.dispose();
    });

    it("re-invalidates on reconnect after lcuReady$ cycles", () => {
      const store = createMatchHistoryStore(harness);
      harness.lcuCredentials$.next({ port: 1234, token: "tok" });
      harness.lcuReady$.next(true);
      harness.lcuReady$.next(false);
      const callsBeforeReconnect = harness.invalidate.mock.calls.length;

      harness.lcuReady$.next(true);

      expect(harness.invalidate.mock.calls.length).toBeGreaterThan(
        callsBeforeReconnect
      );

      store.dispose();
    });
  });
});

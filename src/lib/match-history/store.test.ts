import { describe, it, expect, beforeEach, vi } from "vitest";
import { BehaviorSubject, firstValueFrom, Subject, take } from "rxjs";
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
    connectLcuWebSocket: vi.fn(),
    listenLcuEvent: vi.fn(() => () => {}),
    listenLcuDisconnect: vi.fn(() => () => {}),
  };
}

interface Harness {
  bridge: PlatformBridge;
  gameData$: BehaviorSubject<LoadedGameData | null>;
  lcuCredentials$: BehaviorSubject<{ port: number; token: string } | null>;
  gameEnded$: Subject<void>;
}

function makeHarness(bridge: PlatformBridge): Harness {
  return {
    bridge,
    gameData$: new BehaviorSubject<LoadedGameData | null>(makeGameData()),
    lcuCredentials$: new BehaviorSubject<{
      port: number;
      token: string;
    } | null>(null),
    gameEnded$: new Subject<void>(),
  };
}

describe("createMatchHistoryStore", () => {
  let harness: Harness;

  beforeEach(() => {
    harness = makeHarness(fakeBridge());
  });

  it("starts with empty matches and no error", async () => {
    const store = createMatchHistoryStore(harness);
    const matches = await firstValueFrom(store.matches$);
    expect(matches).toEqual([]);
    const error = await firstValueFrom(store.error$);
    expect(error).toBeNull();
    store.dispose();
  });

  it("fetches matches when LCU credentials become available", async () => {
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

    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    const matches = await firstValueFrom(store.matches$.pipe(take(1)));
    expect(matches).toHaveLength(1);
    expect(matches[0].championName).toBe("Lux");
    expect(matches[0].gameId).toBe("5554483510");
    store.dispose();
  });

  it("re-fetches on gameEnded$", async () => {
    let callCount = 0;
    const fetchLcu = vi.fn(async (_p, _t, endpoint: string) => {
      if (endpoint === "/lol-summoner/v1/current-summoner") {
        return JSON.stringify({ puuid: "puuid-x" });
      }
      callCount += 1;
      return JSON.stringify({ games: { games: [matchPayload] } });
    });
    const harness = makeHarness(fakeBridge(fetchLcu));
    const store = createMatchHistoryStore(harness);
    harness.lcuCredentials$.next({ port: 1234, token: "tok" });
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
    expect(callCount).toBe(1);

    harness.gameEnded$.next();
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
    expect(callCount).toBe(2);
    store.dispose();
  });

  it("emits an error when fetchLcu rejects and keeps last-known matches", async () => {
    let phase = 0;
    const fetchLcu = vi.fn(async (_p, _t, endpoint: string) => {
      if (endpoint === "/lol-summoner/v1/current-summoner") {
        return JSON.stringify({ puuid: "puuid-x" });
      }
      phase += 1;
      if (phase === 1) {
        return JSON.stringify({ games: { games: [matchPayload] } });
      }
      throw new Error("boom");
    });
    const harness = makeHarness(fakeBridge(fetchLcu));
    const store = createMatchHistoryStore(harness);
    harness.lcuCredentials$.next({ port: 1234, token: "tok" });
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    harness.gameEnded$.next();
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    const error = await firstValueFrom(store.error$.pipe(take(1)));
    expect(error?.message).toBe("boom");
    const matches = await firstValueFrom(store.matches$.pipe(take(1)));
    expect(matches).toHaveLength(1); // last-known preserved
    store.dispose();
  });

  it("manual refresh triggers a fetch", async () => {
    let callCount = 0;
    const fetchLcu = vi.fn(async (_p, _t, endpoint: string) => {
      if (endpoint === "/lol-summoner/v1/current-summoner") {
        return JSON.stringify({ puuid: "puuid-x" });
      }
      callCount += 1;
      return JSON.stringify({ games: { games: [] } });
    });
    const harness = makeHarness(fakeBridge(fetchLcu));
    const store = createMatchHistoryStore(harness);
    harness.lcuCredentials$.next({ port: 1234, token: "tok" });
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
    expect(callCount).toBe(1);

    store.refresh();
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
    expect(callCount).toBe(2);
    store.dispose();
  });

  it("retries on connection-refused failures until the LCU HTTPS server binds", async () => {
    vi.useFakeTimers();
    let attempts = 0;
    const fetchLcu = vi.fn(async (_p, _t, endpoint: string) => {
      if (endpoint === "/lol-summoner/v1/current-summoner") {
        attempts += 1;
        if (attempts < 3) {
          throw new Error(
            "CONNECTION_FAILED:connect ECONNREFUSED 127.0.0.1:1234"
          );
        }
        return JSON.stringify({ puuid: "puuid-x" });
      }
      return JSON.stringify({ games: { games: [matchPayload] } });
    });
    const harness = makeHarness(fakeBridge(fetchLcu));
    const store = createMatchHistoryStore(harness);
    harness.lcuCredentials$.next({ port: 1234, token: "tok" });

    // First attempt fails immediately.
    await vi.advanceTimersByTimeAsync(0);
    expect(attempts).toBe(1);

    // Second attempt fires after the first backoff, also fails.
    await vi.advanceTimersByTimeAsync(2_000);
    expect(attempts).toBe(2);

    // Third attempt succeeds.
    await vi.advanceTimersByTimeAsync(4_000);
    expect(attempts).toBeGreaterThanOrEqual(3);

    const matches = await firstValueFrom(store.matches$.pipe(take(1)));
    expect(matches).toHaveLength(1);
    vi.useRealTimers();
    store.dispose();
  });

  it("stops retrying when credentials clear", async () => {
    vi.useFakeTimers();
    const fetchLcu = vi.fn(async () => {
      throw new Error("CONNECTION_FAILED:connect ECONNREFUSED 127.0.0.1:1234");
    });
    const harness = makeHarness(fakeBridge(fetchLcu));
    const store = createMatchHistoryStore(harness);
    harness.lcuCredentials$.next({ port: 1234, token: "tok" });
    await vi.advanceTimersByTimeAsync(0);

    const callsAfterFirstFail = fetchLcu.mock.calls.length;
    harness.lcuCredentials$.next(null);
    await vi.advanceTimersByTimeAsync(60_000);

    expect(fetchLcu.mock.calls.length).toBe(callsAfterFirstFail);
    vi.useRealTimers();
    store.dispose();
  });

  it("does not retry on permanent errors (e.g. malformed payload)", async () => {
    vi.useFakeTimers();
    const fetchLcu = vi.fn(async () => "not-json");
    const harness = makeHarness(fakeBridge(fetchLcu));
    const store = createMatchHistoryStore(harness);
    harness.lcuCredentials$.next({ port: 1234, token: "tok" });
    await vi.advanceTimersByTimeAsync(0);

    const callsAfterFirstFail = fetchLcu.mock.calls.length;
    await vi.advanceTimersByTimeAsync(60_000);

    expect(fetchLcu.mock.calls.length).toBe(callsAfterFirstFail);
    vi.useRealTimers();
    store.dispose();
  });

  it("does not re-fetch puuid on subsequent calls (cached for the session)", async () => {
    const summonerCalls = vi.fn();
    const fetchLcu = vi.fn(async (_p, _t, endpoint: string) => {
      if (endpoint === "/lol-summoner/v1/current-summoner") {
        summonerCalls();
        return JSON.stringify({ puuid: "puuid-x" });
      }
      return JSON.stringify({ games: { games: [] } });
    });
    const harness = makeHarness(fakeBridge(fetchLcu));
    const store = createMatchHistoryStore(harness);
    harness.lcuCredentials$.next({ port: 1234, token: "tok" });
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    store.refresh();
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    expect(summonerCalls).toHaveBeenCalledTimes(1);
    store.dispose();
  });
});

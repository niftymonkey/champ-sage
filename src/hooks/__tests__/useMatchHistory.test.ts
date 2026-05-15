import { renderHook, waitFor, act } from "@testing-library/react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createElement, type ReactNode } from "react";
import { SWRConfig, useSWRConfig, type Cache } from "swr";
import { useMatchHistory } from "../useMatchHistory";
import type { MatchSummary } from "../../lib/match-history/types";

interface MockStore {
  fetchMatches: ReturnType<typeof vi.fn>;
  dispose: ReturnType<typeof vi.fn>;
}

let mockStore: MockStore;

vi.mock("../../lib/match-history/runtime", () => ({
  MATCH_HISTORY_KEY: "match-history",
  getMatchHistoryStore: () => mockStore,
}));

const sampleMatch: MatchSummary = {
  gameId: "1234567890",
  championName: "Lux",
  championId: 99,
  gameMode: "ARAM",
  queueId: 450,
  isWin: true,
  kills: 12,
  deaths: 4,
  assists: 18,
  largestKillingSpree: 3,
  durationSeconds: 1634,
  gameCreation: 1_700_000_000_000,
  finalItems: [],
};

function wrapper({ children }: { children: ReactNode }) {
  return createElement(
    SWRConfig,
    {
      value: {
        provider: () => new Map() as Cache,
        revalidateOnFocus: false,
        revalidateOnReconnect: false,
        revalidateIfStale: false,
        revalidateOnMount: false,
        dedupingInterval: 0,
        shouldRetryOnError: false,
      },
    },
    children,
  );
}

describe("useMatchHistory", () => {
  beforeEach(() => {
    mockStore = {
      fetchMatches: vi.fn().mockResolvedValue([sampleMatch]),
      dispose: vi.fn(),
    };
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("returns empty matches with no fetch on mount when cache is cold", async () => {
    const { result } = renderHook(() => useMatchHistory(), { wrapper });

    expect(result.current.matches).toEqual([]);
    expect(result.current.isValidating).toBe(false);
    expect(mockStore.fetchMatches).not.toHaveBeenCalled();
  });

  it("renders cached matches on first render with no fetch and no validating state", async () => {
    function wrapperWithCache({ children }: { children: ReactNode }) {
      const cache = new Map<string, unknown>([
        ["match-history", { data: [sampleMatch] }],
      ]);
      return createElement(
        SWRConfig,
        {
          value: {
            provider: () => cache as unknown as Cache,
            revalidateOnFocus: false,
            revalidateOnReconnect: false,
            revalidateIfStale: false,
            revalidateOnMount: false,
            dedupingInterval: 0,
            shouldRetryOnError: false,
          },
        },
        children,
      );
    }

    const { result } = renderHook(() => useMatchHistory(), {
      wrapper: wrapperWithCache,
    });

    expect(result.current.matches).toEqual([sampleMatch]);
    expect(result.current.isValidating).toBe(false);
    expect(mockStore.fetchMatches).not.toHaveBeenCalled();
  });

  it("flips to isValidating: true when mutate(MATCH_HISTORY_KEY) is called and back to false on resolve", async () => {
    let resolve: (matches: MatchSummary[]) => void = () => {};
    mockStore.fetchMatches = vi.fn(
      () =>
        new Promise<MatchSummary[]>((r) => {
          resolve = r;
        }),
    );

    // Use the provider-scoped mutate (the global `mutate` from "swr"
    // targets the default cache, not our SWRConfig provider).
    const { result } = renderHook(
      () => ({
        history: useMatchHistory(),
        mutate: useSWRConfig().mutate,
      }),
      { wrapper },
    );

    expect(result.current.history.isValidating).toBe(false);

    act(() => {
      void result.current.mutate("match-history");
    });

    await waitFor(() => {
      expect(result.current.history.isValidating).toBe(true);
    });

    act(() => {
      resolve([sampleMatch]);
    });

    await waitFor(() => {
      expect(result.current.history.isValidating).toBe(false);
    });
    expect(result.current.history.matches).toEqual([sampleMatch]);
  });

  it("exposes windowStats and recentGames convenience wrappers", () => {
    const { result } = renderHook(() => useMatchHistory(), { wrapper });

    expect(typeof result.current.windowStats).toBe("function");
    expect(typeof result.current.recentGames).toBe("function");
    expect(result.current.recentGames(5)).toEqual([]);
  });
});

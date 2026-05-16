import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { SWRConfig, useSWRConfig, unstable_serialize, type Cache } from "swr";
import { useDecisionLogQuery } from "../useDecisionLogQuery";
import type {
  DecisionQuery,
  VoiceDecision,
} from "../../lib/decision-log/types";

function voice(id: string, sentAt: number, gameId = "G1"): VoiceDecision {
  return {
    id,
    gameId,
    gameMode: "ARAM",
    sentAt,
    retried: false,
    schemaVersion: 1,
    source: "voice",
    question: `q-${id}`,
    answer: `a-${id}`,
  };
}

let decisionLogQuery: ReturnType<typeof vi.fn>;
const lastGameQ: DecisionQuery = { kind: "last-game" };

beforeEach(() => {
  decisionLogQuery = vi.fn();
  (window as unknown as { electronAPI?: unknown }).electronAPI = {
    decisionLogQuery,
  };
});

afterEach(() => {
  delete (window as unknown as { electronAPI?: unknown }).electronAPI;
  vi.restoreAllMocks();
});

function makeWrapper(initialCache?: Map<string, unknown>) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(
      SWRConfig,
      {
        value: {
          provider: () => (initialCache ?? new Map()) as Cache,
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
  };
}

describe("useDecisionLogQuery", () => {
  it("fetches on first mount when cache is cold and exposes records", async () => {
    decisionLogQuery.mockResolvedValue([voice("v1", 1_000), voice("v2", 2_000)]);
    const { result } = renderHook(() => useDecisionLogQuery(lastGameQ), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => expect(result.current.records).toHaveLength(2));
    expect(result.current.isValidating).toBe(false);
  });

  it("renders cached records synchronously on first render (no transient empty state)", async () => {
    // Pre-seed the SWR cache with a State-shaped entry for this query.
    // Use `unstable_serialize` to produce the same key SWR generates
    // internally — guessing the format is brittle.
    const cachedKey = unstable_serialize(["decision-log", lastGameQ]);
    const cache = new Map<string, unknown>([
      [cachedKey, { data: [voice("cached", 5_000)] }],
    ]);
    decisionLogQuery.mockResolvedValue([voice("cached", 5_000)]);

    const { result } = renderHook(() => useDecisionLogQuery(lastGameQ), {
      wrapper: makeWrapper(cache),
    });

    // The user-visible promise: cached records show on first render with
    // no flash. A background fetch may still run (stale-while-revalidate);
    // that's correct behavior, not a flash, because records never go empty.
    expect(result.current.records).toHaveLength(1);
    expect(result.current.records[0].id).toBe("cached");
  });

  it("computes a summary from the records via summarizeGame", async () => {
    decisionLogQuery.mockResolvedValue([voice("v1", 1_000)]);
    const { result } = renderHook(() => useDecisionLogQuery(lastGameQ), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => expect(result.current.records).toHaveLength(1));
    expect(result.current.summary.totalCount).toBe(1);
    expect(result.current.summary.byKind.voice).toHaveLength(1);
  });

  it("captures errors and surfaces them via the `error` field", async () => {
    decisionLogQuery.mockRejectedValue(new Error("boom"));
    const { result } = renderHook(() => useDecisionLogQuery(lastGameQ), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => expect(result.current.error?.message).toBe("boom"));
    expect(result.current.records).toEqual([]);
  });

  it("returns empty + not validating when electronAPI is absent", async () => {
    delete (window as unknown as { electronAPI?: unknown }).electronAPI;
    const { result } = renderHook(() => useDecisionLogQuery(lastGameQ), {
      wrapper: makeWrapper(),
    });

    // The hook should resolve to an empty result without throwing.
    await waitFor(() => expect(result.current.isValidating).toBe(false));
    expect(result.current.records).toEqual([]);
    expect(result.current.error).toBeNull();
  });

  it("flips isValidating true → false on mutate(key) and updates records", async () => {
    decisionLogQuery
      .mockResolvedValueOnce([voice("v1", 1_000)])
      .mockResolvedValueOnce([voice("v1", 1_000), voice("v2", 2_000)]);

    const { result } = renderHook(
      () => ({
        log: useDecisionLogQuery(lastGameQ),
        mutate: useSWRConfig().mutate,
      }),
      { wrapper: makeWrapper() },
    );

    await waitFor(() => expect(result.current.log.records).toHaveLength(1));

    act(() => {
      void result.current.mutate((key) =>
        Array.isArray(key) && key[0] === "decision-log",
      );
    });

    await waitFor(() => expect(result.current.log.records).toHaveLength(2));
    expect(decisionLogQuery).toHaveBeenCalledTimes(2);
  });

  it("uses independent cache entries for different query keys", async () => {
    decisionLogQuery
      .mockResolvedValueOnce([voice("vA", 1_000, "GA")])
      .mockResolvedValueOnce([voice("vB", 1_000, "GB")]);

    const { result, rerender } = renderHook(
      ({ q }: { q: DecisionQuery }) => useDecisionLogQuery(q),
      {
        wrapper: makeWrapper(),
        initialProps: { q: lastGameQ as DecisionQuery },
      },
    );

    await waitFor(() => expect(result.current.records).toHaveLength(1));
    expect(result.current.records[0].id).toBe("vA");

    rerender({ q: { kind: "by-game", gameId: "GB" } });

    await waitFor(() => expect(result.current.records[0]?.id).toBe("vB"));
    expect(decisionLogQuery).toHaveBeenCalledWith({ kind: "last-game" });
    expect(decisionLogQuery).toHaveBeenCalledWith({
      kind: "by-game",
      gameId: "GB",
    });
  });
});

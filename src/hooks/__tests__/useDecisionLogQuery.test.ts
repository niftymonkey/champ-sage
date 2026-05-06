import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useDecisionLogQuery } from "../useDecisionLogQuery";
import type {
  DecisionQuery,
  VoiceDecision,
} from "../../lib/decision-log/types";

function voice(id: string, sentAt: number): VoiceDecision {
  return {
    id,
    gameId: "G1",
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
const lastGame: DecisionQuery = { kind: "last-game" };

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

describe("useDecisionLogQuery", () => {
  it("fetches records on mount and exposes them", async () => {
    decisionLogQuery.mockResolvedValue([
      voice("v1", 1_000),
      voice("v2", 2_000),
    ]);
    const { result } = renderHook(() => useDecisionLogQuery(lastGame));
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.records).toHaveLength(2);
  });

  it("computes a summary from the returned records", async () => {
    decisionLogQuery.mockResolvedValue([voice("v1", 1_000)]);
    const { result } = renderHook(() => useDecisionLogQuery(lastGame));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.summary.totalCount).toBe(1);
    expect(result.current.summary.byKind.voice).toHaveLength(1);
  });

  it("captures errors", async () => {
    decisionLogQuery.mockRejectedValue(new Error("boom"));
    const { result } = renderHook(() => useDecisionLogQuery(lastGame));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error?.message).toBe("boom");
    expect(result.current.records).toEqual([]);
  });

  it("returns empty + not loading when electronAPI is absent", async () => {
    delete (window as unknown as { electronAPI?: unknown }).electronAPI;
    const { result } = renderHook(() => useDecisionLogQuery(lastGame));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.records).toEqual([]);
    expect(result.current.error).toBeNull();
  });

  it("refetch re-runs the query", async () => {
    decisionLogQuery.mockResolvedValueOnce([voice("v1", 1_000)]);
    const { result } = renderHook(() => useDecisionLogQuery(lastGame));
    await waitFor(() => expect(result.current.loading).toBe(false));

    decisionLogQuery.mockResolvedValueOnce([
      voice("v1", 1_000),
      voice("v2", 2_000),
    ]);
    act(() => result.current.refetch());
    await waitFor(() => expect(result.current.records).toHaveLength(2));
  });

  it("re-runs when the query changes", async () => {
    decisionLogQuery.mockResolvedValueOnce([voice("v1", 1_000)]);
    const { result, rerender } = renderHook(
      ({ q }: { q: DecisionQuery }) => useDecisionLogQuery(q),
      { initialProps: { q: lastGame as DecisionQuery } }
    );
    await waitFor(() => expect(result.current.loading).toBe(false));

    decisionLogQuery.mockResolvedValueOnce([
      voice("v1", 1_000),
      voice("v2", 2_000),
    ]);
    rerender({ q: { kind: "by-game", gameId: "G7" } });
    await waitFor(() => expect(result.current.records).toHaveLength(2));
    expect(decisionLogQuery).toHaveBeenCalledWith({
      kind: "by-game",
      gameId: "G7",
    });
  });
});

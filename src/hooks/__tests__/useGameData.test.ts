import { renderHook, act, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const loadGameData = vi.fn();
const loadCachedGameData = vi.fn();
const checkForNewVersion = vi.fn();
const fetchAndCache = vi.fn();

vi.mock("../../lib/data-ingest", () => ({
  loadGameData: (...a: unknown[]) => loadGameData(...a),
  loadCachedGameData: (...a: unknown[]) => loadCachedGameData(...a),
  checkForNewVersion: (...a: unknown[]) => checkForNewVersion(...a),
  fetchAndCache: (...a: unknown[]) => fetchAndCache(...a),
}));

vi.mock("../../lib/data-ingest/champion-id-map", () => ({
  populateChampionIdMap: vi.fn(),
}));

import { useGameData, LOADING_SLOW_MS } from "../useGameData";
import { localStatus$ } from "../../lib/reactive/streams";

function fakeData(version = "16.15.1") {
  return {
    champions: new Map(),
    items: new Map(),
    augments: new Map(),
    runes: new Map(),
    version,
  };
}

function dataStatus() {
  return localStatus$.value.find((s) => s.id === "data");
}

beforeEach(() => {
  vi.clearAllMocks();
  localStatus$.next([]);
  loadGameData.mockResolvedValue(fakeData());
  loadCachedGameData.mockResolvedValue(null);
  fetchAndCache.mockResolvedValue(fakeData());
  checkForNewVersion.mockResolvedValue(false);
});

afterEach(() => {
  localStatus$.next([]);
  vi.useRealTimers();
});

describe("useGameData", () => {
  it("loads data and reports no trouble", async () => {
    const { result } = renderHook(() => useGameData());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).not.toBeNull();
    expect(dataStatus()).toBeUndefined();
  });

  // The ingest error screen used to be terminal: no retry, no banner, and a
  // cold cache plus a CACHE_VERSION bump (a routine patch-day event) left the
  // app permanently unusable.
  it("publishes a broken data status when the load fails", async () => {
    loadGameData.mockRejectedValue(new Error("wiki timed out"));
    const { result } = renderHook(() => useGameData());
    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(dataStatus()?.level).toBe("broken");
  });

  it("offers a retry on the failure status, since the failure is often transient", async () => {
    loadGameData.mockRejectedValue(new Error("wiki timed out"));
    const { result } = renderHook(() => useGameData());
    await waitFor(() => expect(dataStatus()).toBeDefined());
    expect(dataStatus()?.action).toBe("retry");
    expect(result.current.error).toContain("wiki timed out");
  });

  it("carries the failure reason, since the player is the one reporting it", async () => {
    loadGameData.mockRejectedValue(new Error("wiki timed out"));
    renderHook(() => useGameData());
    await waitFor(() => expect(dataStatus()).toBeDefined());
    expect(dataStatus()?.detail ?? "").toContain("wiki timed out");
  });

  it("recovers and clears the banner when a retry succeeds", async () => {
    loadGameData.mockRejectedValueOnce(new Error("wiki timed out"));
    const { result } = renderHook(() => useGameData());
    await waitFor(() => expect(dataStatus()).toBeDefined());

    loadGameData.mockResolvedValue(fakeData());
    await act(async () => {
      result.current.retry();
    });
    await waitFor(() => expect(result.current.data).not.toBeNull());
    expect(dataStatus()).toBeUndefined();
    expect(result.current.error).toBeNull();
  });

  it("keeps the banner up when the retry fails too", async () => {
    loadGameData.mockRejectedValue(new Error("still down"));
    const { result } = renderHook(() => useGameData());
    await waitFor(() => expect(dataStatus()).toBeDefined());
    await act(async () => {
      result.current.retry();
    });
    await waitFor(() => expect(dataStatus()?.level).toBe("broken"));
  });

  // `refresh` refuses to run without data, so it cannot rescue a cold start.
  // That is the exact state the retry exists for.
  it("retries from a cold start, where refresh would refuse", async () => {
    loadGameData.mockRejectedValueOnce(new Error("wiki timed out"));
    const { result } = renderHook(() => useGameData());
    await waitFor(() => expect(result.current.data).toBeNull());
    loadGameData.mockResolvedValue(fakeData());
    await act(async () => {
      result.current.retry();
    });
    await waitFor(() => expect(result.current.data).not.toBeNull());
  });

  // A load that never settles used to show "Loading game data..." forever, and
  // a spinner that never ends is indistinguishable from one that is working.
  it("says so when the load is taking far longer than it should", async () => {
    vi.useFakeTimers();
    loadGameData.mockReturnValue(new Promise(() => {}));
    renderHook(() => useGameData());
    await act(async () => {
      vi.advanceTimersByTime(LOADING_SLOW_MS);
    });
    expect(dataStatus()?.level).toBe("degraded");
  });

  it("stays quiet before the slow-load deadline", async () => {
    vi.useFakeTimers();
    loadGameData.mockReturnValue(new Promise(() => {}));
    renderHook(() => useGameData());
    await act(async () => {
      vi.advanceTimersByTime(LOADING_SLOW_MS - 1);
    });
    expect(dataStatus()).toBeUndefined();
  });

  it("does not warn about a slow load that already finished", async () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useGameData());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(result.current.data).not.toBeNull();
    await act(async () => {
      vi.advanceTimersByTime(LOADING_SLOW_MS * 2);
    });
    expect(dataStatus()).toBeUndefined();
  });

  // A real failure is a stronger statement than "this is slow"; the slow
  // warning must not overwrite it.
  it("lets a real failure outrank the slow-load warning", async () => {
    loadGameData.mockRejectedValue(new Error("wiki timed out"));
    renderHook(() => useGameData());
    await waitFor(() => expect(dataStatus()?.level).toBe("broken"));
  });

  it("shows loading again while a retry is in flight", async () => {
    loadGameData.mockRejectedValueOnce(new Error("wiki timed out"));
    const { result } = renderHook(() => useGameData());
    await waitFor(() => expect(result.current.loading).toBe(false));

    let release: (() => void) | null = null;
    loadGameData.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = () => resolve(fakeData());
        })
    );
    act(() => {
      result.current.retry();
    });
    await waitFor(() => expect(result.current.loading).toBe(true));
    await act(async () => {
      release?.();
    });
  });
});

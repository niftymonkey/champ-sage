import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, afterEach, vi } from "vitest";
import { useGameLifecycle } from "../useGameLifecycle";
import { gameLifecycle$ } from "../../lib/reactive";
import type { GameLifecycleEvent } from "../../lib/reactive";

describe("useGameLifecycle", () => {
  afterEach(() => {
    gameLifecycle$.next({ type: "connection", connected: false });
  });

  it("returns the current event from the observable", () => {
    const { result } = renderHook(() => useGameLifecycle());

    expect(result.current.event).toEqual({
      type: "connection",
      connected: false,
    });
    expect(result.current.lastPhase).toBeNull();
  });

  it("delivers phase events immediately without debounce", () => {
    const { result } = renderHook(() => useGameLifecycle());

    const nextEvent: GameLifecycleEvent = {
      type: "phase",
      phase: "ChampSelect",
    };

    act(() => {
      gameLifecycle$.next(nextEvent);
    });

    // Phase events arrive immediately — no debounce
    expect(result.current.event).toEqual(nextEvent);
    expect(result.current.lastPhase).toBe("ChampSelect");
  });

  it("debounces non-phase events", async () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useGameLifecycle());

    act(() => {
      gameLifecycle$.next({ type: "lobby", data: {} });
    });

    // Not yet — debounce hasn't fired
    expect(result.current.event).toEqual({
      type: "connection",
      connected: false,
    });

    await act(async () => {
      vi.advanceTimersByTime(500);
    });

    expect(result.current.event).toEqual({ type: "lobby", data: {} });
    vi.useRealTimers();
  });

  it("tracks lastPhase across phase events", () => {
    const { result } = renderHook(() => useGameLifecycle());

    act(() => {
      gameLifecycle$.next({ type: "phase", phase: "Lobby" });
    });
    expect(result.current.lastPhase).toBe("Lobby");

    act(() => {
      gameLifecycle$.next({ type: "phase", phase: "ChampSelect" });
    });
    expect(result.current.lastPhase).toBe("ChampSelect");
  });

  it("unsubscribes on unmount", () => {
    const initialSubscribers = gameLifecycle$.observers.length;

    const { unmount } = renderHook(() => useGameLifecycle());
    // merge creates multiple subscriptions on the source
    expect(gameLifecycle$.observers.length).toBeGreaterThan(initialSubscribers);

    unmount();
    expect(gameLifecycle$.observers.length).toBe(initialSubscribers);
  });
});

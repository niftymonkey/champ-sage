import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, afterEach } from "vitest";
import { useGameLifecycle } from "../useGameLifecycle";
import { gameLifecycle$ } from "../../lib/reactive";
import type { GameLifecycleEvent } from "../../lib/reactive";

describe("useGameLifecycle", () => {
  afterEach(() => {
    // Reset to default
    gameLifecycle$.next({ type: "connection", connected: false });
  });

  it("returns the current value from the observable", () => {
    const { result } = renderHook(() => useGameLifecycle());

    expect(result.current).toEqual({ type: "connection", connected: false });
  });

  it("updates when the observable emits a new value", () => {
    const { result } = renderHook(() => useGameLifecycle());

    const nextEvent: GameLifecycleEvent = {
      type: "phase",
      phase: "ChampSelect",
    };

    act(() => {
      gameLifecycle$.next(nextEvent);
    });

    expect(result.current).toEqual(nextEvent);
  });

  it("unsubscribes on unmount", () => {
    const initialSubscribers = gameLifecycle$.observers.length;

    const { unmount } = renderHook(() => useGameLifecycle());
    expect(gameLifecycle$.observers.length).toBe(initialSubscribers + 1);

    unmount();
    expect(gameLifecycle$.observers.length).toBe(initialSubscribers);
  });
});

import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, afterEach } from "vitest";
import { useLiveGameState } from "../useLiveGameState";
import { liveGameState$, createDefaultLiveGameState } from "../../lib/reactive";
import type { LiveGameState } from "../../lib/reactive";

describe("useLiveGameState", () => {
  afterEach(() => {
    liveGameState$.next(createDefaultLiveGameState());
  });

  it("returns the default live game state", () => {
    const { result } = renderHook(() => useLiveGameState());

    expect(result.current).toEqual(createDefaultLiveGameState());
  });

  it("updates when the observable emits", () => {
    const { result } = renderHook(() => useLiveGameState());

    const nextState: LiveGameState = {
      activePlayer: null,
      players: [],
      gameMode: "ARAM",
      gameTime: 120,
      champSelect: null,
      eogStats: null,
    };

    act(() => {
      liveGameState$.next(nextState);
    });

    expect(result.current.gameMode).toBe("ARAM");
    expect(result.current.gameTime).toBe(120);
  });

  it("unsubscribes on unmount", () => {
    const initialSubscribers = liveGameState$.observers.length;

    const { unmount } = renderHook(() => useLiveGameState());
    expect(liveGameState$.observers.length).toBe(initialSubscribers + 1);

    unmount();
    expect(liveGameState$.observers.length).toBe(initialSubscribers);
  });
});

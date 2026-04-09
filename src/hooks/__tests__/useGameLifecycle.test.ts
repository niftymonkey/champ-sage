import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, afterEach, vi } from "vitest";
import { useGameLifecycle } from "../useGameLifecycle";
import { gameLifecycle$, liveGameState$ } from "../../lib/reactive";
import type { GameLifecycleEvent } from "../../lib/reactive";
import type { LiveGameState } from "../../lib/reactive/types";

vi.mock("../../lib/data-ingest/champion-id-map", () => {
  const nameMap: Record<number, string> = {
    136: "Aurelion Sol",
    222: "Jinx",
  };
  return {
    resolveChampionName: vi.fn((id: number) => nameMap[id]),
  };
});

function defaultState(overrides: Partial<LiveGameState> = {}): LiveGameState {
  return {
    activePlayer: null,
    players: [],
    gameMode: "",
    lcuGameMode: "",
    gameTime: 0,
    champSelect: null,
    eogStats: null,
    ...overrides,
  };
}

describe("useGameLifecycle", () => {
  afterEach(() => {
    gameLifecycle$.next({ type: "connection", connected: false });
    liveGameState$.next(defaultState());
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

  it("returns championName from locked champion during ChampSelect", () => {
    const { result } = renderHook(() => useGameLifecycle());

    act(() => {
      gameLifecycle$.next({ type: "phase", phase: "ChampSelect" });
      liveGameState$.next(
        defaultState({
          champSelect: {
            localPlayerCellId: 0,
            myTeam: [{ cellId: 0, championId: 222, championPickIntent: 0 }],
          },
        })
      );
    });

    expect(result.current.championName).toBe("Jinx");
  });

  it("returns championName from hover intent when not locked", () => {
    const { result } = renderHook(() => useGameLifecycle());

    act(() => {
      gameLifecycle$.next({ type: "phase", phase: "ChampSelect" });
      liveGameState$.next(
        defaultState({
          champSelect: {
            localPlayerCellId: 0,
            myTeam: [{ cellId: 0, championId: 0, championPickIntent: 136 }],
          },
        })
      );
    });

    expect(result.current.championName).toBe("Aurelion Sol");
  });

  it("returns null championName when not in ChampSelect", () => {
    const { result } = renderHook(() => useGameLifecycle());

    act(() => {
      gameLifecycle$.next({ type: "phase", phase: "InProgress" });
      liveGameState$.next(
        defaultState({
          champSelect: {
            localPlayerCellId: 0,
            myTeam: [{ cellId: 0, championId: 222, championPickIntent: 0 }],
          },
        })
      );
    });

    expect(result.current.championName).toBeNull();
  });

  it("returns null championName when champSelect is null", () => {
    const { result } = renderHook(() => useGameLifecycle());

    act(() => {
      gameLifecycle$.next({ type: "phase", phase: "ChampSelect" });
    });

    expect(result.current.championName).toBeNull();
  });
});

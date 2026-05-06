import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, afterEach } from "vitest";
import { useSurfaceState } from "./useSurfaceState";
import {
  gameLifecycle$,
  liveGameState$,
  createDefaultLiveGameState,
} from "../lib/reactive";
import type { GameflowPhase } from "../lib/reactive/types";

function emitPhase(phase: GameflowPhase): void {
  gameLifecycle$.next({ type: "phase", phase });
}

describe("useSurfaceState", () => {
  afterEach(() => {
    // Reset shared observables back to their default so tests don't bleed.
    // gameLifecycle$ is a BehaviorSubject — explicitly reset the phase too,
    // otherwise the previous test's phase persists into the next.
    gameLifecycle$.next({ type: "connection", connected: false });
    gameLifecycle$.next({ type: "phase", phase: "None" });
    liveGameState$.next(createDefaultLiveGameState());
  });

  it("auto-resolves to in-game when phase is InProgress", () => {
    act(() => emitPhase("InProgress"));

    const { result } = renderHook(() => useSurfaceState());

    expect(result.current.surface).toBe("in-game");
  });

  it("respects a manual nav click during a stable phase", () => {
    // The user is in-game and clicks SETTINGS in the nav. Small in-game
    // events should not pull them back.
    act(() => emitPhase("InProgress"));
    const { result } = renderHook(() => useSurfaceState());

    act(() => result.current.navigate("settings"));
    expect(result.current.surface).toBe("settings");

    // Phase re-emits InProgress (e.g. a duplicate event from the LCU). The
    // user should stay on settings - the auto-resolved default did not
    // actually change.
    act(() => emitPhase("InProgress"));
    expect(result.current.surface).toBe("settings");
  });

  it("expires the manual override when the underlying default surface changes", () => {
    // The user clicked SETTINGS during the game. When the game ends the
    // app should route to post-game (the new auto default) rather than
    // strand them on settings.
    act(() => emitPhase("InProgress"));
    const { result } = renderHook(() => useSurfaceState());
    act(() => result.current.navigate("settings"));
    expect(result.current.surface).toBe("settings");

    act(() => emitPhase("PreEndOfGame"));
    expect(result.current.surface).toBe("post-game");
  });

  it("auto-routes to in-game when a player appears even with no phase signal", () => {
    // The dev simulator injects an active player without LCU phase events.
    const { result } = renderHook(() => useSurfaceState());

    act(() => {
      liveGameState$.next({
        ...createDefaultLiveGameState(),
        activePlayer: {
          championName: "Aatrox",
          level: 1,
          currentGold: 500,
          runes: { keystone: "", primaryTree: "", secondaryTree: "" },
          stats: {} as never,
        },
      });
    });

    expect(result.current.surface).toBe("in-game");
  });
});

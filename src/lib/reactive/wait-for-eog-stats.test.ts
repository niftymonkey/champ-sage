import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { BehaviorSubject } from "rxjs";
import { waitForEogStats } from "./wait-for-eog-stats";
import type { EogStats, LiveGameState } from "./types";

function makeLiveGameState(
  overrides: Partial<LiveGameState> = {}
): LiveGameState {
  return {
    activePlayer: null,
    players: [],
    gameMode: "",
    lcuGameMode: "",
    mapNumber: 0,
    lcuGameId: "",
    gameTime: 0,
    champSelect: null,
    eogStats: null,
    ...overrides,
  };
}

function makeEog(overrides: Partial<EogStats> = {}): EogStats {
  return {
    gameId: "abc",
    gameLength: 1500,
    gameMode: "ARAM",
    result: "win",
    championId: 99,
    items: [],
    ...overrides,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("waitForEogStats", () => {
  it("resolves immediately when the stream already carries eogStats", async () => {
    const eog = makeEog({ result: "win" });
    const live$ = new BehaviorSubject<LiveGameState>(
      makeLiveGameState({ eogStats: eog })
    );
    const seen: Array<EogStats | null> = [];
    waitForEogStats(live$).subscribe((v) => seen.push(v));

    await vi.advanceTimersByTimeAsync(0);
    expect(seen).toEqual([eog]);
  });

  it("waits for eogStats to land on a later emission", async () => {
    const live$ = new BehaviorSubject<LiveGameState>(makeLiveGameState());
    const seen: Array<EogStats | null> = [];
    waitForEogStats(live$).subscribe((v) => seen.push(v));

    await vi.advanceTimersByTimeAsync(0);
    expect(seen).toEqual([]);

    const eog = makeEog({ result: "loss" });
    live$.next(makeLiveGameState({ eogStats: eog }));
    await vi.advanceTimersByTimeAsync(0);
    expect(seen).toEqual([eog]);
  });

  it("resolves to null when the timeout fires before eogStats arrive", async () => {
    const live$ = new BehaviorSubject<LiveGameState>(makeLiveGameState());
    const seen: Array<EogStats | null> = [];
    waitForEogStats(live$, { timeoutMs: 5_000 }).subscribe((v) => seen.push(v));

    await vi.advanceTimersByTimeAsync(4_999);
    expect(seen).toEqual([]);

    await vi.advanceTimersByTimeAsync(2);
    expect(seen).toEqual([null]);
  });

  it("ignores eogStats that arrive after the timeout has already fired", async () => {
    const live$ = new BehaviorSubject<LiveGameState>(makeLiveGameState());
    const seen: Array<EogStats | null> = [];
    waitForEogStats(live$, { timeoutMs: 1_000 }).subscribe((v) => seen.push(v));

    await vi.advanceTimersByTimeAsync(1_500);
    expect(seen).toEqual([null]);

    live$.next(makeLiveGameState({ eogStats: makeEog() }));
    await vi.advanceTimersByTimeAsync(0);
    expect(seen).toEqual([null]);
  });

  it("emits exactly one value (completes after first resolution)", async () => {
    const eog = makeEog();
    const live$ = new BehaviorSubject<LiveGameState>(makeLiveGameState());
    const seen: Array<EogStats | null> = [];
    let completed = false;
    waitForEogStats(live$).subscribe({
      next: (v) => seen.push(v),
      complete: () => {
        completed = true;
      },
    });

    live$.next(makeLiveGameState({ eogStats: eog }));
    await vi.advanceTimersByTimeAsync(0);

    expect(seen).toEqual([eog]);
    expect(completed).toBe(true);

    live$.next(makeLiveGameState({ eogStats: makeEog({ result: "loss" }) }));
    await vi.advanceTimersByTimeAsync(0);
    expect(seen).toEqual([eog]);
  });
});

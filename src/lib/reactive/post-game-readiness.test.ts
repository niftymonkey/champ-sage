import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  postGameReady$,
  markGameEnded,
  markSnapshotRefreshed,
  markMatchesRefreshed,
  _resetPostGameReadiness,
} from "./post-game-readiness";

beforeEach(() => {
  _resetPostGameReadiness();
});

afterEach(() => {
  vi.useRealTimers();
  _resetPostGameReadiness();
});

describe("postGameReady$ state machine", () => {
  it("starts in the ready state (no game has ended yet)", () => {
    expect(postGameReady$.getValue()).toBe(true);
  });

  it("flips to not-ready when a game ends", () => {
    markGameEnded(1000);
    expect(postGameReady$.getValue()).toBe(false);
  });

  it("stays not-ready when only the snapshot has refreshed (matches still stale)", () => {
    markGameEnded(1000);
    markSnapshotRefreshed(2000);
    expect(postGameReady$.getValue()).toBe(false);
  });

  it("stays not-ready when only match-history has refreshed (snapshot still stale)", () => {
    markGameEnded(1000);
    markMatchesRefreshed(2000);
    expect(postGameReady$.getValue()).toBe(false);
  });

  it("flips to ready when BOTH snapshot AND match-history have refreshed after the game-end", () => {
    markGameEnded(1000);
    markSnapshotRefreshed(2000);
    markMatchesRefreshed(2500);
    expect(postGameReady$.getValue()).toBe(true);
  });

  it("ignores snapshot and match refreshes that happened BEFORE the game ended", () => {
    markSnapshotRefreshed(500);
    markMatchesRefreshed(600);
    markGameEnded(1000);
    expect(postGameReady$.getValue()).toBe(false);
  });

  it("stays not-ready across repeated game-end events without refresh signals", () => {
    markGameEnded(1000);
    expect(postGameReady$.getValue()).toBe(false);
    markGameEnded(2000);
    expect(postGameReady$.getValue()).toBe(false);
  });

  it("supports back-to-back games (end → both refresh → end → both refresh)", () => {
    markGameEnded(1000);
    markSnapshotRefreshed(2000);
    markMatchesRefreshed(2100);
    expect(postGameReady$.getValue()).toBe(true);

    markGameEnded(3000);
    expect(postGameReady$.getValue()).toBe(false);

    markSnapshotRefreshed(4000);
    markMatchesRefreshed(4100);
    expect(postGameReady$.getValue()).toBe(true);
  });

  it("forces ready after the 15s max-hold timeout even if signals never arrive", async () => {
    vi.useFakeTimers();
    markGameEnded(1000);
    expect(postGameReady$.getValue()).toBe(false);

    await vi.advanceTimersByTimeAsync(14_999);
    expect(postGameReady$.getValue()).toBe(false);

    await vi.advanceTimersByTimeAsync(2);
    expect(postGameReady$.getValue()).toBe(true);
  });

  it("does not emit on the subject when the value would be the same", () => {
    const emissions: boolean[] = [];
    const sub = postGameReady$.subscribe((v) => emissions.push(v));
    expect(emissions).toEqual([true]);

    // Marking a snapshot refresh while ready stays ready.
    markSnapshotRefreshed(500);
    expect(emissions).toEqual([true]);

    sub.unsubscribe();
  });
});

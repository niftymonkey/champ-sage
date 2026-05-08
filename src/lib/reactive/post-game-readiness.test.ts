import { describe, it, expect, beforeEach } from "vitest";
import {
  postGameReady$,
  markGameEnded,
  markSnapshotRefreshed,
  _resetPostGameReadiness,
} from "./post-game-readiness";

beforeEach(() => {
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

  it("flips back to ready when the snapshot refreshes after the game-end", () => {
    markGameEnded(1000);
    markSnapshotRefreshed(2000);
    expect(postGameReady$.getValue()).toBe(true);
  });

  it("ignores snapshot refreshes that happened BEFORE the game ended", () => {
    // Edge case: a snapshot refresh from the previous lifecycle
    // shouldn't pre-satisfy the next game-end gate.
    markSnapshotRefreshed(500);
    markGameEnded(1000);
    expect(postGameReady$.getValue()).toBe(false);
  });

  it("stays not-ready across repeated game-end events without snapshot refresh", () => {
    markGameEnded(1000);
    expect(postGameReady$.getValue()).toBe(false);
    markGameEnded(2000);
    expect(postGameReady$.getValue()).toBe(false);
  });

  it("supports back-to-back games (end → refresh → end → refresh)", () => {
    markGameEnded(1000);
    markSnapshotRefreshed(2000);
    expect(postGameReady$.getValue()).toBe(true);

    markGameEnded(3000);
    expect(postGameReady$.getValue()).toBe(false);

    markSnapshotRefreshed(4000);
    expect(postGameReady$.getValue()).toBe(true);
  });

  it("does not emit on the subject when the value would be the same", () => {
    const emissions: boolean[] = [];
    const sub = postGameReady$.subscribe((v) => emissions.push(v));
    // Initial true emission from the subscribe.
    expect(emissions).toEqual([true]);

    // Marking a snapshot refresh while ready stays ready.
    markSnapshotRefreshed(500);
    expect(emissions).toEqual([true]);

    sub.unsubscribe();
  });
});

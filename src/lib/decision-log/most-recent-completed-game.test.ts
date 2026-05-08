import { describe, it, expect } from "vitest";
import { mostRecentCompletedGameSlice } from "./most-recent-completed-game";
import type { DecisionRecord, PlanDecision, TakeawayDecision } from "./types";

function plan(gameId: string, sentAt: number): PlanDecision {
  return {
    id: `plan-${gameId}-${sentAt}`,
    source: "plan",
    gameId,
    gameMode: "ARAM",
    sentAt,
    retried: false,
    schemaVersion: 1,
    answer: "p",
    buildPath: [],
    rev: 1,
  };
}

function takeaway(gameId: string, sentAt: number): TakeawayDecision {
  return {
    id: `takeaway-${gameId}-${sentAt}`,
    source: "takeaway",
    gameId,
    gameMode: "ARAM",
    sentAt,
    retried: false,
    schemaVersion: 1,
    narrative: "n",
    champion: "X",
    isWin: true,
    duration: 1500,
    kills: 0,
    deaths: 0,
    assists: 0,
    finalGold: null,
    finalItems: [],
    recommendedBuild: [],
    matchedItemCount: 0,
  };
}

describe("mostRecentCompletedGameSlice", () => {
  it("returns empty when given no records", () => {
    expect(mostRecentCompletedGameSlice([])).toEqual([]);
  });

  it("returns empty when no game has a takeaway", () => {
    const records: DecisionRecord[] = [plan("A", 100), plan("B", 200)];
    expect(mostRecentCompletedGameSlice(records)).toEqual([]);
  });

  it("returns the records for a single completed game", () => {
    const a1 = plan("A", 100);
    const a2 = takeaway("A", 200);
    const records: DecisionRecord[] = [a1, a2];
    expect(mostRecentCompletedGameSlice(records)).toEqual([a1, a2]);
  });

  it("returns the slice of the game with the latest takeaway", () => {
    const a1 = plan("A", 100);
    const a2 = takeaway("A", 200);
    const b1 = plan("B", 300);
    const b2 = takeaway("B", 400);
    const records: DecisionRecord[] = [a1, a2, b1, b2];
    const result = mostRecentCompletedGameSlice(records);
    expect(result.map((r) => r.id).sort()).toEqual([b1.id, b2.id].sort());
  });

  it("ignores newer games that do not yet have a takeaway", () => {
    // Game A finished (has takeaway). Game B started (plan only) but
    // takeaway is still in flight. Picker should return A's slice
    // intact — that's the "no flicker" guarantee.
    const a1 = plan("A", 100);
    const a2 = takeaway("A", 200);
    const b1 = plan("B", 300);
    const records: DecisionRecord[] = [a1, a2, b1];
    const result = mostRecentCompletedGameSlice(records);
    expect(result.map((r) => r.id).sort()).toEqual([a1.id, a2.id].sort());
  });

  it("picks across more than two games correctly", () => {
    const records: DecisionRecord[] = [
      plan("A", 100),
      takeaway("A", 200),
      plan("B", 300),
      takeaway("B", 400),
      plan("C", 500),
      takeaway("C", 600),
    ];
    const result = mostRecentCompletedGameSlice(records);
    expect(result.every((r) => r.gameId === "C")).toBe(true);
    expect(result).toHaveLength(2);
  });

  it("includes ALL of the chosen game's records, not just the takeaway", () => {
    const a1 = plan("A", 100);
    const a2 = plan("A", 150);
    const a3 = takeaway("A", 200);
    const records: DecisionRecord[] = [a1, a2, a3];
    const result = mostRecentCompletedGameSlice(records);
    expect(result).toHaveLength(3);
  });
});

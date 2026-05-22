import { describe, it, expect } from "vitest";
import { mergeMeta } from "./useLastGameMeta";
import type { MatchSummary } from "../lib/match-history/types";
import type { TakeawayDecision } from "../lib/decision-log/types";
import type { LastGameSnapshot } from "../lib/reactive/coaching-feed-types";

function matchSummary(overrides: Partial<MatchSummary> = {}): MatchSummary {
  return {
    gameId: "G1",
    championName: "Lux",
    championId: 99,
    gameMode: "ARAM",
    queueId: 450,
    result: "win",
    kills: 10,
    deaths: 5,
    assists: 15,
    largestKillingSpree: 2,
    finalItems: [],
    durationSeconds: 1500,
    gameCreation: 1_700_000_000_000,
    ...overrides,
  };
}

function takeaway(overrides: Partial<TakeawayDecision> = {}): TakeawayDecision {
  return {
    id: "T1",
    gameId: "G1",
    gameMode: "ARAM",
    sentAt: 1_700_000_000_000,
    retried: false,
    schemaVersion: 1,
    source: "takeaway",
    narrative: "A game happened.",
    champion: "Lux",
    isWin: true,
    duration: 1500,
    kills: 10,
    deaths: 5,
    assists: 15,
    finalGold: 12000,
    finalItems: [],
    recommendedBuild: [],
    matchedItemCount: 0,
    ...overrides,
  };
}

function snapshot(overrides: Partial<LastGameSnapshot> = {}): LastGameSnapshot {
  return {
    gameId: "G1",
    championName: "Lux",
    result: "win",
    kills: 10,
    deaths: 5,
    assists: 15,
    gameTime: 1500,
    gameMode: "ARAM",
    items: [],
    augments: [],
    recentExchanges: [],
    ...overrides,
  };
}

describe("mergeMeta result resolution", () => {
  it("resolves a remade match-history record to a remake result", () => {
    const meta = mergeMeta(matchSummary({ result: "remake" }), null, null);
    expect(meta.result).toBe("remake");
  });

  it("lets match-history win over both the takeaway and the snapshot", () => {
    const meta = mergeMeta(
      matchSummary({ result: "loss" }),
      takeaway({ isWin: true }),
      snapshot({ result: "win" })
    );
    expect(meta.result).toBe("loss");
  });

  it("bridges the takeaway's boolean isWin when no match record exists", () => {
    expect(mergeMeta(undefined, takeaway({ isWin: true }), null).result).toBe(
      "win"
    );
    expect(mergeMeta(undefined, takeaway({ isWin: false }), null).result).toBe(
      "loss"
    );
  });

  it("falls back to the snapshot result when it is the only source", () => {
    const meta = mergeMeta(undefined, null, snapshot({ result: "remake" }));
    expect(meta.result).toBe("remake");
  });

  it("resolves result to null when every source is absent", () => {
    expect(mergeMeta(undefined, null, null).result).toBeNull();
  });
});

import { describe, it, expect } from "vitest";
import { summarizeGame } from "./summarize";
import type {
  AugmentDecision,
  ItemRecDecision,
  PlanDecision,
  ThreatSpikeDecision,
  VoiceDecision,
} from "./types";

const baseEnvelope = {
  gameId: "G1",
  gameMode: "ARAM" as const,
  schemaVersion: 1 as const,
  retried: false,
};

function voice(overrides: Partial<VoiceDecision> = {}): VoiceDecision {
  return {
    ...baseEnvelope,
    id: "v1",
    sentAt: 1_000,
    source: "voice",
    question: "armor or MR?",
    answer: "armor",
    ...overrides,
  };
}

function plan(overrides: Partial<PlanDecision> = {}): PlanDecision {
  return {
    ...baseEnvelope,
    id: "p1",
    sentAt: 2_000,
    source: "plan",
    answer: "open with luden's",
    buildPath: [],
    rev: 1,
    ...overrides,
  };
}

function augment(overrides: Partial<AugmentDecision> = {}): AugmentDecision {
  return {
    ...baseEnvelope,
    id: "a1",
    sentAt: 3_000,
    source: "augment",
    question: "which augment?",
    recommendations: [],
    ...overrides,
  };
}

function itemRec(overrides: Partial<ItemRecDecision> = {}): ItemRecDecision {
  return {
    ...baseEnvelope,
    id: "i1",
    sentAt: 4_000,
    source: "item-rec",
    question: "what next?",
    answer: "rabadons",
    recommendations: [],
    ...overrides,
  };
}

function threat(
  overrides: Partial<ThreatSpikeDecision> = {}
): ThreatSpikeDecision {
  return {
    ...baseEnvelope,
    id: "t1",
    sentAt: 5_000,
    source: "threat-spike",
    threat: "Veigar ult",
    reason: "stay outside cage range",
    ...overrides,
  };
}

describe("summarizeGame", () => {
  it("returns an empty summary when given no records", () => {
    const s = summarizeGame([]);
    expect(s.gameId).toBeNull();
    expect(s.gameMode).toBeNull();
    expect(s.startedAt).toBeNull();
    expect(s.endedAt).toBeNull();
    expect(s.byKind.voice).toEqual([]);
    expect(s.byKind.plan).toEqual([]);
    expect(s.byKind.augment).toEqual([]);
    expect(s.byKind.itemRec).toEqual([]);
    expect(s.byKind.threatSpike).toEqual([]);
    expect(s.finalPlan).toBeNull();
    expect(s.retriedCount).toBe(0);
    expect(s.totalCount).toBe(0);
  });

  it("derives gameId and gameMode from the first record", () => {
    const s = summarizeGame([voice({ gameId: "G42", gameMode: "CHERRY" })]);
    expect(s.gameId).toBe("G42");
    expect(s.gameMode).toBe("CHERRY");
  });

  it("startedAt is the earliest sentAt; endedAt is the latest", () => {
    const s = summarizeGame([
      voice({ id: "v1", sentAt: 5_000 }),
      plan({ id: "p1", sentAt: 1_000 }),
      augment({ id: "a1", sentAt: 9_000 }),
    ]);
    expect(s.startedAt).toBe(1_000);
    expect(s.endedAt).toBe(9_000);
  });

  it("buckets records by source preserving chronological order", () => {
    const records = [
      voice({ id: "v2", sentAt: 4_000, question: "second voice" }),
      plan({ id: "p1", sentAt: 1_000, rev: 1 }),
      voice({ id: "v1", sentAt: 2_000, question: "first voice" }),
      plan({ id: "p2", sentAt: 6_000, rev: 2 }),
    ];
    const s = summarizeGame(records);
    expect(s.byKind.voice.map((v) => v.id)).toEqual(["v1", "v2"]);
    expect(s.byKind.plan.map((p) => p.id)).toEqual(["p1", "p2"]);
  });

  it("finalPlan is the plan record with the highest rev", () => {
    const s = summarizeGame([
      plan({ id: "p1", sentAt: 1_000, rev: 1 }),
      plan({ id: "p3", sentAt: 5_000, rev: 3 }),
      plan({ id: "p2", sentAt: 3_000, rev: 2 }),
    ]);
    expect(s.finalPlan?.id).toBe("p3");
    expect(s.finalPlan?.rev).toBe(3);
  });

  it("finalPlan is null when no plan records exist", () => {
    const s = summarizeGame([voice(), augment()]);
    expect(s.finalPlan).toBeNull();
  });

  it("counts retried records across all sources", () => {
    const s = summarizeGame([
      voice({ retried: true }),
      plan({ retried: false }),
      augment({ retried: true }),
      itemRec({ retried: true }),
    ]);
    expect(s.retriedCount).toBe(3);
  });

  it("totalCount equals records.length", () => {
    const s = summarizeGame([voice(), plan(), augment(), itemRec(), threat()]);
    expect(s.totalCount).toBe(5);
  });

  it("buckets every source variant into the right kind list", () => {
    const s = summarizeGame([voice(), plan(), augment(), itemRec(), threat()]);
    expect(s.byKind.voice).toHaveLength(1);
    expect(s.byKind.plan).toHaveLength(1);
    expect(s.byKind.augment).toHaveLength(1);
    expect(s.byKind.itemRec).toHaveLength(1);
    expect(s.byKind.threatSpike).toHaveLength(1);
  });
});

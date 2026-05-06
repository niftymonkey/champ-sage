import { describe, it, expect, beforeEach } from "vitest";
import { createCoachDecisionLog, type CoachDecisionLog } from "./log";
import { createInMemoryStorage } from "./storage";
import type { DecisionInput, DecisionStorage } from "./storage";
import type { VoiceDecision } from "../../src/lib/decision-log/types";

function makeClock(start = 1_000): () => number {
  let t = start;
  return () => {
    const n = t;
    t += 1;
    return n;
  };
}

function makeIdGen(prefix = "rec-"): () => string {
  let n = 0;
  return () => `${prefix}${++n}`;
}

const voiceInput = (
  overrides: Partial<DecisionInput & { source: "voice" }> = {}
): DecisionInput => ({
  source: "voice",
  gameId: "G1",
  gameMode: "ARAM",
  retried: false,
  question: "?",
  answer: "!",
  ...overrides,
});

const planInput = (rev: number, gameId = "G1"): DecisionInput => ({
  source: "plan",
  gameId,
  gameMode: "ARAM",
  retried: false,
  answer: `plan rev ${rev}`,
  buildPath: [],
  rev,
});

async function buildLog(
  overrides: Partial<{
    storage: DecisionStorage;
    clock: () => number;
    idGen: () => string;
  }> = {}
): Promise<CoachDecisionLog> {
  return createCoachDecisionLog({
    storage: overrides.storage ?? createInMemoryStorage(),
    clock: overrides.clock ?? makeClock(),
    idGen: overrides.idGen ?? makeIdGen(),
  });
}

describe("createCoachDecisionLog", () => {
  let log: CoachDecisionLog;

  beforeEach(async () => {
    log = await buildLog();
  });

  describe("append", () => {
    it("assigns id, sentAt, and schemaVersion from injected deps", async () => {
      const log = await buildLog({
        clock: () => 5_000,
        idGen: () => "id-x",
      });
      const record = await log.append(voiceInput());
      expect(record.id).toBe("id-x");
      expect(record.sentAt).toBe(5_000);
      expect(record.schemaVersion).toBe(1);
    });

    it("preserves caller-provided fields verbatim", async () => {
      const record = await log.append(
        voiceInput({ question: "armor or MR?", answer: "armor" })
      );
      expect(record.source).toBe("voice");
      const v = record as VoiceDecision;
      expect(v.question).toBe("armor or MR?");
      expect(v.answer).toBe("armor");
      expect(record.gameId).toBe("G1");
      expect(record.gameMode).toBe("ARAM");
      expect(record.retried).toBe(false);
    });

    it("rejects after close()", async () => {
      await log.close();
      await expect(log.append(voiceInput())).rejects.toThrow();
    });
  });

  describe("query — by-game", () => {
    it("returns records for the given gameId in chronological order", async () => {
      await log.append(voiceInput({ gameId: "G1" }));
      await log.append(voiceInput({ gameId: "G2" }));
      await log.append(voiceInput({ gameId: "G1" }));
      const result = await log.query({ kind: "by-game", gameId: "G1" });
      expect(result).toHaveLength(2);
      expect(result[0].sentAt).toBeLessThan(result[1].sentAt);
    });

    it("returns empty array when gameId has no records", async () => {
      await log.append(voiceInput({ gameId: "G1" }));
      const result = await log.query({ kind: "by-game", gameId: "G99" });
      expect(result).toEqual([]);
    });
  });

  describe("query — last-game", () => {
    it("returns records from the most-recently-touched game", async () => {
      await log.append(voiceInput({ gameId: "G1" }));
      await log.append(voiceInput({ gameId: "G2" }));
      await log.append(voiceInput({ gameId: "G1" }));
      // G1 was touched most recently → returns G1's records
      const result = await log.query({ kind: "last-game" });
      expect(result.every((r) => r.gameId === "G1")).toBe(true);
      expect(result).toHaveLength(2);
    });

    it("returns empty array when log is empty", async () => {
      const result = await log.query({ kind: "last-game" });
      expect(result).toEqual([]);
    });
  });

  describe("query — recent-games", () => {
    it("returns records from the last n distinct games chronologically", async () => {
      await log.append(voiceInput({ gameId: "G1" }));
      await log.append(voiceInput({ gameId: "G2" }));
      await log.append(voiceInput({ gameId: "G3" }));
      const result = await log.query({ kind: "recent-games", n: 2 });
      const games = new Set(result.map((r) => r.gameId));
      expect(games).toEqual(new Set(["G2", "G3"]));
    });

    it("returns all records when n exceeds game count", async () => {
      await log.append(voiceInput({ gameId: "G1" }));
      await log.append(voiceInput({ gameId: "G2" }));
      const result = await log.query({ kind: "recent-games", n: 99 });
      expect(result).toHaveLength(2);
    });

    it("returns empty array when n is 0 or negative", async () => {
      await log.append(voiceInput({ gameId: "G1" }));
      expect(await log.query({ kind: "recent-games", n: 0 })).toEqual([]);
      expect(await log.query({ kind: "recent-games", n: -5 })).toEqual([]);
    });
  });

  describe("query — by-source", () => {
    it("returns only records of the given source within a game", async () => {
      await log.append(voiceInput({ gameId: "G1" }));
      await log.append(planInput(1));
      await log.append(voiceInput({ gameId: "G1" }));
      const voice = await log.query({
        kind: "by-source",
        gameId: "G1",
        source: "voice",
      });
      expect(voice).toHaveLength(2);
      expect(voice.every((r) => r.source === "voice")).toBe(true);
    });
  });

  it("read-your-writes: query sees records appended in the same handle", async () => {
    await log.append(voiceInput());
    const result = await log.query({ kind: "by-game", gameId: "G1" });
    expect(result).toHaveLength(1);
  });

  it("hydrates from storage at construction", async () => {
    const storage = createInMemoryStorage();
    const seedLog = await buildLog({ storage });
    await seedLog.append(voiceInput({ gameId: "G7" }));
    // Don't close seedLog — that would close the shared storage. The
    // hydrate-on-construct path is what we're exercising.

    const fresh = await buildLog({ storage });
    const result = await fresh.query({ kind: "by-game", gameId: "G7" });
    expect(result).toHaveLength(1);
  });

  it("close() prevents further queries", async () => {
    await log.close();
    await expect(log.query({ kind: "last-game" })).rejects.toThrow();
  });
});

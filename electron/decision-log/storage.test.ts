import { describe, it, expect } from "vitest";
import { createInMemoryStorage } from "./storage";
import type { VoiceDecision } from "../../src/lib/decision-log/types";

function voice(id: string, gameId: string, sentAt: number): VoiceDecision {
  return {
    id,
    gameId,
    gameMode: "ARAM",
    sentAt,
    retried: false,
    schemaVersion: 1,
    source: "voice",
    question: "?",
    answer: "!",
  };
}

describe("createInMemoryStorage", () => {
  it("hydrate returns empty on first run", async () => {
    const storage = createInMemoryStorage();
    const { games, warnings } = await storage.hydrate();
    expect(games).toEqual([]);
    expect(warnings).toEqual([]);
  });

  it("appendRecord then loadGame returns the record", async () => {
    const storage = createInMemoryStorage();
    await storage.appendRecord(voice("v1", "G1", 1_000));
    const loaded = await storage.loadGame("G1");
    expect(loaded).not.toBeNull();
    expect(loaded?.[0].id).toBe("v1");
  });

  it("loadGame returns null for unknown gameId", async () => {
    const storage = createInMemoryStorage();
    await storage.appendRecord(voice("v1", "G1", 1_000));
    expect(await storage.loadGame("G2")).toBeNull();
  });

  it("preserves append order within a game", async () => {
    const storage = createInMemoryStorage();
    await storage.appendRecord(voice("v1", "G1", 1_000));
    await storage.appendRecord(voice("v2", "G1", 2_000));
    await storage.appendRecord(voice("v3", "G1", 3_000));
    const loaded = await storage.loadGame("G1");
    expect(loaded?.map((r) => r.id)).toEqual(["v1", "v2", "v3"]);
  });

  it("hydrate after appends returns each game grouped with its records", async () => {
    const storage = createInMemoryStorage();
    await storage.appendRecord(voice("v1", "G1", 1_000));
    await storage.appendRecord(voice("v2", "G2", 2_000));
    await storage.appendRecord(voice("v3", "G1", 3_000));
    const { games } = await storage.hydrate();
    const byId = new Map(games.map((g) => [g.gameId, g.records]));
    expect(byId.get("G1")?.map((r) => r.id)).toEqual(["v1", "v3"]);
    expect(byId.get("G2")?.map((r) => r.id)).toEqual(["v2"]);
  });

  it("loadGame returns a copy that does not mutate stored state", async () => {
    const storage = createInMemoryStorage();
    await storage.appendRecord(voice("v1", "G1", 1_000));
    const loaded = await storage.loadGame("G1");
    loaded?.push(voice("hacker", "G1", 9_999));
    const reloaded = await storage.loadGame("G1");
    expect(reloaded).toHaveLength(1);
  });

  it("close is idempotent and locks subsequent operations", async () => {
    const storage = createInMemoryStorage();
    await storage.close();
    await storage.close();
    await expect(storage.appendRecord(voice("v1", "G1", 1))).rejects.toThrow();
    await expect(storage.loadGame("G1")).rejects.toThrow();
    await expect(storage.hydrate()).rejects.toThrow();
  });
});

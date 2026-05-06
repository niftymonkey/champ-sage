import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  readFileSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFileStorage } from "./file-storage";
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
    question: `q-${id}`,
    answer: `a-${id}`,
  };
}

describe("createFileStorage", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "champ-sage-decision-log-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("hydrate returns empty when directory is empty", async () => {
    const storage = createFileStorage(dir);
    const { games, warnings } = await storage.hydrate();
    expect(games).toEqual([]);
    expect(warnings).toEqual([]);
  });

  it("appendRecord persists and roundtrips through a fresh storage", async () => {
    const writer = createFileStorage(dir);
    await writer.appendRecord(voice("v1", "G1", 1_000));
    await writer.appendRecord(voice("v2", "G1", 2_000));
    await writer.close();

    const reader = createFileStorage(dir);
    const { games } = await reader.hydrate();
    expect(games).toHaveLength(1);
    expect(games[0].gameId).toBe("G1");
    expect(games[0].records.map((r) => r.id)).toEqual(["v1", "v2"]);
  });

  it("groups records into per-game files", async () => {
    const storage = createFileStorage(dir);
    await storage.appendRecord(voice("v1", "G1", 1_000));
    await storage.appendRecord(voice("v2", "G2", 2_000));
    await storage.appendRecord(voice("v3", "G1", 3_000));
    await storage.close();

    expect(existsSync(join(dir, "G1.ndjson"))).toBe(true);
    expect(existsSync(join(dir, "G2.ndjson"))).toBe(true);
  });

  it("loadGame returns the records for one game on demand", async () => {
    const writer = createFileStorage(dir);
    await writer.appendRecord(voice("v1", "G1", 1_000));
    await writer.appendRecord(voice("v2", "G2", 2_000));
    await writer.close();

    const reader = createFileStorage(dir);
    const g1 = await reader.loadGame("G1");
    expect(g1?.map((r) => r.id)).toEqual(["v1"]);
    expect(await reader.loadGame("G99")).toBeNull();
  });

  it("hydrate returns games in first-append chronological order", async () => {
    const writer = createFileStorage(dir);
    await writer.appendRecord(voice("v1", "Gb", 1_000));
    await writer.appendRecord(voice("v2", "Ga", 2_000));
    await writer.appendRecord(voice("v3", "Gc", 3_000));
    await writer.close();

    const reader = createFileStorage(dir);
    const { games } = await reader.hydrate();
    expect(games.map((g) => g.gameId)).toEqual(["Gb", "Ga", "Gc"]);
  });

  it("recovers from a malformed line and surfaces a warning", async () => {
    const writer = createFileStorage(dir);
    await writer.appendRecord(voice("v1", "G1", 1_000));
    await writer.appendRecord(voice("v2", "G1", 2_000));
    await writer.close();

    // Corrupt the middle of the file
    const path = join(dir, "G1.ndjson");
    const original = readFileSync(path, "utf-8");
    const lines = original.trimEnd().split("\n");
    const corrupted = `${lines[0]}\n{not json\n${lines[1]}\n`;
    writeFileSync(path, corrupted, "utf-8");

    const reader = createFileStorage(dir);
    const { games, warnings } = await reader.hydrate();
    expect(games[0].records).toHaveLength(2);
    expect(warnings).toEqual([
      expect.objectContaining({ gameId: "G1", droppedLines: 1 }),
    ]);
  });

  it("hydrate rebuilds index from existing per-game files when index.json is missing", async () => {
    const writer = createFileStorage(dir);
    await writer.appendRecord(voice("v1", "G1", 1_000));
    await writer.appendRecord(voice("v2", "G2", 2_000));
    await writer.close();

    rmSync(join(dir, "index.json"), { force: true });

    const reader = createFileStorage(dir);
    const { games } = await reader.hydrate();
    const ids = games.map((g) => g.gameId).sort();
    expect(ids).toEqual(["G1", "G2"]);
  });
});

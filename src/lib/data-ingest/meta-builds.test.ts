import { describe, it, expect } from "vitest";
import {
  deriveMetaItemPool,
  getChampionMeta,
  type MetaBuildFile,
  type MetaBuildChampion,
} from "./meta-builds";

function createChampion(builds: Array<{ items: number[] }>): MetaBuildChampion {
  return {
    championName: "TestChamp",
    sampleSize: 100,
    builds: builds.map((b) => ({
      items: b.items,
      perks: {
        statPerks: { defense: 0, flex: 0, offense: 0 },
        styles: [],
      },
      winRate: 0.5,
      pickRate: 0.1,
      games: 10,
    })),
  };
}

describe("getChampionMeta", () => {
  const file: MetaBuildFile = {
    patch: "16.7",
    region: "na1",
    queueId: 450,
    queueName: "ARAM",
    collectedAt: "2026-04-09T00:00:00Z",
    champions: {
      "222": createChampion([{ items: [3031, 6672] }]),
    },
  };

  it("returns the champion entry when present", () => {
    const result = getChampionMeta(file, 222);
    expect(result?.championName).toBe("TestChamp");
  });

  it("returns null when the champion is missing", () => {
    expect(getChampionMeta(file, 999)).toBeNull();
  });

  it("returns null when the file is null", () => {
    expect(getChampionMeta(null, 222)).toBeNull();
  });
});

describe("deriveMetaItemPool", () => {
  it("returns an empty array for a null champion", () => {
    expect(deriveMetaItemPool(null)).toEqual([]);
  });

  it("returns an empty array when the champion has no builds", () => {
    expect(deriveMetaItemPool(createChampion([]))).toEqual([]);
  });

  it("extracts unique item IDs across all builds", () => {
    const champion = createChampion([
      { items: [1001, 1002, 1003] },
      { items: [1002, 1004, 1005] },
    ]);
    const result = deriveMetaItemPool(champion);
    expect(new Set(result)).toEqual(new Set([1001, 1002, 1003, 1004, 1005]));
  });

  it("orders items by frequency across builds (most common first)", () => {
    // 1001 appears in 3 builds, 1002 in 2, 1003 in 1
    const champion = createChampion([
      { items: [1001, 1002, 1003] },
      { items: [1001, 1002] },
      { items: [1001] },
    ]);
    const result = deriveMetaItemPool(champion);
    expect(result[0]).toBe(1001);
    expect(result[1]).toBe(1002);
    expect(result[2]).toBe(1003);
  });
});

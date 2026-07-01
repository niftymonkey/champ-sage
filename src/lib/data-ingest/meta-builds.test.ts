import { describe, it, expect } from "vitest";
import {
  deriveMetaItemPool,
  deriveMetaItemPoolEntries,
  deriveRecommendedSpells,
  getChampionMeta,
  loadMetaBuilds,
  type MetaBuildFile,
  type MetaBuildChampion,
  type MetaBuildItemPoolEntry,
  type MetaBuildSpell,
} from "./meta-builds";

function championWithSpells(
  popularSpells: MetaBuildSpell[] | undefined
): MetaBuildChampion {
  return {
    championName: "TestChamp",
    sampleSize: 100,
    builds: [],
    popularSpells,
  };
}

function championWithItemPool(
  itemPool: MetaBuildItemPoolEntry[],
  builds: Array<{ items: number[] }> = []
): MetaBuildChampion {
  return {
    ...createChampion(builds),
    itemPool,
  };
}

function spell(spells: number[], picks: number): MetaBuildSpell {
  return { spells, picks, wins: 0, pickRate: 0, winRate: 0 };
}

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

  it("prefers the presence-sourced itemPool over legacy builds", () => {
    // itemPool present (ranked by presence), builds carry unrelated ids. The
    // pool must come from itemPool, in its given order, ignoring builds entirely.
    const champion = championWithItemPool(
      [
        { itemId: 3089, presence: 0.62 },
        { itemId: 3157, presence: 0.28 },
      ],
      [{ items: [9001, 9002] }]
    );
    expect(deriveMetaItemPool(champion)).toEqual([3089, 3157]);
  });

  it("falls back to legacy builds when itemPool is absent", () => {
    // Legacy ranked-solo/arena file: no itemPool, so the pool is derived from
    // build-cluster item frequency (1001 in two builds leads).
    const champion = createChampion([
      { items: [1001, 1002] },
      { items: [1001, 1003] },
    ]);
    expect(deriveMetaItemPool(champion)).toEqual([1001, 1002, 1003]);
  });
});

describe("deriveMetaItemPoolEntries", () => {
  it("returns an empty array for a null champion", () => {
    expect(deriveMetaItemPoolEntries(null)).toEqual([]);
  });

  it("returns itemPool entries with their presence rates, in order", () => {
    const champion = championWithItemPool([
      { itemId: 3089, presence: 0.62 },
      { itemId: 3157, presence: 0.28 },
    ]);
    expect(deriveMetaItemPoolEntries(champion)).toEqual([
      { itemId: 3089, presence: 0.62 },
      { itemId: 3157, presence: 0.28 },
    ]);
  });

  it("reports a null presence for legacy build-derived entries", () => {
    const champion = createChampion([
      { items: [1001, 1002] },
      { items: [1001] },
    ]);
    expect(deriveMetaItemPoolEntries(champion)).toEqual([
      { itemId: 1001, presence: null },
      { itemId: 1002, presence: null },
    ]);
  });

  it("returns an empty array when neither itemPool nor builds have data", () => {
    expect(deriveMetaItemPoolEntries(createChampion([]))).toEqual([]);
    expect(deriveMetaItemPoolEntries(championWithItemPool([]))).toEqual([]);
  });

  it("honors a present-but-empty itemPool and does NOT fall back to builds", () => {
    // A current-pipeline champion whose presence pool computed to empty (nothing
    // cleared the floor) but that still has legacy build clusters. The empty
    // itemPool is authoritative; the noisy clusters must NOT resurface.
    const champion = championWithItemPool([], [{ items: [1001, 1002] }]);
    expect(deriveMetaItemPoolEntries(champion)).toEqual([]);
    expect(deriveMetaItemPool(champion)).toEqual([]);
  });
});

describe("loadMetaBuilds", () => {
  function fakeFile(queueName: string): MetaBuildFile {
    return {
      patch: "16.99",
      region: "na1",
      queueId: 450,
      queueName,
      collectedAt: "2026-06-21T00:00:00Z",
      champions: { "222": createChampion([{ items: [3031, 6672] }]) },
    };
  }

  // Module map shaped like Vite's import.meta.glob output: relative path to a
  // lazy importer whose resolved module has the file under `default`.
  function fakeModules(
    files: Record<string, MetaBuildFile>
  ): Record<string, () => Promise<unknown>> {
    return Object.fromEntries(
      Object.entries(files).map(([path, file]) => [
        path,
        async () => ({ default: file }),
      ])
    );
  }

  it("loads each queue from its promoted file and leaves missing queues null", async () => {
    const index = await loadMetaBuilds(
      fakeModules({
        "../../data/meta-builds/aram.json": fakeFile("ARAM"),
      })
    );
    expect(index.aram?.queueName).toBe("ARAM");
    expect(index.rankedSolo).toBeNull();
    expect(index.arena).toBeNull();
  });

  it("does not load a staging .new.json as the live queue file", async () => {
    // arena.new.json is an un-promoted staging file; the live loader must
    // ignore it so the app never serves un-reviewed data.
    const index = await loadMetaBuilds(
      fakeModules({
        "../../data/meta-builds/arena.new.json": fakeFile("Arena"),
      })
    );
    expect(index.arena).toBeNull();
  });

  it("degrades to an all-null index when no module map is available", async () => {
    // `null` is the explicit "no map" signal that exercises the degrade guard
    // directly, mirroring the offline tsx harnesses (audit-augments /
    // dump-data) where the Vite glob transform is absent and acquireGlobModules
    // returns null. The previous `typeof import.meta.glob` guard handled this
    // but also fired in the production renderer, silently stripping the meta
    // item pool from coaching prompts. An empty map ({}) would instead pass
    // through loadFile and is not the same code path.
    const index = await loadMetaBuilds(null);
    expect(index).toEqual({ aram: null, rankedSolo: null, arena: null });
  });
});

describe("deriveRecommendedSpells", () => {
  it("returns the most-picked pair as a tuple", () => {
    const champion = championWithSpells([
      spell([4, 32], 30),
      spell([4, 14], 6),
    ]);
    expect(deriveRecommendedSpells(champion)).toEqual([4, 32]);
  });

  it("returns undefined for a null champion", () => {
    expect(deriveRecommendedSpells(null)).toBeUndefined();
  });

  it("returns undefined when the champion has no popular spells", () => {
    expect(
      deriveRecommendedSpells(championWithSpells(undefined))
    ).toBeUndefined();
    expect(deriveRecommendedSpells(championWithSpells([]))).toBeUndefined();
  });

  it("returns undefined when the top pair is incomplete", () => {
    expect(
      deriveRecommendedSpells(championWithSpells([spell([4], 30)]))
    ).toBeUndefined();
  });
});

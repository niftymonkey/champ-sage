import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  loadGameData,
  loadCachedGameData,
  checkForNewVersion,
  mergeMayhemAugments,
  kiwiResolutionStats,
  KIWI_MIN_RESOLUTION_RATE,
} from "./index";
import * as dataDragon from "./sources/data-dragon";
import * as wikiAugments from "./sources/wiki-augments";
import * as arenaAugments from "./sources/wiki-arena-augments";
import * as kiwiAugments from "./sources/cdragon-kiwi-augments";
import * as communityDragon from "./sources/community-dragon";
import * as aramOverrides from "./sources/wiki-aram-overrides";
import * as cache from "./cache";
import type { AramOverrides, Champion, Item, Augment, RuneTree } from "./types";

vi.mock("./sources/data-dragon");
vi.mock("./sources/wiki-augments");
vi.mock("./sources/wiki-arena-augments");
vi.mock("./sources/cdragon-kiwi-augments");
// Partial mock: only the network call (mergeAugmentIds) is stubbed. The pure
// helpers normalizeForMatch / MISSING_DESCRIPTION_PLACEHOLDER stay real because
// mergeMayhemAugments (under test here) depends on them.
vi.mock("./sources/community-dragon", async (importOriginal) => {
  const actual = await importOriginal<typeof communityDragon>();
  return {
    ...actual,
    mergeAugmentIds: vi.fn(),
  };
});
vi.mock("./sources/wiki-aram-overrides");
vi.mock("./cache", async (importOriginal) => {
  const actual = await importOriginal<typeof cache>();
  return {
    ...actual,
    readCache: vi.fn(),
    writeCache: vi.fn(),
  };
});

function createMockChampions() {
  return new Map<string, Champion>([
    [
      "aatrox",
      {
        id: "Aatrox",
        key: 266,
        name: "Aatrox",
        title: "the Darkin Blade",
        tags: ["Fighter"],
        partype: "Blood Well",
        stats: {} as Champion["stats"],
        image: "",
      },
    ],
  ]);
}

const mockItems = new Map<number, Item>([
  [
    1001,
    {
      id: 1001,
      name: "Boots",
      description: "Move Speed",
      plaintext: "",
      gold: { base: 300, total: 300, sell: 210, purchasable: true },
      tags: [],
      stats: {},
      image: "",
      mode: "standard",
    },
  ],
]);

const mockRunes: RuneTree[] = [
  {
    id: 8100,
    key: "Domination",
    name: "Domination",
    icon: "",
    keystones: [],
    slots: [],
  },
];

const mockMayhemAugments = new Map<string, Augment>([
  [
    "typhoon",
    {
      name: "Typhoon",
      description: "Storm damage",
      tier: "Gold",
      sets: [],
      mode: "mayhem",
    },
  ],
]);

const mockArenaAugments = new Map<string, Augment>([
  [
    "blade waltz",
    {
      name: "Blade Waltz",
      description: "Attack speed bonus",
      tier: "Silver",
      sets: [],
      mode: "arena",
    },
  ],
  [
    "typhoon",
    {
      name: "Typhoon",
      description: "Arena storm damage",
      tier: "Gold",
      sets: [],
      mode: "arena",
    },
  ],
]);

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(cache.readCache).mockResolvedValue(null);
  vi.mocked(cache.writeCache).mockResolvedValue(undefined);
  vi.mocked(dataDragon.fetchLatestVersion).mockResolvedValue("15.6.1");
  vi.mocked(dataDragon.fetchChampions).mockResolvedValue(createMockChampions());
  vi.mocked(dataDragon.fetchItems).mockResolvedValue(mockItems);
  vi.mocked(dataDragon.fetchRunes).mockResolvedValue(mockRunes);
  // KIWI (CDragon raw) is the primary Mayhem source; the wiki is the fallback
  // (empty by default so each test opts into the fallback scenario it needs).
  vi.mocked(kiwiAugments.fetchKiwiAugments).mockResolvedValue(
    mockMayhemAugments
  );
  vi.mocked(wikiAugments.fetchWikiAugments).mockResolvedValue(new Map());
  vi.mocked(arenaAugments.fetchArenaAugments).mockResolvedValue(
    mockArenaAugments
  );
  vi.mocked(communityDragon.mergeAugmentIds).mockResolvedValue(undefined);
  vi.mocked(aramOverrides.fetchAramOverrides).mockResolvedValue(new Map());
});

describe("loadGameData", () => {
  it("fetches and returns all game data", async () => {
    const data = await loadGameData();

    expect(data.version).toBe("15.6.1");
    expect(data.champions.size).toBe(1);
    expect(data.items.size).toBe(1);
    expect(data.runes).toHaveLength(1);
    expect(data.augments.size).toBe(3); // 1 mayhem + 1 arena unique + 1 arena collision
    expect(data.augmentSets).toHaveLength(0); // Traits removed in 26.12 Mayhem rework
  });

  it("calls all data sources", async () => {
    await loadGameData();

    expect(dataDragon.fetchLatestVersion).toHaveBeenCalled();
    expect(dataDragon.fetchChampions).toHaveBeenCalledWith("15.6.1");
    expect(dataDragon.fetchItems).toHaveBeenCalledWith("15.6.1");
    expect(dataDragon.fetchRunes).toHaveBeenCalledWith("15.6.1");
    expect(kiwiAugments.fetchKiwiAugments).toHaveBeenCalled();
    expect(wikiAugments.fetchWikiAugments).toHaveBeenCalled();
    expect(arenaAugments.fetchArenaAugments).toHaveBeenCalled();
    // mergeAugmentIds receives the combined mayhem + arena map
    const mergedMap = vi.mocked(communityDragon.mergeAugmentIds).mock
      .calls[0][0];
    expect(mergedMap.has("typhoon")).toBe(true);
    expect(mergedMap.has("blade waltz")).toBe(true);
    expect(aramOverrides.fetchAramOverrides).toHaveBeenCalled();
  });

  it("writes fetched data to cache", async () => {
    await loadGameData();

    expect(cache.writeCache).toHaveBeenCalled();
  });

  it("returns cached data when available (production mode)", async () => {
    // loadGameData skips cache in dev mode, so simulate production
    const origDev = import.meta.env.DEV;
    import.meta.env.DEV = false;

    vi.mocked(cache.readCache).mockResolvedValue({
      version: "15.5.1",
      champions: { aatrox: createMockChampions().get("aatrox") },
      items: { "1001": mockItems.get(1001) },
      runes: mockRunes,
      augments: { typhoon: mockMayhemAugments.get("typhoon") },
      augmentSets: [],
    });

    const data = await loadGameData();

    expect(data.version).toBe("15.5.1");
    expect(data.champions.size).toBe(1);
    // Should not have called network fetchers
    expect(dataDragon.fetchLatestVersion).not.toHaveBeenCalled();

    import.meta.env.DEV = origDev;
  });

  it("returns entity dictionary that can search", async () => {
    const data = await loadGameData();

    expect(data.dictionary).toBeDefined();
    expect(data.dictionary.champions).toContain("Aatrox");
    expect(data.dictionary.items).toContain("Boots");
    expect(data.dictionary.augments).toContain("Typhoon");
    expect(data.dictionary.augments).toContain("Blade Waltz");

    const results = data.dictionary.search("aatrox");
    expect(results[0].name).toBe("Aatrox");
    expect(results[0].type).toBe("champion");
  });

  it("stores cross-mode augment collisions with arena: prefix", async () => {
    const data = await loadGameData();

    // Mayhem version stored under plain key
    const mayhemTyphoon = data.augments.get("typhoon");
    expect(mayhemTyphoon).toBeDefined();
    expect(mayhemTyphoon!.mode).toBe("mayhem");

    // Arena version stored under prefixed key
    const arenaTyphoon = data.augments.get("arena:typhoon");
    expect(arenaTyphoon).toBeDefined();
    expect(arenaTyphoon!.mode).toBe("arena");
    expect(arenaTyphoon!.description).toBe("Arena storm damage");

    // Arena-only augment stored under plain key
    const bladeWaltz = data.augments.get("blade waltz");
    expect(bladeWaltz).toBeDefined();
    expect(bladeWaltz!.mode).toBe("arena");
  });

  it("merges ARAM overrides onto matching champions", async () => {
    const mockOverrides = new Map<string, AramOverrides>([
      ["aatrox", { dmgDealt: 1.05, dmgTaken: 1 }],
    ]);
    vi.mocked(aramOverrides.fetchAramOverrides).mockResolvedValue(
      mockOverrides
    );

    const data = await loadGameData();
    const aatrox = data.champions.get("aatrox");
    expect(aatrox!.aramOverrides).toEqual({ dmgDealt: 1.05, dmgTaken: 1 });
  });

  it("leaves aramOverrides undefined for champions without overrides", async () => {
    vi.mocked(aramOverrides.fetchAramOverrides).mockResolvedValue(new Map());

    const data = await loadGameData();
    const aatrox = data.champions.get("aatrox");
    expect(aatrox!.aramOverrides).toBeUndefined();
  });

  it("writes lastRefreshedAt timestamp to cache", async () => {
    const before = Date.now();
    await loadGameData();
    const after = Date.now();

    const writtenData = vi.mocked(cache.writeCache).mock.calls[0][1] as {
      lastRefreshedAt: number;
    };
    expect(writtenData.lastRefreshedAt).toBeGreaterThanOrEqual(before);
    expect(writtenData.lastRefreshedAt).toBeLessThanOrEqual(after);
  });
});

describe("loadCachedGameData", () => {
  it("returns data when cache hit", async () => {
    const origDev = import.meta.env.DEV;
    import.meta.env.DEV = false;

    vi.mocked(cache.readCache).mockResolvedValue({
      version: "15.6.1",
      champions: { aatrox: createMockChampions().get("aatrox") },
      items: { "1001": mockItems.get(1001) },
      runes: mockRunes,
      augments: { typhoon: mockMayhemAugments.get("typhoon") },
      augmentSets: [],
      lastRefreshedAt: 1000,
    });

    const data = await loadCachedGameData();

    expect(data).not.toBeNull();
    expect(data!.version).toBe("15.6.1");
    expect(data!.champions.size).toBe(1);
    expect(dataDragon.fetchLatestVersion).not.toHaveBeenCalled();

    import.meta.env.DEV = origDev;
  });

  it("returns null when cache miss", async () => {
    const origDev = import.meta.env.DEV;
    import.meta.env.DEV = false;

    vi.mocked(cache.readCache).mockResolvedValue(null);

    const data = await loadCachedGameData();

    expect(data).toBeNull();

    import.meta.env.DEV = origDev;
  });
});

describe("loadGameData ingest-failure fallback", () => {
  it("returns the last cached payload when a hard source throws", async () => {
    // A hard dependency failing (here Data Dragon) must not blank the app. If a
    // prior fetch succeeded and is still cached, loadGameData has to surface
    // that data instead of propagating the error.
    vi.mocked(dataDragon.fetchChampions).mockRejectedValue(
      new Error("data dragon outage")
    );
    vi.mocked(cache.readCache).mockResolvedValue({
      version: "15.6.1",
      champions: { aatrox: createMockChampions().get("aatrox") },
      items: { "1001": mockItems.get(1001) },
      runes: mockRunes,
      augments: { typhoon: mockMayhemAugments.get("typhoon") },
      augmentSets: [],
      lastRefreshedAt: 1000,
    });

    const data = await loadGameData();

    expect(data.version).toBe("15.6.1");
    expect(data.champions.size).toBe(1);
  });

  it("propagates the ingest error when no cached payload exists", async () => {
    vi.mocked(dataDragon.fetchChampions).mockRejectedValue(
      new Error("data dragon outage")
    );
    vi.mocked(cache.readCache).mockResolvedValue(null);

    await expect(loadGameData()).rejects.toThrow(/data dragon outage/);
  });

  it("tolerates a wiki outage by serving CDragon-raw Mayhem descriptions", async () => {
    // The wiki is now only the fallback. With it down, the raw KIWI source up,
    // and a cold cache, ingest must still produce real Mayhem text rather than
    // failing through to the cache.
    vi.mocked(wikiAugments.fetchWikiAugments).mockRejectedValue(
      new Error("wiki 503")
    );
    vi.mocked(kiwiAugments.fetchKiwiAugments).mockResolvedValue(
      new Map<string, Augment>([
        [
          "typhoon",
          {
            name: "Typhoon",
            description: "Raw storm damage",
            tier: "Gold",
            sets: [],
            mode: "mayhem",
          },
        ],
      ])
    );
    vi.mocked(cache.readCache).mockResolvedValue(null);

    const data = await loadGameData();

    const typhoon = data.augments.get("typhoon");
    expect(typhoon?.mode).toBe("mayhem");
    expect(typhoon?.description).toBe("Raw storm damage");
  });
});

describe("patchline-aware loading", () => {
  it("writes pbe data under the pbe-namespaced cache key", async () => {
    await loadGameData("pbe");

    expect(cache.writeCache).toHaveBeenCalledWith(
      "game-data:pbe",
      expect.anything()
    );
  });

  it("defaults to the live-namespaced cache key", async () => {
    await loadGameData();

    expect(cache.writeCache).toHaveBeenCalledWith(
      "game-data:live",
      expect.anything()
    );
  });

  it("passes the patchline through to mergeAugmentIds", async () => {
    await loadGameData("pbe");

    expect(communityDragon.mergeAugmentIds).toHaveBeenCalledWith(
      expect.any(Map),
      "pbe"
    );
  });

  it("passes the patchline through to fetchKiwiAugments", async () => {
    await loadGameData("pbe");

    expect(kiwiAugments.fetchKiwiAugments).toHaveBeenCalledWith("pbe");
  });

  it("reads the pbe-namespaced cache key in production mode", async () => {
    const origDev = import.meta.env.DEV;
    import.meta.env.DEV = false;
    vi.mocked(cache.readCache).mockResolvedValue(null);

    await loadGameData("pbe");

    expect(cache.readCache).toHaveBeenCalledWith("game-data:pbe");

    import.meta.env.DEV = origDev;
  });

  it("fetches under the patchline namespace on a production cache miss", async () => {
    // Production mode + cold cache falls through to fetchAndCacheWithFallback;
    // the patchline must survive that hop, not silently revert to "live".
    const origDev = import.meta.env.DEV;
    import.meta.env.DEV = false;
    vi.mocked(cache.readCache).mockResolvedValue(null);

    await loadGameData("pbe");

    expect(communityDragon.mergeAugmentIds).toHaveBeenCalledWith(
      expect.any(Map),
      "pbe"
    );
    expect(cache.writeCache).toHaveBeenCalledWith(
      "game-data:pbe",
      expect.anything()
    );

    import.meta.env.DEV = origDev;
  });

  it("reads the pbe-namespaced cache key in loadCachedGameData", async () => {
    await loadCachedGameData("pbe");

    expect(cache.readCache).toHaveBeenCalledWith("game-data:pbe");
  });
});

describe("mergeMayhemAugments", () => {
  const aug = (over: Partial<Augment> & { name: string }): Augment => ({
    description: "",
    tier: "Silver",
    sets: [],
    mode: "mayhem",
    ...over,
  });

  it("keeps the raw KIWI description over the wiki's", () => {
    const kiwi = new Map([
      ["typhoon", aug({ name: "Typhoon", description: "Raw storm" })],
    ]);
    const wiki = new Map([
      ["typhoon", aug({ name: "Typhoon", description: "Wiki storm" })],
    ]);

    expect(mergeMayhemAugments(kiwi, wiki).get("typhoon")?.description).toBe(
      "Raw storm"
    );
  });

  it("fills an empty raw description from the wiki", () => {
    const kiwi = new Map([
      ["typhoon", aug({ name: "Typhoon", description: "" })],
    ]);
    const wiki = new Map([
      ["typhoon", aug({ name: "Typhoon", description: "Wiki storm" })],
    ]);

    expect(mergeMayhemAugments(kiwi, wiki).get("typhoon")?.description).toBe(
      "Wiki storm"
    );
  });

  it("adds a wiki Mayhem augment the raw source did not supply", () => {
    const kiwi = new Map([
      ["typhoon", aug({ name: "Typhoon", description: "Raw storm" })],
    ]);
    const wiki = new Map([
      ["flux", aug({ name: "Flux", description: "Wiki flux" })],
    ]);

    const merged = mergeMayhemAugments(kiwi, wiki);
    expect(merged.size).toBe(2);
    expect(merged.get("flux")?.description).toBe("Wiki flux");
  });

  it("falls back to the placeholder when neither source has a description", () => {
    const kiwi = new Map([
      ["typhoon", aug({ name: "Typhoon", description: "" })],
    ]);

    expect(
      mergeMayhemAugments(kiwi, new Map()).get("typhoon")?.description
    ).toBe(communityDragon.MISSING_DESCRIPTION_PLACEHOLDER);
  });

  it("matches across punctuation differences when filling descriptions", () => {
    const kiwi = new Map([
      ["get excited", aug({ name: "Get Excited", description: "" })],
    ]);
    const wiki = new Map([
      [
        "get excited!",
        aug({ name: "Get Excited!", description: "Wiki excite" }),
      ],
    ]);

    expect(
      mergeMayhemAugments(kiwi, wiki).get("get excited")?.description
    ).toBe("Wiki excite");
  });

  it("does not mutate the input KIWI augment objects when filling", () => {
    const kiwiAug = aug({ name: "Typhoon", description: "" });
    const kiwi = new Map([["typhoon", kiwiAug]]);
    const wiki = new Map([
      ["typhoon", aug({ name: "Typhoon", description: "Wiki storm" })],
    ]);

    mergeMayhemAugments(kiwi, wiki);
    expect(kiwiAug.description).toBe("");
  });
});

describe("kiwiResolutionStats", () => {
  const aug = (description: string): Augment => ({
    name: "x",
    description,
    tier: "Silver",
    sets: [],
    mode: "mayhem",
  });

  it("counts non-empty descriptions and computes the rate", () => {
    const kiwi = new Map([
      ["a", aug("real")],
      ["b", aug("")],
      ["c", aug("real")],
      ["d", aug("real")],
    ]);

    const stats = kiwiResolutionStats(kiwi);
    expect(stats.total).toBe(4);
    expect(stats.nonEmpty).toBe(3);
    expect(stats.rate).toBeCloseTo(0.75);
  });

  it("reports a zero rate for an empty map (raw source yielded nothing)", () => {
    const stats = kiwiResolutionStats(new Map());
    expect(stats).toEqual({ total: 0, nonEmpty: 0, rate: 0 });
    expect(stats.rate).toBeLessThan(KIWI_MIN_RESOLUTION_RATE);
  });

  it("treats a fully-resolved set as at or above the trust threshold", () => {
    const kiwi = new Map([
      ["a", aug("real")],
      ["b", aug("real")],
    ]);

    expect(kiwiResolutionStats(kiwi).rate).toBeGreaterThanOrEqual(
      KIWI_MIN_RESOLUTION_RATE
    );
  });
});

describe("checkForNewVersion", () => {
  it("returns false when versions match", async () => {
    vi.mocked(dataDragon.fetchLatestVersion).mockResolvedValue("15.6.1");

    const result = await checkForNewVersion("15.6.1");

    expect(result).toBe(false);
  });

  it("returns true when versions differ", async () => {
    vi.mocked(dataDragon.fetchLatestVersion).mockResolvedValue("15.7.1");

    const result = await checkForNewVersion("15.6.1");

    expect(result).toBe(true);
  });

  it("returns false when fetch fails (avoid thundering herd)", async () => {
    vi.mocked(dataDragon.fetchLatestVersion).mockRejectedValue(
      new Error("Network error")
    );

    const result = await checkForNewVersion("15.6.1");

    expect(result).toBe(false);
  });
});

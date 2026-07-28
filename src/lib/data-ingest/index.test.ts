import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  loadGameData,
  loadCachedGameData,
  checkForNewVersion,
  mergeMayhemAugments,
  kiwiResolutionStats,
  mergeAbilityScaling,
  mergeItemMutexGroups,
  KIWI_MIN_RESOLUTION_RATE,
} from "./index";
import type { ChampionAbilityScaling } from "./sources/wiki-champion-abilities";
import * as wikiChampionAbilities from "./sources/wiki-champion-abilities";
import * as dataDragon from "./sources/data-dragon";
import * as wikiAugments from "./sources/wiki-augments";
import * as arenaAugments from "./sources/wiki-arena-augments";
import * as kiwiAugments from "./sources/cdragon-kiwi-augments";
import * as communityDragon from "./sources/community-dragon";
import * as aramOverrides from "./sources/wiki-aram-overrides";
import * as wikiItemGroups from "./sources/wiki-item-groups";
import * as cache from "./cache";
import type {
  AramOverrides,
  Champion,
  Item,
  Augment,
  RuneTree,
  AbilitySpell,
} from "./types";

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
vi.mock("./sources/wiki-item-groups");
// Partial mock: only the network call is stubbed, so the real
// describeQuarantineReason stays available to any caller that needs it.
vi.mock("./sources/wiki-champion-abilities", async (importOriginal) => {
  const actual = await importOriginal<typeof wikiChampionAbilities>();
  return {
    ...actual,
    fetchChampionAbilityScaling: vi.fn(),
  };
});
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

function createMockAbilities() {
  return new Map([
    [
      "aatrox",
      {
        passive: {
          name: "Deathbringer Stance",
          description: "Periodically, Aatrox's next attack deals bonus damage.",
        },
        spells: [
          {
            id: "AatroxQ",
            name: "The Darkin Blade",
            description: "Aatrox slams his greatsword down.",
            maxRank: 5,
            cooldowns: [14, 12, 10, 8, 6],
            costs: [0, 0, 0, 0, 0],
            range: [650, 650, 650, 650, 650],
          },
        ],
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
      maps: [11, 12],
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
  vi.mocked(dataDragon.fetchAllChampionAbilities).mockResolvedValue(
    createMockAbilities()
  );
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
  vi.mocked(wikiItemGroups.fetchItemMutexGroups).mockResolvedValue(new Map());
  vi.mocked(
    wikiChampionAbilities.fetchChampionAbilityScaling
  ).mockResolvedValue({
    byChampion: new Map(),
    diagnostics: {
      abilitiesRequested: 0,
      abilitiesWithScaling: 0,
      statsAccepted: 0,
      statsQuarantined: 0,
      quarantineReasons: new Map(),
      quarantineExamples: new Map(),
    },
  });
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

  it("still caches game data when the ability scaling wiki fetch fails", async () => {
    // Scaling is an enhancement, so a wiki outage must cost prompts their
    // damage numbers, never cost the app its game data.
    vi.mocked(
      wikiChampionAbilities.fetchChampionAbilityScaling
    ).mockRejectedValue(new Error("wiki is down"));

    const data = await loadGameData();

    expect(cache.writeCache).toHaveBeenCalled();
    expect(data.champions.size).toBe(1);
  });

  it("attaches wiki scaling to champion abilities before caching", async () => {
    vi.mocked(
      wikiChampionAbilities.fetchChampionAbilityScaling
    ).mockResolvedValue({
      byChampion: new Map<string, ChampionAbilityScaling>([
        [
          "aatrox",
          { slots: { Q: [{ label: "Damage", value: "10 to 70 (+ 60% AD)" }] } },
        ],
      ]),
      diagnostics: {
        abilitiesRequested: 4,
        abilitiesWithScaling: 1,
        statsAccepted: 1,
        statsQuarantined: 0,
        quarantineReasons: new Map(),
        quarantineExamples: new Map(),
      },
    });

    await loadGameData();

    const cached = vi.mocked(cache.writeCache).mock.calls[0][1] as {
      champions: Record<string, Champion>;
    };
    expect(cached.champions.aatrox.abilities?.spells[0].scaling).toEqual([
      { label: "Damage", value: "10 to 70 (+ 60% AD)" },
    ]);
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

describe("champion abilities in the cached payload", () => {
  it("merges abilities onto champions during ingest", async () => {
    const data = await loadGameData();

    const aatrox = data.champions.get("aatrox");
    expect(aatrox!.abilities).toBeDefined();
    expect(aatrox!.abilities!.passive.name).toBe("Deathbringer Stance");
    expect(aatrox!.abilities!.spells[0].name).toBe("The Darkin Blade");
  });

  it("looks abilities up by DDragon id, not by champion map key", async () => {
    // Champions are keyed by lowercase NAME ("aurelion sol") but abilities
    // come back keyed by lowercase ID ("aurelionsol"). A merge that uses the
    // map key would silently miss every multi-word champion.
    vi.mocked(dataDragon.fetchChampions).mockResolvedValue(
      new Map<string, Champion>([
        [
          "aurelion sol",
          {
            id: "AurelionSol",
            key: 136,
            name: "Aurelion Sol",
            title: "The Star Forger",
            tags: ["Mage"],
            partype: "Mana",
            stats: {} as Champion["stats"],
            image: "",
          },
        ],
      ])
    );
    vi.mocked(dataDragon.fetchAllChampionAbilities).mockResolvedValue(
      new Map([
        [
          "aurelionsol",
          {
            passive: { name: "Cosmic Creator", description: "Stardust." },
            spells: [],
          },
        ],
      ])
    );

    const data = await loadGameData();

    expect(data.champions.get("aurelion sol")!.abilities!.passive.name).toBe(
      "Cosmic Creator"
    );
  });

  it("writes abilities into the cache payload", async () => {
    // The regression this guards: abilities resolved AFTER the cache write
    // never persist, so every session starts ability-less and has to race a
    // network fetch it loses.
    await loadGameData();

    const [, payload] = vi.mocked(cache.writeCache).mock.calls[0];
    const cached = payload as { champions: Record<string, Champion> };
    expect(cached.champions.aatrox.abilities).toBeDefined();
    expect(cached.champions.aatrox.abilities!.passive.name).toBe(
      "Deathbringer Stance"
    );
  });

  it("still returns champions when the abilities fetch fails", async () => {
    vi.mocked(dataDragon.fetchAllChampionAbilities).mockResolvedValue(
      new Map()
    );

    const data = await loadGameData();

    expect(data.champions.get("aatrox")).toBeDefined();
    expect(data.champions.get("aatrox")!.abilities).toBeUndefined();
  });

  it("does NOT cache when abilities resolve but fail to match any champion", async () => {
    // The fetch succeeding is not the same as champions HAVING abilities. If
    // DDragon ever changes its id format, every merge misses while the fetched
    // map is full, and a size-of-fetch guard would happily cache an
    // ability-less payload forever. Guard on coverage, not on fetch success.
    vi.mocked(dataDragon.fetchAllChampionAbilities).mockResolvedValue(
      new Map([
        [
          "some-unrecognized-id",
          {
            passive: { name: "Whatever", description: "Unmatched." },
            spells: [],
          },
        ],
      ])
    );

    await loadGameData();

    expect(cache.writeCache).not.toHaveBeenCalled();
  });

  it("does NOT cache the payload when the abilities fetch fails", async () => {
    // Caching an ability-less payload would persist the very bug this fixes:
    // every later start would read abilities-free champions straight from the
    // cache and never retry, until the patch version happened to change.
    // Degrade for this session, but leave the next start free to retry.
    vi.mocked(dataDragon.fetchAllChampionAbilities).mockResolvedValue(
      new Map()
    );

    await loadGameData();

    expect(cache.writeCache).not.toHaveBeenCalled();
  });

  it("does NOT cache the payload when the abilities fetch REJECTS", async () => {
    // A network drop rejects rather than resolving empty, which reaches the
    // guard by a different path (the catch in fetchAndCache). Same rule has
    // to hold: degrade for the session, cache nothing, retry next start.
    vi.mocked(dataDragon.fetchAllChampionAbilities).mockRejectedValue(
      new Error("ECONNRESET")
    );

    const data = await loadGameData();

    expect(cache.writeCache).not.toHaveBeenCalled();
    expect(data.champions.get("aatrox")).toBeDefined();
    expect(data.champions.get("aatrox")!.abilities).toBeUndefined();
  });
});

describe("mergeAbilityScaling", () => {
  function makeSpell(id: string, name: string): AbilitySpell {
    return {
      id,
      name,
      description: "does a thing",
      maxRank: 5,
      cooldowns: [7],
      costs: [55],
      range: [970],
    };
  }

  function makeChampionWithAbilities(
    key: string,
    name: string
  ): Map<string, Champion> {
    return new Map<string, Champion>([
      [
        key,
        {
          id: name.replace(/[^A-Za-z]/g, ""),
          key: 1,
          name,
          title: "the Tested",
          tags: [],
          partype: "Mana",
          stats: {} as Champion["stats"],
          image: "",
          abilities: {
            passive: { name: "Passive", description: "passive text" },
            spells: [
              makeSpell("Q1", "First"),
              makeSpell("W1", "Second"),
              makeSpell("E1", "Third"),
              makeSpell("R1", "Fourth"),
            ],
          },
        },
      ],
    ]);
  }

  it("attaches scaling to the spell in the matching slot", () => {
    const champions = makeChampionWithAbilities("ahri", "Ahri");
    const scaling = new Map<string, ChampionAbilityScaling>([
      [
        "ahri",
        {
          slots: {
            Q: [{ label: "Damage Per Pass", value: "35 to 135 (+ 50% AP)" }],
            R: [{ label: "Magic Damage", value: "75 to 175 (+ 35% AP)" }],
          },
        },
      ],
    ]);

    const merged = mergeAbilityScaling(champions, scaling);

    const spells = champions.get("ahri")!.abilities!.spells;
    expect(spells[0].scaling).toEqual([
      { label: "Damage Per Pass", value: "35 to 135 (+ 50% AP)" },
    ]);
    expect(spells[3].scaling).toEqual([
      { label: "Magic Damage", value: "75 to 175 (+ 35% AP)" },
    ]);
    expect(merged).toBe(2);
  });

  it("leaves a slot with no wiki scaling untouched", () => {
    const champions = makeChampionWithAbilities("ahri", "Ahri");
    const scaling = new Map<string, ChampionAbilityScaling>([
      ["ahri", { slots: { Q: [{ label: "Damage", value: "10 to 20" }] } }],
    ]);

    mergeAbilityScaling(champions, scaling);

    const spells = champions.get("ahri")!.abilities!.spells;
    expect(spells[1].scaling).toBeUndefined();
    expect(spells[2].scaling).toBeUndefined();
  });

  it("matches multi-word champions by name, not by DDragon id", () => {
    const champions = makeChampionWithAbilities("aurelion sol", "Aurelion Sol");
    const scaling = new Map<string, ChampionAbilityScaling>([
      [
        "aurelion sol",
        { slots: { W: [{ label: "Magic Damage", value: "45 to 105" }] } },
      ],
    ]);

    const merged = mergeAbilityScaling(champions, scaling);

    expect(champions.get("aurelion sol")!.abilities!.spells[1].scaling).toEqual(
      [{ label: "Magic Damage", value: "45 to 105" }]
    );
    expect(merged).toBe(1);
  });

  it("merges nothing when the wiki returned no scaling", () => {
    const champions = makeChampionWithAbilities("ahri", "Ahri");

    const merged = mergeAbilityScaling(
      champions,
      new Map<string, ChampionAbilityScaling>()
    );

    expect(merged).toBe(0);
    expect(champions.get("ahri")!.abilities!.spells[0].scaling).toBeUndefined();
  });

  it("skips a champion whose abilities never resolved", () => {
    const champions = makeChampionWithAbilities("ahri", "Ahri");
    delete champions.get("ahri")!.abilities;
    const scaling = new Map<string, ChampionAbilityScaling>([
      ["ahri", { slots: { Q: [{ label: "Damage", value: "10 to 20" }] } }],
    ]);

    expect(mergeAbilityScaling(champions, scaling)).toBe(0);
  });

  it("ignores scaling for a champion absent from the roster", () => {
    const champions = makeChampionWithAbilities("ahri", "Ahri");
    const scaling = new Map<string, ChampionAbilityScaling>([
      ["nasus", { slots: { Q: [{ label: "Damage", value: "10 to 20" }] } }],
    ]);

    expect(mergeAbilityScaling(champions, scaling)).toBe(0);
  });

  it("replaces the DDragon passive with the wiki innate and keeps it when no innate came back", () => {
    const champions = new Map([
      ...makeChampionWithAbilities("ahri", "Ahri"),
      ...makeChampionWithAbilities("zed", "Zed"),
    ]);
    const scaling = new Map<string, ChampionAbilityScaling>([
      ["ahri", { slots: {}, innate: "Ahri heals for 18% of ability damage." }],
      ["zed", { slots: { Q: [{ label: "Damage", value: "10 to 20" }] } }],
    ]);

    const merged = mergeAbilityScaling(champions, scaling);

    expect(champions.get("ahri")!.abilities!.passive.description).toBe(
      "Ahri heals for 18% of ability damage."
    );
    expect(champions.get("zed")!.abilities!.passive.description).toBe(
      "passive text"
    );
    // The innate is prose on the passive, not a scaled spell: only Zed's Q counts.
    expect(merged).toBe(1);
  });
});

describe("mergeItemMutexGroups", () => {
  function makeItem(id: number, name: string): Item {
    return {
      id,
      name,
      description: "",
      plaintext: "",
      gold: { base: 0, total: 3000, sell: 2100, purchasable: true },
      tags: [],
      stats: {},
      image: "",
      mode: "standard",
      maps: [11, 12],
    };
  }

  it("attaches groups to items by lowercase name and reports the count", () => {
    const items = new Map<number, Item>([
      [3036, makeItem(3036, "Lord Dominik's Regards")],
      [3033, makeItem(3033, "Mortal Reminder")],
      [3802, makeItem(3802, "Lost Chapter")],
    ]);
    const groups = new Map<string, string[]>([
      ["lord dominik's regards", ["Fatality"]],
      ["mortal reminder", ["Fatality"]],
    ]);

    const merged = mergeItemMutexGroups(items, groups);

    expect(merged).toBe(2);
    expect(items.get(3036)!.mutexGroups).toEqual(["Fatality"]);
    expect(items.get(3033)!.mutexGroups).toEqual(["Fatality"]);
    expect(items.get(3802)!.mutexGroups).toBeUndefined();
  });

  it("attaches the same groups to every same-named variant", () => {
    const items = new Map<number, Item>([
      [3036, makeItem(3036, "Lord Dominik's Regards")],
      [223036, makeItem(223036, "Lord Dominik's Regards")],
    ]);
    const groups = new Map<string, string[]>([
      ["lord dominik's regards", ["Fatality"]],
    ]);

    expect(mergeItemMutexGroups(items, groups)).toBe(2);
    expect(items.get(223036)!.mutexGroups).toEqual(["Fatality"]);
  });

  it("is a no-op when the wiki fetch failed (null groups)", () => {
    const items = new Map<number, Item>([
      [3036, makeItem(3036, "Lord Dominik's Regards")],
    ]);

    expect(mergeItemMutexGroups(items, null)).toBe(0);
    expect(items.get(3036)!.mutexGroups).toBeUndefined();
  });

  it("copies group arrays so later mutation of the source cannot leak in", () => {
    const items = new Map<number, Item>([
      [3036, makeItem(3036, "Lord Dominik's Regards")],
    ]);
    const fatality = ["Fatality"];
    const groups = new Map<string, string[]>([
      ["lord dominik's regards", fatality],
    ]);

    mergeItemMutexGroups(items, groups);
    fatality.push("Poisoned");

    expect(items.get(3036)!.mutexGroups).toEqual(["Fatality"]);
  });
});

describe("loadGameData mutex-group ingestion", () => {
  it("persists wiki mutex groups on items in the cached payload", async () => {
    const freshItems = new Map<number, Item>([
      [
        3036,
        {
          id: 3036,
          name: "Lord Dominik's Regards",
          description: "",
          plaintext: "",
          gold: { base: 1100, total: 3300, sell: 2310, purchasable: true },
          tags: [],
          stats: {},
          image: "",
          mode: "standard",
          maps: [11, 12],
        },
      ],
    ]);
    vi.mocked(dataDragon.fetchItems).mockResolvedValue(freshItems);
    vi.mocked(wikiItemGroups.fetchItemMutexGroups).mockResolvedValue(
      new Map([["lord dominik's regards", ["Fatality"]]])
    );

    const data = await loadGameData();

    expect(data.items.get(3036)!.mutexGroups).toEqual(["Fatality"]);
    const written = vi.mocked(cache.writeCache).mock.calls[0][1] as {
      items: Record<string, Item>;
    };
    expect(written.items["3036"].mutexGroups).toEqual(["Fatality"]);
  });

  it("degrades to group-less items when the wiki fetch rejects", async () => {
    vi.mocked(wikiItemGroups.fetchItemMutexGroups).mockRejectedValue(
      new Error("wiki down")
    );

    const data = await loadGameData();

    expect(data.items.size).toBeGreaterThan(0);
    for (const item of data.items.values()) {
      expect(item.mutexGroups).toBeUndefined();
    }
  });
});

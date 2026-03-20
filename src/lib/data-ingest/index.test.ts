import { describe, it, expect, vi, beforeEach } from "vitest";
import { loadGameData } from "./index";
import * as dataDragon from "./sources/data-dragon";
import * as wikiAugments from "./sources/wiki-augments";
import * as communityDragon from "./sources/community-dragon";
import * as cache from "./cache";
import type { Champion, Item, Augment, RuneTree } from "./types";

vi.mock("./sources/data-dragon");
vi.mock("./sources/wiki-augments");
vi.mock("./sources/community-dragon");
vi.mock("./cache", async (importOriginal) => {
  const actual = await importOriginal<typeof cache>();
  return {
    ...actual,
    readCache: vi.fn(),
    writeCache: vi.fn(),
  };
});

const mockChampions = new Map<string, Champion>([
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

const mockAugments = new Map<string, Augment>([
  [
    "typhoon",
    {
      name: "Typhoon",
      description: "Storm damage",
      tier: "Gold",
      set: "-",
      mode: "mayhem",
    },
  ],
]);

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(cache.readCache).mockResolvedValue(null);
  vi.mocked(cache.writeCache).mockResolvedValue(undefined);
  vi.mocked(dataDragon.fetchLatestVersion).mockResolvedValue("15.6.1");
  vi.mocked(dataDragon.fetchChampions).mockResolvedValue(mockChampions);
  vi.mocked(dataDragon.fetchItems).mockResolvedValue(mockItems);
  vi.mocked(dataDragon.fetchRunes).mockResolvedValue(mockRunes);
  vi.mocked(wikiAugments.fetchWikiAugments).mockResolvedValue(mockAugments);
  vi.mocked(communityDragon.mergeAugmentIds).mockResolvedValue(undefined);
});

describe("loadGameData", () => {
  it("fetches and returns all game data", async () => {
    const data = await loadGameData();

    expect(data.version).toBe("15.6.1");
    expect(data.champions.size).toBe(1);
    expect(data.items.size).toBe(1);
    expect(data.runes).toHaveLength(1);
    expect(data.augments.size).toBe(1);
  });

  it("calls all data sources", async () => {
    await loadGameData();

    expect(dataDragon.fetchLatestVersion).toHaveBeenCalled();
    expect(dataDragon.fetchChampions).toHaveBeenCalledWith("15.6.1");
    expect(dataDragon.fetchItems).toHaveBeenCalledWith("15.6.1");
    expect(dataDragon.fetchRunes).toHaveBeenCalledWith("15.6.1");
    expect(wikiAugments.fetchWikiAugments).toHaveBeenCalled();
    expect(communityDragon.mergeAugmentIds).toHaveBeenCalledWith(mockAugments);
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
      champions: { aatrox: mockChampions.get("aatrox") },
      items: { "1001": mockItems.get(1001) },
      runes: mockRunes,
      augments: { typhoon: mockAugments.get("typhoon") },
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

    const results = data.dictionary.search("aatrox");
    expect(results[0].name).toBe("Aatrox");
    expect(results[0].type).toBe("champion");
  });
});

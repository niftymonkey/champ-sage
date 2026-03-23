import { describe, it, expect, vi, beforeEach } from "vitest";
import { ensureAbilities } from "./ensure-abilities";
import type { LoadedGameData } from "./index";
import type { Champion, ChampionAbilities } from "./types";

vi.mock("./sources/data-dragon", () => ({
  fetchChampionAbilities: vi.fn(),
}));

import { fetchChampionAbilities } from "./sources/data-dragon";

const mockFetch = vi.mocked(fetchChampionAbilities);

function createChampion(overrides: Partial<Champion> = {}): Champion {
  return {
    id: "Ahri",
    key: 103,
    name: "Ahri",
    title: "the Nine-Tailed Fox",
    tags: ["Mage"],
    partype: "Mana",
    stats: {} as Champion["stats"],
    image: "",
    ...overrides,
  };
}

function createGameData(
  champions: Map<string, Champion> = new Map()
): LoadedGameData {
  return {
    version: "14.10.1",
    champions,
    items: new Map(),
    runes: [],
    augments: new Map(),
    augmentSets: [],
    dictionary: {
      allNames: [],
      champions: [],
      items: [],
      augments: [],
      search: () => [],
      findInText: () => [],
    },
  };
}

const sampleAbilities: ChampionAbilities = {
  passive: {
    name: "Essence Theft",
    description: "Gains a charge on ability hit.",
  },
  spells: [
    {
      id: "AhriQ",
      name: "Orb of Deception",
      description: "Throws an orb.",
      maxRank: 5,
      cooldowns: [7, 7, 7, 7, 7],
      costs: [65, 70, 75, 80, 85],
      range: [880, 880, 880, 880, 880],
    },
  ],
};

beforeEach(() => {
  mockFetch.mockReset();
});

describe("ensureAbilities", () => {
  it("fetches abilities for champions that lack them", async () => {
    const ahri = createChampion({ id: "Ahri", name: "Ahri" });
    const champions = new Map([["ahri", ahri]]);
    const gameData = createGameData(champions);

    mockFetch.mockResolvedValueOnce(new Map([["ahri", sampleAbilities]]));

    await ensureAbilities(gameData, ["Ahri"], "14.10.1");

    expect(mockFetch).toHaveBeenCalledWith("14.10.1", ["Ahri"]);
    expect(ahri.abilities).toEqual(sampleAbilities);
  });

  it("skips champions that already have abilities", async () => {
    const ahri = createChampion({
      id: "Ahri",
      name: "Ahri",
      abilities: sampleAbilities,
    });
    const champions = new Map([["ahri", ahri]]);
    const gameData = createGameData(champions);

    await ensureAbilities(gameData, ["Ahri"], "14.10.1");

    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("handles champions not found in gameData", async () => {
    const gameData = createGameData(new Map());

    await ensureAbilities(gameData, ["Ahri"], "14.10.1");

    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("maps DDragon IDs correctly for multi-word champion names", async () => {
    const mf = createChampion({
      id: "MissFortune",
      name: "Miss Fortune",
    });
    const champions = new Map([["miss fortune", mf]]);
    const gameData = createGameData(champions);

    mockFetch.mockResolvedValueOnce(
      new Map([["missfortune", sampleAbilities]])
    );

    await ensureAbilities(gameData, ["Miss Fortune"], "14.10.1");

    expect(mockFetch).toHaveBeenCalledWith("14.10.1", ["MissFortune"]);
    expect(mf.abilities).toEqual(sampleAbilities);
  });

  it("only fetches for champions missing abilities in a mixed list", async () => {
    const ahri = createChampion({
      id: "Ahri",
      name: "Ahri",
      abilities: sampleAbilities,
    });
    const garen = createChampion({
      id: "Garen",
      key: 86,
      name: "Garen",
      title: "Might of Demacia",
    });
    const champions = new Map([
      ["ahri", ahri],
      ["garen", garen],
    ]);
    const gameData = createGameData(champions);

    const garenAbilities: ChampionAbilities = {
      passive: { name: "Perseverance", description: "Regenerates health." },
      spells: [],
    };
    mockFetch.mockResolvedValueOnce(new Map([["garen", garenAbilities]]));

    await ensureAbilities(gameData, ["Ahri", "Garen"], "14.10.1");

    expect(mockFetch).toHaveBeenCalledWith("14.10.1", ["Garen"]);
    expect(garen.abilities).toEqual(garenAbilities);
    expect(ahri.abilities).toEqual(sampleAbilities);
  });
});

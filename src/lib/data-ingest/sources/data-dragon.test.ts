import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  fetchChampions,
  fetchItems,
  fetchRunes,
  fetchChampionAbilities,
} from "./data-dragon";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

beforeEach(() => {
  mockFetch.mockReset();
});

function jsonResponse(data: unknown) {
  return { ok: true, json: () => Promise.resolve(data) };
}

describe("fetchChampions", () => {
  it("normalizes champion data from DDragon format", async () => {
    mockFetch.mockResolvedValue(
      jsonResponse({
        data: {
          Aatrox: {
            id: "Aatrox",
            key: "266",
            name: "Aatrox",
            title: "the Darkin Blade",
            tags: ["Fighter", "Tank"],
            partype: "Blood Well",
            stats: {
              hp: 650,
              hpperlevel: 114,
              mp: 0,
              mpperlevel: 0,
              movespeed: 345,
              armor: 38,
              armorperlevel: 4.8,
              spellblock: 32,
              spellblockperlevel: 2.05,
              attackrange: 175,
              hpregen: 3,
              hpregenperlevel: 0.5,
              mpregen: 0,
              mpregenperlevel: 0,
              attackdamage: 60,
              attackdamageperlevel: 5,
              attackspeed: 0.651,
              attackspeedperlevel: 2.5,
            },
            image: { full: "Aatrox.png" },
          },
        },
      })
    );

    const champions = await fetchChampions("15.6.1");
    expect(champions.size).toBe(1);

    const aatrox = champions.get("aatrox");
    expect(aatrox).toBeDefined();
    expect(aatrox!.name).toBe("Aatrox");
    expect(aatrox!.key).toBe(266);
    expect(aatrox!.tags).toEqual(["Fighter", "Tank"]);
    expect(aatrox!.stats.hp).toBe(650);
    expect(aatrox!.image).toContain("Aatrox.png");
  });

  it("keys champions by lowercase name", async () => {
    mockFetch.mockResolvedValue(
      jsonResponse({
        data: {
          AurelionSol: {
            id: "AurelionSol",
            key: "136",
            name: "Aurelion Sol",
            title: "The Star Forger",
            tags: ["Mage"],
            partype: "Mana",
            stats: {
              hp: 620,
              hpperlevel: 90,
              mp: 530,
              mpperlevel: 40,
              movespeed: 335,
              armor: 22,
              armorperlevel: 4.6,
              spellblock: 30,
              spellblockperlevel: 1.3,
              attackrange: 550,
              hpregen: 5.5,
              hpregenperlevel: 0.55,
              mpregen: 8,
              mpregenperlevel: 0.75,
              attackdamage: 55,
              attackdamageperlevel: 3.2,
              attackspeed: 0.625,
              attackspeedperlevel: 1.5,
            },
            image: { full: "AurelionSol.png" },
          },
        },
      })
    );

    const champions = await fetchChampions("15.6.1");
    expect(champions.has("aurelion sol")).toBe(true);
    expect(champions.get("aurelion sol")!.id).toBe("AurelionSol");
  });
});

describe("fetchItems", () => {
  it("normalizes item data and strips HTML from descriptions", async () => {
    mockFetch.mockResolvedValue(
      jsonResponse({
        data: {
          "1001": {
            name: "Boots",
            description:
              "<mainText><stats><attention>25</attention> Move Speed</stats></mainText>",
            plaintext: "Slightly increases Move Speed",
            gold: { base: 300, total: 300, sell: 210, purchasable: true },
            tags: ["Boots"],
            stats: { FlatMovementSpeedMod: 25 },
            into: ["3005", "3047"],
            image: { full: "1001.png" },
          },
        },
      })
    );

    const items = await fetchItems("15.6.1");
    expect(items.size).toBe(1);

    const boots = items.get(1001);
    expect(boots).toBeDefined();
    expect(boots!.name).toBe("Boots");
    expect(boots!.description).not.toContain("<");
    expect(boots!.gold.total).toBe(300);
    expect(boots!.into).toEqual([3005, 3047]);
    expect(boots!.image).toContain("1001.png");
  });

  it("handles items without from/into arrays", async () => {
    mockFetch.mockResolvedValue(
      jsonResponse({
        data: {
          "2003": {
            name: "Health Potion",
            description: "<mainText>Restores health</mainText>",
            gold: { base: 50, total: 50, sell: 20, purchasable: true },
            image: { full: "2003.png" },
          },
        },
      })
    );

    const items = await fetchItems("15.6.1");
    const potion = items.get(2003);
    expect(potion!.from).toBeUndefined();
    expect(potion!.into).toBeUndefined();
  });

  it("classifies standard items (1000-8999) as standard", async () => {
    mockFetch.mockResolvedValue(
      jsonResponse({
        data: {
          "3089": {
            name: "Rabadon's Deathcap",
            description: "AP",
            gold: { base: 1100, total: 3600, sell: 2520, purchasable: true },
            image: { full: "3089.png" },
          },
        },
      })
    );
    const items = await fetchItems("15.6.1");
    expect(items.get(3089)!.mode).toBe("standard");
  });

  it("classifies 22xxxx items as arena", async () => {
    mockFetch.mockResolvedValue(
      jsonResponse({
        data: {
          "228020": {
            name: "Abyssal Mask",
            description: "MR",
            gold: { base: 500, total: 2500, sell: 1750, purchasable: true },
            image: { full: "8020.png" },
          },
        },
      })
    );
    const items = await fetchItems("15.6.1");
    expect(items.get(228020)!.mode).toBe("arena");
  });

  it("classifies 32xxxx items as aram", async () => {
    mockFetch.mockResolvedValue(
      jsonResponse({
        data: {
          "328020": {
            name: "Abyssal Mask",
            description: "MR",
            gold: { base: 500, total: 2850, sell: 1995, purchasable: true },
            image: { full: "8020.png" },
          },
        },
      })
    );
    const items = await fetchItems("15.6.1");
    expect(items.get(328020)!.mode).toBe("aram");
  });

  it("classifies 9xxx purchasable items as swarm", async () => {
    mockFetch.mockResolvedValue(
      jsonResponse({
        data: {
          "9171": {
            name: "Cyclonic Slicers",
            description: "Swarm weapon",
            gold: { base: 100, total: 100, sell: 50, purchasable: true },
            image: { full: "9171.png" },
          },
        },
      })
    );
    const items = await fetchItems("15.6.1");
    expect(items.get(9171)!.mode).toBe("swarm");
  });

  it("excludes non-purchasable zero-gold Swarm items", async () => {
    mockFetch.mockResolvedValue(
      jsonResponse({
        data: {
          "9171": {
            name: "Cyclonic Slicers",
            description: "Swarm weapon",
            gold: { base: 0, total: 0, sell: 0, purchasable: false },
            image: { full: "9171.png" },
          },
        },
      })
    );
    const items = await fetchItems("15.6.1");
    expect(items.size).toBe(0);
  });

  it("strips HTML from item names", async () => {
    mockFetch.mockResolvedValue(
      jsonResponse({
        data: {
          "3901": {
            name: "<rarityLegendary>Fire at Will</rarityLegendary><br><subtitleLeft><silver>500 Silver Serpents</silver></subtitleLeft>",
            description: "Upgrade",
            gold: { base: 500, total: 500, sell: 250, purchasable: true },
            image: { full: "3901.png" },
          },
        },
      })
    );
    const items = await fetchItems("15.6.1");
    expect(items.get(3901)!.name).toBe("Fire at Will");
  });

  it("excludes items with empty names", async () => {
    mockFetch.mockResolvedValue(
      jsonResponse({
        data: {
          "7050": {
            name: "",
            description: "junk",
            gold: { base: 0, total: 0, sell: 0, purchasable: false },
            image: { full: "7050.png" },
          },
          "1001": {
            name: "Boots",
            description: "MS",
            gold: { base: 300, total: 300, sell: 210, purchasable: true },
            image: { full: "1001.png" },
          },
        },
      })
    );
    const items = await fetchItems("15.6.1");
    expect(items.size).toBe(1);
    expect(items.has(7050)).toBe(false);
  });

  it("excludes non-purchasable zero-gold items (system/internal items)", async () => {
    mockFetch.mockResolvedValue(
      jsonResponse({
        data: {
          "1500": {
            name: "Penetrating Bullets",
            description: "turret buff",
            gold: { base: 0, total: 0, sell: 0, purchasable: false },
            image: { full: "1500.png" },
          },
          "3340": {
            name: "Stealth Ward",
            description: "Places a ward",
            gold: { base: 0, total: 0, sell: 0, purchasable: true },
            image: { full: "3340.png" },
          },
          "3089": {
            name: "Rabadon's Deathcap",
            description: "AP",
            gold: { base: 1100, total: 3600, sell: 2520, purchasable: true },
            image: { full: "3089.png" },
          },
        },
      })
    );
    const items = await fetchItems("15.6.1");
    // Turret buff excluded, ward and Deathcap kept
    expect(items.size).toBe(2);
    expect(items.has(1500)).toBe(false);
    expect(items.has(3340)).toBe(true);
    expect(items.has(3089)).toBe(true);
  });
});

describe("fetchRunes", () => {
  it("normalizes rune trees with keystones and minor slots", async () => {
    mockFetch.mockResolvedValue(
      jsonResponse([
        {
          id: 8100,
          key: "Domination",
          name: "Domination",
          icon: "perk-images/Styles/7200_Domination.png",
          slots: [
            {
              runes: [
                {
                  id: 8112,
                  key: "Electrocute",
                  name: "Electrocute",
                  icon: "perk-images/Styles/Domination/Electrocute/Electrocute.png",
                  shortDesc: "Hit with <b>3</b> attacks for bonus damage.",
                  longDesc:
                    "Hit with <b>3 separate</b> attacks within 3s for <b>bonus</b> damage.",
                },
              ],
            },
            {
              runes: [
                {
                  id: 8126,
                  key: "CheapShot",
                  name: "Cheap Shot",
                  icon: "perk-images/Styles/Domination/CheapShot/CheapShot.png",
                  shortDesc: "Deal bonus true damage to impaired targets.",
                  longDesc:
                    "Deal <b>bonus</b> true damage to impaired targets.",
                },
              ],
            },
          ],
        },
      ])
    );

    const runes = await fetchRunes("15.6.1");
    expect(runes).toHaveLength(1);
    expect(runes[0].name).toBe("Domination");
    expect(runes[0].keystones).toHaveLength(1);
    expect(runes[0].keystones[0].name).toBe("Electrocute");
    expect(runes[0].keystones[0].shortDesc).not.toContain("<b>");
    expect(runes[0].slots).toHaveLength(1);
    expect(runes[0].slots[0][0].name).toBe("Cheap Shot");
  });
});

describe("fetchChampionAbilities", () => {
  it("fetches per-champion endpoint and normalizes abilities", async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({
        data: {
          Ahri: {
            passive: {
              name: "Essence Theft",
              description: "After killing 9 minions or monsters, Ahri heals.",
              image: { full: "Ahri_SoulEater2.png" },
            },
            spells: [
              {
                id: "AhriQ",
                name: "Orb of Deception",
                description:
                  "Ahri sends out and pulls back her orb, dealing magic damage on the way out and true damage on the way back.",
                maxrank: 5,
                cooldown: [7, 7, 7, 7, 7],
                cost: [55, 65, 75, 85, 95],
                costType: " {{ abilityresourcename }}",
                range: [970, 970, 970, 970, 970],
              },
              {
                id: "AhriW",
                name: "Fox-Fire",
                description: "Ahri releases three fox-fires.",
                maxrank: 5,
                cooldown: [9, 8, 7, 6, 5],
                cost: [25, 25, 25, 25, 25],
                costType: " {{ abilityresourcename }}",
                range: [700, 700, 700, 700, 700],
              },
              {
                id: "AhriE",
                name: "Charm",
                description:
                  "Ahri blows a kiss that charms an enemy it encounters.",
                maxrank: 5,
                cooldown: [14, 13, 12, 11, 10],
                cost: [60, 70, 80, 90, 100],
                costType: " {{ abilityresourcename }}",
                range: [975, 975, 975, 975, 975],
              },
              {
                id: "AhriR",
                name: "Spirit Rush",
                description: "Ahri dashes forward and fires essence bolts.",
                maxrank: 3,
                cooldown: [130, 105, 80],
                cost: [100, 100, 100],
                costType: " {{ abilityresourcename }}",
                range: [450, 450, 450],
              },
            ],
          },
        },
      })
    );

    const abilities = await fetchChampionAbilities("15.6.1", ["Ahri"]);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("/champion/Ahri.json")
    );
    expect(abilities.size).toBe(1);

    const ahri = abilities.get("ahri");
    expect(ahri).toBeDefined();
    expect(ahri!.passive.name).toBe("Essence Theft");
    expect(ahri!.passive.description).toContain("heals");
    expect(ahri!.spells).toHaveLength(4);
    expect(ahri!.spells[0].name).toBe("Orb of Deception");
    expect(ahri!.spells[0].cooldowns).toEqual([7, 7, 7, 7, 7]);
    expect(ahri!.spells[0].costs).toEqual([55, 65, 75, 85, 95]);
    expect(ahri!.spells[0].range).toEqual([970, 970, 970, 970, 970]);
    expect(ahri!.spells[0].maxRank).toBe(5);
    expect(ahri!.spells[3].name).toBe("Spirit Rush");
    expect(ahri!.spells[3].maxRank).toBe(3);
  });

  it("returns map keyed by lowercase champion name", async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({
        data: {
          AurelionSol: {
            passive: {
              name: "Cosmic Creator",
              description: "Stars orbit.",
              image: { full: "AurelionSol_P.png" },
            },
            spells: [
              {
                id: "AurelionSolQ",
                name: "Breath of Light",
                description: "Channel starfire.",
                maxrank: 5,
                cooldown: [3, 3, 3, 3, 3],
                cost: [45, 50, 55, 60, 65],
                costType: " {{ abilityresourcename }}",
                range: [750, 750, 750, 750, 750],
              },
              {
                id: "AurelionSolW",
                name: "Astral Flight",
                description: "Fly over terrain.",
                maxrank: 5,
                cooldown: [22, 20.5, 19, 17.5, 16],
                cost: [80, 85, 90, 95, 100],
                costType: " {{ abilityresourcename }}",
                range: [5500, 5750, 6000, 6250, 6500],
              },
              {
                id: "AurelionSolE",
                name: "Singularity",
                description: "Summon a black hole.",
                maxrank: 5,
                cooldown: [12, 12, 12, 12, 12],
                cost: [70, 75, 80, 85, 90],
                costType: " {{ abilityresourcename }}",
                range: [750, 750, 750, 750, 750],
              },
              {
                id: "AurelionSolR",
                name: "Falling Star",
                description: "Crash a star into the earth.",
                maxrank: 3,
                cooldown: [120, 100, 80],
                cost: [100, 100, 100],
                costType: " {{ abilityresourcename }}",
                range: [1250, 1250, 1250],
              },
            ],
          },
        },
      })
    );

    const abilities = await fetchChampionAbilities("15.6.1", ["AurelionSol"]);
    expect(abilities.has("aurelion sol")).toBe(false);
    expect(abilities.has("aurelionsol")).toBe(true);
  });

  it("handles multiple champions in parallel", async () => {
    const makeChampResponse = (id: string, passiveName: string) =>
      jsonResponse({
        data: {
          [id]: {
            passive: {
              name: passiveName,
              description: "test",
              image: { full: `${id}_P.png` },
            },
            spells: [
              {
                id: `${id}Q`,
                name: "Q",
                description: "q",
                maxrank: 5,
                cooldown: [10, 10, 10, 10, 10],
                cost: [50, 50, 50, 50, 50],
                costType: " Mana",
                range: [600, 600, 600, 600, 600],
              },
              {
                id: `${id}W`,
                name: "W",
                description: "w",
                maxrank: 5,
                cooldown: [10, 10, 10, 10, 10],
                cost: [50, 50, 50, 50, 50],
                costType: " Mana",
                range: [600, 600, 600, 600, 600],
              },
              {
                id: `${id}E`,
                name: "E",
                description: "e",
                maxrank: 5,
                cooldown: [10, 10, 10, 10, 10],
                cost: [50, 50, 50, 50, 50],
                costType: " Mana",
                range: [600, 600, 600, 600, 600],
              },
              {
                id: `${id}R`,
                name: "R",
                description: "r",
                maxrank: 3,
                cooldown: [120, 100, 80],
                cost: [100, 100, 100],
                costType: " Mana",
                range: [600, 600, 600],
              },
            ],
          },
        },
      });

    mockFetch
      .mockResolvedValueOnce(makeChampResponse("Ahri", "Essence Theft"))
      .mockResolvedValueOnce(
        makeChampResponse("Aatrox", "Deathbringer Stance")
      );

    const abilities = await fetchChampionAbilities("15.6.1", [
      "Ahri",
      "Aatrox",
    ]);
    expect(abilities.size).toBe(2);
    expect(abilities.get("ahri")!.passive.name).toBe("Essence Theft");
    expect(abilities.get("aatrox")!.passive.name).toBe("Deathbringer Stance");
  });

  it("strips HTML from ability descriptions", async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({
        data: {
          Ahri: {
            passive: {
              name: "Essence Theft",
              description:
                "After killing <b>9</b> minions, Ahri <status>heals</status>.",
              image: { full: "Ahri_P.png" },
            },
            spells: [
              {
                id: "AhriQ",
                name: "Orb of Deception",
                description:
                  "Deals <magicDamage>magic damage</magicDamage> and <trueDamage>true damage</trueDamage>.",
                maxrank: 5,
                cooldown: [7, 7, 7, 7, 7],
                cost: [55, 65, 75, 85, 95],
                costType: " Mana",
                range: [970, 970, 970, 970, 970],
              },
              {
                id: "AhriW",
                name: "W",
                description: "w",
                maxrank: 5,
                cooldown: [9, 8, 7, 6, 5],
                cost: [25, 25, 25, 25, 25],
                costType: " Mana",
                range: [700, 700, 700, 700, 700],
              },
              {
                id: "AhriE",
                name: "E",
                description: "e",
                maxrank: 5,
                cooldown: [14, 13, 12, 11, 10],
                cost: [60, 70, 80, 90, 100],
                costType: " Mana",
                range: [975, 975, 975, 975, 975],
              },
              {
                id: "AhriR",
                name: "R",
                description: "r",
                maxrank: 3,
                cooldown: [130, 105, 80],
                cost: [100, 100, 100],
                costType: " Mana",
                range: [450, 450, 450],
              },
            ],
          },
        },
      })
    );

    const abilities = await fetchChampionAbilities("15.6.1", ["Ahri"]);
    const ahri = abilities.get("ahri")!;
    expect(ahri.passive.description).not.toContain("<");
    expect(ahri.passive.description).toContain("heals");
    expect(ahri.spells[0].description).not.toContain("<");
    expect(ahri.spells[0].description).toContain("magic damage");
    expect(ahri.spells[0].description).toContain("true damage");
  });
});

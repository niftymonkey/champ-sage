import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  fetchChampions,
  fetchItems,
  fetchRunes,
  fetchAllChampionAbilities,
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

  describe("mode variant entries (patch 16.15.1 Jade roster)", () => {
    function championEntry(id: string, key: string, name: string) {
      return {
        id,
        key,
        name,
        title: `the ${name}`,
        tags: ["Marksman"],
        partype: "Mana",
        stats: {
          hp: id.includes("_") ? 474 : 610,
          hpperlevel: 79,
          mp: 280,
          mpperlevel: 35,
          movespeed: 325,
          armor: 26,
          armorperlevel: 4.6,
          spellblock: 30,
          spellblockperlevel: 1.3,
          attackrange: 600,
          hpregen: 3.5,
          hpregenperlevel: 0.55,
          mpregen: 7,
          mpregenperlevel: 0.65,
          attackdamage: 59,
          attackdamageperlevel: 0,
          attackspeed: 0.658,
          attackspeedperlevel: 3,
        },
        image: { full: `${id}.png` },
      };
    }

    // DDragon 16.15.1 ships a "Jade_" entry per Classic Rift champion whose
    // `name` is byte-identical to the canonical champion. Keying the map by
    // name let the variant, which sorts later in the payload, overwrite its
    // canonical twin: `champions.get("ashe")` came back carrying key 60022,
    // id "Jade_Ashe", legacy base stats, and (via the id-keyed ability merge)
    // the legacy 2013 ability kit, in every game mode.
    it("keeps the canonical champion when a variant shares its name", async () => {
      mockFetch.mockResolvedValue(
        jsonResponse({
          data: {
            Ashe: championEntry("Ashe", "22", "Ashe"),
            Jade_Ashe: championEntry("Jade_Ashe", "60022", "Ashe"),
          },
        })
      );

      const champions = await fetchChampions("15.6.1");
      const ashe = champions.get("ashe");
      expect(ashe).toBeDefined();
      expect(ashe!.id).toBe("Ashe");
      expect(ashe!.key).toBe(22);
      expect(ashe!.stats.hp).toBe(610);
    });

    it("excludes variant entries from the champion map", async () => {
      mockFetch.mockResolvedValue(
        jsonResponse({
          data: {
            Ashe: championEntry("Ashe", "22", "Ashe"),
            Jade_Ashe: championEntry("Jade_Ashe", "60022", "Ashe"),
            Jade_Ryze: championEntry("Jade_Ryze", "60013", "Ryze"),
          },
        })
      );

      const champions = await fetchChampions("15.6.1");
      expect(champions.size).toBe(1);
      expect([...champions.values()].map((c) => c.id)).toEqual(["Ashe"]);
    });
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

  it("inserts separators between stats in item descriptions", async () => {
    mockFetch.mockResolvedValue(
      jsonResponse({
        data: {
          "6672": {
            name: "Kraken Slayer",
            description:
              "<mainText><stats><attention>30</attention> Attack Damage<br><attention>40%</attention> Attack Speed<br><attention>20%</attention> Critical Strike Chance</stats></mainText>",
            gold: { base: 800, total: 3000, sell: 2100, purchasable: true },
            image: { full: "6672.png" },
          },
        },
      })
    );

    const items = await fetchItems("15.6.1");
    const kraken = items.get(6672);
    expect(kraken!.description).toContain("30 Attack Damage");
    expect(kraken!.description).toContain("40% Attack Speed");
    expect(kraken!.description).not.toMatch(/Damage\d/);
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

  it("parses the maps field into the list of available map IDs", async () => {
    mockFetch.mockResolvedValue(
      jsonResponse({
        data: {
          "8020": {
            name: "Abyssal Mask",
            description: "MR",
            gold: { base: 500, total: 2650, sell: 1855, purchasable: true },
            image: { full: "8020.png" },
            maps: { "11": true, "12": true, "21": false, "30": false },
          },
          "3095": {
            name: "Deprecated item",
            description: "junk",
            gold: { base: 1000, total: 3000, sell: 2100, purchasable: true },
            image: { full: "3095.png" },
            maps: { "11": false, "12": false, "30": false },
          },
        },
      })
    );
    const items = await fetchItems("15.6.1");
    expect(items.get(8020)!.maps).toEqual([11, 12]);
    // Available on no map: an empty list, which every catalog reads as absent.
    expect(items.get(3095)!.maps).toEqual([]);
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

describe("fetchAllChampionAbilities", () => {
  function championFullResponse() {
    return jsonResponse({
      data: {
        Ahri: {
          passive: {
            name: "Essence Theft",
            // Real DDragon ability text is plain prose whose only markup is
            // <br>, which the stripper turns into a " | " separator.
            description:
              "After killing 9 minions, Ahri heals.<br>Takedowns heal more.",
            image: { full: "Ahri_SoulEater2.png" },
          },
          spells: [
            {
              id: "AhriQ",
              name: "Orb of Deception",
              description: "Ahri sends out her orb, dealing magic damage.",
              maxrank: 5,
              cooldown: [7, 7, 7, 7, 7],
              cost: [55, 65, 75, 85, 95],
              costType: " Mana",
              range: [970, 970, 970, 970, 970],
            },
          ],
        },
        AurelionSol: {
          passive: {
            name: "Cosmic Creator",
            description: "Aurelion Sol gains Stardust.",
            image: { full: "AurelionSol_P.png" },
          },
          spells: [
            {
              id: "AurelionSolQ",
              name: "Breath of Light",
              description: "Aurelion Sol breathes.",
              maxrank: 5,
              cooldown: [4, 4, 4, 4, 4],
              cost: [30, 30, 30, 30, 30],
              costType: " Mana",
              range: [810, 810, 810, 810, 810],
            },
          ],
        },
      },
    });
  }

  it("fetches every champion's abilities in a single request", async () => {
    mockFetch.mockResolvedValueOnce(championFullResponse());

    const abilities = await fetchAllChampionAbilities("15.6.1");

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch).toHaveBeenCalledWith(
      "https://ddragon.leagueoflegends.com/cdn/15.6.1/data/en_US/championFull.json"
    );
    expect(abilities.size).toBe(2);
  });

  it("keys by lowercase champion id and normalizes abilities", async () => {
    mockFetch.mockResolvedValueOnce(championFullResponse());

    const abilities = await fetchAllChampionAbilities("15.6.1");

    const ahri = abilities.get("ahri")!;
    expect(ahri.passive.name).toBe("Essence Theft");
    expect(ahri.passive.description).toBe(
      "After killing 9 minions, Ahri heals. | Takedowns heal more."
    );
    expect(ahri.spells[0].name).toBe("Orb of Deception");
    expect(ahri.spells[0].description).toBe(
      "Ahri sends out her orb, dealing magic damage."
    );
    expect(ahri.spells[0].maxRank).toBe(5);
    expect(ahri.spells[0].cooldowns).toEqual([7, 7, 7, 7, 7]);
    expect(ahri.spells[0].costs).toEqual([55, 65, 75, 85, 95]);
    expect(ahri.spells[0].range).toEqual([970, 970, 970, 970, 970]);

    expect(abilities.has("aurelionsol")).toBe(true);
    expect(abilities.has("aurelion sol")).toBe(false);
  });

  it("returns an empty map when the request fails", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 503 });

    const abilities = await fetchAllChampionAbilities("15.6.1");

    expect(abilities.size).toBe(0);
  });

  // A network drop and a truncated body reach this differently from an HTTP
  // error: they REJECT rather than resolve. Ingest handles that at the call
  // site (degrade to no abilities, warn, and skip the cache write so the next
  // start retries), so what matters here is that the rejection propagates
  // rather than being swallowed into a silent empty result that would look
  // identical to "DDragon has no abilities".
  it("propagates a rejected fetch rather than swallowing it", async () => {
    mockFetch.mockRejectedValueOnce(new Error("ECONNRESET"));

    await expect(fetchAllChampionAbilities("15.6.1")).rejects.toThrow(
      "ECONNRESET"
    );
  });

  it("propagates a malformed JSON body rather than swallowing it", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.reject(new SyntaxError("Unexpected end of JSON input")),
    });

    await expect(fetchAllChampionAbilities("15.6.1")).rejects.toThrow(
      "Unexpected end of JSON input"
    );
  });

  describe("payload validation", () => {
    /** A valid champion entry, so tests can corrupt one field at a time. */
    function validChampion() {
      return {
        passive: {
          name: "Essence Theft",
          description: "Ahri heals.",
          image: { full: "Ahri_SoulEater2.png" },
        },
        spells: [
          {
            id: "AhriQ",
            name: "Orb of Deception",
            description: "Ahri sends out her orb.",
            maxrank: 5,
            cooldown: [7],
            cost: [55],
            costType: " Mana",
            range: [970],
          },
        ],
      };
    }

    function expectOnlyValidSurvives(badEntry: unknown) {
      return jsonResponse({ data: { Ahri: validChampion(), Bad: badEntry } });
    }

    it("skips a champion whose spells array holds a malformed element", async () => {
      const bad = validChampion();
      // Numbers where the shape expects strings/arrays: no throw, just garbage.
      bad.spells.push({
        id: 42,
        name: null,
        description: undefined,
        maxrank: "five",
        cooldown: "7",
        cost: null,
        costType: " Mana",
        range: 970,
      } as unknown as (typeof bad.spells)[number]);
      mockFetch.mockResolvedValueOnce(expectOnlyValidSurvives(bad));

      const abilities = await fetchAllChampionAbilities("15.6.1");

      expect(abilities.has("bad")).toBe(false);
      expect(abilities.has("ahri")).toBe(true);
    });

    it("skips a champion whose cooldown array holds non-numbers", async () => {
      const bad = validChampion();
      bad.spells[0].cooldown = [7, "nope"] as unknown as number[];
      mockFetch.mockResolvedValueOnce(expectOnlyValidSurvives(bad));

      const abilities = await fetchAllChampionAbilities("15.6.1");

      expect(abilities.has("bad")).toBe(false);
      expect(abilities.has("ahri")).toBe(true);
    });

    it("skips a champion whose passive is not an object", async () => {
      const bad = validChampion();
      mockFetch.mockResolvedValueOnce(
        expectOnlyValidSurvives({ ...bad, passive: "Essence Theft" })
      );

      const abilities = await fetchAllChampionAbilities("15.6.1");

      expect(abilities.has("bad")).toBe(false);
      expect(abilities.has("ahri")).toBe(true);
    });

    it("skips a champion whose spells is not an array", async () => {
      const bad = validChampion();
      mockFetch.mockResolvedValueOnce(
        expectOnlyValidSurvives({ ...bad, spells: {} })
      );

      const abilities = await fetchAllChampionAbilities("15.6.1");

      expect(abilities.has("bad")).toBe(false);
      expect(abilities.has("ahri")).toBe(true);
    });

    it("skips a champion with no spells at all", async () => {
      const bad = validChampion();
      mockFetch.mockResolvedValueOnce(
        expectOnlyValidSurvives({ ...bad, spells: [] })
      );

      const abilities = await fetchAllChampionAbilities("15.6.1");

      expect(abilities.has("bad")).toBe(false);
      expect(abilities.has("ahri")).toBe(true);
    });

    it("skips a null champion entry", async () => {
      mockFetch.mockResolvedValueOnce(expectOnlyValidSurvives(null));

      const abilities = await fetchAllChampionAbilities("15.6.1");

      expect(abilities.has("bad")).toBe(false);
      expect(abilities.has("ahri")).toBe(true);
    });

    it("returns an empty map when data is not an object", async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ data: [] }));

      const abilities = await fetchAllChampionAbilities("15.6.1");

      expect(abilities.size).toBe(0);
    });
  });
});

describe("fetchAllChampionAbilities resilience", () => {
  it("keeps the healthy champions when one entry is malformed", async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({
        data: {
          Ahri: {
            passive: { name: "Essence Theft", description: "Heals." },
            spells: [
              {
                id: "AhriQ",
                name: "Orb of Deception",
                description: "Throws an orb.",
                maxrank: 5,
                cooldown: [7],
                cost: [55],
                costType: " Mana",
                range: [970],
              },
            ],
          },
          // No `passive` / `spells`: normalizing this throws.
          Broken: {},
        },
      })
    );

    const abilities = await fetchAllChampionAbilities("15.6.1");

    expect(abilities.has("ahri")).toBe(true);
    expect(abilities.has("broken")).toBe(false);
    expect(abilities.get("ahri")!.passive.name).toBe("Essence Theft");
  });
});

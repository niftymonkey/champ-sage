import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  resolveKiwiAugments,
  fetchKiwiAugments,
} from "./cdragon-kiwi-augments";
import type { RawCDragonAugment } from "./community-dragon";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

beforeEach(() => {
  mockFetch.mockReset();
});

const kiwiIcon = (file: string): string =>
  `/lol-game-data/assets/ASSETS/UX/Kiwi/Augments/Icons/${file}`;
const cherryIcon = (file: string): string =>
  `/lol-game-data/assets/ASSETS/UX/Cherry/Augments/Icons/${file}`;

/** Catalog slice: 6 KIWI augments plus one Arena ADAPt that the bin lacks. */
function makeCatalog(): RawCDragonAugment[] {
  return [
    {
      id: 1205,
      augmentNameId: "ARAM_ADAPt",
      nameTRA: "ADAPt",
      rarity: "kSilver",
      augmentSmallIconPath: kiwiIcon("ADAPt_small.png"),
    },
    {
      id: 205,
      augmentNameId: "ADAPt",
      nameTRA: "ADAPt",
      rarity: "kSilver",
      augmentSmallIconPath: cherryIcon("ADAPt_small.png"),
    },
    {
      id: 1414,
      augmentNameId: "Dropybara_Active",
      nameTRA: "Droppybara",
      rarity: "kPrismatic",
      augmentSmallIconPath: kiwiIcon("Droppybara_small.png"),
    },
    {
      id: 1389,
      augmentNameId: "HandOfBaron",
      nameTRA: "Hand of Baron",
      rarity: "kPrismatic",
      augmentSmallIconPath: kiwiIcon("HandOfBaron_small.png"),
    },
    {
      id: 9999,
      augmentNameId: "ARAM_Mystery",
      nameTRA: "Mystery",
      rarity: "kBronze",
      augmentSmallIconPath: kiwiIcon("Mystery_small.png"),
    },
    {
      id: 8888,
      augmentNameId: "ARAM_NoDesc",
      nameTRA: "No Desc",
      rarity: "kGold",
      augmentSmallIconPath: kiwiIcon("NoDesc_small.png"),
    },
    {
      id: 7777,
      augmentNameId: "ARAM_Quest",
      nameTRA: "Questy",
      rarity: "kGold",
      augmentSmallIconPath: kiwiIcon("Quest_small.png"),
    },
  ];
}

/** KIWI mode bin: AugmentData records + their RootSpell SpellObjects + noise. */
function makeBin(): Record<string, unknown> {
  return {
    noise: { __type: "SomethingElse", AugmentNameId: "ARAM_ADAPt" },
    h_adapt: {
      __type: "AugmentData",
      AugmentNameId: "ARAM_ADAPt",
      DescriptionTra: "ARAM_ADAPt_Desc",
      NameTra: "ARAM_ADAPt_Name",
      RootSpell: "spell_adapt",
    },
    spell_adapt: {
      mSpell: {
        DataValues: [{ name: "APAmp", values: [0.15000000596046448] }],
      },
    },
    h_drop: {
      __type: "AugmentData",
      AugmentNameId: "Dropybara_Active",
      DescriptionTra: "Drop_Desc",
      NameTra: "Drop_Name",
      RootSpell: "spell_drop",
    },
    spell_drop: {
      mSpell: {
        DataValues: [
          { name: "DamagetoChampions", values: [0.30000001192092896] },
        ],
      },
    },
    h_hob: {
      __type: "AugmentData",
      AugmentNameId: "HandOfBaron",
      DescriptionTra: "Hob_Desc",
      NameTra: "Hob_Name",
      RootSpell: "spell_hob",
    },
    spell_hob: { mSpell: { DataValues: [{ name: "AFAmp", values: [0.25] }] } },
    h_mystery: {
      __type: "AugmentData",
      AugmentNameId: "ARAM_Mystery",
      DescriptionTra: "Mystery_Desc",
      NameTra: "Mystery_Name",
      RootSpell: "spell_mystery",
    },
    spell_mystery: { mSpell: { DataValues: [] } },
    h_nodesc: {
      __type: "AugmentData",
      AugmentNameId: "ARAM_NoDesc",
      DescriptionTra: "Missing_Key",
      NameTra: "NoDesc_Name",
      RootSpell: "",
    },
    h_quest: {
      __type: "AugmentData",
      AugmentNameId: "ARAM_Quest",
      DescriptionTra: "Quest_Desc",
      NameTra: "Quest_Name",
      RootSpell: "spell_quest",
    },
    spell_quest: { mSpell: { DataValues: [] } },
  };
}

/** String table: LOWERCASED keys, the casing CDragon de-hashes RST keys to. */
function makeStringtable(): Record<string, string> {
  return {
    aram_adapt_desc:
      "Convert Bonus Attack Damage to Ability Power. Gain @APAmp*100@% Ability Power.",
    aram_adapt_name: "ADAPt",
    drop_desc:
      "Gain Droppybara as a Summoner Spell. After a delay, call down a capybara that deals @DamagetoChampions*100@% max Health true damage.",
    drop_name: "Droppybara",
    hob_desc:
      "Gain @AFAmp*100@% Adaptive Force. Nearby allied minions are greatly empowered.",
    hob_name: "Hand of Baron",
    mystery_desc: "A mysterious augment.",
    mystery_name: "Mystery",
    quest_desc: "QUEST: Heal allies for @QuestRequirement@ Health.",
    quest_name: "Questy",
    nodesc_name: "No Desc",
  };
}

describe("resolveKiwiAugments", () => {
  it("resolves the shared ADAPt (1205) to its oracle desc and drops the Arena ADAPt (205)", () => {
    const map = resolveKiwiAugments(
      makeCatalog(),
      makeBin(),
      makeStringtable()
    );

    const adapt = map.get("adapt");
    expect(adapt?.id).toBe(1205);
    expect(adapt?.description).toBe(
      "Convert Bonus Attack Damage to Ability Power. Gain 15% Ability Power."
    );
    // The Arena ADAPt (205, apiName "ADAPt") is not in the KIWI bin, so the
    // join filters it out: only the six bin-backed augments remain.
    expect(map.size).toBe(6);
  });

  it("resolves Mayhem-only Droppybara and Hand of Baron to their oracle descs", () => {
    const map = resolveKiwiAugments(
      makeCatalog(),
      makeBin(),
      makeStringtable()
    );

    expect(map.get("droppybara")?.description).toBe(
      "Gain Droppybara as a Summoner Spell. After a delay, call down a capybara that deals 30% max Health true damage."
    );
    expect(map.get("hand of baron")?.description).toBe(
      "Gain 25% Adaptive Force. Nearby allied minions are greatly empowered."
    );
  });

  it("substitutes @token*N@ with the factor applied and float noise rounded away", () => {
    const map = resolveKiwiAugments(
      makeCatalog(),
      makeBin(),
      makeStringtable()
    );

    // DamagetoChampions = 0.30000001192092896, @DamagetoChampions*100@ -> 30, not 30.000001.
    expect(map.get("droppybara")?.description).toContain("30% max Health");
  });

  it("leaves an unresolved @token@ (no DataValue) intact", () => {
    const map = resolveKiwiAugments(
      makeCatalog(),
      makeBin(),
      makeStringtable()
    );

    expect(map.get("questy")?.description).toBe(
      "QUEST: Heal allies for @QuestRequirement@ Health."
    );
  });

  it("maps CDragon rarity to tier, falling back to Silver for an unknown rarity", () => {
    const map = resolveKiwiAugments(
      makeCatalog(),
      makeBin(),
      makeStringtable()
    );

    expect(map.get("adapt")?.tier).toBe("Silver");
    expect(map.get("droppybara")?.tier).toBe("Prismatic");
    expect(map.get("no desc")?.tier).toBe("Gold");
    expect(map.get("mystery")?.tier).toBe("Silver"); // kBronze -> Silver
  });

  it("marks every resolved augment mayhem with empty sets", () => {
    const map = resolveKiwiAugments(
      makeCatalog(),
      makeBin(),
      makeStringtable()
    );

    expect(map.size).toBe(6);
    for (const augment of map.values()) {
      expect(augment.mode).toBe("mayhem");
      expect(augment.sets).toEqual([]);
    }
  });

  it("resolves an augment whose DescriptionTra misses to an empty description", () => {
    const map = resolveKiwiAugments(
      makeCatalog(),
      makeBin(),
      makeStringtable()
    );

    // "Missing_Key" has no string-table entry; the desc resolves empty so the
    // orchestration fallback can fill it from the wiki.
    expect(map.get("no desc")?.description).toBe("");
  });

  it("carries the raw catalog icon path for the fetch wrapper to normalize", () => {
    const map = resolveKiwiAugments(
      makeCatalog(),
      makeBin(),
      makeStringtable()
    );

    expect(map.get("adapt")?.iconPath).toBe(kiwiIcon("ADAPt_small.png"));
  });

  it("strips CDragon inline markup, line breaks, icon markers, and runtime templates", () => {
    const catalog: RawCDragonAugment[] = [
      {
        id: 6666,
        augmentNameId: "ARAM_Markup",
        nameTRA: "Markup",
        rarity: "kGold",
        augmentSmallIconPath: kiwiIcon("Markup_small.png"),
      },
    ];
    const bin: Record<string, unknown> = {
      h_markup: {
        __type: "AugmentData",
        AugmentNameId: "ARAM_Markup",
        DescriptionTra: "Markup_Desc",
        NameTra: "Markup_Name",
        RootSpell: "spell_markup",
      },
      spell_markup: {
        mSpell: { DataValues: [{ name: "Pct", values: [0.2] }] },
      },
    };
    const stringtable: Record<string, string> = {
      markup_desc:
        "Cast {{SpellName}} to gain <scaleHealth>@Pct*100@%</scaleHealth> Health.<br><keyword>Friendship</keyword> grows %i:scaleCrit% fast.",
      markup_name: "Markup",
    };

    const map = resolveKiwiAugments(catalog, bin, stringtable);

    expect(map.get("markup")?.description).toBe(
      "Cast to gain 20% Health. Friendship grows fast."
    );
  });
});

function mockEndpoints(opts: { kiwiBinOk?: boolean } = {}): void {
  mockFetch.mockImplementation((url: string) => {
    if (url.includes("cherry-augments.json")) {
      return Promise.resolve({ ok: true, json: async () => makeCatalog() });
    }
    if (url.includes("kiwi.bin.json")) {
      if (opts.kiwiBinOk === false) {
        return Promise.resolve({ ok: false, status: 503 });
      }
      return Promise.resolve({ ok: true, json: async () => makeBin() });
    }
    if (url.includes("lol.stringtable.json")) {
      return Promise.resolve({
        ok: true,
        json: async () => ({ entries: makeStringtable() }),
      });
    }
    return Promise.resolve({ ok: false, status: 404 });
  });
}

describe("fetchKiwiAugments", () => {
  it("threads the pbe branch into the catalog, kiwi bin, and string table URLs", async () => {
    mockEndpoints();

    await fetchKiwiAugments("pbe");

    const urls = mockFetch.mock.calls.map((c) => c[0] as string);
    expect(
      urls.some(
        (u) => u.includes("/pbe/") && u.includes("cherry-augments.json")
      )
    ).toBe(true);
    expect(
      urls.some((u) => u.includes("/pbe/") && u.includes("kiwi.bin.json"))
    ).toBe(true);
    expect(
      urls.some(
        (u) => u.includes("/pbe/") && u.includes("lol.stringtable.json")
      )
    ).toBe(true);
  });

  it("throws when any endpoint responds !ok", async () => {
    mockEndpoints({ kiwiBinOk: false });

    await expect(fetchKiwiAugments("live")).rejects.toThrow();
  });

  it("normalizes icon paths to full CDragon URLs for the branch", async () => {
    mockEndpoints();

    const map = await fetchKiwiAugments("live");
    const iconPath = map.get("adapt")?.iconPath ?? "";

    expect(iconPath).toContain("https://raw.communitydragon.org/latest/");
    expect(iconPath).toContain("kiwi");
    expect(iconPath).toContain("adapt_small.png");
  });
});

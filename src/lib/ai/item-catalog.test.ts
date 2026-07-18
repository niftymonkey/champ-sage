import { describe, it, expect } from "vitest";
import {
  buildItemCatalogSections,
  isBuildPathEligible,
  selectMetaFile,
} from "./item-catalog";
import type { GameMode, ModeContext } from "../mode/types";
import {
  GAME_MODE_ARAM,
  GAME_MODE_ARENA,
  GAME_MODE_CLASSIC,
  GAME_MODE_MAYHEM,
} from "../mode/types";
import type { Champion, Item } from "../data-ingest/types";
import type { MetaBuildFile, MetaBuildIndex } from "../data-ingest/meta-builds";

function createStubMode(modeId: string): GameMode {
  return {
    id: modeId,
    displayName: modeId,
    decisionTypes: ["item-purchase"],
    augmentSelectionLevels: [],
    matches: (m: string) => m === modeId,
    buildContext: () => ({}) as ModeContext,
  };
}

function createItem(
  overrides: Partial<Item> & Pick<Item, "id" | "name">
): Item {
  return {
    description: "",
    plaintext: "",
    gold: { base: 0, total: 0, sell: 0, purchasable: true },
    tags: [],
    stats: {},
    image: "",
    mode: "aram",
    maps: [11, 12],
    ...overrides,
  };
}

function createChampion(
  key: number,
  name: string,
  tags: string[] = ["Mage"]
): Champion {
  return {
    id: name,
    key,
    name,
    title: "",
    tags,
    partype: "Mana",
    stats: {} as Champion["stats"],
    image: "",
  };
}

function createMetaFile(
  championKey: number,
  championName: string,
  itemSets: number[][]
): MetaBuildFile {
  return {
    patch: "16.7",
    region: "na1",
    queueId: 450,
    queueName: "ARAM",
    collectedAt: new Date().toISOString(),
    champions: {
      [String(championKey)]: {
        championName,
        sampleSize: 100,
        builds: itemSets.map((items) => ({
          items,
          perks: {
            statPerks: { defense: 0, flex: 0, offense: 0 },
            styles: [],
          },
          winRate: 0.5,
          pickRate: 0.1,
          games: 10,
        })),
      },
    },
  };
}

function createMetaFileWithItemPool(
  championKey: number,
  championName: string,
  pool: Array<{ itemId: number; presence: number }>
): MetaBuildFile {
  return {
    patch: "16.7",
    region: "na1",
    queueId: 450,
    queueName: "ARAM",
    collectedAt: new Date().toISOString(),
    champions: {
      [String(championKey)]: {
        championName,
        sampleSize: 100,
        builds: [],
        itemPool: pool,
      },
    },
  };
}

describe("selectMetaFile", () => {
  const aramFile = createMetaFile(1, "A", [[1001]]);
  const rankedFile = createMetaFile(1, "A", [[1002]]);
  const arenaFile = createMetaFile(1, "A", [[1003]]);
  const index: MetaBuildIndex = {
    aram: aramFile,
    rankedSolo: rankedFile,
    arena: arenaFile,
  };

  it("returns the ARAM file for ARAM mode", () => {
    expect(selectMetaFile(createStubMode(GAME_MODE_ARAM), index)).toBe(
      aramFile
    );
  });

  it("returns the ARAM file for Mayhem mode", () => {
    expect(selectMetaFile(createStubMode(GAME_MODE_MAYHEM), index)).toBe(
      aramFile
    );
  });

  it("returns the ranked-solo file for Classic mode", () => {
    expect(selectMetaFile(createStubMode(GAME_MODE_CLASSIC), index)).toBe(
      rankedFile
    );
  });

  it("returns the arena file for Arena mode", () => {
    expect(selectMetaFile(createStubMode(GAME_MODE_ARENA), index)).toBe(
      arenaFile
    );
  });

  it("returns null when the index is undefined", () => {
    expect(
      selectMetaFile(createStubMode(GAME_MODE_ARAM), undefined)
    ).toBeNull();
  });
});

describe("buildItemCatalogSections", () => {
  const jinx = createChampion(222, "Jinx", ["Marksman"]);
  const kraken = createItem({
    id: 6672,
    name: "Kraken Slayer",
    description: "Kills a kraken.",
    gold: { base: 600, total: 3100, sell: 2170, purchasable: true },
    mode: "aram",
    stats: { FlatPhysicalDamageMod: 65, PercentAttackSpeedMod: 0.35 },
  });
  const galeforce = createItem({
    id: 6671,
    name: "Galeforce",
    description: "Dashes really fast.",
    gold: { base: 200, total: 3400, sell: 2380, purchasable: true },
    mode: "aram",
    stats: { FlatPhysicalDamageMod: 60, PercentAttackSpeedMod: 0.2 },
  });
  const zhonyas = createItem({
    id: 3157,
    name: "Zhonya's Hourglass",
    description: "Stasis for 2.5 seconds.",
    gold: { base: 600, total: 2600, sell: 1820, purchasable: true },
    mode: "aram",
    stats: { FlatMagicDamageMod: 80, FlatArmorMod: 45 },
  });
  const jungleItem = createItem({
    id: 1041,
    name: "Emberknife",
    mode: "standard", // NOT in aram mode
    gold: { base: 450, total: 450, sell: 180, purchasable: true },
  });
  const refillablePotion = createItem({
    id: 2031,
    name: "Refillable Potion",
    mode: "aram",
    gold: { base: 150, total: 150, sell: 60, purchasable: true },
    into: [2033],
  });
  const longSword = createItem({
    id: 1036,
    name: "Long Sword",
    mode: "aram",
    gold: { base: 350, total: 350, sell: 245, purchasable: true },
    into: [3133, 3134, 6670],
  });
  const needlesslyLargeRod = createItem({
    id: 1058,
    name: "Needlessly Large Rod",
    mode: "aram",
    gold: { base: 1200, total: 1200, sell: 840, purchasable: true },
    into: [3089, 3157, 4645],
  });
  const mercuryTreads = createItem({
    id: 3111,
    name: "Mercury's Treads",
    mode: "aram",
    gold: { base: 350, total: 1250, sell: 875, purchasable: true },
    tags: ["Boots", "SpellBlock", "Tenacity"],
    into: [3173],
  });
  const basicsBoots = createItem({
    id: 1001,
    name: "Boots",
    mode: "aram",
    gold: { base: 300, total: 300, sell: 210, purchasable: true },
    tags: ["Boots"],
    into: [3006, 3009, 3020, 3047, 3111],
  });

  const allItems = new Map<number, Item>([
    [kraken.id, kraken],
    [galeforce.id, galeforce],
    [zhonyas.id, zhonyas],
    [jungleItem.id, jungleItem],
    [refillablePotion.id, refillablePotion],
    [longSword.id, longSword],
    [needlesslyLargeRod.id, needlesslyLargeRod],
    [mercuryTreads.id, mercuryTreads],
    [basicsBoots.id, basicsBoots],
  ]);

  it("produces tier 1 items from meta builds for a known champion", () => {
    const metaFile = createMetaFile(jinx.key, "Jinx", [
      [kraken.id, galeforce.id],
    ]);
    const index: MetaBuildIndex = {
      aram: metaFile,
      rankedSolo: null,
      arena: null,
    };

    const result = buildItemCatalogSections(
      createStubMode(GAME_MODE_ARAM),
      jinx,
      allItems,
      index
    );

    expect(result.text).not.toBeNull();
    expect(result.tier1Count).toBe(2);
    expect(result.text).toContain("Item pool for Jinx");
    expect(result.text).toContain("Kraken Slayer");
    expect(result.text).toContain("Galeforce");
    expect(result.text).toContain("Cost: 3100g");
  });

  it("shows each tier 1 item's presence rate from the item pool", () => {
    const metaFile = createMetaFileWithItemPool(jinx.key, "Jinx", [
      { itemId: kraken.id, presence: 0.62 },
      { itemId: zhonyas.id, presence: 0.28 },
    ]);
    const index: MetaBuildIndex = {
      aram: metaFile,
      rankedSolo: null,
      arena: null,
    };

    const result = buildItemCatalogSections(
      createStubMode(GAME_MODE_ARAM),
      jinx,
      allItems,
      index
    );

    expect(result.tier1Count).toBe(2);
    expect(result.text).toContain("Kraken Slayer");
    expect(result.text).toContain("used in 62% of games");
    expect(result.text).toContain("used in 28% of games");
  });

  it("omits the presence rate for legacy build-derived pools", () => {
    const metaFile = createMetaFile(jinx.key, "Jinx", [[kraken.id]]);
    const index: MetaBuildIndex = {
      aram: metaFile,
      rankedSolo: null,
      arena: null,
    };

    const result = buildItemCatalogSections(
      createStubMode(GAME_MODE_ARAM),
      jinx,
      allItems,
      index
    );

    expect(result.text).toContain("Kraken Slayer");
    expect(result.text).not.toContain("% of games");
  });

  it("includes non-meta mode items in tier 2", () => {
    const metaFile = createMetaFile(jinx.key, "Jinx", [[kraken.id]]);
    const index: MetaBuildIndex = {
      aram: metaFile,
      rankedSolo: null,
      arena: null,
    };

    const result = buildItemCatalogSections(
      createStubMode(GAME_MODE_ARAM),
      jinx,
      allItems,
      index
    );

    expect(result.text).toContain("Other available items");
    // Galeforce and Zhonya's are both ARAM-valid and not in the meta, so tier 2
    expect(result.text).toContain("Galeforce");
    expect(result.text).toContain("Zhonya's Hourglass");
    // Jungle item is NOT aram-mode, so it should be filtered out of tier 2
    expect(result.text).not.toContain("Emberknife");
  });

  it("excludes tier 1 items from tier 2 to avoid duplication", () => {
    const metaFile = createMetaFile(jinx.key, "Jinx", [[kraken.id]]);
    const index: MetaBuildIndex = {
      aram: metaFile,
      rankedSolo: null,
      arena: null,
    };

    const result = buildItemCatalogSections(
      createStubMode(GAME_MODE_ARAM),
      jinx,
      allItems,
      index
    );

    // Kraken should appear exactly once — in tier 1, not also listed in tier 2.
    const matches = (result.text ?? "").match(/Kraken Slayer/g) ?? [];
    expect(matches.length).toBe(1);
  });

  it("falls back to tier 2 only when the champion has no meta data", () => {
    const metaFile = createMetaFile(999, "OtherChampion", [[kraken.id]]);
    const index: MetaBuildIndex = {
      aram: metaFile,
      rankedSolo: null,
      arena: null,
    };

    const result = buildItemCatalogSections(
      createStubMode(GAME_MODE_ARAM),
      jinx,
      allItems,
      index
    );

    expect(result.tier1Count).toBe(0);
    expect(result.text).not.toContain("Item pool for Jinx");
    expect(result.text).toContain("Other available items");
    expect(result.text).toContain("Kraken Slayer"); // now in tier 2
  });

  it("falls back to tier 2 only when metaBuilds is undefined", () => {
    const result = buildItemCatalogSections(
      createStubMode(GAME_MODE_ARAM),
      jinx,
      allItems,
      undefined
    );

    expect(result.tier1Count).toBe(0);
    expect(result.tier2Count).toBeGreaterThan(0);
    expect(result.text).toContain("Other available items");
  });

  it("returns null text when there are no items at all", () => {
    const result = buildItemCatalogSections(
      createStubMode(GAME_MODE_ARAM),
      jinx,
      new Map(),
      undefined
    );

    expect(result.text).toBeNull();
  });

  it("uses ARAM meta data for Mayhem mode", () => {
    const metaFile = createMetaFile(jinx.key, "Jinx", [[kraken.id]]);
    const index: MetaBuildIndex = {
      aram: metaFile,
      rankedSolo: null,
      arena: null,
    };

    const result = buildItemCatalogSections(
      createStubMode(GAME_MODE_MAYHEM),
      jinx,
      allItems,
      index
    );

    expect(result.tier1Count).toBe(1);
    expect(result.text).toContain("Kraken Slayer");
  });

  it("excludes consumables from tier 1 (gold < 500)", () => {
    const metaFile = createMetaFile(jinx.key, "Jinx", [
      [kraken.id, refillablePotion.id, longSword.id],
    ]);
    const index: MetaBuildIndex = {
      aram: metaFile,
      rankedSolo: null,
      arena: null,
    };

    const result = buildItemCatalogSections(
      createStubMode(GAME_MODE_ARAM),
      jinx,
      allItems,
      index
    );

    expect(result.text).toContain("Kraken Slayer");
    expect(result.text).not.toContain("Refillable Potion");
    expect(result.text).not.toContain("Long Sword");
    expect(result.tier1Count).toBe(1);
  });

  it("excludes components from tier 1 (items that build into others)", () => {
    const metaFile = createMetaFile(jinx.key, "Jinx", [
      [kraken.id, needlesslyLargeRod.id],
    ]);
    const index: MetaBuildIndex = {
      aram: metaFile,
      rankedSolo: null,
      arena: null,
    };

    const result = buildItemCatalogSections(
      createStubMode(GAME_MODE_ARAM),
      jinx,
      allItems,
      index
    );

    expect(result.text).toContain("Kraken Slayer");
    expect(result.text).not.toContain("Needlessly Large Rod");
    expect(result.tier1Count).toBe(1);
  });

  it("includes upgraded boots in tier 1 despite having an 'into' array", () => {
    const metaFile = createMetaFile(jinx.key, "Jinx", [
      [kraken.id, mercuryTreads.id],
    ]);
    const index: MetaBuildIndex = {
      aram: metaFile,
      rankedSolo: null,
      arena: null,
    };

    const result = buildItemCatalogSections(
      createStubMode(GAME_MODE_ARAM),
      jinx,
      allItems,
      index
    );

    expect(result.text).toContain("Kraken Slayer");
    expect(result.text).toContain("Mercury's Treads");
    expect(result.tier1Count).toBe(2);
  });

  it("excludes base boots from tier 1 (gold < 500)", () => {
    const metaFile = createMetaFile(jinx.key, "Jinx", [
      [kraken.id, basicsBoots.id],
    ]);
    const index: MetaBuildIndex = {
      aram: metaFile,
      rankedSolo: null,
      arena: null,
    };

    const result = buildItemCatalogSections(
      createStubMode(GAME_MODE_ARAM),
      jinx,
      allItems,
      index
    );

    expect(result.text).toContain("Kraken Slayer");
    expect(result.text).not.toMatch(/\bBoots\b/);
    expect(result.tier1Count).toBe(1);
  });
});

describe("isBuildPathEligible", () => {
  const aram = createStubMode(GAME_MODE_ARAM);
  const classic = createStubMode(GAME_MODE_CLASSIC);
  const arena = createStubMode(GAME_MODE_ARENA);

  // A completed, purchasable, durable standard item: the eligible baseline.
  // Per-case overrides flip one property to assert the rule it triggers.
  function completed(
    overrides: Partial<Item> & Pick<Item, "id" | "name">
  ): Item {
    return createItem({
      mode: "standard",
      tags: [],
      gold: { base: 0, total: 3000, sell: 0, purchasable: true },
      ...overrides,
    });
  }

  it("accepts a completed purchasable standard item in ARAM", () => {
    expect(
      isBuildPathEligible(completed({ id: 1, name: "On-Hit Item" }), aram)
    ).toBe(true);
  });

  it("accepts an ARAM variant item in ARAM (standard + aram overlay)", () => {
    expect(
      isBuildPathEligible(
        completed({ id: 2, name: "ARAM Variant", mode: "aram" }),
        aram
      )
    ).toBe(true);
  });

  it("accepts upgraded boots despite an into-upgrade", () => {
    expect(
      isBuildPathEligible(
        completed({
          id: 3,
          name: "Plated Steelcaps",
          tags: ["Boots"],
          into: [90001],
          gold: { base: 0, total: 1100, sell: 0, purchasable: true },
        }),
        aram
      )
    ).toBe(true);
  });

  it("rejects consumables", () => {
    expect(
      isBuildPathEligible(
        completed({
          id: 4,
          name: "Poro-Snax",
          mode: "aram",
          tags: ["Consumable"],
          gold: { base: 0, total: 50, sell: 0, purchasable: true },
        }),
        aram
      )
    ).toBe(false);
  });

  it("rejects trinkets", () => {
    expect(
      isBuildPathEligible(
        completed({
          id: 5,
          name: "Stealth Ward",
          tags: ["Trinket"],
          gold: { base: 0, total: 0, sell: 0, purchasable: true },
        }),
        aram
      )
    ).toBe(false);
  });

  it("rejects components that build into another item", () => {
    expect(
      isBuildPathEligible(
        completed({
          id: 6,
          name: "Pickaxe",
          into: [3031],
          gold: { base: 0, total: 875, sell: 0, purchasable: true },
        }),
        aram
      )
    ).toBe(false);
  });

  it("rejects sub-500-gold items", () => {
    expect(
      isBuildPathEligible(
        completed({
          id: 7,
          name: "Cloth Armor",
          gold: { base: 0, total: 300, sell: 0, purchasable: true },
        }),
        aram
      )
    ).toBe(false);
  });

  it("rejects non-purchasable items", () => {
    expect(
      isBuildPathEligible(
        completed({
          id: 8,
          name: "Quest Reward",
          gold: { base: 0, total: 1000, sell: 0, purchasable: false },
        }),
        aram
      )
    ).toBe(false);
  });

  it("rejects an arena-partition item in ARAM", () => {
    expect(
      isBuildPathEligible(
        completed({ id: 9, name: "Prismatic Thing", mode: "arena" }),
        aram
      )
    ).toBe(false);
  });

  it("accepts only standard items in Classic, not ARAM-partition variants", () => {
    expect(
      isBuildPathEligible(completed({ id: 10, name: "SR Item" }), classic)
    ).toBe(true);
    expect(
      isBuildPathEligible(
        completed({ id: 11, name: "ARAM Variant", mode: "aram" }),
        classic
      )
    ).toBe(false);
  });

  it("accepts only arena items in Arena, not standard", () => {
    expect(
      isBuildPathEligible(
        completed({ id: 12, name: "Prismatic", mode: "arena", maps: [30] }),
        arena
      )
    ).toBe(true);
    expect(
      isBuildPathEligible(completed({ id: 13, name: "SR Item" }), arena)
    ).toBe(false);
  });

  it("rejects an item available on no map (deprecated / internal)", () => {
    // The reliable junk signal: an all-false maps record. Unlike a specific-map
    // filter, this never drops a real item, since every real item is on a map.
    expect(
      isBuildPathEligible(
        completed({ id: 14, name: "Deprecated", maps: [] }),
        aram
      )
    ).toBe(false);
  });
});

describe("tier 2 catalog: dedupe and junk exclusion", () => {
  // Modeled on the real Abyssal Mask situation: DDragon carries two same-named
  // variants (the canonical one on SR + ARAM, and a niche one). Both pass the
  // permissive mode filter, so the catalog must collapse them to one, keeping
  // the more broadly-available variant. A separate deprecated entry is on no
  // map and must be dropped entirely.
  const rabadons = createItem({
    id: 3089,
    name: "Rabadon's Deathcap",
    mode: "standard",
    maps: [11, 12],
    gold: { base: 1100, total: 3600, sell: 2520, purchasable: true },
    stats: { FlatMagicDamageMod: 130 },
  });
  const abyssalAram = createItem({
    id: 8020,
    name: "Abyssal Mask",
    mode: "standard",
    maps: [11, 12],
    gold: { base: 500, total: 2650, sell: 1855, purchasable: true },
    stats: { FlatSpellBlockMod: 45 },
  });
  const abyssalSrOnly = createItem({
    id: 328020,
    name: "Abyssal Mask",
    mode: "aram",
    maps: [11],
    gold: { base: 500, total: 2850, sell: 1995, purchasable: true },
    stats: { FlatSpellBlockMod: 50 },
  });
  const component = createItem({
    id: 1038,
    name: "B. F. Sword",
    mode: "standard",
    maps: [11, 12],
    into: [3089],
    gold: { base: 1300, total: 1300, sell: 910, purchasable: true },
    stats: { FlatPhysicalDamageMod: 40 },
  });
  const deprecated = createItem({
    id: 3095,
    name: "Deprecated item",
    mode: "standard",
    maps: [],
    gold: { base: 1000, total: 3000, sell: 2100, purchasable: true },
    stats: { FlatPhysicalDamageMod: 50 },
  });
  const arenaAbyssal = createItem({
    id: 228020,
    name: "Abyssal Mask",
    mode: "arena",
    maps: [30],
    gold: { base: 500, total: 2500, sell: 1750, purchasable: true },
    stats: { FlatSpellBlockMod: 40 },
  });

  const items = new Map<number, Item>([
    [3089, rabadons],
    [8020, abyssalAram],
    [328020, abyssalSrOnly],
    [1038, component],
    [3095, deprecated],
    [228020, arenaAbyssal],
  ]);

  const champ = createChampion(222, "Jinx", ["Marksman"]);

  function aramText(): string {
    return (
      buildItemCatalogSections(
        createStubMode(GAME_MODE_ARAM),
        champ,
        items,
        undefined
      ).text ?? ""
    );
  }

  it("includes standard items that are available on the ARAM map", () => {
    expect(aramText()).toContain("Rabadon's Deathcap");
    expect(aramText()).toContain("Abyssal Mask");
  });

  it("lists a same-named item only once, keeping the ARAM-available variant", () => {
    // The old ID-range predicate surfaced BOTH Abyssal Masks (2650g + 2850g).
    // Only the map-12 variant is real in ARAM; the SR-only one must not appear.
    const lines = aramText()
      .split("\n")
      .filter((l) => l.startsWith("- Abyssal Mask"));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("2650g");
    expect(lines[0]).not.toContain("2850g");
  });

  it("excludes items available on no map (deprecated / internal)", () => {
    expect(aramText()).not.toContain("Deprecated item");
  });

  it("does not repeat a tier-1 item name in tier 2 via a different variant id", () => {
    // Jinx's meta pool holds Abyssal Mask by the id 8020. The SR-only variant
    // 328020 shares the name but a different id, so an id-only tier-1 exclusion
    // leaves it in tier 2 and "Abyssal Mask" appears in BOTH sections.
    const index: MetaBuildIndex = {
      aram: createMetaFileWithItemPool(222, "Jinx", [
        { itemId: 8020, presence: 0.6 },
      ]),
      rankedSolo: null,
      arena: null,
    };
    const result = buildItemCatalogSections(
      createStubMode(GAME_MODE_ARAM),
      champ,
      items,
      index
    );
    const text = result.text ?? "";

    // Present once, in tier 1 (the "**Abyssal Mask**" meta line), and absent
    // from the "- Abyssal Mask" tier-2 reference list.
    expect(text).toContain("**Abyssal Mask**");
    expect(
      text.split("\n").filter((l) => l.startsWith("- Abyssal Mask"))
    ).toHaveLength(0);
  });

  it("excludes components", () => {
    expect(aramText()).not.toContain("B. F. Sword");
  });

  it("scopes Arena's catalog to arena-map items", () => {
    const text =
      buildItemCatalogSections(
        createStubMode(GAME_MODE_ARENA),
        champ,
        items,
        undefined
      ).text ?? "";
    expect(text).toContain("Abyssal Mask");
    expect(text).not.toContain("Rabadon's Deathcap");
  });
});

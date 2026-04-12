import { describe, it, expect } from "vitest";
import {
  buildItemCatalogSections,
  selectItemMode,
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

describe("selectItemMode", () => {
  it("maps Mayhem to the ARAM item mode", () => {
    expect(selectItemMode(createStubMode(GAME_MODE_MAYHEM))).toBe("aram");
  });

  it("maps ARAM to the ARAM item mode", () => {
    expect(selectItemMode(createStubMode(GAME_MODE_ARAM))).toBe("aram");
  });

  it("maps Arena to the arena item mode", () => {
    expect(selectItemMode(createStubMode(GAME_MODE_ARENA))).toBe("arena");
  });

  it("defaults to standard for Classic", () => {
    expect(selectItemMode(createStubMode(GAME_MODE_CLASSIC))).toBe("standard");
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
    expect(result.text).not.toContain(/\bBoots\b/);
    expect(result.tier1Count).toBe(1);
  });
});

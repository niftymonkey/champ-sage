import { describe, it, expect } from "vitest";
import {
  describeRecommendationDrop,
  enforceRecommendationLegality,
} from "./legality";
import type { Recommendation } from "../../types";
import type { Item, ItemMode } from "../../../data-ingest/types";
import type { GameMode, ModeContext } from "../../../mode/types";
import { GAME_MODE_CLASSIC } from "../../../mode/types";

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

const classic = createStubMode(GAME_MODE_CLASSIC);

interface MakeItemOptions {
  mutexGroups?: string[];
  purchasable?: boolean;
  specialRecipe?: number;
  mode?: ItemMode;
  maps?: number[];
  tags?: string[];
  goldTotal?: number;
}

function makeItem(
  id: number,
  name: string,
  options: MakeItemOptions = {}
): [number, Item] {
  return [
    id,
    {
      id,
      name,
      description: "",
      plaintext: "",
      gold: {
        base: 0,
        total: options.goldTotal ?? 3000,
        sell: 2100,
        purchasable: options.purchasable ?? true,
      },
      tags: options.tags ?? [],
      stats: {},
      image: `${id}.png`,
      mode: options.mode ?? "standard",
      maps: options.maps ?? [11, 12],
      mutexGroups: options.mutexGroups,
      specialRecipe: options.specialRecipe,
    },
  ];
}

const items = new Map<number, Item>([
  makeItem(3036, "Lord Dominik's Regards", { mutexGroups: ["Fatality"] }),
  makeItem(3033, "Mortal Reminder", { mutexGroups: ["Fatality"] }),
  makeItem(6694, "Serylda's Grudge", { mutexGroups: ["Fatality"] }),
  makeItem(3004, "Manamune", { mutexGroups: ["Manaflow"] }),
  makeItem(3003, "Archangel's Staff", { mutexGroups: ["Manaflow"] }),
  // Transformation-only: not purchasable, points at its base (Manamune).
  makeItem(3042, "Muramana", {
    mutexGroups: ["Manaflow"],
    purchasable: false,
    specialRecipe: 3004,
  }),
  makeItem(3009, "Boots of Swiftness", { tags: ["Boots"] }),
  makeItem(3020, "Sorcerer's Shoes", { tags: ["Boots"] }),
  makeItem(3006, "Berserker's Greaves", { tags: ["Boots"] }),
  // DDragon's 300g tier-1 boots: "Boots"-tagged but a component.
  makeItem(1001, "Boots", { tags: ["Boots"], goldTotal: 300 }),
  makeItem(3031, "Infinity Edge"),
  makeItem(3072, "Bloodthirster"),
  // Arena-only by its maps record: unavailable in Classic.
  makeItem(4015, "Perplexity", { maps: [30] }),
]);

function option(
  name: string,
  fit: Recommendation["fit"] = "strong"
): Recommendation {
  return { name, fit, reasoning: "" };
}

describe("enforceRecommendationLegality", () => {
  it("returns every option unchanged when nothing collides", () => {
    const options = [
      option("Lord Dominik's Regards"),
      option("Infinity Edge"),
      option("Bloodthirster"),
    ];

    const result = enforceRecommendationLegality(options, items, classic);

    expect(result.recommendations).toEqual(options);
    expect(result.dropped).toEqual([]);
  });

  describe("options are alternatives, not an end-state inventory", () => {
    it("keeps two options from the same restriction group", () => {
      // The player picks ONE of the offered options, so two members of the
      // same group are a legitimate comparison. This is the opposite of the
      // build path, where the two would co-exist in one inventory.
      const options = [
        option("Lord Dominik's Regards"),
        option("Mortal Reminder"),
        option("Serylda's Grudge"),
      ];

      const result = enforceRecommendationLegality(options, items, classic);

      expect(result.recommendations).toEqual(options);
      expect(result.dropped).toEqual([]);
    });

    it("keeps two boots options", () => {
      const options = [
        option("Boots of Swiftness"),
        option("Sorcerer's Shoes"),
        option("Infinity Edge"),
      ];

      const result = enforceRecommendationLegality(options, items, classic);

      expect(result.recommendations).toEqual(options);
      expect(result.dropped).toEqual([]);
    });

    it("never echoes an owned item back as an option", () => {
      // The build path REQUIRES owned items to reappear once in their
      // end-state slot; an option list must never suggest buying one again.
      const options = [option("Infinity Edge"), option("Bloodthirster")];

      const result = enforceRecommendationLegality(options, items, classic, [
        "Infinity Edge",
      ]);

      expect(result.recommendations.map((r) => r.name)).toEqual([
        "Bloodthirster",
      ]);
      expect(result.dropped).toEqual([
        {
          kind: "already-owned",
          recommendation: option("Infinity Edge"),
          ownedName: "Infinity Edge",
        },
      ]);
    });

    it("drops an option whose purchasable base the player owns evolved", () => {
      // Owning Muramana makes buying Manamune a no-op purchase.
      const options = [option("Manamune"), option("Infinity Edge")];

      const result = enforceRecommendationLegality(options, items, classic, [
        "Muramana",
      ]);

      expect(result.recommendations.map((r) => r.name)).toEqual([
        "Infinity Edge",
      ]);
      expect(result.dropped).toEqual([
        {
          kind: "already-owned",
          recommendation: option("Manamune"),
          ownedName: "Muramana",
        },
      ]);
    });
  });

  describe("inventory-held slots", () => {
    it("drops the exact playtest regression (owned LDR, offered Mortal Reminder)", () => {
      // 2026-07-29 ARAM Mayhem game: the item-rec window offered Mortal
      // Reminder while the player held Lord Dominik's Regards, and the shop
      // refuses that purchase.
      const options = [
        option("Mortal Reminder", "exceptional"),
        option("Infinity Edge"),
      ];

      const result = enforceRecommendationLegality(options, items, classic, [
        "Lord Dominik's Regards",
      ]);

      expect(result.recommendations.map((r) => r.name)).toEqual([
        "Infinity Edge",
      ]);
      expect(result.dropped).toEqual([
        {
          kind: "owned-group-collision",
          recommendation: option("Mortal Reminder", "exceptional"),
          group: "Fatality",
          ownedName: "Lord Dominik's Regards",
        },
      ]);
    });

    it("names the owned evolved item as the group's holder", () => {
      const options = [option("Archangel's Staff"), option("Infinity Edge")];

      const result = enforceRecommendationLegality(options, items, classic, [
        "Muramana",
      ]);

      expect(result.recommendations.map((r) => r.name)).toEqual([
        "Infinity Edge",
      ]);
      expect(result.dropped).toEqual([
        {
          kind: "owned-group-collision",
          recommendation: option("Archangel's Staff"),
          group: "Manaflow",
          ownedName: "Muramana",
        },
      ]);
    });

    it("drops a boots option when the player owns a finished pair", () => {
      const options = [option("Sorcerer's Shoes"), option("Infinity Edge")];

      const result = enforceRecommendationLegality(options, items, classic, [
        "Berserker's Greaves",
      ]);

      expect(result.recommendations.map((r) => r.name)).toEqual([
        "Infinity Edge",
      ]);
      expect(result.dropped).toEqual([
        {
          kind: "owned-boots-collision",
          recommendation: option("Sorcerer's Shoes"),
          ownedName: "Berserker's Greaves",
        },
      ]);
    });

    it("keeps a boots option when the player only owns tier-1 Boots", () => {
      const options = [option("Sorcerer's Shoes"), option("Infinity Edge")];

      const result = enforceRecommendationLegality(options, items, classic, [
        "Boots",
      ]);

      expect(result.recommendations).toEqual(options);
      expect(result.dropped).toEqual([]);
    });
  });

  it("drops a repeated option name and keeps the first", () => {
    const options = [
      option("Infinity Edge", "exceptional"),
      option("Bloodthirster"),
      option("Infinity Edge", "situational"),
    ];

    const result = enforceRecommendationLegality(options, items, classic);

    expect(result.recommendations).toEqual([options[0], options[1]]);
    expect(result.dropped).toEqual([
      {
        kind: "duplicate-option",
        recommendation: option("Infinity Edge", "situational"),
      },
    ]);
  });

  it("drops an option no same-named variant makes purchasable in the mode", () => {
    const options = [option("Perplexity"), option("Infinity Edge")];

    const result = enforceRecommendationLegality(options, items, classic);

    expect(result.recommendations.map((r) => r.name)).toEqual([
      "Infinity Edge",
    ]);
    expect(result.dropped).toEqual([
      {
        kind: "mode-unavailable",
        recommendation: option("Perplexity"),
        modeName: GAME_MODE_CLASSIC,
      },
    ]);
  });

  it("keeps unknown names: the catalog cannot prove them illegal", () => {
    const options = [option("Totally Made Up Item"), option("Infinity Edge")];

    const result = enforceRecommendationLegality(options, items, classic, [
      "Lord Dominik's Regards",
    ]);

    expect(result.recommendations).toEqual(options);
    expect(result.dropped).toEqual([]);
  });
});

describe("describeRecommendationDrop", () => {
  it("describes an option the player already owns", () => {
    expect(
      describeRecommendationDrop({
        kind: "already-owned",
        recommendation: option("Infinity Edge"),
        ownedName: "Infinity Edge",
      })
    ).toBe("Infinity Edge (player already owns it)");
  });

  it("names the owned evolved form for a base-item drop", () => {
    expect(
      describeRecommendationDrop({
        kind: "already-owned",
        recommendation: option("Manamune"),
        ownedName: "Muramana",
      })
    ).toBe("Manamune (player already owns Muramana)");
  });

  it("describes a collision with an owned item's restriction group", () => {
    expect(
      describeRecommendationDrop({
        kind: "owned-group-collision",
        recommendation: option("Mortal Reminder"),
        group: "Fatality",
        ownedName: "Lord Dominik's Regards",
      })
    ).toBe(
      "Mortal Reminder (group Fatality, player owns Lord Dominik's Regards)"
    );
  });

  it("describes a collision with owned boots", () => {
    expect(
      describeRecommendationDrop({
        kind: "owned-boots-collision",
        recommendation: option("Sorcerer's Shoes"),
        ownedName: "Berserker's Greaves",
      })
    ).toBe("Sorcerer's Shoes (boots, player owns Berserker's Greaves)");
  });

  it("describes a duplicate option", () => {
    expect(
      describeRecommendationDrop({
        kind: "duplicate-option",
        recommendation: option("Infinity Edge"),
      })
    ).toBe("Infinity Edge (duplicate of an earlier option)");
  });

  it("describes a mode-unavailable option", () => {
    expect(
      describeRecommendationDrop({
        kind: "mode-unavailable",
        recommendation: option("Perplexity"),
        modeName: "ARAM",
      })
    ).toBe("Perplexity (not purchasable in ARAM)");
  });
});

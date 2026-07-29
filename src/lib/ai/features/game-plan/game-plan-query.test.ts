import { describe, it, expect } from "vitest";
import {
  buildGamePlanQuestion,
  describeBuildPathDrop,
  enforceBuildPathLegality,
  extractBuildPath,
  isUpdatePlanCommand,
} from "./index";
import { GAME_PLAN_TASK_PROMPT } from "./prompt";
import type { BuildPathItem, CoachingResponse } from "../../types";
import type { Item, ItemMode } from "../../../data-ingest/types";
import type { GameMode, ModeContext } from "../../../mode/types";
import { GAME_MODE_ARAM, GAME_MODE_CLASSIC } from "../../../mode/types";

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
const aram = createStubMode(GAME_MODE_ARAM);

describe("buildGamePlanQuestion", () => {
  const q = buildGamePlanQuestion();

  it("asks for the 6-item build path", () => {
    expect(q).toMatch(/6-item build path/);
  });

  it("is state-agnostic — does not anchor to start of game", () => {
    // The same prompt serves opening and mid-game update calls; the [Game State]
    // block carries temporal context. See game-plan-query.ts docblock.
    expect(q).not.toMatch(/start of the game/i);
    expect(q).not.toMatch(/beginning of the (?:game|match)/i);
  });

  it("handles mid-game state where items are already built", () => {
    expect(q).toMatch(/already built|current inventory/i);
  });

  it("requires items in the `buildPath` field", () => {
    expect(q).toMatch(/`buildPath` field/);
  });

  it("lists every supported category", () => {
    for (const cat of [
      "core",
      "counter",
      "defensive",
      "damage",
      "utility",
      "situational",
    ]) {
      expect(q).toMatch(new RegExp(`\\b${cat}\\b`));
    }
  });

  it("tells the model to set targetEnemy for counter, null otherwise", () => {
    // The schema requires targetEnemy on every buildPath item (nullable, not
    // optional) — the prompt must not instruct the model to omit it.
    expect(q).toMatch(/targetEnemy:/);
    expect(q).toMatch(/when category is `counter`/);
    expect(q).toMatch(/set to `null` for every other category/);
    expect(q).not.toMatch(/\bOmit\b/i);
  });

  it("asks for terse reason text (no full sentences)", () => {
    expect(q).toMatch(/few words max/);
    expect(q).toMatch(/No full sentences/);
  });
});

describe("isUpdatePlanCommand", () => {
  describe("matches imperative command phrasings", () => {
    const hits = [
      "update plan",
      "update game plan",
      "update the plan",
      "update my plan",
      "update the game plan",
      "update my game plan",
      "Update game plan.",
      "UPDATE GAME PLAN",
      "update game plan!",
      "please update the game plan",
      "hey update the plan",
      "ok update the plan",
      "okay update my plan",
      "coach update my game plan",
      "hey coach update my plan",
      "please hey update the plan",
      "ok coach please refresh the plan",
      "refresh plan",
      "refresh the plan",
      "refresh my game plan",
      "rework the plan",
      "rework my game plan",
      "redo the plan",
      "redo my game plan",
      "replace the plan",
      "remake the game plan",
      "   update game plan   ",
      // Whisper occasionally collapses "game plan" into one word; the hook
      // should still fire instead of falling through to a coaching question.
      "update gameplan",
      "update the gameplan",
      "update my gameplan",
      "refresh gameplan",
      "rework my gameplan",
      // Targeted widen (#2): natural, mid-sentence phrasings the old
      // start-anchored matcher missed. Intent is a command, so the plan should
      // regenerate. "gameplay" is Whisper mishearing "game plan".
      "you should update the game plan",
      "I think you should update gameplay",
      "these are wrong, update the plan",
      "can you update the game plan",
      "I want you to update the game plan",
    ];
    for (const phrase of hits) {
      it(`matches "${phrase}"`, () => {
        expect(isUpdatePlanCommand(phrase)).toBe(true);
      });
    }
  });

  describe("does not match coaching questions or commentary", () => {
    const misses = [
      "what's the plan for dragon",
      "what's your plan",
      "should I plan ahead",
      "I have a plan",
      "I think the plan is working",
      "what should I build next",
      "is Zhonya's a good plan",
      "should I update my plan",
      "is my plan working",
      "my new plan is to split push",
      "that's a new plan",
      "new plan",
      "new game plan",
      "did my build plan update",
      "can you update my build",
      // Deliberative questions: the player is weighing whether to update, not
      // commanding it. Must fall through to a coaching answer, not silently
      // regenerate the plan. These guard the targeted widen (#2) from
      // over-firing.
      "do you think I should update the plan",
      "should we update the game plan or keep poking",
    ];
    for (const phrase of misses) {
      it(`does not match "${phrase}"`, () => {
        expect(isUpdatePlanCommand(phrase)).toBe(false);
      });
    }
  });
});

describe("extractBuildPath", () => {
  it("returns the structured buildPath when present", () => {
    const response: CoachingResponse = {
      answer: "ok",
      recommendations: [],
      buildPath: [
        {
          name: "Rocketbelt",
          category: "core",
          targetEnemy: null,
          reason: "mobility",
        },
        {
          name: "Zhonya's",
          category: "counter",
          targetEnemy: "Zed",
          reason: "stasis",
        },
      ],
    };

    expect(extractBuildPath(response)).toEqual(response.buildPath);
  });

  it("falls back to promoting recommendations when buildPath is null", () => {
    const response: CoachingResponse = {
      answer: "ok",
      recommendations: [
        { name: "Zhonya's", fit: "strong", reasoning: "vs burst" },
        { name: "Banshee's", fit: "situational", reasoning: "spell shield" },
      ],
      buildPath: null,
    };

    const result = extractBuildPath(response);
    expect(result).toEqual([
      {
        name: "Zhonya's",
        category: "core",
        targetEnemy: null,
        reason: "vs burst",
      },
      {
        name: "Banshee's",
        category: "core",
        targetEnemy: null,
        reason: "spell shield",
      },
    ]);
  });

  it("falls back when buildPath is an empty array", () => {
    const response: CoachingResponse = {
      answer: "ok",
      recommendations: [{ name: "Rabadon's", fit: "strong", reasoning: "AP" }],
      buildPath: [],
    };

    const result = extractBuildPath(response);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("Rabadon's");
    expect(result[0].targetEnemy).toBeNull();
  });

  it("preserves counter targetEnemy when provided", () => {
    const response: CoachingResponse = {
      answer: "",
      recommendations: [],
      buildPath: [
        {
          name: "Thornmail",
          category: "counter",
          targetEnemy: "Yi",
          reason: "GW vs auto crit",
        },
      ],
    };

    expect(extractBuildPath(response)[0].targetEnemy).toBe("Yi");
  });
});

describe("GAME_PLAN_TASK_PROMPT", () => {
  it("forbids multiple Boots-tagged items in the build path", () => {
    // #109 AC: build path never contains two pairs of boots. The schema enum
    // can't express uniqueness, so the rule lives in the prompt and is
    // enforced post-hoc by enforceBuildPathLegality's boots rule.
    expect(GAME_PLAN_TASK_PROMPT).toMatch(/\bboots\b/i);
    expect(GAME_PLAN_TASK_PROMPT).toMatch(/at most one/i);
  });

  it("forbids two items from the same purchase-restriction group", () => {
    // #117 mutex slice: two Last Whisper items (Lord Dominik's Regards +
    // Mortal Reminder) cannot coexist. The rule references the item catalog's
    // Purchase restrictions section and is double-checked post-hoc by
    // enforceBuildPathLegality.
    expect(GAME_PLAN_TASK_PROMPT).toMatch(/purchase restrictions/i);
    expect(GAME_PLAN_TASK_PROMPT).toMatch(/never.*two items.*same/is);
  });

  it("forbids listing the same item name twice", () => {
    // #117 duplicate slice: the shop allows only one copy of a completed
    // item, so a 6-slot end-state path can never repeat a name. Enforced
    // post-hoc by enforceBuildPathLegality.
    expect(GAME_PLAN_TASK_PROMPT).toMatch(/same item name twice/i);
  });

  it("keeps the end-state contract for owned items while forbidding re-buys", () => {
    // Owned items MUST still appear once (the buildPath is the end-state
    // inventory), so the rule targets second copies and restriction-group
    // siblings of owned items, not the owned items themselves.
    expect(GAME_PLAN_TASK_PROMPT).toMatch(/already own/i);
    expect(GAME_PLAN_TASK_PROMPT).toMatch(
      /restriction group as .*already own/i
    );
  });
});

describe("enforceBuildPathLegality", () => {
  interface MakeItemOptions {
    mutexGroups?: string[];
    purchasable?: boolean;
    specialRecipe?: number;
    mode?: ItemMode;
    maps?: number[];
    tags?: string[];
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
          total: 3000,
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
    makeItem(3302, "Terminus", { mutexGroups: ["Fatality", "Blight"] }),
    makeItem(3135, "Void Staff", { mutexGroups: ["Blight"] }),
    makeItem(3004, "Manamune", { mutexGroups: ["Manaflow"] }),
    // Transformation-only: not purchasable, points at its base (Manamune).
    makeItem(3042, "Muramana", {
      mutexGroups: ["Manaflow"],
      purchasable: false,
      specialRecipe: 3004,
    }),
    makeItem(3003, "Archangel's Staff", { mutexGroups: ["Manaflow"] }),
    makeItem(3508, "Essence Reaver", { mutexGroups: ["Spellblade"] }),
    makeItem(3158, "Ionian Boots of Lucidity"),
    makeItem(3031, "Infinity Edge"),
  ]);

  function entry(
    name: string,
    category: BuildPathItem["category"] = "core"
  ): BuildPathItem {
    return { name, category, targetEnemy: null, reason: "" };
  }

  it("returns the path unchanged with no drops when no groups collide", () => {
    const path = [
      entry("Manamune"),
      entry("Essence Reaver"),
      entry("Lord Dominik's Regards"),
      entry("Infinity Edge"),
    ];

    const result = enforceBuildPathLegality(path, items, classic);

    expect(result.buildPath).toEqual(path);
    expect(result.dropped).toEqual([]);
  });

  it("drops the later of two same-group items and reports the collision", () => {
    const path = [
      entry("Lord Dominik's Regards", "counter"),
      entry("Infinity Edge", "damage"),
      entry("Mortal Reminder", "counter"),
    ];

    const result = enforceBuildPathLegality(path, items, classic);

    expect(result.buildPath.map((e) => e.name)).toEqual([
      "Lord Dominik's Regards",
      "Infinity Edge",
    ]);
    expect(result.dropped).toEqual([
      {
        kind: "mutex-collision",
        entry: entry("Mortal Reminder", "counter"),
        group: "Fatality",
        keptName: "Lord Dominik's Regards",
        keptSource: "path",
      },
    ]);
  });

  it("remediates the exact playtest regression (LDR + Mortal Reminder)", () => {
    // 2026-07-27 game log: 4 consecutive plans carried both Last Whisper
    // items, surviving two voice corrections.
    const path = [
      entry("Ionian Boots of Lucidity"),
      entry("Manamune"),
      entry("Essence Reaver"),
      entry("Lord Dominik's Regards", "counter"),
      entry("Mortal Reminder", "counter"),
      entry("Infinity Edge", "damage"),
    ];

    const result = enforceBuildPathLegality(path, items, classic);

    expect(result.buildPath.map((e) => e.name)).toEqual([
      "Ionian Boots of Lucidity",
      "Manamune",
      "Essence Reaver",
      "Lord Dominik's Regards",
      "Infinity Edge",
    ]);
    expect(result.dropped.map((d) => d.entry.name)).toEqual([
      "Mortal Reminder",
    ]);
  });

  it("keeps only the first of three same-group items", () => {
    const path = [
      entry("Serylda's Grudge"),
      entry("Lord Dominik's Regards"),
      entry("Mortal Reminder"),
    ];

    const result = enforceBuildPathLegality(path, items, classic);

    expect(result.buildPath.map((e) => e.name)).toEqual(["Serylda's Grudge"]);
    expect(
      result.dropped.map((d) =>
        d.kind === "mutex-collision" ? d.keptName : d.kind
      )
    ).toEqual(["Serylda's Grudge", "Serylda's Grudge"]);
  });

  it("enforces every group a dual-group item belongs to", () => {
    const path = [entry("Terminus"), entry("Void Staff")];

    const result = enforceBuildPathLegality(path, items, classic);

    expect(result.buildPath.map((e) => e.name)).toEqual(["Terminus"]);
    expect(result.dropped).toEqual([
      {
        kind: "mutex-collision",
        entry: entry("Void Staff"),
        group: "Blight",
        keptName: "Terminus",
        keptSource: "path",
      },
    ]);
  });

  it("drops a dual-group item when either of its groups is taken", () => {
    const path = [entry("Lord Dominik's Regards"), entry("Terminus")];

    const result = enforceBuildPathLegality(path, items, classic);

    expect(result.buildPath.map((e) => e.name)).toEqual([
      "Lord Dominik's Regards",
    ]);
    expect(result.dropped).toEqual([
      {
        kind: "mutex-collision",
        entry: entry("Terminus"),
        group: "Fatality",
        keptName: "Lord Dominik's Regards",
        keptSource: "path",
      },
    ]);
  });

  it("ignores unknown names and items without mutex groups", () => {
    const path = [
      entry("Totally Made Up Item"),
      entry("Ionian Boots of Lucidity"),
      entry("Infinity Edge"),
    ];

    const result = enforceBuildPathLegality(path, items, classic);

    expect(result.buildPath).toEqual(path);
    expect(result.dropped).toEqual([]);
  });

  describe("duplicate names in the path", () => {
    it("drops the second occurrence of a repeated name and keeps the first", () => {
      const path = [
        entry("Infinity Edge", "core"),
        entry("Ionian Boots of Lucidity"),
        entry("Infinity Edge", "damage"),
      ];

      const result = enforceBuildPathLegality(path, items, classic);

      expect(result.buildPath.map((e) => e.name)).toEqual([
        "Infinity Edge",
        "Ionian Boots of Lucidity",
      ]);
      expect(result.dropped).toEqual([
        { kind: "duplicate-name", entry: entry("Infinity Edge", "damage") },
      ]);
    });

    it("drops every repeat when a name appears three times", () => {
      const path = [
        entry("Infinity Edge"),
        entry("Infinity Edge"),
        entry("Infinity Edge"),
      ];

      const result = enforceBuildPathLegality(path, items, classic);

      expect(result.buildPath.map((e) => e.name)).toEqual(["Infinity Edge"]);
      expect(result.dropped.map((d) => d.kind)).toEqual([
        "duplicate-name",
        "duplicate-name",
      ]);
    });

    it("reports a repeated grouped item as a duplicate, not a mutex collision", () => {
      // Same-name repetition is the more precise diagnosis; the mutex report
      // is reserved for two DIFFERENT items sharing a group.
      const path = [
        entry("Lord Dominik's Regards"),
        entry("Lord Dominik's Regards"),
      ];

      const result = enforceBuildPathLegality(path, items, classic);

      expect(result.buildPath.map((e) => e.name)).toEqual([
        "Lord Dominik's Regards",
      ]);
      expect(result.dropped.map((d) => d.kind)).toEqual(["duplicate-name"]);
    });

    it("dedupes names the catalog does not know", () => {
      // Name equality needs no catalog proof: two identical names can never
      // be two legal slots, even in degraded free-string mode.
      const path = [
        entry("Totally Made Up Item"),
        entry("Totally Made Up Item"),
      ];

      const result = enforceBuildPathLegality(path, items, classic);

      expect(result.buildPath.map((e) => e.name)).toEqual([
        "Totally Made Up Item",
      ]);
      expect(result.dropped.map((d) => d.kind)).toEqual(["duplicate-name"]);
    });
  });

  describe("inventory-aware enforcement", () => {
    it("behaves identically to the no-inventory sweep when inventory is empty", () => {
      const path = [entry("Lord Dominik's Regards"), entry("Mortal Reminder")];

      const withDefault = enforceBuildPathLegality(path, items, classic);
      const withEmpty = enforceBuildPathLegality(path, items, classic, []);

      expect(withEmpty).toEqual(withDefault);
      expect(withEmpty.buildPath.map((e) => e.name)).toEqual([
        "Lord Dominik's Regards",
      ]);
    });

    it("keeps the single end-state appearance of an owned item", () => {
      // The buildPath is the END-STATE inventory: the prompt requires owned
      // items to appear once, so ownership must not drop that appearance.
      const path = [entry("Mortal Reminder"), entry("Infinity Edge")];

      const result = enforceBuildPathLegality(path, items, classic, [
        "Mortal Reminder",
      ]);

      expect(result.buildPath).toEqual(path);
      expect(result.dropped).toEqual([]);
    });

    it("drops a second appearance of an owned item as a duplicate", () => {
      const path = [
        entry("Mortal Reminder"),
        entry("Infinity Edge"),
        entry("Mortal Reminder"),
      ];

      const result = enforceBuildPathLegality(path, items, classic, [
        "Mortal Reminder",
      ]);

      expect(result.buildPath.map((e) => e.name)).toEqual([
        "Mortal Reminder",
        "Infinity Edge",
      ]);
      expect(result.dropped.map((d) => d.kind)).toEqual(["duplicate-name"]);
    });

    it("drops a restriction-group sibling of an owned item", () => {
      // Owning Mortal Reminder makes Lord Dominik's Regards unbuyable: the
      // shop blocks the purchase, so recommending it is illegal even though
      // the path itself has no internal collision.
      const path = [entry("Lord Dominik's Regards"), entry("Infinity Edge")];

      const result = enforceBuildPathLegality(path, items, classic, [
        "Mortal Reminder",
      ]);

      expect(result.buildPath.map((e) => e.name)).toEqual(["Infinity Edge"]);
      expect(result.dropped).toEqual([
        {
          kind: "mutex-collision",
          entry: entry("Lord Dominik's Regards"),
          group: "Fatality",
          keptName: "Mortal Reminder",
          keptSource: "inventory",
        },
      ]);
    });

    it("drops a sibling while keeping the owned item's own echo", () => {
      const path = [entry("Mortal Reminder"), entry("Lord Dominik's Regards")];

      const result = enforceBuildPathLegality(path, items, classic, [
        "Mortal Reminder",
      ]);

      expect(result.buildPath.map((e) => e.name)).toEqual(["Mortal Reminder"]);
      expect(result.dropped.map((d) => d.kind)).toEqual(["mutex-collision"]);
    });

    it("counts an owned evolved item as its purchasable base for the echo", () => {
      // Muramana is what the player OWNS; Manamune is what the catalog can
      // recommend. The path echoing Manamune is the owned item's end-state
      // slot, not a re-buy.
      const path = [entry("Manamune"), entry("Infinity Edge")];

      const result = enforceBuildPathLegality(path, items, classic, [
        "Muramana",
      ]);

      expect(result.buildPath).toEqual(path);
      expect(result.dropped).toEqual([]);
    });

    it("drops a second Manamune when the player owns Muramana", () => {
      const path = [
        entry("Manamune"),
        entry("Infinity Edge"),
        entry("Manamune"),
      ];

      const result = enforceBuildPathLegality(path, items, classic, [
        "Muramana",
      ]);

      expect(result.buildPath.map((e) => e.name)).toEqual([
        "Manamune",
        "Infinity Edge",
      ]);
      expect(result.dropped.map((d) => d.kind)).toEqual(["duplicate-name"]);
    });

    it("blocks group siblings of an owned evolved item under the owned name", () => {
      const path = [entry("Archangel's Staff")];

      const result = enforceBuildPathLegality(path, items, classic, [
        "Muramana",
      ]);

      expect(result.buildPath).toEqual([]);
      expect(result.dropped).toEqual([
        {
          kind: "mutex-collision",
          entry: entry("Archangel's Staff"),
          group: "Manaflow",
          keptName: "Muramana",
          keptSource: "inventory",
        },
      ]);
    });

    it("ignores owned names the catalog does not know", () => {
      // Cannot prove anything illegal from an unknown inventory name; the
      // sweep must neither crash nor drop unrelated entries.
      const path = [entry("Lord Dominik's Regards"), entry("Infinity Edge")];

      const result = enforceBuildPathLegality(path, items, classic, [
        "Mystery Trophy",
        "Health Potion",
      ]);

      expect(result.buildPath).toEqual(path);
      expect(result.dropped).toEqual([]);
    });

    it("still enforces path-internal collisions alongside inventory seeds", () => {
      const path = [
        entry("Serylda's Grudge"),
        entry("Mortal Reminder"),
        entry("Essence Reaver"),
        entry("Essence Reaver"),
      ];

      const result = enforceBuildPathLegality(path, items, classic, [
        "Void Staff",
      ]);

      expect(result.buildPath.map((e) => e.name)).toEqual([
        "Serylda's Grudge",
        "Essence Reaver",
      ]);
      expect(result.dropped.map((d) => d.kind)).toEqual([
        "mutex-collision",
        "duplicate-name",
      ]);
    });
  });

  describe("boots uniqueness (#109 rule folded into the sweep)", () => {
    // Boots-ness is tag-based (boots are NOT a wiki itemlimit group): a name
    // is a boots item when ANY same-named catalog variant carries the
    // "Boots" tag, the same any-variant quantifier as mode legality.
    const bootsItems = new Map<number, Item>([
      makeItem(3009, "Boots of Swiftness", { tags: ["Boots"] }),
      makeItem(3111, "Mercury's Treads", { tags: ["Boots"] }),
      makeItem(3006, "Berserker's Greaves", { tags: ["Boots"] }),
      // Standard variant untagged, ARAM variant tagged: the any-variant
      // quantifier must still classify the name as boots in Classic.
      makeItem(3158, "Ionian Boots of Lucidity"),
      makeItem(223158, "Ionian Boots of Lucidity", {
        mode: "aram",
        maps: [12],
        tags: ["Boots"],
      }),
      makeItem(3031, "Infinity Edge"),
      makeItem(6653, "Liandry's Torment"),
      makeItem(3116, "Rylai's Crystal Scepter"),
      makeItem(4401, "Force of Nature"),
      makeItem(6665, "Jak'Sho, The Protean"),
    ]);

    it("keeps a path with exactly one boots item", () => {
      const path = [
        entry("Boots of Swiftness"),
        entry("Infinity Edge"),
        entry("Liandry's Torment"),
      ];

      const result = enforceBuildPathLegality(path, bootsItems, classic);

      expect(result.buildPath).toEqual(path);
      expect(result.dropped).toEqual([]);
    });

    it("drops the second boots item and keeps the first", () => {
      const path = [
        entry("Boots of Swiftness"),
        entry("Infinity Edge"),
        entry("Mercury's Treads", "defensive"),
      ];

      const result = enforceBuildPathLegality(path, bootsItems, classic);

      expect(result.buildPath.map((e) => e.name)).toEqual([
        "Boots of Swiftness",
        "Infinity Edge",
      ]);
      expect(result.dropped).toEqual([
        {
          kind: "boots-collision",
          entry: entry("Mercury's Treads", "defensive"),
          keptName: "Boots of Swiftness",
          keptSource: "path",
        },
      ]);
    });

    it("remediates the exact playtest regression (Swiftness + Mercury's Treads)", () => {
      const path = [
        entry("Liandry's Torment"),
        entry("Boots of Swiftness"),
        entry("Rylai's Crystal Scepter"),
        entry("Mercury's Treads"),
        entry("Force of Nature"),
        entry("Jak'Sho, The Protean"),
      ];

      const result = enforceBuildPathLegality(path, bootsItems, classic);

      expect(result.buildPath.map((e) => e.name)).toEqual([
        "Liandry's Torment",
        "Boots of Swiftness",
        "Rylai's Crystal Scepter",
        "Force of Nature",
        "Jak'Sho, The Protean",
      ]);
      expect(result.dropped).toEqual([
        {
          kind: "boots-collision",
          entry: entry("Mercury's Treads"),
          keptName: "Boots of Swiftness",
          keptSource: "path",
        },
      ]);
    });

    it("drops every later boots item when three are present", () => {
      const path = [
        entry("Boots of Swiftness"),
        entry("Mercury's Treads"),
        entry("Berserker's Greaves"),
      ];

      const result = enforceBuildPathLegality(path, bootsItems, classic);

      expect(result.buildPath.map((e) => e.name)).toEqual([
        "Boots of Swiftness",
      ]);
      expect(result.dropped.map((d) => d.kind)).toEqual([
        "boots-collision",
        "boots-collision",
      ]);
    });

    it("drops a recommended boots item when the player already owns boots", () => {
      const path = [entry("Berserker's Greaves"), entry("Infinity Edge")];

      const result = enforceBuildPathLegality(path, bootsItems, classic, [
        "Boots of Swiftness",
      ]);

      expect(result.buildPath.map((e) => e.name)).toEqual(["Infinity Edge"]);
      expect(result.dropped).toEqual([
        {
          kind: "boots-collision",
          entry: entry("Berserker's Greaves"),
          keptName: "Boots of Swiftness",
          keptSource: "inventory",
        },
      ]);
    });

    it("keeps the owned boots' end-state echo and drops a second pair", () => {
      const path = [
        entry("Mercury's Treads"),
        entry("Boots of Swiftness"),
        entry("Infinity Edge"),
      ];

      const result = enforceBuildPathLegality(path, bootsItems, classic, [
        "Mercury's Treads",
      ]);

      expect(result.buildPath.map((e) => e.name)).toEqual([
        "Mercury's Treads",
        "Infinity Edge",
      ]);
      expect(result.dropped).toEqual([
        {
          kind: "boots-collision",
          entry: entry("Boots of Swiftness"),
          keptName: "Mercury's Treads",
          keptSource: "inventory",
        },
      ]);
    });

    it("ignores unknown names: the catalog cannot prove them boots", () => {
      const path = [entry("Totally Made Up Item"), entry("Boots of Swiftness")];

      const result = enforceBuildPathLegality(path, bootsItems, classic);

      expect(result.buildPath).toEqual(path);
      expect(result.dropped).toEqual([]);
    });

    it("classifies a name as boots when ANY same-named variant carries the tag", () => {
      // The standard Ionian variant is untagged in this map; only the ARAM
      // variant carries "Boots". The name must still occupy the boots slot.
      const path = [
        entry("Ionian Boots of Lucidity"),
        entry("Mercury's Treads"),
      ];

      const result = enforceBuildPathLegality(path, bootsItems, classic);

      expect(result.buildPath.map((e) => e.name)).toEqual([
        "Ionian Boots of Lucidity",
      ]);
      expect(result.dropped).toEqual([
        {
          kind: "boots-collision",
          entry: entry("Mercury's Treads"),
          keptName: "Ionian Boots of Lucidity",
          keptSource: "path",
        },
      ]);
    });
  });

  describe("mode availability", () => {
    // Cross-mode leaks (GAP B/D of #117): standard-ID-band items whose maps
    // record proves them Arena-only or Nexus-Blitz-only. The ineligible
    // Abyssal Mask variant is inserted BEFORE the eligible one so a naive
    // "first variant with the name" lookup would false-drop the name.
    const modedItems = new Map<number, Item>([
      makeItem(228020, "Abyssal Mask", { mode: "arena", maps: [30] }),
      makeItem(8020, "Abyssal Mask", { maps: [11, 12] }),
      makeItem(4015, "Perplexity", { maps: [30] }),
      makeItem(3128, "Deathfire Grasp", { maps: [21] }),
      makeItem(3031, "Infinity Edge"),
    ]);

    it("drops an entry no same-named catalog item can be bought in the mode", () => {
      const path = [
        entry("Infinity Edge"),
        entry("Perplexity", "counter"),
        entry("Deathfire Grasp"),
      ];

      const result = enforceBuildPathLegality(path, modedItems, classic);

      expect(result.buildPath.map((e) => e.name)).toEqual(["Infinity Edge"]);
      expect(result.dropped).toEqual([
        {
          kind: "mode-unavailable",
          entry: entry("Perplexity", "counter"),
          modeName: "CLASSIC",
        },
        {
          kind: "mode-unavailable",
          entry: entry("Deathfire Grasp"),
          modeName: "CLASSIC",
        },
      ]);
    });

    it("keeps a name when ANY same-named variant is eligible in the mode", () => {
      // Duplicate names exist across ID partitions (Abyssal Mask lives in
      // both the standard and aram bands); the wrong variant must not cause
      // a false drop.
      const path = [entry("Abyssal Mask"), entry("Perplexity")];

      const result = enforceBuildPathLegality(path, modedItems, classic);

      expect(result.buildPath.map((e) => e.name)).toEqual(["Abyssal Mask"]);
      expect(result.dropped.map((d) => d.kind)).toEqual(["mode-unavailable"]);
    });

    it("accepts standard and aram-band variants alike in ARAM", () => {
      const aramItems = new Map<number, Item>([
        makeItem(328020, "ARAM Rebalance", { mode: "aram", maps: [12] }),
        makeItem(3031, "Infinity Edge"),
      ]);
      const path = [entry("ARAM Rebalance"), entry("Infinity Edge")];

      const result = enforceBuildPathLegality(path, aramItems, aram);

      expect(result.buildPath).toEqual(path);
      expect(result.dropped).toEqual([]);
    });

    it("never drops the owned-item echo for mode reasons", () => {
      // Whatever the player already holds is a fact of the game, not a
      // recommendation; its single end-state echo must survive the sweep.
      const path = [entry("Perplexity"), entry("Deathfire Grasp")];

      const result = enforceBuildPathLegality(path, modedItems, classic, [
        "Perplexity",
      ]);

      expect(result.buildPath.map((e) => e.name)).toEqual(["Perplexity"]);
      expect(result.dropped).toEqual([
        {
          kind: "mode-unavailable",
          entry: entry("Deathfire Grasp"),
          modeName: "CLASSIC",
        },
      ]);
    });

    it("exempts the echo of an owned evolved item whose base is mode-restricted", () => {
      // Synthetic map to isolate the invariant: the owned EVOLVED form
      // resolves to its purchasable base (slice 3 walk), and that base's
      // echo is exempt from mode drops even when the base itself would not
      // pass the eligibility predicate.
      const localItems = new Map<number, Item>([
        makeItem(3119, "Winter's Approach", { maps: [21] }),
        makeItem(3121, "Fimbulwinter", {
          purchasable: false,
          specialRecipe: 3119,
          maps: [21],
        }),
        makeItem(4015, "Perplexity", { maps: [30] }),
      ]);
      const path = [entry("Winter's Approach"), entry("Perplexity")];

      const result = enforceBuildPathLegality(path, localItems, classic, [
        "Fimbulwinter",
      ]);

      expect(result.buildPath.map((e) => e.name)).toEqual([
        "Winter's Approach",
      ]);
      expect(result.dropped.map((d) => d.kind)).toEqual(["mode-unavailable"]);
    });

    it("keeps unknown names: the catalog cannot prove them mode-illegal", () => {
      const path = [entry("Totally Made Up Item"), entry("Perplexity")];

      const result = enforceBuildPathLegality(path, modedItems, classic);

      expect(result.buildPath.map((e) => e.name)).toEqual([
        "Totally Made Up Item",
      ]);
      expect(result.dropped.map((d) => d.kind)).toEqual(["mode-unavailable"]);
    });
  });
});

describe("describeBuildPathDrop", () => {
  function entry(name: string): BuildPathItem {
    return { name, category: "core", targetEnemy: null, reason: "" };
  }

  it("describes a path-internal mutex collision", () => {
    expect(
      describeBuildPathDrop({
        kind: "mutex-collision",
        entry: entry("Mortal Reminder"),
        group: "Fatality",
        keptName: "Lord Dominik's Regards",
        keptSource: "path",
      })
    ).toBe("Mortal Reminder (group Fatality, kept Lord Dominik's Regards)");
  });

  it("describes a collision with an owned item", () => {
    expect(
      describeBuildPathDrop({
        kind: "mutex-collision",
        entry: entry("Archangel's Staff"),
        group: "Manaflow",
        keptName: "Muramana",
        keptSource: "inventory",
      })
    ).toBe("Archangel's Staff (group Manaflow, player owns Muramana)");
  });

  it("describes a duplicate name", () => {
    expect(
      describeBuildPathDrop({
        kind: "duplicate-name",
        entry: entry("Infinity Edge"),
      })
    ).toBe("Infinity Edge (duplicate of an earlier build-path entry)");
  });

  it("describes a mode-unavailable drop", () => {
    expect(
      describeBuildPathDrop({
        kind: "mode-unavailable",
        entry: entry("Perplexity"),
        modeName: "ARAM",
      })
    ).toBe("Perplexity (not purchasable in ARAM)");
  });

  it("describes a boots collision with an earlier path entry", () => {
    expect(
      describeBuildPathDrop({
        kind: "boots-collision",
        entry: entry("Mercury's Treads"),
        keptName: "Boots of Swiftness",
        keptSource: "path",
      })
    ).toBe("Mercury's Treads (second boots, kept Boots of Swiftness)");
  });

  it("describes a boots collision with an owned pair", () => {
    expect(
      describeBuildPathDrop({
        kind: "boots-collision",
        entry: entry("Berserker's Greaves"),
        keptName: "Plated Steelcaps",
        keptSource: "inventory",
      })
    ).toBe("Berserker's Greaves (second boots, player owns Plated Steelcaps)");
  });
});

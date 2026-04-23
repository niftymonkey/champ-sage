import { describe, it, expect } from "vitest";
import {
  buildGamePlanQuestion,
  extractBuildPath,
  findDuplicateBoots,
  isUpdatePlanCommand,
} from "./index";
import { GAME_PLAN_TASK_PROMPT } from "./prompt";
import type { BuildPathItem, CoachingResponse } from "../../types";
import type { Item } from "../../../data-ingest/types";

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
    // double-checked post-hoc by findDuplicateBoots.
    expect(GAME_PLAN_TASK_PROMPT).toMatch(/\bboots\b/i);
    expect(GAME_PLAN_TASK_PROMPT).toMatch(/at most one/i);
  });
});

describe("findDuplicateBoots", () => {
  function makeItem(id: number, name: string, tags: string[]): Item {
    return {
      id,
      name,
      description: "",
      plaintext: "",
      gold: { base: 0, total: 0, sell: 0, purchasable: true },
      tags,
      stats: {},
      image: `${id}.png`,
      mode: "standard",
    };
  }

  const items = new Map<number, Item>([
    [1001, makeItem(1001, "Boots", ["Boots"])],
    [3006, makeItem(3006, "Berserker's Greaves", ["Boots"])],
    [3047, makeItem(3047, "Plated Steelcaps", ["Boots"])],
    [6655, makeItem(6655, "Luden's Companion", ["SpellDamage"])],
    [3157, makeItem(3157, "Zhonya's Hourglass", ["SpellDamage", "Armor"])],
  ]);

  function item(name: string): BuildPathItem {
    return { name, category: "core", targetEnemy: null, reason: "" };
  }

  it("returns empty when the build path has no boots", () => {
    const path = [item("Luden's Companion"), item("Zhonya's Hourglass")];
    expect(findDuplicateBoots(path, items)).toEqual([]);
  });

  it("returns empty when the build path has exactly one boots item", () => {
    const path = [item("Berserker's Greaves"), item("Luden's Companion")];
    expect(findDuplicateBoots(path, items)).toEqual([]);
  });

  it("returns all boots items when the build path has two distinct pairs", () => {
    const path = [
      item("Luden's Companion"),
      item("Berserker's Greaves"),
      item("Plated Steelcaps"),
      item("Zhonya's Hourglass"),
    ];
    const dupes = findDuplicateBoots(path, items);
    expect(dupes.map((b) => b.name)).toEqual([
      "Berserker's Greaves",
      "Plated Steelcaps",
    ]);
  });

  it("detects the exact playtest regression (Boots of Swiftness + Mercury's Treads)", () => {
    const fullItems = new Map(items);
    fullItems.set(3009, makeItem(3009, "Boots of Swiftness", ["Boots"]));
    fullItems.set(3111, makeItem(3111, "Mercury's Treads", ["Boots"]));
    const path = [
      item("Liandry's Torment"),
      item("Boots of Swiftness"),
      item("Rylai's Crystal Scepter"),
      item("Mercury's Treads"),
      item("Force of Nature"),
      item("Jak'Sho, The Protean"),
    ];
    const dupes = findDuplicateBoots(path, fullItems);
    expect(dupes).toHaveLength(2);
    expect(dupes.map((b) => b.name).sort()).toEqual([
      "Boots of Swiftness",
      "Mercury's Treads",
    ]);
  });

  it("returns empty when an unknown item name appears in the build path", () => {
    // Can't classify unknown names as boots; schema enum already rejects
    // most leakage. Helper should not throw or false-positive.
    const path = [item("Totally Made Up Item"), item("Luden's Companion")];
    expect(findDuplicateBoots(path, items)).toEqual([]);
  });
});

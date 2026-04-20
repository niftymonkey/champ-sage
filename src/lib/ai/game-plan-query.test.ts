import { describe, it, expect } from "vitest";
import {
  buildGamePlanQuestion,
  extractBuildPath,
  isUpdatePlanCommand,
} from "./game-plan-query";
import type { CoachingResponse } from "./types";

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

  it("requires items in the `buildPath` field, not recommendations", () => {
    expect(q).toMatch(/`buildPath` field/);
    expect(q).toMatch(/not in `recommendations`/);
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

  it("requires targetEnemy only for counter category", () => {
    expect(q).toMatch(/targetEnemy: REQUIRED when category is `counter`/);
    expect(q).toMatch(/Omit for every other category/);
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

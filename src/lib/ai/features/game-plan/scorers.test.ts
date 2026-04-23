import { describe, expect, it } from "vitest";
import type { BuildPathItem } from "../../types";
import {
  scoreBuildPathStructure,
  scoreCategoryDiversity,
  scoreCounterTargeting,
  scoreReasonBrevity,
} from "./scorers";

function item(overrides: Partial<BuildPathItem> = {}): BuildPathItem {
  return {
    name: "Item",
    category: "core",
    targetEnemy: null,
    reason: "core",
    ...overrides,
  };
}

function buildOf(...items: Array<Partial<BuildPathItem>>): BuildPathItem[] {
  return items.map((overrides, i) => item({ name: `Item${i}`, ...overrides }));
}

describe("scoreBuildPathStructure", () => {
  it("returns 1.0 for a 6-item build with unique names", () => {
    const build = buildOf({}, {}, {}, {}, {}, {});
    expect(scoreBuildPathStructure(build)).toBe(1);
  });

  it("returns 0 when the build has fewer than 6 items", () => {
    const build = buildOf({}, {}, {}, {}, {});
    expect(scoreBuildPathStructure(build)).toBe(0);
  });

  it("returns 0 when the build has more than 6 items", () => {
    const build = buildOf({}, {}, {}, {}, {}, {}, {});
    expect(scoreBuildPathStructure(build)).toBe(0);
  });

  it("returns 0 when the build contains duplicate item names", () => {
    const build = buildOf(
      { name: "A" },
      { name: "B" },
      { name: "A" },
      { name: "C" },
      { name: "D" },
      { name: "E" }
    );
    expect(scoreBuildPathStructure(build)).toBe(0);
  });

  it("treats item names as case-insensitive when checking duplicates", () => {
    const build = buildOf(
      { name: "Thornmail" },
      { name: "B" },
      { name: "thornmail" },
      { name: "C" },
      { name: "D" },
      { name: "E" }
    );
    expect(scoreBuildPathStructure(build)).toBe(0);
  });
});

describe("scoreCounterTargeting", () => {
  const enemies = ["Yi", "Soraka", "Zed"];

  it("returns 1.0 when every counter has a valid targetEnemy and non-counters have none", () => {
    const build = buildOf(
      { category: "core" },
      { category: "counter", targetEnemy: "Yi" },
      { category: "defensive" },
      { category: "counter", targetEnemy: "Zed" },
      { category: "damage" },
      { category: "utility" }
    );
    expect(scoreCounterTargeting(build, enemies)).toBe(1);
  });

  it("penalizes a counter item with null targetEnemy", () => {
    const build = buildOf(
      { category: "core" },
      { category: "counter", targetEnemy: null },
      { category: "core" },
      { category: "core" },
      { category: "core" },
      { category: "core" }
    );
    // 5 of 6 satisfy the rule
    expect(scoreCounterTargeting(build, enemies)).toBeCloseTo(5 / 6);
  });

  it("penalizes a counter item targeting a non-roster enemy", () => {
    const build = buildOf(
      { category: "counter", targetEnemy: "Garen" },
      { category: "core" },
      { category: "core" },
      { category: "core" },
      { category: "core" },
      { category: "core" }
    );
    expect(scoreCounterTargeting(build, enemies)).toBeCloseTo(5 / 6);
  });

  it("matches enemy names case-insensitively", () => {
    const build = buildOf(
      { category: "counter", targetEnemy: "yi" },
      { category: "core" },
      { category: "core" },
      { category: "core" },
      { category: "core" },
      { category: "core" }
    );
    expect(scoreCounterTargeting(build, enemies)).toBe(1);
  });

  it("penalizes a non-counter item with a non-null targetEnemy", () => {
    const build = buildOf(
      { category: "defensive", targetEnemy: "Yi" },
      { category: "core" },
      { category: "core" },
      { category: "core" },
      { category: "core" },
      { category: "core" }
    );
    expect(scoreCounterTargeting(build, enemies)).toBeCloseTo(5 / 6);
  });
});

describe("scoreCategoryDiversity", () => {
  it("returns 1.0 for a well-diversified build", () => {
    const build = buildOf(
      { category: "core" },
      { category: "counter", targetEnemy: "Yi" },
      { category: "defensive" },
      { category: "damage" },
      { category: "utility" },
      { category: "core" }
    );
    expect(scoreCategoryDiversity(build)).toBe(1);
  });

  it("penalizes a build that is all one category", () => {
    const build = buildOf(
      { category: "core" },
      { category: "core" },
      { category: "core" },
      { category: "core" },
      { category: "core" },
      { category: "core" }
    );
    expect(scoreCategoryDiversity(build)).toBeLessThan(1);
  });

  it("penalizes builds with three or more 'situational' items", () => {
    const build = buildOf(
      { category: "situational" },
      { category: "situational" },
      { category: "situational" },
      { category: "core" },
      { category: "damage" },
      { category: "defensive" }
    );
    expect(scoreCategoryDiversity(build)).toBeLessThan(1);
  });

  it("does not penalize one or two situational items", () => {
    const build = buildOf(
      { category: "situational" },
      { category: "situational" },
      { category: "core" },
      { category: "damage" },
      { category: "defensive" },
      { category: "utility" }
    );
    expect(scoreCategoryDiversity(build)).toBe(1);
  });
});

describe("scoreReasonBrevity", () => {
  it("returns 1.0 when every reason fits the 8-word ceiling", () => {
    const build = buildOf(
      { reason: "core item" },
      { reason: "counters Yi healing" },
      { reason: "armor for bruisers" },
      { reason: "more damage" },
      { reason: "utility for team" },
      { reason: "magic resist" }
    );
    expect(scoreReasonBrevity(build)).toBe(1);
  });

  it("penalizes items whose reason exceeds the 8-word ceiling", () => {
    const build = buildOf(
      {
        reason:
          "this item is fundamental to my champion kit and synergizes well with the rest of my build",
      },
      { reason: "core" },
      { reason: "core" },
      { reason: "core" },
      { reason: "core" },
      { reason: "core" }
    );
    expect(scoreReasonBrevity(build)).toBeCloseTo(5 / 6);
  });

  it("counts whitespace-separated tokens including punctuation", () => {
    // "one two three four five six seven eight" = 8 words → passes
    const build = buildOf(
      { reason: "one two three four five six seven eight" },
      { reason: "ok" },
      { reason: "ok" },
      { reason: "ok" },
      { reason: "ok" },
      { reason: "ok" }
    );
    expect(scoreReasonBrevity(build)).toBe(1);
  });

  it("penalizes a 9-word reason", () => {
    const build = buildOf(
      { reason: "one two three four five six seven eight nine" },
      { reason: "ok" },
      { reason: "ok" },
      { reason: "ok" },
      { reason: "ok" },
      { reason: "ok" }
    );
    expect(scoreReasonBrevity(build)).toBeCloseTo(5 / 6);
  });
});

import { describe, it, expect } from "vitest";
import { buildFeatureRules } from "./feature-rules";
import type { GameMode, ModeContext } from "../mode/types";

function createStubMode(overrides: Partial<GameMode> = {}): GameMode {
  return {
    id: "test-mode",
    displayName: "Test Mode",
    decisionTypes: ["item-purchase", "open-ended-coaching"],
    augmentSelectionLevels: [],
    matches: () => false,
    buildContext: () => ({}) as ModeContext,
    ...overrides,
  };
}

describe("buildFeatureRules", () => {
  it("includes the item-rec family (item recommendations, proactive awareness, item pool usage)", () => {
    const rules = buildFeatureRules(createStubMode());
    expect(rules).toContain("ITEM RECOMMENDATIONS:");
    expect(rules).toContain(
      "Build toward Rabadon's Deathcap. You can get a Needlessly Large Rod now"
    );
    expect(rules).toContain("PROACTIVE AWARENESS");
    expect(rules).toContain("grievous wounds");
    expect(rules).toContain("ITEM POOL USAGE");
  });

  it("includes augment fit rating and synergy coaching when the mode supports augment-selection", () => {
    const mode = createStubMode({
      decisionTypes: [
        "augment-selection",
        "item-purchase",
        "open-ended-coaching",
      ],
    });
    const rules = buildFeatureRules(mode);
    expect(rules).toContain("AUGMENT FIT RATING");
    expect(rules).toContain("SYNERGY COACHING");
    expect(rules).toContain("exceptional");
    expect(rules).toContain("unconventional");
  });

  it("excludes augment blocks when the mode lacks augment-selection", () => {
    const rules = buildFeatureRules(createStubMode());
    expect(rules).not.toContain("AUGMENT FIT RATING");
    expect(rules).not.toContain("SYNERGY COACHING");
  });

  it("returns a non-empty string (item-rec family is always present)", () => {
    expect(buildFeatureRules(createStubMode())).not.toBe("");
  });
});

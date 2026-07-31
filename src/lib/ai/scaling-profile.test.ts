import { describe, it, expect } from "vitest";
import { deriveScalingProfile } from "./scaling-profile";
import type { AbilityScalingStat, AbilitySpell } from "../data-ingest/types";

function spell(scaling?: AbilityScalingStat[]): AbilitySpell {
  return {
    id: "X",
    name: "Ability",
    description: "does a thing",
    maxRank: 5,
    cooldowns: [7],
    costs: [50],
    range: [900],
    ...(scaling ? { scaling } : {}),
  };
}

describe("deriveScalingProfile", () => {
  it("summarizes per-ability ratios grouped by stat, with markers and negatives", () => {
    const spells = [
      spell([{ label: "Magic Damage", value: "80 to 300 (+ 90% AP)" }]),
      spell([
        { label: "Damage Per Tick", value: "12 to 20 (+ 10% AP)" },
        { label: "Total Magic Damage", value: "48 to 80 (+ 200% AP)" },
      ]),
      spell([{ label: "Shield Strength", value: "60 to 180 (+ 70% AP)" }]),
      spell([
        { label: "Magic Damage Per Wave", value: "75 (+ 40% AP)" },
        { label: "Maximum Damage", value: "300 (+ 160% AP)" },
      ]),
    ];

    expect(deriveScalingProfile(spells)).toBe(
      "Scaling profile: AP - Q 90%, W up to 200%, E 70% (shield), R up to 160%. No AD ratios."
    );
  });

  it("reports a missing AP ratio for an AD kit", () => {
    const spells = [
      spell([{ label: "Physical Damage", value: "20 to 120 (+ 105% AD)" }]),
    ];
    expect(deriveScalingProfile(spells)).toBe(
      "Scaling profile: AD - Q 105%. No AP ratios."
    );
  });

  it("treats a bonus AD ratio as AD coverage", () => {
    const spells = [
      spell([{ label: "Physical Damage", value: "50 (+ 100% bonus AD)" }]),
    ];
    expect(deriveScalingProfile(spells)).toBe(
      "Scaling profile: bonus AD - Q 100%. No AP ratios."
    );
  });

  it("omits both negatives when the kit scales with both stats", () => {
    const spells = [
      spell([{ label: "Magic Damage", value: "80 (+ 60% AP)" }]),
      spell([{ label: "Physical Damage", value: "40 (+ 80% bonus AD)" }]),
    ];
    expect(deriveScalingProfile(spells)).toBe(
      "Scaling profile: AP - Q 60%. bonus AD - W 80%."
    );
  });

  it("marks healing ratios as such", () => {
    const spells = [
      spell([{ label: "Heal Amount", value: "40 to 120 (+ 35% AP)" }]),
    ];
    expect(deriveScalingProfile(spells)).toBe(
      "Scaling profile: AP - Q 35% (heal). No AD ratios."
    );
  });

  it("keeps decimal ratios as written", () => {
    const spells = [
      spell([{ label: "Physical Damage", value: "10 (+ 52.5% AD)" }]),
    ];
    expect(deriveScalingProfile(spells)).toBe(
      "Scaling profile: AD - Q 52.5%. No AP ratios."
    );
  });

  it("skips values that do not match the strict ratio token form", () => {
    const spells = [
      spell([
        { label: "Root Duration", value: "2 to 3 seconds" },
        { label: "Magic Damage", value: "80 (+ 4% per 100 AP)" },
        { label: "True Damage", value: "10 (+ 30% AP)" },
      ]),
    ];
    expect(deriveScalingProfile(spells)).toBe(
      "Scaling profile: AP - Q 30%. No AD ratios."
    );
  });

  it("returns null when no ratio parses anywhere", () => {
    const spells = [
      spell([{ label: "Root Duration", value: "2 to 3 seconds" }]),
      spell(),
    ];
    expect(deriveScalingProfile(spells)).toBeNull();
  });

  it("returns null for a kit with no scaling data at all", () => {
    expect(deriveScalingProfile([spell(), spell()])).toBeNull();
  });
});

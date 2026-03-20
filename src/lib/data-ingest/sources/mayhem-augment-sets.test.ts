import { describe, it, expect } from "vitest";
import { getMayhemAugmentSets } from "./mayhem-augment-sets";

describe("getMayhemAugmentSets", () => {
  const sets = getMayhemAugmentSets();

  it("returns all 9 Mayhem augment sets", () => {
    expect(sets).toHaveLength(9);
  });

  it("each set has a name and at least one bonus", () => {
    for (const set of sets) {
      expect(set.name).toBeTruthy();
      expect(set.bonuses.length).toBeGreaterThanOrEqual(1);
    }
  });

  it("each bonus has a threshold and description", () => {
    for (const set of sets) {
      for (const bonus of set.bonuses) {
        expect(bonus.threshold).toBeGreaterThanOrEqual(2);
        expect(bonus.threshold).toBeLessThanOrEqual(4);
        expect(bonus.description).toBeTruthy();
      }
    }
  });

  it("bonuses are ordered by ascending threshold within each set", () => {
    for (const set of sets) {
      for (let i = 1; i < set.bonuses.length; i++) {
        expect(set.bonuses[i].threshold).toBeGreaterThan(
          set.bonuses[i - 1].threshold
        );
      }
    }
  });

  it("includes known sets by name", () => {
    const names = sets.map((s) => s.name);
    expect(names).toContain("Archmage");
    expect(names).toContain("Dive Bomb");
    expect(names).toContain("Firecracker");
    expect(names).toContain("Fully Automated");
    expect(names).toContain("High Roller");
    expect(names).toContain("Make it Rain");
    expect(names).toContain("Snowday");
    expect(names).toContain("Stackosaurus Rex");
    expect(names).toContain("Wee Woo Wee Woo");
  });

  it("returns a new array on each call (no shared mutable state)", () => {
    const a = getMayhemAugmentSets();
    const b = getMayhemAugmentSets();
    expect(a).not.toBe(b);
    expect(a).toEqual(b);
  });
});

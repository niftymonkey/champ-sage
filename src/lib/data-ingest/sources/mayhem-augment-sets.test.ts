import { describe, it, expect } from "vitest";
import { getMayhemAugmentSets } from "./mayhem-augment-sets";

/**
 * ARAM Mayhem removed augment Traits (the set-bonus mechanic) in the patch
 * 26.12 rework, replacing grouped sets with champion-first Ability Augments.
 * getMayhemAugmentSets() must therefore expose no sets: handing the coaching
 * LLM the old nine would assert synergies the live game no longer has.
 * Source: https://www.leagueoflegends.com/en-us/news/dev/dev-augmentmaxxing-aram-mayhem/
 */
describe("getMayhemAugmentSets", () => {
  it("returns no sets (Traits removed in the 26.12 Mayhem rework)", () => {
    expect(getMayhemAugmentSets()).toEqual([]);
  });

  it("returns a fresh array each call (no shared mutable state)", () => {
    const a = getMayhemAugmentSets();
    const b = getMayhemAugmentSets();
    expect(a).not.toBe(b);
    expect(a).toEqual(b);
  });
});

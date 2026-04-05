import { describe, it, expect } from "vitest";
import { deriveItemCategories } from "./item-categories";

function item(
  stats: Record<string, number> = {},
  tags: string[] = []
): { stats: Record<string, number>; tags: string[] } {
  return { stats, tags };
}

describe("deriveItemCategories", () => {
  it("returns empty for no items", () => {
    expect(deriveItemCategories([])).toEqual([]);
  });

  it("returns empty for items with no recognized stats or tags", () => {
    expect(deriveItemCategories([item({ SomeUnknownStat: 10 })])).toEqual([]);
  });

  it("derives AP from FlatMagicDamageMod", () => {
    const result = deriveItemCategories([item({ FlatMagicDamageMod: 80 })]);
    expect(result).toContain("AP");
  });

  it("derives AD from FlatPhysicalDamageMod", () => {
    const result = deriveItemCategories([item({ FlatPhysicalDamageMod: 40 })]);
    expect(result).toContain("AD");
  });

  it("derives Health from FlatHPPoolMod", () => {
    const result = deriveItemCategories([item({ FlatHPPoolMod: 300 })]);
    expect(result).toContain("Health");
  });

  it("derives Armor from FlatArmorMod", () => {
    const result = deriveItemCategories([item({ FlatArmorMod: 50 })]);
    expect(result).toContain("Armor");
  });

  it("derives MR from FlatSpellBlockMod", () => {
    const result = deriveItemCategories([item({ FlatSpellBlockMod: 40 })]);
    expect(result).toContain("MR");
  });

  it("derives M.Pen from spellpen tag", () => {
    const result = deriveItemCategories([item({}, ["SpellPen"])]);
    expect(result).toContain("M.Pen");
  });

  it("derives Haste from cooldownreduction tag", () => {
    const result = deriveItemCategories([item({}, ["CooldownReduction"])]);
    expect(result).toContain("Haste");
  });

  it("derives Antiheal from grievouswounds tag", () => {
    const result = deriveItemCategories([item({}, ["GrievousWounds"])]);
    expect(result).toContain("Antiheal");
  });

  it("deduplicates categories across multiple items", () => {
    const result = deriveItemCategories([
      item({ FlatMagicDamageMod: 80 }),
      item({ FlatMagicDamageMod: 60 }),
      item({ FlatMagicDamageMod: 120 }),
    ]);
    expect(result.filter((c) => c === "AP")).toHaveLength(1);
  });

  it("returns categories in display order", () => {
    const result = deriveItemCategories([
      item({ FlatHPPoolMod: 300 }),
      item({ FlatMagicDamageMod: 80 }, ["SpellPen"]),
      item({ FlatArmorMod: 50 }),
    ]);
    expect(result).toEqual(["AP", "Health", "Armor", "M.Pen"]);
  });

  it("ignores stats with zero values", () => {
    const result = deriveItemCategories([
      item({ FlatMagicDamageMod: 0, FlatPhysicalDamageMod: 40 }),
    ]);
    expect(result).not.toContain("AP");
    expect(result).toContain("AD");
  });

  it("handles a full tank build", () => {
    const result = deriveItemCategories([
      item({ FlatHPPoolMod: 800 }),
      item({ FlatArmorMod: 60, FlatHPPoolMod: 200 }),
      item({ FlatSpellBlockMod: 55, FlatHPPoolMod: 350 }),
      item({ FlatArmorMod: 80, FlatHPPoolMod: 300 }, ["GrievousWounds"]),
      item({
        FlatSpellBlockMod: 70,
        FlatHPPoolMod: 350,
        PercentMovementSpeedMod: 0.07,
      }),
      item({ FlatArmorMod: 20 }),
    ]);
    expect(result).toEqual(["Health", "Armor", "MR", "MS", "Antiheal"]);
  });
});

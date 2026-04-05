import { describe, it, expect } from "vitest";
import { computeEnemyStats } from "./enemy-stats";
import type { ChampionStats } from "../data-ingest/types";
import type { Item } from "../data-ingest/types";

/** Ahri's base stats from Data Dragon (patch 14.x reference) */
function createAhriStats(): ChampionStats {
  return {
    hp: 590,
    hpperlevel: 96,
    mp: 418,
    mpperlevel: 25,
    movespeed: 330,
    armor: 21,
    armorperlevel: 4.7,
    spellblock: 30,
    spellblockperlevel: 1.3,
    attackrange: 550,
    hpregen: 2.5,
    hpregenperlevel: 0.6,
    mpregen: 8,
    mpregenperlevel: 0.8,
    attackdamage: 53,
    attackdamageperlevel: 3,
    attackspeed: 0.668,
    attackspeedperlevel: 2,
  };
}

function createItem(stats: Record<string, number> = {}): Item {
  return {
    id: 1000,
    name: "Test Item",
    description: "",
    plaintext: "",
    gold: { base: 0, total: 0, sell: 0, purchasable: true },
    tags: [],
    stats,
    image: "",
    mode: "standard",
  };
}

describe("computeEnemyStats", () => {
  it("returns base stats at level 1 with no items", () => {
    const stats = computeEnemyStats(createAhriStats(), 1, []);

    // At level 1, scale factor = 0, so stats = base values
    expect(stats.attackDamage).toBe(53);
    expect(stats.armor).toBe(21);
    expect(stats.magicResist).toBe(30);
    expect(stats.maxHealth).toBe(590);
    expect(stats.moveSpeed).toBe(330);
    expect(stats.abilityPower).toBe(0); // No base AP on any champion
    expect(stats.attackSpeed).toBe(0.668);
  });

  it("applies per-level scaling correctly at level 18", () => {
    const stats = computeEnemyStats(createAhriStats(), 18, []);

    // Scale factor at level 18: 17 * (0.7025 + 0.0175 * 17) = 17 * 0.9998 ≈ 16.9966
    const scale = 17 * (0.7025 + 0.0175 * 17);

    expect(stats.attackDamage).toBe(Math.round(53 + 3 * scale));
    expect(stats.armor).toBe(Math.round(21 + 4.7 * scale));
    expect(stats.magicResist).toBe(Math.round(30 + 1.3 * scale));
    expect(stats.maxHealth).toBe(Math.round(590 + 96 * scale));
  });

  it("adds flat item stat bonuses", () => {
    const items = [
      createItem({ FlatArmorMod: 50 }),
      createItem({ FlatPhysicalDamageMod: 40 }),
    ];
    const stats = computeEnemyStats(createAhriStats(), 1, items);

    expect(stats.armor).toBe(21 + 50);
    expect(stats.attackDamage).toBe(53 + 40);
  });

  it("stacks multiple flat bonuses additively", () => {
    const items = [
      createItem({ FlatArmorMod: 30 }),
      createItem({ FlatArmorMod: 20 }),
      createItem({ FlatSpellBlockMod: 40 }),
    ];
    const stats = computeEnemyStats(createAhriStats(), 1, items);

    expect(stats.armor).toBe(21 + 30 + 20);
    expect(stats.magicResist).toBe(30 + 40);
  });

  it("applies percent attack speed multiplicatively on base", () => {
    // PercentAttackSpeedMod of 0.35 = 35% bonus AS
    const items = [createItem({ PercentAttackSpeedMod: 0.35 })];
    const stats = computeEnemyStats(createAhriStats(), 1, items);

    // At level 1: base AS * (1 + 0 per-level + 0.35 item)
    const expected = 0.668 * (1 + 0.35);
    expect(stats.attackSpeed).toBeCloseTo(expected, 2);
  });

  it("combines per-level and item attack speed bonuses", () => {
    const items = [createItem({ PercentAttackSpeedMod: 0.25 })];
    const stats = computeEnemyStats(createAhriStats(), 10, items);

    // Scale factor at level 10
    const scale = 9 * (0.7025 + 0.0175 * 9);
    const perLevelPercent = 2 * scale; // attackspeedperlevel = 2
    const expected = 0.668 * (1 + perLevelPercent / 100 + 0.25);
    expect(stats.attackSpeed).toBeCloseTo(expected, 2);
  });

  it("applies flat and percent move speed correctly", () => {
    const items = [
      createItem({ FlatMovementSpeedMod: 45 }),
      createItem({ PercentMovementSpeedMod: 0.07 }),
    ];
    const stats = computeEnemyStats(createAhriStats(), 1, items);

    // (base + flat) * (1 + percent)
    const expected = (330 + 45) * (1 + 0.07);
    expect(stats.moveSpeed).toBe(Math.round(expected));
  });

  it("computes ability power from items only", () => {
    const items = [
      createItem({ FlatMagicDamageMod: 120 }),
      createItem({ FlatMagicDamageMod: 80 }),
    ];
    const stats = computeEnemyStats(createAhriStats(), 1, items);

    expect(stats.abilityPower).toBe(200);
  });

  it("handles empty items array", () => {
    const stats = computeEnemyStats(createAhriStats(), 5, []);
    expect(stats.attackDamage).toBeGreaterThan(53); // Scaled up from base
    expect(stats.abilityPower).toBe(0);
  });

  it("handles items with no recognized stat keys", () => {
    const items = [createItem({ UnknownStat: 999 })];
    const stats = computeEnemyStats(createAhriStats(), 1, items);

    // Should be same as no items
    expect(stats.attackDamage).toBe(53);
    expect(stats.armor).toBe(21);
  });

  it("handles items with mixed recognized and unrecognized stats", () => {
    const items = [createItem({ FlatArmorMod: 50, SomeWeirdStat: 123 })];
    const stats = computeEnemyStats(createAhriStats(), 1, items);

    expect(stats.armor).toBe(71); // 21 + 50
  });
});

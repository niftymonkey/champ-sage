/**
 * Compute approximate enemy champion stats from base stats, per-level
 * growth, and item bonuses.
 *
 * Uses Riot's official per-level scaling formula:
 *   stat = base + (growth × (level-1) × (0.7025 + 0.0175 × (level-1)))
 *
 * Item flat bonuses are summed directly. Percent bonuses (attack speed,
 * move speed) are applied multiplicatively on the base.
 *
 * Limitations: does not capture temporary buffs (Baron, elixirs, ability
 * steroids, stacking passives like Cho'Gath R).
 */

import type { ChampionStats } from "../data-ingest/types";
import type { Item } from "../data-ingest/types";

export interface ComputedStats {
  attackDamage: number;
  abilityPower: number;
  armor: number;
  magicResist: number;
  maxHealth: number;
  moveSpeed: number;
  attackSpeed: number;
}

/**
 * Mapping from DDragon item stat keys to ComputedStats fields.
 * "flat" bonuses are added directly; "percent" bonuses are stored
 * as decimals in DDragon (e.g., 0.35 = 35%) and applied multiplicatively.
 */
const ITEM_STAT_MAP: Record<
  string,
  { field: keyof ComputedStats; mode: "flat" | "percent" }
> = {
  FlatPhysicalDamageMod: { field: "attackDamage", mode: "flat" },
  FlatMagicDamageMod: { field: "abilityPower", mode: "flat" },
  FlatArmorMod: { field: "armor", mode: "flat" },
  FlatSpellBlockMod: { field: "magicResist", mode: "flat" },
  FlatHPPoolMod: { field: "maxHealth", mode: "flat" },
  FlatMovementSpeedMod: { field: "moveSpeed", mode: "flat" },
  PercentAttackSpeedMod: { field: "attackSpeed", mode: "percent" },
  PercentMovementSpeedMod: { field: "moveSpeed", mode: "percent" },
};

/** Riot's per-level scaling factor */
function levelScaleFactor(level: number): number {
  return (level - 1) * (0.7025 + 0.0175 * (level - 1));
}

export function computeEnemyStats(
  champion: ChampionStats,
  level: number,
  items: Item[]
): ComputedStats {
  const scale = levelScaleFactor(level);

  // Base + per-level growth
  const baseAD = champion.attackdamage + champion.attackdamageperlevel * scale;
  const baseArmor = champion.armor + champion.armorperlevel * scale;
  const baseMR = champion.spellblock + champion.spellblockperlevel * scale;
  const baseHP = champion.hp + champion.hpperlevel * scale;
  const baseMS = champion.movespeed;
  // Attack speed scales differently: base × (1 + bonus%)
  // The per-level bonus is a percent stored as a whole number (e.g., 3.5 = 3.5%)
  const baseAS = champion.attackspeed;
  const asPerLevelPercent = champion.attackspeedperlevel * scale;

  // Accumulate flat and percent bonuses from items
  const flatBonuses: Record<keyof ComputedStats, number> = {
    attackDamage: 0,
    abilityPower: 0,
    armor: 0,
    magicResist: 0,
    maxHealth: 0,
    moveSpeed: 0,
    attackSpeed: 0,
  };

  const percentBonuses: Record<keyof ComputedStats, number> = {
    attackDamage: 0,
    abilityPower: 0,
    armor: 0,
    magicResist: 0,
    maxHealth: 0,
    moveSpeed: 0,
    attackSpeed: 0,
  };

  for (const item of items) {
    for (const [key, value] of Object.entries(item.stats)) {
      const mapping = ITEM_STAT_MAP[key];
      if (!mapping) continue;
      if (mapping.mode === "flat") {
        flatBonuses[mapping.field] += value;
      } else {
        percentBonuses[mapping.field] += value;
      }
    }
  }

  // Combine: base + flat bonuses, then apply percent bonuses where relevant
  const totalAS =
    baseAS * (1 + asPerLevelPercent / 100 + percentBonuses.attackSpeed);
  const totalMS =
    (baseMS + flatBonuses.moveSpeed) * (1 + percentBonuses.moveSpeed);

  return {
    attackDamage: Math.round(baseAD + flatBonuses.attackDamage),
    abilityPower: Math.round(flatBonuses.abilityPower),
    armor: Math.round(baseArmor + flatBonuses.armor),
    magicResist: Math.round(baseMR + flatBonuses.magicResist),
    maxHealth: Math.round(baseHP + flatBonuses.maxHealth),
    moveSpeed: Math.round(totalMS),
    attackSpeed: Math.round(totalAS * 1000) / 1000,
  };
}

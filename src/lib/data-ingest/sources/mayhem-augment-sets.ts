import type { AugmentSet } from "../types";

/**
 * Returns Mayhem augment set definitions with bonus thresholds.
 *
 * Source: https://wiki.leagueoflegends.com/en-us/ARAM:_Mayhem/Augment_Sets
 * There is no Lua data module for set bonuses — this data is only available
 * on the wiki article page. Hardcoded here because:
 * - There are only 9 sets
 * - Set bonuses rarely change (balance patches adjust augment stats, not set mechanics)
 * - Scraping rendered HTML would be fragile
 *
 * Returns a fresh array each call to prevent shared mutable state.
 */
export function getMayhemAugmentSets(): AugmentSet[] {
  return [
    {
      name: "Archmage",
      bonuses: [
        {
          threshold: 2,
          description:
            "Casting an ability refunds 30% of the cooldown of another ability",
        },
      ],
    },
    {
      name: "Dive Bomb",
      bonuses: [{ threshold: 2, description: "25% shorter death timer" }],
    },
    {
      name: "Firecracker",
      bonuses: [
        {
          threshold: 2,
          description:
            "Firecrackers bounce to 2 nearby enemies at 25% effectiveness",
        },
        {
          threshold: 4,
          description:
            "Firecrackers bounce to 3 nearby enemies at 50% effectiveness",
        },
      ],
    },
    {
      name: "Fully Automated",
      bonuses: [
        {
          threshold: 2,
          description: "30% cooldown reduction on automatic augments",
        },
        {
          threshold: 3,
          description:
            "Cooldown of automatic augments now scales with ability haste",
        },
      ],
    },
    {
      name: "High Roller",
      bonuses: [
        {
          threshold: 2,
          description: "Minions have a 9% chance to drop stat anvils",
        },
        { threshold: 3, description: "1.2x drop chance (10.8%)" },
        { threshold: 4, description: "1.5x drop chance (13.5%)" },
      ],
    },
    {
      name: "Make it Rain",
      bonuses: [
        {
          threshold: 2,
          description: "Takedowns drop 6 gold coins (30 gold total)",
        },
        {
          threshold: 3,
          description: "Takedowns drop 12 gold coins (60 gold total)",
        },
      ],
    },
    {
      name: "Snowday",
      bonuses: [
        {
          threshold: 2,
          description:
            "Mark deals 30% increased damage, 50 summoner spell haste",
        },
        {
          threshold: 3,
          description:
            "Mark deals 50% increased damage, 100 summoner spell haste",
        },
        {
          threshold: 4,
          description:
            "Mark deals 100% increased damage, 150 summoner spell haste",
        },
      ],
    },
    {
      name: "Stackosaurus Rex",
      bonuses: [
        {
          threshold: 2,
          description: "Gain 50% more permanent stacks from abilities",
        },
        {
          threshold: 3,
          description: "Gain 100% more permanent stacks from abilities",
        },
        {
          threshold: 4,
          description: "Gain 200% more permanent stacks from abilities",
        },
      ],
    },
    {
      name: "Wee Woo Wee Woo",
      bonuses: [
        {
          threshold: 2,
          description:
            "50% bonus movement speed towards allies below 50% health",
        },
        {
          threshold: 3,
          description:
            "Healing or shielding an ally grants them 12% missing health recovery",
        },
      ],
    },
  ];
}

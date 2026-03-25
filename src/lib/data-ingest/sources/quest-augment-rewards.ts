import type { Augment, Item } from "../types";

/**
 * Enrich quest augment descriptions with their reward item stats,
 * looked up dynamically from the items database.
 *
 * Quest augments say "you receive [Item]" but the description doesn't include
 * what the item actually gives. The model needs these stats to reason about
 * whether a quest augment is worth picking and how it affects build priorities.
 *
 * How it works:
 * 1. Identify quest augments (name starts with "Quest:")
 * 2. Find the "Reward:" section of the description
 * 3. Search for known item names after "Reward:"
 * 4. Look up matched items' stats from the items database
 * 5. Append a human-readable stat block to the description
 *
 * This is fully dynamic — if item stats change between patches, the enrichment
 * picks up the new values from DDragon automatically.
 */
export function enrichQuestAugments(
  augments: Map<string, Augment>,
  items: Map<number, Item>
): void {
  // Build a name → Item lookup for fast matching.
  // Multiple items can share the same name (e.g., The Golden Spatula has 4 variants
  // across game modes). Prefer the variant with the highest total stats, since
  // Mayhem quest rewards are typically the most powerful versions.
  const itemsByName = new Map<string, Item>();
  for (const item of items.values()) {
    const key = item.name.toLowerCase();
    const existing = itemsByName.get(key);
    if (!existing || totalStatValue(item) > totalStatValue(existing)) {
      itemsByName.set(key, item);
    }
  }

  for (const augment of augments.values()) {
    if (!augment.name.startsWith("Quest:")) continue;
    if (augment.description.includes(" stats: ")) continue;

    const rewardIndex = augment.description.toLowerCase().indexOf("reward:");
    if (rewardIndex === -1) continue;

    // Only search for item names in the text after "Reward:"
    const rewardText = augment.description.slice(rewardIndex);
    const rewardItem = findRewardItem(rewardText, itemsByName);
    if (!rewardItem) continue;

    const statBlock = formatItemStats(rewardItem);
    if (statBlock) {
      augment.description += ` [${rewardItem.name} stats: ${statBlock}]`;
    }
  }
}

/**
 * Find the reward item mentioned in the reward text by matching against
 * known item names. Uses longest-match-first to prefer specific names
 * (e.g., "The Golden Spatula" over "Golden").
 */
function findRewardItem(
  rewardText: string,
  itemsByName: Map<string, Item>
): Item | null {
  const lowerText = rewardText.toLowerCase();

  // Sort by name length descending to prefer longest matches
  const sortedNames = [...itemsByName.keys()].sort(
    (a, b) => b.length - a.length
  );

  for (const name of sortedNames) {
    if (name.length < 4) continue; // Skip very short names to avoid false matches
    if (lowerText.includes(name)) {
      return itemsByName.get(name)!;
    }
  }

  return null;
}

/** Map of DDragon stat keys to human-readable names and formatting rules */
const STAT_NAMES: Record<
  string,
  { label: string; format: "flat" | "percent" }
> = {
  FlatPhysicalDamageMod: { label: "Attack Damage", format: "flat" },
  FlatMagicDamageMod: { label: "Ability Power", format: "flat" },
  PercentAttackSpeedMod: { label: "Attack Speed", format: "percent" },
  FlatCritChanceMod: { label: "Critical Strike Chance", format: "percent" },
  FlatHPPoolMod: { label: "Health", format: "flat" },
  FlatArmorMod: { label: "Armor", format: "flat" },
  FlatSpellBlockMod: { label: "Magic Resist", format: "flat" },
  FlatMPPoolMod: { label: "Mana", format: "flat" },
  PercentMovementSpeedMod: { label: "Move Speed", format: "percent" },
  PercentLifeStealMod: { label: "Omnivamp", format: "percent" },
  FlatMovementSpeedMod: { label: "Move Speed", format: "flat" },
};

/** Format an item's stats as a human-readable comma-separated string */
function formatItemStats(item: Item): string | null {
  const parts: string[] = [];

  for (const [key, value] of Object.entries(item.stats)) {
    if (value === 0) continue;

    const meta = STAT_NAMES[key];
    if (!meta) continue;

    if (meta.format === "percent") {
      parts.push(`${Math.round(value * 100)}% ${meta.label}`);
    } else {
      parts.push(`${value} ${meta.label}`);
    }
  }

  return parts.length > 0 ? parts.join(", ") : null;
}

/**
 * Sum all stat values for an item, used to pick the strongest variant
 * when multiple items share the same name across game modes.
 * Percent stats (0.0–1.0) are scaled by 100 so they contribute meaningfully.
 */
function totalStatValue(item: Item): number {
  return Object.values(item.stats).reduce((sum, v) => {
    // Percent stats are stored as decimals (e.g., 0.6 for 60%)
    return sum + (v < 1 && v > 0 ? v * 100 : v);
  }, 0);
}

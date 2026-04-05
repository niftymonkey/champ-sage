/**
 * Derives item stat categories from a set of items' stats.
 *
 * Given a list of item stat records, returns the category labels
 * (e.g., "AP", "Health", "Armor") representing what the player
 * is investing in. Only categories where at least one item contributes
 * are included.
 */

/** Stat key → human-readable category label */
const STAT_CATEGORIES: Record<string, string> = {
  FlatMagicDamageMod: "AP",
  FlatPhysicalDamageMod: "AD",
  FlatArmorMod: "Armor",
  FlatSpellBlockMod: "MR",
  FlatHPPoolMod: "Health",
  PercentAttackSpeedMod: "AS",
  FlatCritChanceMod: "Crit",
  PercentMovementSpeedMod: "MS",
  PercentLifeStealMod: "Lifesteal",
};

/** Category display order (most important first) */
const CATEGORY_ORDER = [
  "AP",
  "AD",
  "Health",
  "Armor",
  "MR",
  "M.Pen",
  "Haste",
  "AS",
  "Crit",
  "Lifesteal",
  "MS",
  "Antiheal",
];

/**
 * Derive the stat categories a player is building toward
 * based on their item stats and tags.
 */
export function deriveItemCategories(
  items: Array<{ stats: Record<string, number>; tags: string[] }>
): string[] {
  const categories = new Set<string>();

  for (const item of items) {
    // Derive from stats
    for (const [statKey, value] of Object.entries(item.stats)) {
      if (value > 0 && STAT_CATEGORIES[statKey]) {
        categories.add(STAT_CATEGORIES[statKey]);
      }
    }

    // Derive from tags for categories not captured by stats
    const lowerTags = item.tags.map((t) => t.toLowerCase());
    if (lowerTags.includes("spellpen") || lowerTags.includes("magicpen")) {
      categories.add("M.Pen");
    }
    if (
      lowerTags.includes("cooldownreduction") ||
      lowerTags.includes("abilityhaste")
    ) {
      categories.add("Haste");
    }
    if (
      lowerTags.includes("grievouswounds") ||
      lowerTags.includes("antiheal")
    ) {
      categories.add("Antiheal");
    }
  }

  // Sort by display order
  return CATEGORY_ORDER.filter((c) => categories.has(c));
}

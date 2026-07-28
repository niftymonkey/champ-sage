/**
 * Item catalog formatter for the coaching system prompt.
 *
 * Produces two tiers of item information:
 *
 *   Tier 1 — Meta-derived items: items that actually appear in the top
 *   community builds for the player's champion in the current mode. Presented
 *   with full detail (name, description, stats, cost, build path) and framed
 *   as "items proven on this champion". This is the strong prior the LLM
 *   should default to.
 *
 *   Tier 2 — Remaining mode-valid items: all other items purchasable in the
 *   current game mode (per `isBuildPathEligible`, the same predicate the
 *   game-plan build-path enum stands on), minus the tier 1 items. Presented with
 *   lighter detail (name, key stats, cost) so the LLM has a complete reference
 *   for situational deviations (grievous wounds, defensive swaps, etc.) without
 *   diluting the tier 1 signal.
 *
 * The formatting strategy follows the exploration doc's approach: give the
 * LLM a hierarchy (strong default + full reference) rather than a flat list.
 */

import type { GameMode } from "../mode/types";
import {
  GAME_MODE_ARAM,
  GAME_MODE_ARENA,
  GAME_MODE_CLASSIC,
  GAME_MODE_MAYHEM,
} from "../mode/types";
import type { Champion, Item, ItemMode } from "../data-ingest/types";
import {
  deriveMetaItemPoolEntries,
  getChampionMeta,
  type MetaBuildFile,
  type MetaBuildIndex,
} from "../data-ingest/meta-builds";

/**
 * Decide which meta build file to use for a given game mode. ARAM and Mayhem
 * both use the ARAM meta build data — see exploration doc for rationale.
 */
export function selectMetaFile(
  mode: GameMode,
  index: MetaBuildIndex | undefined
): MetaBuildFile | null {
  if (!index) return null;
  if (mode.matches(GAME_MODE_MAYHEM) || mode.matches(GAME_MODE_ARAM)) {
    return index.aram;
  }
  if (mode.matches(GAME_MODE_CLASSIC)) {
    return index.rankedSolo;
  }
  if (mode.matches(GAME_MODE_ARENA)) {
    return index.arena;
  }
  return null;
}

/**
 * Whether a build-path slot may contain this item in the given mode. The shared
 * "build-path content rules" predicate (issue #127): a recommendable item is
 * purchasable, durable (not a consumable or trinket), completed (components and
 * basic boots are not end-state slots), and available in the current mode.
 *
 * This is the structural floor the game-plan name enum stands on. It cannot
 * express cross-item legality (one boots, no duplicate Legendary, mutex item
 * groups) or "already owned": those need the full set plus inventory and are
 * enforced post-hoc (issue #117).
 *
 * Mode availability uses the ID-range `item.mode` partition (ARAM is played
 * with standard items plus the ARAM variant overlay, so it accepts both). This
 * is deliberately permissive: DDragon's per-map `maps` flags are INCOMPLETE for
 * ARAM (they mark real staples like Guardian Angel and Mejai's as map-12-absent),
 * so filtering on a specific map would drop items that are genuinely buildable.
 * The one thing `maps` IS reliable for is "available on NO map at all", which is
 * how deprecated and internal entries (Deprecated item, Quest markers) are
 * excluded here without touching real items (issue #138 remains the tracked
 * home for a fully map-accurate availability model).
 */
/**
 * Curated name blocklist for items that pass every structural rule but should
 * never be recommended. Name-based (not id) so it survives id churn and catches
 * every same-named variant at once:
 *
 *   - Golden Spatula: DDragon marks it purchasable, but in real games it is
 *     granted by a rare augment and cannot be bought.
 *   - Guardian's starters: buyable, but strictly starter-tier; recommending
 *     one mid-game is never right, and start-of-game item advice isn't a
 *     coaching surface here.
 */
const NEVER_RECOMMEND_ITEM_NAMES = new Set([
  "The Golden Spatula",
  "Golden Spatula",
  "Guardian's Blade",
  "Guardian's Hammer",
  "Guardian's Horn",
  "Guardian's Orb",
]);

export function isBuildPathEligible(item: Item, mode: GameMode): boolean {
  if (NEVER_RECOMMEND_ITEM_NAMES.has(item.name)) return false;
  if (!item.gold.purchasable) return false;
  if (item.tags.includes("Consumable") || item.tags.includes("Trinket")) {
    return false;
  }
  // Completed items only. Components build INTO something and are not an
  // end-state slot. Boots are the exception: an upgraded boot may list a
  // further upgrade in `into` but is a legitimate finished slot.
  const isBoots = item.tags.includes("Boots");
  if (item.into && item.into.length > 0 && !isBoots) return false;
  if (item.gold.total < 500) return false;
  // Available on no map = deprecated or internal, recommendable nowhere.
  if (item.maps.length === 0) return false;
  return modeAcceptsItemMode(mode, item.mode);
}

/**
 * Which `item.mode` partitions count as available in a given game mode. ARAM and
 * Mayhem are played with standard Summoner's Rift items plus the ARAM variant
 * overlay, so both partitions are accepted. Classic is standard-only; Arena is
 * its own pool.
 */
function modeAcceptsItemMode(mode: GameMode, itemMode: ItemMode): boolean {
  if (mode.matches(GAME_MODE_ARAM) || mode.matches(GAME_MODE_MAYHEM)) {
    return itemMode === "standard" || itemMode === "aram";
  }
  if (mode.matches(GAME_MODE_ARENA)) return itemMode === "arena";
  return itemMode === "standard";
}

/**
 * Collapse same-named items to one entry so the catalog never shows a name
 * twice. Map filtering already removes off-map variants for a mode like ARAM,
 * but a mode can still legitimately list two same-named variants (both on its
 * map), and the base context tells the model each catalog name is a distinct
 * purchasable item. Keep the most broadly-available variant (the most maps),
 * tie-broken by lowest cost then lowest id, so the choice is deterministic and
 * favors the canonical item over a niche rebalance.
 */
function dedupeByName(items: Item[]): Item[] {
  const byName = new Map<string, Item>();
  for (const item of items) {
    const current = byName.get(item.name);
    if (!current || isMoreCanonical(item, current)) {
      byName.set(item.name, item);
    }
  }
  return [...byName.values()];
}

function isMoreCanonical(candidate: Item, incumbent: Item): boolean {
  if (candidate.maps.length !== incumbent.maps.length) {
    return candidate.maps.length > incumbent.maps.length;
  }
  if (candidate.gold.total !== incumbent.gold.total) {
    return candidate.gold.total < incumbent.gold.total;
  }
  return candidate.id < incumbent.id;
}

/** Format gold with a thousands separator. Cheap but readable. */
function formatGold(gold: number): string {
  return `${gold}g`;
}

/**
 * Build a compact "key stats" string from an item's stats map — used for
 * tier 2 items where we don't include the full description. Surfaces the
 * most recognizable numeric properties (AD, AP, HP, AH, armor, MR, crit, AS,
 * MS) and skips the long tail of percentage-based modifiers.
 */
function formatKeyStats(item: Item): string {
  const parts: string[] = [];
  const s = item.stats;

  // Offensive
  if (s.FlatPhysicalDamageMod) parts.push(`${s.FlatPhysicalDamageMod} AD`);
  if (s.FlatMagicDamageMod) parts.push(`${s.FlatMagicDamageMod} AP`);
  if (s.PercentAttackSpeedMod) {
    parts.push(`${Math.round(s.PercentAttackSpeedMod * 100)}% AS`);
  }
  if (s.FlatCritChanceMod) {
    parts.push(`${Math.round(s.FlatCritChanceMod * 100)}% crit`);
  }

  // Defensive
  if (s.FlatHPPoolMod) parts.push(`${s.FlatHPPoolMod} HP`);
  if (s.FlatArmorMod) parts.push(`${s.FlatArmorMod} armor`);
  if (s.FlatSpellBlockMod) parts.push(`${s.FlatSpellBlockMod} MR`);

  // Utility
  if (s.PercentMovementSpeedMod) {
    parts.push(`${Math.round(s.PercentMovementSpeedMod * 100)}% MS`);
  }
  if (s.FlatMPPoolMod) parts.push(`${s.FlatMPPoolMod} mana`);

  return parts.join(", ");
}

/**
 * Format an item for tier 1 (meta-derived). Full detail: description, key
 * stats (if not already covered by description), total cost, and build path. A
 * non-null `presence` (the fraction of the champion's games that built the item)
 * is appended as a usage rate so the LLM can read how-standard the item is;
 * legacy build-derived pools pass null and the rate is omitted.
 */
function formatMetaItem(
  item: Item,
  allItems: Map<number, Item>,
  presence: number | null
): string {
  const parts: string[] = [`**${item.name}** — `];
  // Prefer the stripped description; it's the authoritative effect text.
  if (item.description) {
    parts.push(item.description);
  } else {
    const stats = formatKeyStats(item);
    if (stats) parts.push(stats);
  }
  parts.push(`. Cost: ${formatGold(item.gold.total)}`);

  // Show build-from components by name if present
  if (item.from && item.from.length > 0) {
    const components = item.from
      .map((id) => allItems.get(id)?.name)
      .filter((name): name is string => !!name);
    if (components.length > 0) {
      parts.push(` (builds from: ${components.join(" + ")})`);
    }
  }
  if (presence != null) {
    parts.push(` (used in ${Math.round(presence * 100)}% of games)`);
  }
  return parts.join("");
}

/**
 * Format an item for tier 2 (broader reference catalog). One line per item:
 * name, key stats, total cost.
 */
function formatReferenceItem(item: Item): string {
  const stats = formatKeyStats(item);
  return stats
    ? `- ${item.name} — ${stats}. ${formatGold(item.gold.total)}`
    : `- ${item.name} — ${formatGold(item.gold.total)}`;
}

export interface ItemCatalogSections {
  /** The full block of text ready to drop into the system prompt, or null
   *  if no item data could be assembled (e.g. unknown champion, no meta file). */
  text: string | null;
  /** Count of tier 1 items, for diagnostics/tests. */
  tier1Count: number;
  /** Count of tier 2 items, for diagnostics/tests. */
  tier2Count: number;
}

/**
 * Build the item catalog section of the coaching system prompt.
 *
 * Returns null text if we can't produce anything useful (unknown champion
 * or no meta data file available). Callers should treat null as "skip this
 * section entirely" rather than injecting an empty block.
 */
export function buildItemCatalogSections(
  mode: GameMode,
  champion: Champion | undefined,
  allItems: Map<number, Item>,
  metaBuilds: MetaBuildIndex | undefined
): ItemCatalogSections {
  // The tier 2 universe: every item this mode could legitimately have us
  // recommend. `isBuildPathEligible` is the shared "recommendable item"
  // predicate (purchasable, durable, completed, available in this mode) that
  // the game-plan build-path enum already stands on, so the catalog we show
  // the model and the enum it must answer within describe the same set.
  //
  // This deliberately does NOT use `filterItemsByMode`, which exact-matches
  // `item.mode`. ARAM and Mayhem are played with the standard Summoner's Rift
  // items PLUS the ARAM variant overlay; an exact match on "aram" yielded only
  // the ~21 variant items and hid every standard item from the model, while
  // the base context simultaneously told it that anything absent from this
  // catalog is not purchasable.
  const modeItems = new Map<number, Item>();
  for (const [id, item] of allItems) {
    if (isBuildPathEligible(item, mode)) modeItems.set(id, item);
  }

  const metaFile = selectMetaFile(mode, metaBuilds);

  // If we have no champion match OR no meta file, fall back to "tier 2 only":
  // just the mode-filtered item catalog, no meta-derived tier 1. Still useful
  // for the LLM to know what items exist and what they cost.
  const championMeta = champion
    ? getChampionMeta(metaFile, champion.key)
    : null;

  const tier1Entries = deriveMetaItemPoolEntries(championMeta);
  const tier1Items: Array<{ item: Item; presence: number | null }> = [];
  for (const entry of tier1Entries) {
    const item = allItems.get(entry.itemId);
    if (!item) continue;
    // Skip components and consumables. These show up in meta builds when
    // players finish games with leftover inventory (Refillable Potion, Ruby
    // Crystal, Long Sword, etc.). They pollute the tier 1 pool.
    //
    // A completed item either doesn't build into anything, or is boots
    // (upgraded boots have `into` pointing at further upgrades but are
    // still "completed" items — identified by the "Boots" tag).
    if (item.gold.total < 500) continue;
    const isBoots = item.tags.includes("Boots");
    if (item.into && item.into.length > 0 && !isBoots) continue;
    tier1Items.push({ item, presence: entry.presence });
  }

  // Tier 2 = mode-valid items minus tier 1, excluded by NAME not just id: a
  // tier-1 item and its same-named off-map variant carry different ids, so an
  // id-only exclusion would surface the name in both sections. Sort
  // alphabetically for predictable, eyeball-friendly output.
  const tier1Names = new Set(tier1Items.map(({ item }) => item.name));
  const tier2Items = dedupeByName(
    [...modeItems.values()].filter((item) => !tier1Names.has(item.name))
  ).sort((a, b) => a.name.localeCompare(b.name));

  // Produce nothing if we have neither tier. Unlikely but guards against
  // a misconfigured mode or a missing item catalog.
  if (tier1Items.length === 0 && tier2Items.length === 0) {
    return { text: null, tier1Count: 0, tier2Count: 0 };
  }

  const lines: string[] = [];

  if (tier1Items.length > 0 && champion) {
    lines.push(
      `## Item pool for ${champion.name} (patch ${metaFile?.patch ?? "current"})`
    );
    lines.push(
      `These items show up in the top community builds for ${champion.name} this patch. Treat this as a CURATED POOL to choose from, NOT a build order. The list is unordered — use your knowledge of League itemization to determine build order. Do NOT simply list all of these items — pick the subset that best counters the enemy team composition, matches the player's current gold and inventory, and addresses the player's current question.`
    );
    lines.push("");
    for (const { item, presence } of tier1Items) {
      lines.push(formatMetaItem(item, allItems, presence));
    }
  }

  if (tier2Items.length > 0) {
    if (lines.length > 0) lines.push("");
    lines.push("## Other available items");
    lines.push(
      "Additional items available in this game mode. Reach for these when the game state calls for something the pool above doesn't address — for example, grievous wounds items against heavy healing, specific defensive items against a fed threat, or matchup-specific counters."
    );
    lines.push("");
    for (const item of tier2Items) {
      lines.push(formatReferenceItem(item));
    }
  }

  const restrictions = formatPurchaseRestrictions([
    ...tier1Items.map(({ item }) => item),
    ...tier2Items,
  ]);
  if (restrictions.length > 0) {
    if (lines.length > 0) lines.push("");
    lines.push(...restrictions);
  }

  return {
    text: lines.join("\n"),
    tier1Count: tier1Items.length,
    tier2Count: tier2Items.length,
  };
}

/**
 * Render the "Purchase restrictions" block: one line per mutex group with two
 * or more distinct item names in the shown catalog (#117 mutex slice). The
 * game caps each group (Last Whisper family "Fatality", Spellblade, Hydra,
 * Lifeline, ...) at one owned item, so listing colliding names next to the
 * pool is the prompt-level defense that keeps the model from recommending,
 * say, Lord Dominik's Regards and Mortal Reminder together. Groups and names
 * are sorted alphabetically so the output is deterministic. Returns [] when
 * no shown group has a possible collision (including when mutex data is
 * absent because the wiki fetch failed).
 */
function formatPurchaseRestrictions(catalogItems: Item[]): string[] {
  const namesByGroup = new Map<string, Set<string>>();
  for (const item of catalogItems) {
    for (const group of item.mutexGroups ?? []) {
      const names = namesByGroup.get(group) ?? new Set<string>();
      names.add(item.name);
      namesByGroup.set(group, names);
    }
  }

  const collidingGroups = [...namesByGroup.entries()]
    .filter(([, names]) => names.size >= 2)
    .sort(([a], [b]) => a.localeCompare(b));
  if (collidingGroups.length === 0) return [];

  const lines = [
    "## Purchase restrictions",
    "The game only allows owning ONE item from each group below at a time. Never put two items from the same group in a build path, and never recommend one while the player already owns another from that group.",
    "",
  ];
  for (const [group, names] of collidingGroups) {
    const sorted = [...names].sort((a, b) => a.localeCompare(b));
    lines.push(`- ${group}: at most ONE of ${sorted.join(", ")}`);
  }
  return lines;
}

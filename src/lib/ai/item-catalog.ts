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
 *   current game mode, minus the tier 1 items. Presented with lighter detail
 *   (name, key stats, cost) so the LLM has a complete reference for situational
 *   deviations (grievous wounds, defensive swaps, etc.) without diluting the
 *   tier 1 signal.
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
import type { Champion, Item } from "../data-ingest/types";
import {
  deriveMetaItemPool,
  getChampionMeta,
  type MetaBuildFile,
  type MetaBuildIndex,
} from "../data-ingest/meta-builds";
import { filterItemsByMode } from "../mode/utils";

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
 * Pick the item-mode string used by the existing `filterItemsByMode` helper,
 * which filters the global item catalog down to items valid for a given mode.
 */
export function selectItemMode(mode: GameMode): string {
  if (mode.matches(GAME_MODE_ARAM) || mode.matches(GAME_MODE_MAYHEM)) {
    return "aram";
  }
  if (mode.matches(GAME_MODE_ARENA)) return "arena";
  return "standard";
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
 * stats (if not already covered by description), total cost, and build path.
 */
function formatMetaItem(item: Item, allItems: Map<number, Item>): string {
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
  // Filter down to the items valid for this game mode first. This is the
  // tier 2 universe — without it we'd be listing jungle items in ARAM, etc.
  const modeItems = filterItemsByMode(allItems, selectItemMode(mode));

  const metaFile = selectMetaFile(mode, metaBuilds);

  // If we have no champion match OR no meta file, fall back to "tier 2 only":
  // just the mode-filtered item catalog, no meta-derived tier 1. Still useful
  // for the LLM to know what items exist and what they cost.
  const championMeta = champion
    ? getChampionMeta(metaFile, champion.key)
    : null;

  const tier1Ids = deriveMetaItemPool(championMeta);
  const tier1Items: Item[] = [];
  for (const id of tier1Ids) {
    const item = allItems.get(id);
    // Meta builds may reference items that aren't in the current mode filter
    // (e.g. builds captured just before a patch shifted item availability).
    // We still want to include them in tier 1 — the meta data is what matters
    // for "proven on this champion", not the mode filter.
    if (item) tier1Items.push(item);
  }

  // Tier 2 = mode-valid items minus tier 1 items. Sort alphabetically for
  // predictable output; the LLM doesn't care about order but it makes the
  // prompt easier to eyeball when debugging.
  const tier1Set = new Set(tier1Ids);
  const tier2Items = [...modeItems.values()]
    .filter((item) => !tier1Set.has(item.id))
    .sort((a, b) => a.name.localeCompare(b.name));

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
    for (const item of tier1Items) {
      lines.push(formatMetaItem(item, allItems));
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

  return {
    text: lines.join("\n"),
    tier1Count: tier1Items.length,
    tier2Count: tier2Items.length,
  };
}

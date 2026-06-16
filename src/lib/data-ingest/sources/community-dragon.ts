import type { Augment, AugmentMode } from "../types";
import { cdragonBranch, type Patchline } from "../patchline";

/**
 * Description carried by an augment that exists in Community Dragon but has no
 * wiki entry yet. New Mayhem augments land in CDragon (id/icon/rarity) a patch
 * or more before the wiki documents them; this lets them stay visible to the
 * player and the coaching LLM instead of vanishing until the wiki catches up.
 * The augment-fit prompt special-cases this text so the model rates cautiously
 * from name and tier rather than inventing an effect.
 */
export const MISSING_DESCRIPTION_PLACEHOLDER = "No description available yet.";

function cdragonAugmentsUrl(patchline: Patchline): string {
  return `https://raw.communitydragon.org/${cdragonBranch(
    patchline
  )}/plugins/rcp-be-lol-game-data/global/default/v1/cherry-augments.json`;
}

export interface RawCDragonAugment {
  id: number;
  nameTRA: string;
  augmentSmallIconPath: string;
  rarity: string;
}

/**
 * Classify an augment's mode based on its CDragon icon path.
 * - Kiwi/ anywhere in path → mayhem (ARAM Mayhem)
 * - Strawberry/ in path → swarm (Swarm mode, codename Strawberry)
 * - Swarm/ in path → swarm
 * - Cherry/ without Kiwi → arena (Arena mode, codename Cherry)
 * - anything else → unknown
 */
export function classifyAugmentMode(iconPath: string): AugmentMode {
  const lower = iconPath.toLowerCase();
  if (lower.includes("kiwi/")) return "mayhem";
  if (lower.includes("strawberry/")) return "swarm";
  if (lower.includes("swarm/")) return "swarm";
  if (lower.includes("cherry/")) return "arena";
  return "unknown";
}

/**
 * Normalize a name for matching: lowercase, turn punctuation into spaces,
 * collapse runs of whitespace, and drop a leading "quest" marker. Handles
 * cases like "Get Excited" vs "Get Excited!" and "Quest: Sneakerhead" vs
 * "Sneakerhead" (the wiki and CDragon disagree on the prefix for quest
 * augments). Punctuation becomes a space rather than nothing so a hyphenated
 * name still matches its spaced counterpart.
 */
export function normalizeForMatch(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^quest\s+/, "")
    .trim();
}

function normalizePath(path: string, patchline: Patchline): string {
  const cleaned = path.replace("/lol-game-data/assets/", "").toLowerCase();
  return `https://raw.communitydragon.org/${cdragonBranch(
    patchline
  )}/plugins/rcp-be-lol-game-data/global/default/${cleaned}`;
}

/**
 * Fetch augment IDs and icons from Community Dragon, then:
 * 1. Merge IDs/icons into existing wiki augments (matched by name)
 *    WITHOUT overwriting their mode (wiki source is authoritative for mode)
 * 2. Add any CDragon-only augments with their classified mode
 *
 * When duplicates exist (same name, different IDs), prefer the entry
 * whose mode matches the existing augment's mode.
 */
export async function fetchCDragonAugments(
  patchline: Patchline = "live"
): Promise<RawCDragonAugment[]> {
  const res = await fetch(cdragonAugmentsUrl(patchline));
  if (!res.ok)
    throw new Error(`Failed to fetch CDragon augments: ${res.status}`);
  return (await res.json()) as RawCDragonAugment[];
}

export async function mergeAugmentIds(
  augments: Map<string, Augment>,
  patchline: Patchline = "live"
): Promise<void> {
  const raw = await fetchCDragonAugments(patchline);

  // Build a normalized-name lookup for wiki augments
  const normalizedLookup = new Map<string, string>();
  for (const key of augments.keys()) {
    normalizedLookup.set(normalizeForMatch(key), key);
  }

  // Group CDragon entries by normalized name to handle duplicates
  const grouped = new Map<string, RawCDragonAugment[]>();
  for (const entry of raw) {
    const normalized = normalizeForMatch(entry.nameTRA);
    const list = grouped.get(normalized) ?? [];
    list.push(entry);
    grouped.set(normalized, list);
  }

  for (const [normalized, entries] of grouped) {
    const existingKey = normalizedLookup.get(normalized);
    const existing = existingKey ? augments.get(existingKey) : null;

    // Pick the best entry: prefer one whose mode matches the existing augment
    const best = pickBestEntry(entries, existing?.mode);

    if (existing) {
      // Merge ID and icon but DO NOT overwrite mode
      existing.id = best.id;
      existing.iconPath = normalizePath(best.augmentSmallIconPath, patchline);
      continue;
    }

    // CDragon-only augment (no wiki entry). Keep Mayhem ones with a placeholder
    // description so augments new this patch stay visible to the player and the
    // coaching LLM before the wiki documents them. Other modes stay dropped:
    // Arena is fully covered by its own wiki source, CDragon's test/internal
    // entries ("404 Augment Not Found", "Augment 405") are Arena-coded, and
    // Swarm is unsupported.
    if (classifyAugmentMode(best.augmentSmallIconPath) !== "mayhem") continue;

    const key = best.nameTRA.toLowerCase();
    if (augments.has(key)) continue;
    augments.set(key, {
      name: best.nameTRA,
      description: MISSING_DESCRIPTION_PLACEHOLDER,
      tier: rarityToTier(best.rarity),
      sets: [],
      mode: "mayhem",
      id: best.id,
      iconPath: normalizePath(best.augmentSmallIconPath, patchline),
    });
  }
}

/**
 * Map a Community Dragon rarity token (e.g. "kPrismatic") to our tier enum.
 * Mayhem augments only use kSilver/kGold/kPrismatic; anything else falls back
 * to Silver so a kept augment always has a valid tier.
 */
function rarityToTier(rarity: string): Augment["tier"] {
  switch (rarity) {
    case "kPrismatic":
      return "Prismatic";
    case "kGold":
      return "Gold";
    default:
      return "Silver";
  }
}

function pickBestEntry(
  entries: RawCDragonAugment[],
  preferMode?: AugmentMode
): RawCDragonAugment {
  if (entries.length === 1) return entries[0];

  if (preferMode) {
    const preferred = entries.find(
      (e) => classifyAugmentMode(e.augmentSmallIconPath) === preferMode
    );
    if (preferred) return preferred;
  }

  // Default: prefer mayhem > arena > swarm > unknown
  const priority: AugmentMode[] = ["mayhem", "arena", "swarm", "unknown"];
  for (const mode of priority) {
    const match = entries.find(
      (e) => classifyAugmentMode(e.augmentSmallIconPath) === mode
    );
    if (match) return match;
  }

  return entries[0];
}

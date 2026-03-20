import type { Augment, AugmentMode } from "../types";

const CDRAGON_URL =
  "https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/v1/cherry-augments.json";

interface RawCDragonAugment {
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
 * Normalize a name for matching: lowercase, strip punctuation.
 * Handles cases like "Get Excited" vs "Get Excited!" and
 * "Quest: Sneakerhead" vs "Sneakerhead".
 */
function normalizeForMatch(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .trim();
}

function normalizePath(path: string): string {
  const cleaned = path.replace("/lol-game-data/assets/", "").toLowerCase();
  return `https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/${cleaned}`;
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
export async function mergeAugmentIds(
  augments: Map<string, Augment>
): Promise<void> {
  const res = await fetch(CDRAGON_URL);
  if (!res.ok)
    throw new Error(`Failed to fetch CDragon augments: ${res.status}`);
  const raw: RawCDragonAugment[] = await res.json();

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
      existing.iconPath = normalizePath(best.augmentSmallIconPath);
    }
    // CDragon-only augments (not in any wiki source) are skipped.
    // They have no description and are often test/internal entries
    // (e.g., "404 Augment Not Found", "Augment 405") or from
    // unsupported modes. Wiki sources are authoritative for augment data.
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

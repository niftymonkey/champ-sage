import { parseLuaTable } from "../parsers/lua-parser";

const ITEM_DATA_URL =
  "https://wiki.leagueoflegends.com/en-us/Module:ItemData/data?action=raw";

/** Scalar fields named itemlimit, itemlimit2, itemlimit3, ... */
const ITEM_LIMIT_FIELD = /^itemlimit\d*$/;

/** Matches the other wiki sources; this fetch shares the ingest Promise.all. */
const REQUEST_TIMEOUT_MS = 15_000;

/**
 * Fetch mutually exclusive item-group membership from the League Wiki
 * ItemData Lua module.
 *
 * Each item entry may carry `itemlimit` (and `itemlimit2` for dual-group
 * items like Terminus) naming the restriction group the game caps at one
 * owned copy, e.g. "Fatality" for the Last Whisper family or "Spellblade".
 * This is the only machine-readable source for group membership: DDragon's
 * top-level `groups` array names the groups but no item carries a membership
 * field, and CommunityDragon mirrors the same gap.
 *
 * Returns a map keyed by lowercase item name; values are the trimmed group
 * names (the live module carries stray trailing whitespace on some values).
 */
export async function fetchItemMutexGroups(): Promise<Map<string, string[]>> {
  const res = await fetch(ITEM_DATA_URL, {
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Failed to fetch ItemData: ${res.status}`);

  const entries = parseLuaTable(await res.text());
  const groups = new Map<string, string[]>();

  for (const [itemName, fields] of Object.entries(entries)) {
    const itemGroups: string[] = [];
    for (const [field, value] of Object.entries(fields)) {
      if (!ITEM_LIMIT_FIELD.test(field)) continue;
      if (typeof value !== "string") continue;
      const group = value.trim();
      if (group !== "") itemGroups.push(group);
    }
    if (itemGroups.length > 0) {
      groups.set(itemName.toLowerCase(), itemGroups);
    }
  }

  return groups;
}

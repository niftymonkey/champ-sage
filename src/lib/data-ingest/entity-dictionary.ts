import type {
  Champion,
  Item,
  Augment,
  EntityDictionary,
  EntityMatch,
} from "./types";

interface NameEntry {
  name: string;
  type: EntityMatch["type"];
  nameLower: string;
}

export function buildEntityDictionary(
  champions: Map<string, Champion>,
  items: Map<number, Item>,
  augments: Map<string, Augment>
): EntityDictionary {
  const entries: NameEntry[] = [];
  const championNames: string[] = [];
  const itemNames: string[] = [];
  const augmentNames: string[] = [];

  for (const champ of champions.values()) {
    entries.push({
      name: champ.name,
      type: "champion",
      nameLower: champ.name.toLowerCase(),
    });
    championNames.push(champ.name);
  }

  for (const item of items.values()) {
    entries.push({
      name: item.name,
      type: "item",
      nameLower: item.name.toLowerCase(),
    });
    itemNames.push(item.name);
  }

  for (const aug of augments.values()) {
    entries.push({
      name: aug.name,
      type: "augment",
      nameLower: aug.name.toLowerCase(),
    });
    augmentNames.push(aug.name);
  }

  const allNames = [...championNames, ...itemNames, ...augmentNames];

  return {
    allNames,
    champions: championNames,
    items: itemNames,
    augments: augmentNames,
    search(query: string): EntityMatch[] {
      return fuzzySearch(entries, query);
    },
    findInText(text: string): EntityMatch[] {
      return findEntitiesInText(entries, text);
    },
  };
}

function fuzzySearch(entries: NameEntry[], query: string): EntityMatch[] {
  const queryLower = query.toLowerCase();
  const results: EntityMatch[] = [];

  for (const entry of entries) {
    const score = fuzzyScore(entry.nameLower, queryLower);
    if (score > 0) {
      results.push({ name: entry.name, type: entry.type, score });
    }
  }

  results.sort((a, b) => b.score - a.score);
  return results;
}

/**
 * Score how well a query matches a name. Returns 0-1.
 * - 1.0: exact match
 * - 0.9: case-insensitive exact match
 * - 0.8: name starts with query
 * - 0.7: name contains query as a substring
 * - 0.3-0.6: fuzzy character match (all query chars appear in order)
 * - 0: no match
 */
function fuzzyScore(nameLower: string, queryLower: string): number {
  if (nameLower === queryLower) return 1;

  // Strip common punctuation for matching (e.g., "rabadons" vs "rabadon's")
  const nameStripped = nameLower.replace(/[^a-z0-9\s]/g, "");
  const queryStripped = queryLower.replace(/[^a-z0-9\s]/g, "");

  if (nameStripped === queryStripped) return 0.9;
  if (nameStripped.startsWith(queryStripped)) return 0.8;
  if (nameStripped.includes(queryStripped)) return 0.7;

  // Fuzzy: all query characters appear in order in the name
  let nameIdx = 0;
  let matched = 0;
  for (let i = 0; i < queryStripped.length; i++) {
    const ch = queryStripped[i];
    while (nameIdx < nameStripped.length) {
      if (nameStripped[nameIdx] === ch) {
        matched++;
        nameIdx++;
        break;
      }
      nameIdx++;
    }
  }

  if (matched === queryStripped.length && queryStripped.length > 1) {
    return 0.3 + 0.3 * (matched / nameStripped.length);
  }

  return 0;
}

/**
 * Find entity names mentioned within a block of text.
 * Unlike fuzzySearch (which matches a short query against entity names),
 * this scans text for occurrences of known entity names.
 *
 * Returns matches sorted by name length (longest first) to prefer
 * "Upgrade Collector" over "Collector" when both appear.
 */
function findEntitiesInText(entries: NameEntry[], text: string): EntityMatch[] {
  const textLower = text.toLowerCase();
  const textStripped = textLower.replace(/[^a-z0-9\s]/g, "");
  const results: EntityMatch[] = [];
  const seen = new Set<string>();

  // Sort entries by name length descending so longer matches win
  const sorted = [...entries].sort(
    (a, b) => b.nameLower.length - a.nameLower.length
  );

  for (const entry of sorted) {
    if (seen.has(entry.nameLower)) continue;

    // Check both with and without punctuation
    const nameStripped = entry.nameLower.replace(/[^a-z0-9\s]/g, "");

    if (
      textLower.includes(entry.nameLower) ||
      textStripped.includes(nameStripped)
    ) {
      // Skip very short names (3 chars or less) to avoid false positives
      // like "ADC" matching "adapt" or single-word collisions
      if (nameStripped.length <= 3) continue;

      results.push({ name: entry.name, type: entry.type, score: 1.0 });
      seen.add(entry.nameLower);
    }
  }

  return results;
}

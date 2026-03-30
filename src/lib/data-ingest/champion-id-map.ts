/**
 * Module-level reverse lookup: champion numeric key → display name.
 *
 * Populated once when game data loads. Used by the debug panel summarizer
 * to show champion names instead of numeric IDs during champ select
 * (the LCU champ select API only provides numeric champion keys).
 */

const championIdToName = new Map<number, string>();

export function populateChampionIdMap(
  champions: Map<string, { key: number; name: string }>
): void {
  championIdToName.clear();
  for (const champ of champions.values()) {
    championIdToName.set(champ.key, champ.name);
  }
}

export function resolveChampionName(championId: number): string | undefined {
  return championIdToName.get(championId);
}

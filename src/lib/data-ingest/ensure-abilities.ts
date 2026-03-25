import type { LoadedGameData } from "./index";
import { fetchChampionAbilities } from "./sources/data-dragon";

export async function ensureAbilities(
  gameData: LoadedGameData,
  championNames: string[],
  version: string
): Promise<void> {
  const needsFetch: Array<{
    champion: ReturnType<LoadedGameData["champions"]["get"]>;
    ddId: string;
  }> = [];

  for (const name of championNames) {
    const champion = gameData.champions.get(name.toLowerCase());
    if (!champion || champion.abilities) continue;
    needsFetch.push({ champion, ddId: champion.id });
  }

  if (needsFetch.length === 0) return;

  const ddIds = needsFetch.map((entry) => entry.ddId);
  const abilitiesMap = await fetchChampionAbilities(version, ddIds);

  for (const entry of needsFetch) {
    const abilities = abilitiesMap.get(entry.ddId.toLowerCase());
    if (abilities && entry.champion) {
      entry.champion.abilities = abilities;
    }
  }
}

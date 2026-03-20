import type {
  GameData,
  AramOverrides,
  Champion,
  Item,
  Augment,
  RuneTree,
  EntityDictionary,
} from "./types";
import {
  fetchLatestVersion,
  fetchChampions,
  fetchItems,
  fetchRunes,
} from "./sources/data-dragon";
import { fetchWikiAugments } from "./sources/wiki-augments";
import { mergeAugmentIds } from "./sources/community-dragon";
import { fetchAramOverrides } from "./sources/wiki-aram-overrides";
import { readCache, writeCache, mapToObject, objectToMap } from "./cache";
import { buildEntityDictionary } from "./entity-dictionary";

const CACHE_KEY = "game-data";

interface CachedGameData {
  version: string;
  champions: Record<string, Champion>;
  items: Record<string, Item>;
  runes: RuneTree[];
  augments: Record<string, Augment>;
}

export interface LoadedGameData extends GameData {
  dictionary: EntityDictionary;
}

export async function loadGameData(): Promise<LoadedGameData> {
  // Skip cache in dev mode so hot reload always shows fresh data
  if (import.meta.env.DEV) {
    return fetchAndCache();
  }

  const cached = await readCache<CachedGameData>(CACHE_KEY);
  if (cached) {
    return fromCached(cached);
  }

  return fetchAndCache();
}

export async function fetchAndCache(): Promise<LoadedGameData> {
  const version = await fetchLatestVersion();
  const [champions, items, runes, augments, aramOverrideMap] =
    await Promise.all([
      fetchChampions(version),
      fetchItems(version),
      fetchRunes(version),
      fetchWikiAugments(),
      fetchAramOverrides(),
    ]);

  await mergeAugmentIds(augments);
  mergeAramOverrides(champions, aramOverrideMap);

  const data: CachedGameData = {
    version,
    champions: mapToObject(champions),
    items: mapToObject(items),
    runes,
    augments: mapToObject(augments),
  };

  await writeCache(CACHE_KEY, data);

  return fromCached(data);
}

function mergeAramOverrides(
  champions: Map<string, Champion>,
  overrides: Map<string, AramOverrides>
): void {
  for (const [key, champion] of champions) {
    const aram = overrides.get(key);
    if (aram) {
      champion.aramOverrides = aram;
    }
  }
}

function fromCached(cached: CachedGameData): LoadedGameData {
  const champions = objectToMap<string, Champion>(cached.champions);
  const items = objectToMap<number, Item>(cached.items, "number");
  const augments = objectToMap<string, Augment>(cached.augments);
  const dictionary = buildEntityDictionary(champions, items, augments);

  return {
    version: cached.version,
    champions,
    items,
    runes: cached.runes,
    augments,
    dictionary,
  };
}

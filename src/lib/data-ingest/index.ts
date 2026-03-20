import type {
  GameData,
  AramOverrides,
  AugmentSet,
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
import { fetchArenaAugments } from "./sources/wiki-arena-augments";
import { mergeAugmentIds } from "./sources/community-dragon";
import { fetchAramOverrides } from "./sources/wiki-aram-overrides";
import { getMayhemAugmentSets } from "./sources/mayhem-augment-sets";
import { readCache, writeCache, mapToObject, objectToMap } from "./cache";
import { buildEntityDictionary } from "./entity-dictionary";

const CACHE_KEY = "game-data";

interface CachedGameData {
  version: string;
  champions: Record<string, Champion>;
  items: Record<string, Item>;
  runes: RuneTree[];
  augments: Record<string, Augment>;
  augmentSets: AugmentSet[];
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
  const [
    champions,
    items,
    runes,
    mayhemAugments,
    arenaAugments,
    aramOverrideMap,
  ] = await Promise.all([
    fetchChampions(version),
    fetchItems(version),
    fetchRunes(version),
    fetchWikiAugments(),
    fetchArenaAugments(),
    fetchAramOverrides(),
  ]);

  // Merge augments from both modes into a single map.
  // Many augments exist in both Mayhem and Arena — these need separate entries
  // because they have different metadata (Mayhem has set info, Arena doesn't).
  // Duplicates get a mode-prefixed key; unique names keep the plain key.
  const augments = new Map<string, Augment>();
  for (const [key, augment] of mayhemAugments) {
    augments.set(key, augment);
  }
  for (const [key, augment] of arenaAugments) {
    if (augments.has(key)) {
      // Name collision — store arena version with prefixed key
      augments.set(`arena:${key}`, augment);
    } else {
      augments.set(key, augment);
    }
  }

  await mergeAugmentIds(augments);
  mergeAramOverrides(champions, aramOverrideMap);

  const augmentSets = getMayhemAugmentSets();

  const data: CachedGameData = {
    version,
    champions: mapToObject(champions),
    items: mapToObject(items),
    runes,
    augments: mapToObject(augments),
    augmentSets,
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
    augmentSets: cached.augmentSets,
    dictionary,
  };
}

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
import { fetchKiwiAugments } from "./sources/cdragon-kiwi-augments";
import {
  mergeAugmentIds,
  normalizeForMatch,
  MISSING_DESCRIPTION_PLACEHOLDER,
} from "./sources/community-dragon";
import { fetchAramOverrides } from "./sources/wiki-aram-overrides";
import { getMayhemAugmentSets } from "./sources/mayhem-augment-sets";
import { enrichQuestAugments } from "./sources/quest-augment-rewards";
import { readCache, writeCache, mapToObject, objectToMap } from "./cache";
import { buildEntityDictionary } from "./entity-dictionary";
import { loadMetaBuilds, type MetaBuildIndex } from "./meta-builds";
import { patchlineCacheKey, type Patchline } from "./patchline";
import { getLogger } from "../logger";

const log = getLogger("data-ingest");

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Minimum share of KIWI augments that must resolve a non-empty description
 * before ingest trusts the raw source. Below this the bin schema likely
 * drifted, so ingest warns and leans on the wiki fallback rather than shipping
 * a gutted set. Mirrors the GEP stub-guard pattern: degrade and log.
 */
export const KIWI_MIN_RESOLUTION_RATE = 0.9;

export interface KiwiResolutionStats {
  total: number;
  nonEmpty: number;
  /** nonEmpty / total, or 0 when total is 0. */
  rate: number;
}

export function kiwiResolutionStats(
  kiwi: Map<string, Augment>
): KiwiResolutionStats {
  let nonEmpty = 0;
  for (const augment of kiwi.values()) {
    if (augment.description.trim() !== "") nonEmpty++;
  }
  const total = kiwi.size;
  return { total, nonEmpty, rate: total === 0 ? 0 : nonEmpty / total };
}

/**
 * Merge the CommunityDragon-raw KIWI augments (primary) with the wiki Mayhem
 * augments (fallback). Raw descriptions win; the wiki fills any empty raw
 * description and supplies whole entries the raw source did not; anything still
 * description-less ends on the placeholder. Matching across the two sources
 * uses normalizeForMatch so punctuation/quest-prefix differences still align.
 */
export function mergeMayhemAugments(
  kiwi: Map<string, Augment>,
  wiki: Map<string, Augment>
): Map<string, Augment> {
  // Copy the raw KIWI augments so filling a description never mutates the
  // caller's source map (sets is always [] so a shallow copy is enough).
  const merged = new Map<string, Augment>();
  for (const [key, augment] of kiwi) merged.set(key, { ...augment });

  const byNormalized = new Map<string, Augment>();
  for (const [key, augment] of merged) {
    byNormalized.set(normalizeForMatch(key), augment);
  }

  for (const [wikiKey, wikiAugment] of wiki) {
    const match = byNormalized.get(normalizeForMatch(wikiKey));
    if (match) {
      // Raw desc wins; the wiki only fills one the raw source left empty.
      if (
        match.description.trim() === "" &&
        wikiAugment.description.trim() !== ""
      ) {
        match.description = wikiAugment.description;
      }
      continue;
    }
    // A Mayhem augment the raw source did not supply: keep the wiki entry.
    if (!merged.has(wikiKey)) merged.set(wikiKey, wikiAugment);
  }

  // Last resort for anything still description-less from either source.
  for (const augment of merged.values()) {
    if (augment.description.trim() === "") {
      augment.description = MISSING_DESCRIPTION_PLACEHOLDER;
    }
  }

  return merged;
}

interface CachedGameData {
  version: string;
  champions: Record<string, Champion>;
  items: Record<string, Item>;
  runes: RuneTree[];
  augments: Record<string, Augment>;
  augmentSets: AugmentSet[];
  lastRefreshedAt: number;
}

export interface LoadedGameData extends GameData {
  dictionary: EntityDictionary;
  /**
   * Per-queue meta build data loaded from `src/data/meta-builds/*.json`.
   * Optional because the data may not be collected yet — callers must
   * handle the `undefined` case gracefully.
   */
  metaBuilds?: MetaBuildIndex;
}

export async function loadCachedGameData(
  patchline: Patchline = "live"
): Promise<LoadedGameData | null> {
  const cached = await readCache<CachedGameData>(patchlineCacheKey(patchline));
  if (!cached) return null;
  const data = fromCached(cached);
  data.metaBuilds = await loadMetaBuilds();
  return data;
}

export async function checkForNewVersion(
  cachedVersion: string
): Promise<boolean> {
  try {
    const latest = await fetchLatestVersion();
    return latest !== cachedVersion;
  } catch {
    // If the version check fails, assume we're current — don't trigger
    // a full fetch across all data sources on a transient error.
    // Users can force-refresh manually if needed.
    return false;
  }
}

export async function loadGameData(
  patchline: Patchline = "live"
): Promise<LoadedGameData> {
  // Skip cache in dev mode so hot reload always shows fresh data
  if (import.meta.env.DEV) {
    return fetchAndCacheWithFallback(patchline);
  }

  const cached = await readCache<CachedGameData>(patchlineCacheKey(patchline));
  if (cached) {
    const data = fromCached(cached);
    data.metaBuilds = await loadMetaBuilds();
    return data;
  }

  return fetchAndCacheWithFallback(patchline);
}

/**
 * Run a fresh ingest, falling back to the last cached payload if any source
 * fails (network outage, wiki text change that crashes the Lua parser, etc).
 * The app stays usable on stale data instead of dying on a third-party hiccup;
 * the underlying error is logged so the failure is still visible to devs.
 *
 * If no cache exists, the original error propagates - there is nothing to
 * fall back to and the caller deserves to know ingest failed.
 */
async function fetchAndCacheWithFallback(
  patchline: Patchline = "live"
): Promise<LoadedGameData> {
  try {
    return await fetchAndCache(patchline);
  } catch (err) {
    const cached = await readCache<CachedGameData>(
      patchlineCacheKey(patchline)
    );
    if (!cached) {
      log.error(
        "Data ingest failed and no cached payload is available",
        err as Error
      );
      throw err;
    }
    const errMsg = err instanceof Error ? err.message : String(err);
    const refreshedAtIso = Number.isFinite(cached.lastRefreshedAt)
      ? new Date(cached.lastRefreshedAt).toISOString()
      : "unknown-time";
    log.warn(
      `Data ingest failed (${errMsg}); serving cached payload from ${refreshedAtIso}`
    );
    const data = fromCached(cached);
    data.metaBuilds = await loadMetaBuilds();
    return data;
  }
}

export async function fetchAndCache(
  patchline: Patchline = "live"
): Promise<LoadedGameData> {
  const version = await fetchLatestVersion();
  const [
    champions,
    items,
    runes,
    kiwiAugments,
    wikiMayhemAugments,
    arenaAugments,
    aramOverrideMap,
  ] = await Promise.all([
    fetchChampions(version),
    fetchItems(version),
    fetchRunes(version),
    fetchKiwiAugments(patchline).catch((err) => {
      log.warn(
        `KIWI augment fetch failed; falling back to the wiki: ${errMessage(err)}`
      );
      return new Map<string, Augment>();
    }),
    fetchWikiAugments().catch((err) => {
      log.warn(
        `Wiki Mayhem augment fetch failed; relying on CDragon raw: ${errMessage(err)}`
      );
      return new Map<string, Augment>();
    }),
    fetchArenaAugments(),
    fetchAramOverrides(),
  ]);

  // ARAM Mayhem (KIWI) descriptions now come from CommunityDragon raw game
  // data, fresh on patch day. The wiki is demoted to a fallback that fills any
  // description the raw source leaves empty and supplies entries when the raw
  // fetch yields none. Warn (never fail) when raw resolution looks gutted so
  // the wiki safety net is visibly carrying the mode.
  const kiwiStats = kiwiResolutionStats(kiwiAugments);
  if (kiwiStats.rate < KIWI_MIN_RESOLUTION_RATE) {
    log.warn(
      `KIWI augment resolution low (${kiwiStats.nonEmpty}/${kiwiStats.total} non-empty descriptions); leaning on the wiki fallback`
    );
  }
  const mayhemAugments = mergeMayhemAugments(kiwiAugments, wikiMayhemAugments);

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

  await mergeAugmentIds(augments, patchline);
  enrichQuestAugments(augments, items);
  mergeAramOverrides(champions, aramOverrideMap);

  const augmentSets = getMayhemAugmentSets();

  const data: CachedGameData = {
    version,
    champions: mapToObject(champions),
    items: mapToObject(items),
    runes,
    augments: mapToObject(augments),
    augmentSets,
    lastRefreshedAt: Date.now(),
  };

  await writeCache(patchlineCacheKey(patchline), data);

  const loaded = fromCached(data);
  loaded.metaBuilds = await loadMetaBuilds();
  return loaded;
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

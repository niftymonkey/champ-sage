import type {
  GameData,
  AramOverrides,
  AugmentSet,
  Champion,
  ChampionAbilities,
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
  fetchAllChampionAbilities,
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
import {
  fetchChampionAbilityScaling,
  type ChampionAbilityScaling,
} from "./sources/wiki-champion-abilities";
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

/**
 * Minimum share of champions that must come out of ingest carrying abilities
 * before the payload is worth persisting. Below this, something structural
 * broke (a dead championFull fetch, or a DDragon id-format change that makes
 * every merge miss), and caching the result would make a transient failure
 * permanent: every later start would read ability-less champions from the
 * cache and never retry until the patch version changed. Degrade for the
 * session and let the next start try again. Mirrors KIWI_MIN_RESOLUTION_RATE:
 * warn and degrade, never fail.
 */
export const ABILITY_MIN_COVERAGE_RATE = 0.9;

/**
 * Minimum share of abilities that must carry wiki-sourced scaling before ingest
 * stops warning. Unlike abilities, low coverage here never blocks the cache
 * write: scaling is an enhancement on top of the ability text, so a wiki outage
 * or a template rework should cost prompts their damage numbers for a session,
 * not cost the app its game data. Warn so the degradation is visible.
 */
export const SCALING_MIN_COVERAGE_RATE = 0.9;

/**
 * Attach wiki-sourced scaling to each champion's spells before the cache write,
 * so it is persisted with the payload rather than resolved lazily.
 *
 * Spells arrive from DDragon in Q/W/E/R order and the wiki is keyed by that
 * slot, so the two are matched positionally. Returns the number of spells that
 * received scaling.
 */
export function mergeAbilityScaling(
  champions: Map<string, Champion>,
  scaling: Map<string, ChampionAbilityScaling>
): number {
  if (scaling.size === 0) return 0;

  const slots = ["Q", "W", "E", "R"] as const;
  let merged = 0;

  for (const [key, champion] of champions) {
    const resolved = scaling.get(key);
    if (!resolved || !champion.abilities) continue;

    // A trusted wiki innate replaces DDragon's numberless passive flavor text.
    // It is prose on the passive, not a scaled spell, so it stays out of the
    // merged count that feeds the scaling-coverage report.
    if (resolved.innate) {
      champion.abilities.passive.description = resolved.innate;
    }

    champion.abilities.spells.forEach((spell, index) => {
      const stats = resolved.slots[slots[index]];
      if (!stats || stats.length === 0) return;
      spell.scaling = stats;
      merged++;
    });
  }

  return merged;
}

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

  // Scaling is keyed by champion name, so its fetch is chained off the champion
  // fetch rather than listed alongside it. Kept inside the same Promise.all so
  // the wiki round-trips still overlap the other sources instead of extending
  // ingest by their full duration.
  const championsPromise = fetchChampions(version);
  const abilityScalingPromise = championsPromise
    .then((champs) =>
      fetchChampionAbilityScaling([...champs.values()].map((c) => c.name))
    )
    .catch((err) => {
      log.warn(
        `Champion ability scaling fetch failed; coaching prompts will omit scaling this session: ${errMessage(err)}`
      );
      return null;
    });

  const [
    champions,
    items,
    runes,
    championAbilities,
    abilityScaling,
    kiwiAugments,
    wikiMayhemAugments,
    arenaAugments,
    aramOverrideMap,
  ] = await Promise.all([
    championsPromise,
    fetchItems(version),
    fetchRunes(version),
    fetchAllChampionAbilities(version).catch((err) => {
      log.warn(
        `Champion abilities fetch failed; coaching prompts will omit abilities this session: ${errMessage(err)}`
      );
      return new Map<string, ChampionAbilities>();
    }),
    abilityScalingPromise,
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
  const abilityCoverage = mergeChampionAbilities(champions, championAbilities);
  reportScalingCoverage(
    champions,
    mergeAbilityScaling(champions, abilityScaling?.byChampion ?? new Map())
  );

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

  // Only persist a payload whose champions actually CARRY abilities. Measured
  // on coverage rather than on the fetch succeeding: a full fetch whose ids no
  // longer match our champions merges nothing, and a fetch-success guard would
  // cache that ability-less payload forever. A handful of stragglers still
  // caches (they are named in the warning above); refusing over one absent
  // champion would refetch the whole catalog on every start.
  const coverageRate =
    champions.size === 0 ? 0 : abilityCoverage / champions.size;
  if (coverageRate >= ABILITY_MIN_COVERAGE_RATE) {
    await writeCache(patchlineCacheKey(patchline), data);
  } else {
    log.warn(
      `Skipping cache write: only ${abilityCoverage}/${champions.size} champions resolved abilities ` +
        `(below ${ABILITY_MIN_COVERAGE_RATE * 100}%). Game data is degraded for this session and will be refetched on next start.`
    );
  }

  const loaded = fromCached(data);
  loaded.metaBuilds = await loadMetaBuilds();
  return loaded;
}

/**
 * Attach ability data to champions before the cache write, so abilities are
 * part of the persisted payload and are present the instant game data loads.
 *
 * Keyed deliberately by DDragon `id` rather than the champion map's key: the
 * map is keyed by lowercase NAME ("aurelion sol") while abilities come back
 * keyed by lowercase ID ("aurelionsol"), so keying by the map key would drop
 * every multi-word champion.
 */
function mergeChampionAbilities(
  champions: Map<string, Champion>,
  abilities: Map<string, ChampionAbilities>
): number {
  if (abilities.size === 0) return 0;

  const missing: string[] = [];
  let merged = 0;
  for (const champion of champions.values()) {
    const resolved = abilities.get(champion.id.toLowerCase());
    if (!resolved) {
      missing.push(champion.name);
      continue;
    }
    champion.abilities = resolved;
    merged++;
  }

  if (missing.length > 0) {
    log.warn(
      `No ability data for ${missing.length} champion(s): ${missing.join(", ")}`
    );
  }
  return merged;
}

/**
 * Warn when wiki-sourced scaling covers noticeably fewer abilities than usual,
 * which is how a template rework or a partial wiki outage announces itself.
 * Never blocks the cache write: see SCALING_MIN_COVERAGE_RATE.
 */
function reportScalingCoverage(
  champions: Map<string, Champion>,
  scaledSpells: number
): void {
  let totalSpells = 0;
  for (const champion of champions.values()) {
    totalSpells += champion.abilities?.spells.length ?? 0;
  }
  if (totalSpells === 0) return;

  const rate = scaledSpells / totalSpells;
  if (rate < SCALING_MIN_COVERAGE_RATE) {
    log.warn(
      `Ability scaling coverage low (${scaledSpells}/${totalSpells} abilities, ` +
        `below ${SCALING_MIN_COVERAGE_RATE * 100}%); coaching prompts will omit scaling for the rest.`
    );
  }
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

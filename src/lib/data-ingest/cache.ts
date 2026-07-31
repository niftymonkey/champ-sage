/**
 * Cache layer for game data. Uses localStorage in the Electron renderer
 * and falls back gracefully if unavailable.
 */

// Bump this version when the cache schema changes to invalidate stale data.
// v12: champion passives now carry the wiki's innate (`/I`) description in
// place of DDragon's numberless flavor text, and abilities carry the parsed
// scaling those profiles are built from. An earlier payload holds the flavor
// text, which reads as valid data, so only a bump replaces it. Numbered above
// v10 rather than reusing this branch's original v8: v10 shipped while this
// work sat uncommitted, and issue #117 holds v11, so a key nobody is using is
// the only safe one to take.
// v10: patch 16.15.1's Jade champion variants overwrote sixty canonical
// champions in the name-keyed map, so a payload written before the variant
// filter holds Jade ids, legacy base stats, and legacy ability kits under
// canonical names. Nothing about the payload's shape reveals this, and the
// version string does not change, so only an explicit bump evicts it. Numbered
// 10 rather than 8 to clear both branches in flight at the time (the
// ability-scaling work sits on 8, issue #117 on 9); when either merges, keep
// the highest number rather than the incoming one.
// v7: items now carry a `maps` field (DDragon map availability) that filters
// the coaching item catalog. A v6 payload has no `maps`, so every item reads
// as available-nowhere and the ARAM/Mayhem catalog empties out. Invalidate it.
// v6: champion abilities now carry wiki-sourced per-rank scaling. A v5 payload
// holds spells with no scaling at all, and nothing would refetch it until the
// patch version changed, so prompts would go a whole patch without damage
// numbers. Invalidate to force one refetch that fills them in.
// v5: champion abilities are now resolved during ingest and persisted with the
// payload. A v4 payload predates that and holds champions with no abilities at
// all, which is precisely the state that kept abilities out of coaching
// prompts, so it must not be served.
// v4: the 26.12 Mayhem rework removed augment sets/traits; a v3 payload still
// holds set data (populated augmentSets + per-augment sets), so invalidate it
// to force one refetch that drops sets from the coaching context.
const CACHE_VERSION = 12;
const CACHE_PREFIX = `champ-sage:v${CACHE_VERSION}:`;

export async function readCache<T>(key: string): Promise<T | null> {
  try {
    const raw = localStorage.getItem(`${CACHE_PREFIX}${key}`);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export async function writeCache<T>(key: string, data: T): Promise<void> {
  try {
    localStorage.setItem(`${CACHE_PREFIX}${key}`, JSON.stringify(data));
  } catch {
    // localStorage may be full or unavailable — silently skip
  }
}

/**
 * Serialize a Map to a plain object for JSON caching.
 */
export function mapToObject<V>(
  map: Map<string | number, V>
): Record<string, V> {
  const obj: Record<string, V> = {};
  for (const [k, v] of map) {
    obj[String(k)] = v;
  }
  return obj;
}

/**
 * Deserialize a plain object back to a Map.
 */
export function objectToMap<K extends string | number, V>(
  obj: Record<string, V>,
  keyType: "string" | "number" = "string"
): Map<K, V> {
  const map = new Map<K, V>();
  for (const [k, v] of Object.entries(obj)) {
    const key = (keyType === "number" ? Number(k) : k) as K;
    map.set(key, v);
  }
  return map;
}

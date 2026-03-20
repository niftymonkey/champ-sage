/**
 * Cache layer for game data. Uses localStorage in the browser (Tauri webview)
 * and falls back gracefully if unavailable.
 */

// Bump this version when the cache schema changes to invalidate stale data
const CACHE_VERSION = 3;
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

import type { Cache } from "swr";

export const CACHE_STORAGE_KEY = "champ-sage:swr-cache:v1";

type CachedState = ReturnType<Cache["get"]>;

/**
 * SWR cache provider that mirrors the in-memory Map to localStorage.
 *
 * Hydrates synchronously on construction so `useSWR` returns cached values
 * on the first render — the whole point of issue #129's instant-cached-render
 * promise. Persists on every `set` / `delete`. Storage failures (corrupt
 * JSON, quota exceeded, storage disabled) degrade silently to in-memory; a
 * cache is allowed to lose its persistence layer.
 */
export function localStorageProvider(): Cache {
  const map = new Map<string, CachedState>();

  try {
    const raw = localStorage.getItem(CACHE_STORAGE_KEY);
    if (raw !== null) {
      const entries = JSON.parse(raw) as Array<[string, unknown]>;
      if (Array.isArray(entries)) {
        for (const entry of entries) {
          if (Array.isArray(entry) && typeof entry[0] === "string") {
            map.set(entry[0], entry[1] as CachedState);
          }
        }
      }
    }
  } catch {
    // Corrupt JSON or storage unavailable — start cold.
  }

  const persist = (): void => {
    try {
      localStorage.setItem(
        CACHE_STORAGE_KEY,
        JSON.stringify([...map.entries()]),
      );
    } catch {
      // Quota exceeded or storage disabled — keep the in-memory copy.
    }
  };

  return {
    get: (key) => map.get(key),
    set: (key, value) => {
      map.set(key, value);
      persist();
    },
    delete: (key) => {
      map.delete(key);
      persist();
    },
    keys: () => map.keys(),
  };
}

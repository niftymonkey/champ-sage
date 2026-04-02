import { useState, useEffect, useCallback, useRef } from "react";
import {
  loadGameData,
  loadCachedGameData,
  checkForNewVersion,
  fetchAndCache,
  type LoadedGameData,
} from "../lib/data-ingest";
import { populateChampionIdMap } from "../lib/data-ingest/champion-id-map";
import { notifications$ } from "../lib/reactive";
import { getLogger } from "../lib/logger";

const dataLog = getLogger("data-ingest");

const JITTER_MAX_MS = 300_000; // 5 minutes in ms

let notificationId = 0;
function notify(level: "info" | "success" | "error", message: string): void {
  notifications$.next({
    id: `data-refresh-${++notificationId}`,
    level,
    message,
    timestamp: Date.now(),
  });
}

export interface UseGameDataResult {
  data: LoadedGameData | null;
  loading: boolean;
  error: string | null;
  refreshState: "idle" | "checking" | "refreshing";
  refresh: (force?: boolean) => void;
}

export function useGameData(): UseGameDataResult {
  const [data, setData] = useState<LoadedGameData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshState, setRefreshState] = useState<
    "idle" | "checking" | "refreshing"
  >("idle");
  const jitterTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const applyData = useCallback((result: LoadedGameData) => {
    populateChampionIdMap(result.champions);
    dataLog.info(
      `Data loaded: ${result.champions.size} champions, ${result.items.size} items, ${result.augments.size} augments (v${result.version})`
    );
    setData(result);
  }, []);

  // Background refresh: check version, fetch if needed (with optional jitter)
  const backgroundRefresh = useCallback(
    async (currentVersion: string, applyJitter: boolean) => {
      setRefreshState("checking");

      try {
        const hasNewVersion = await checkForNewVersion(currentVersion);

        if (!hasNewVersion) {
          if (!applyJitter) {
            // Manual refresh — tell the user
            notify("info", "Data is already up to date");
          }
          setRefreshState("idle");
          return;
        }

        setRefreshState("refreshing");
        notify("info", "Updating game data...");

        const doFetch = async () => {
          try {
            const result = await fetchAndCache();
            applyData(result);
            notify("success", `Updated to patch ${result.version}`);
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            dataLog.error(`Background refresh failed: ${msg}`);
            notify("error", "Update check failed — using cached data");
          } finally {
            setRefreshState("idle");
          }
        };

        if (applyJitter) {
          const delayMs = Math.floor(Math.random() * JITTER_MAX_MS);
          jitterTimerRef.current = setTimeout(doFetch, delayMs);
        } else {
          await doFetch();
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        dataLog.error(`Version check failed: ${msg}`);
        notify("error", "Update check failed — using cached data");
        setRefreshState("idle");
      }
    },
    [applyData]
  );

  // Initial load on mount
  useEffect(() => {
    let cancelled = false;

    async function init() {
      // Dev mode: skip cache, fetch directly (existing behavior)
      if (import.meta.env.DEV) {
        try {
          const result = await loadGameData();
          if (!cancelled) {
            applyData(result);
            setLoading(false);
          }
        } catch (err) {
          if (!cancelled) {
            const msg = err instanceof Error ? err.message : String(err);
            dataLog.error(`Data ingest failed: ${msg}`);
            setError(msg);
            setLoading(false);
          }
        }
        return;
      }

      // Production: cache-first with background version check
      const cached = await loadCachedGameData();

      if (cancelled) return;

      if (cached) {
        // Serve cached data immediately — no loading spinner
        applyData(cached);
        setLoading(false);

        // Background version check with jitter
        backgroundRefresh(cached.version, true);
      } else {
        // Cold cache (first launch): fetch directly, no jitter
        try {
          const result = await fetchAndCache();
          if (!cancelled) {
            applyData(result);
            setLoading(false);
          }
        } catch (err) {
          if (!cancelled) {
            const msg = err instanceof Error ? err.message : String(err);
            dataLog.error(`Data ingest failed: ${msg}`);
            setError(msg);
            setLoading(false);
          }
        }
      }
    }

    init();

    return () => {
      cancelled = true;
      if (jitterTimerRef.current) {
        clearTimeout(jitterTimerRef.current);
      }
    };
  }, [applyData, backgroundRefresh]);

  // Manual refresh: version check without jitter
  // Force mode skips the version check and fetches regardless
  const refresh = useCallback(
    async (force = false) => {
      if (!data) return;
      if (force) {
        setRefreshState("refreshing");
        notify("info", "Force refreshing game data...");
        try {
          const result = await fetchAndCache();
          applyData(result);
          notify("success", `Refreshed to patch ${result.version}`);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          dataLog.error(`Force refresh failed: ${msg}`);
          notify("error", "Force refresh failed — using cached data");
        } finally {
          setRefreshState("idle");
        }
        return;
      }
      backgroundRefresh(data.version, false);
    },
    [data, applyData, backgroundRefresh]
  );

  return { data, loading, error, refreshState, refresh };
}

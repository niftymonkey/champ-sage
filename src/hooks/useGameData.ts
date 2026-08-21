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
import { localStatusRegistry } from "../lib/reactive/streams";
import { getLogger } from "../lib/logger";

const dataLog = getLogger("data-ingest");

const JITTER_MAX_MS = 300_000; // 5 minutes in ms

/**
 * How long a load may run before the app admits it is not going well.
 *
 * A load that never settles used to render "Loading game data..." forever, and
 * a spinner with no end is indistinguishable from one that is working. Long
 * enough that a slow first fetch on a cold cache does not trip it.
 */
export const LOADING_SLOW_MS = 20_000;

/**
 * Dev-only fault injection for the data-failure path.
 *
 * `VITE_` prefixed, unlike its `CS_SIMULATE_*` siblings, because those are read
 * by the main process while this one is read by the renderer, and Vite only
 * exposes `VITE_`-prefixed variables to client code. It also has to be set on
 * the WSL side (`VITE_CS_SIMULATE_DATA_FAIL=1 pnpm dev:electron`), since Vite
 * runs there while the launcher's environment goes to the Windows process.
 */
function simulatedDataFailure(): Error | null {
  if (!import.meta.env.DEV) return null;
  return import.meta.env.VITE_CS_SIMULATE_DATA_FAIL
    ? new Error("VITE_CS_SIMULATE_DATA_FAIL: forced data ingest failure")
    : null;
}

/**
 * Reports the data layer to the status surface.
 *
 * The ingest error screen used to be terminal: no retry, no banner, and since
 * banners lived inside the data-gated subtree, nothing could even be shown next
 * to it. A cold cache plus a CACHE_VERSION bump is a routine patch-day event
 * and it left the app permanently unusable.
 */
function reportSlowLoad(): void {
  localStatusRegistry.set({
    id: "data",
    level: "degraded",
    message:
      "Champ Sage is still loading its game data. This is taking longer than usual.",
  });
}

function reportDataFailure(message: string): void {
  localStatusRegistry.set({
    id: "data",
    level: "broken",
    message:
      "Champ Sage could not load its game data, so coaching is unavailable.",
    detail: message,
    action: "retry",
  });
}

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
  /** Re-runs the initial load after a failure. Unlike `refresh`, works with no data. */
  retry: () => void;
}

export function useGameData(): UseGameDataResult {
  const [data, setData] = useState<LoadedGameData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshState, setRefreshState] = useState<
    "idle" | "checking" | "refreshing"
  >("idle");
  const jitterTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /**
   * Which load attempt is the one that still counts.
   *
   * Every mount and every retry claims the next number, so an older attempt
   * that settles late can tell it has been superseded. Without this, a player
   * who clicks Try again twice and whose slower attempt fails after the faster
   * one succeeded gets the broken banner restored on top of good data. It also
   * stops an in-flight load writing to the shared registry after unmount.
   */
  const attemptRef = useRef(0);
  const startAttempt = useCallback((): (() => boolean) => {
    const attempt = ++attemptRef.current;
    return () => attemptRef.current !== attempt;
  }, []);

  const applyData = useCallback((result: LoadedGameData) => {
    populateChampionIdMap(result.champions);
    // Any successful load clears the banner, including one that arrives from a
    // background refresh long after the failure.
    localStatusRegistry.clear("data");
    setError(null);
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

        const doFetch = async () => {
          setRefreshState("refreshing");
          notify("info", "Updating game data...");
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
          // Return to idle during jitter wait so the button stays enabled
          setRefreshState("idle");
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

  /**
   * The whole initial-load path, extracted so `retry` can run it again.
   *
   * `refresh` cannot serve as the retry: it returns early without `data`, which
   * is exactly the cold-start state a retry exists to escape.
   */
  const load = useCallback(
    async (isCancelled: () => boolean) => {
      // Cleared by both outcomes. A failure that lands before the deadline must
      // not be overwritten at 20s by the weaker "this is slow" message.
      const slowTimer = setTimeout(() => {
        if (!isCancelled()) reportSlowLoad();
      }, LOADING_SLOW_MS);

      const fail = (err: unknown): void => {
        clearTimeout(slowTimer);
        if (isCancelled()) return;
        const msg = err instanceof Error ? err.message : String(err);
        dataLog.error(`Data ingest failed: ${msg}`);
        setError(msg);
        reportDataFailure(msg);
        setLoading(false);
      };

      const succeed = (result: LoadedGameData): void => {
        clearTimeout(slowTimer);
        if (isCancelled()) return;
        applyData(result);
        setLoading(false);
      };

      // Dev mode: skip cache, fetch directly (existing behavior)
      if (import.meta.env.DEV) {
        try {
          const simulated = simulatedDataFailure();
          if (simulated) throw simulated;
          const result = await loadGameData();
          succeed(result);
        } catch (err) {
          fail(err);
        }
        return;
      }

      // Production: cache-first with background version check
      try {
        const cached = await loadCachedGameData();
        if (isCancelled()) return;

        if (cached) {
          // Serve cached data immediately — no loading spinner
          succeed(cached);

          // Background version check with jitter
          backgroundRefresh(cached.version, true);
          return;
        }
      } catch (err) {
        // A cache read that throws is not fatal on its own: the cold-cache
        // fetch below is the same path a first launch takes.
        dataLog.warn(
          `Cache read failed, falling back to a cold fetch: ${err instanceof Error ? err.message : String(err)}`
        );
        if (isCancelled()) {
          clearTimeout(slowTimer);
          return;
        }
      }

      // Cold cache (first launch): fetch directly, no jitter
      try {
        const result = await fetchAndCache();
        succeed(result);
      } catch (err) {
        fail(err);
      }
    },
    [applyData, backgroundRefresh]
  );

  // Initial load on mount
  useEffect(() => {
    void load(startAttempt());

    return () => {
      // Retires whatever attempt is in flight, so nothing that settles after
      // this point reaches React state or the status registry.
      attemptRef.current++;
      if (jitterTimerRef.current) {
        clearTimeout(jitterTimerRef.current);
      }
    };
  }, [load, startAttempt]);

  /**
   * Runs the whole load again after a failure. Wired to the `retry` action on
   * the `data` status banner.
   */
  const retry = useCallback(() => {
    setLoading(true);
    setError(null);
    void load(startAttempt());
  }, [load, startAttempt]);

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

  return { data, loading, error, refreshState, refresh, retry };
}

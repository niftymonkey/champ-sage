import { useCallback, useMemo } from "react";
import useSWR from "swr";
import {
  getMatchHistoryStore,
  MATCH_HISTORY_KEY,
} from "../lib/match-history/runtime";
import {
  recentGames as recentGamesPure,
  windowStats as windowStatsPure,
  type WindowStatsOptions,
} from "../lib/match-history/aggregate";
import type { MatchSummary, WindowStats } from "../lib/match-history/types";

export interface UseMatchHistoryResult {
  matches: MatchSummary[];
  /**
   * True when SWR is fetching in the background. Surfaces drive the
   * existing pulsing-dots affordance from this — appears when the LCU
   * connects after a cold launch and the renderer is re-pulling.
   */
  isValidating: boolean;
  error: Error | null;
  windowStats(options?: { days?: number }): WindowStats;
  recentGames(n: number): MatchSummary[];
}

/**
 * Renderer hook for match history. Backed by SWR with a localStorage
 * cache provider — cached matches render synchronously on first render,
 * trigger-driven `mutate(MATCH_HISTORY_KEY)` calls from the engine layer
 * (LCU connect, gameEnded$) cause background revalidation.
 */
export function useMatchHistory(): UseMatchHistoryResult {
  const store = useMemo(() => getMatchHistoryStore(), []);
  const { data, error, isValidating } = useSWR<MatchSummary[], Error>(
    MATCH_HISTORY_KEY,
    () => store.fetchMatches(),
  );

  const matches = data ?? [];

  const windowStats = useCallback(
    (options: { days?: number } = {}): WindowStats => {
      const opts: WindowStatsOptions = {
        days: options.days,
        now: Date.now(),
      };
      return windowStatsPure(matches, opts);
    },
    [matches],
  );

  const recentGames = useCallback(
    (n: number): MatchSummary[] => recentGamesPure(matches, n),
    [matches],
  );

  return {
    matches,
    isValidating,
    error: error ?? null,
    windowStats,
    recentGames,
  };
}

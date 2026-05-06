import { useCallback, useEffect, useMemo, useState } from "react";
import { getMatchHistoryStore } from "../lib/match-history/runtime";
import {
  recentGames as recentGamesPure,
  windowStats as windowStatsPure,
  type WindowStatsOptions,
} from "../lib/match-history/aggregate";
import type { MatchSummary, WindowStats } from "../lib/match-history/types";

export interface UseMatchHistoryResult {
  matches: MatchSummary[];
  loading: boolean;
  error: Error | null;
  refresh(): void;
  windowStats(options?: { days?: number }): WindowStats;
  recentGames(n: number): MatchSummary[];
}

/**
 * Renderer hook that exposes the singleton match-history store. Returns
 * the current `matches`, error state, a manual `refresh`, and two
 * memoized convenience wrappers around the pure aggregators (so callers
 * don't have to thread `Date.now()` themselves).
 */
export function useMatchHistory(): UseMatchHistoryResult {
  const store = useMemo(() => getMatchHistoryStore(), []);
  const [matches, setMatches] = useState<MatchSummary[]>([]);
  const [error, setError] = useState<Error | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const matchSub = store.matches$.subscribe((next) => {
      setMatches(next);
      setLoading(false);
    });
    const errorSub = store.error$.subscribe((next) => {
      setError(next);
    });
    return () => {
      matchSub.unsubscribe();
      errorSub.unsubscribe();
    };
  }, [store]);

  const windowStats = useCallback(
    (options: { days?: number } = {}): WindowStats => {
      const opts: WindowStatsOptions = {
        days: options.days,
        now: Date.now(),
      };
      return windowStatsPure(matches, opts);
    },
    [matches]
  );

  const recentGames = useCallback(
    (n: number): MatchSummary[] => recentGamesPure(matches, n),
    [matches]
  );

  return {
    matches,
    loading,
    error,
    refresh: useCallback(() => store.refresh(), [store]),
    windowStats,
    recentGames,
  };
}

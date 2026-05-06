import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  DecisionQuery,
  DecisionRecord,
  GameSummary,
} from "../lib/decision-log/types";
import { summarizeGame } from "../lib/decision-log/summarize";

export interface DecisionLogQueryResult {
  records: DecisionRecord[];
  summary: GameSummary;
  loading: boolean;
  error: Error | null;
  refetch: () => void;
}

/**
 * Renderer hook that runs a decision-log query via the main-process IPC
 * bridge and exposes the records along with a derived per-game summary.
 *
 * The summary is computed locally via `summarizeGame` so the renderer
 * pays for derived shape on its own thread (the IPC payload stays a flat
 * record list). Refetch is exposed for explicit re-runs (e.g. after a
 * post-game phase transition fires).
 */
export function useDecisionLogQuery(
  query: DecisionQuery
): DecisionLogQueryResult {
  const [records, setRecords] = useState<DecisionRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const tickRef = useRef(0);

  const memoQuery = useMemo(() => query, [JSON.stringify(query)]);

  const run = useCallback(() => {
    const api = window.electronAPI;
    if (!api?.decisionLogQuery) {
      setRecords([]);
      setLoading(false);
      setError(null);
      return;
    }

    const tick = ++tickRef.current;
    setLoading(true);
    setError(null);

    api
      .decisionLogQuery(memoQuery)
      .then((result) => {
        if (tickRef.current !== tick) return;
        setRecords(Array.isArray(result) ? (result as DecisionRecord[]) : []);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (tickRef.current !== tick) return;
        setError(err instanceof Error ? err : new Error(String(err)));
        setLoading(false);
      });
  }, [memoQuery]);

  useEffect(() => {
    run();
  }, [run]);

  const summary = useMemo(() => summarizeGame(records), [records]);

  return { records, summary, loading, error, refetch: run };
}

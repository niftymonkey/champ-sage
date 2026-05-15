import { useMemo } from "react";
import useSWR from "swr";
import type {
  DecisionQuery,
  DecisionRecord,
  GameSummary,
} from "../lib/decision-log/types";
import { summarizeGame } from "../lib/decision-log/summarize";

export interface DecisionLogQueryResult {
  records: DecisionRecord[];
  summary: GameSummary;
  /**
   * True when SWR is fetching in the background. Surfaces drive the
   * existing pulsing-dots affordance from this — appears when an
   * `onDecisionLogUpdated` IPC event has fired and the renderer is
   * pulling the fresh slice.
   */
  isValidating: boolean;
  error: Error | null;
}

/**
 * Renderer hook for decision-log queries. Backed by SWR with a
 * localStorage cache provider — cached records render synchronously on
 * first render, and `mutate(predicate)` calls fanned out from the
 * `onDecisionLogUpdated` IPC listener (registered once in `<SWRBridge>`)
 * cause background revalidation.
 *
 * Per-hook overrides on top of the global SWRConfig:
 * - `revalidateOnMount: true` — without it, a cold cache stays empty
 *   forever (decision-log has no LCU-connect-style trigger to seed it).
 * - `dedupingInterval: 30 min` — prevents tab-nav remounts from firing
 *   redundant IPC calls. The `mutate(predicate)` invalidation from the
 *   bridge bypasses dedup, so a real upstream change still fetches.
 */
const DEDUPING_INTERVAL_MS = 30 * 60 * 1000;

export function useDecisionLogQuery(
  query: DecisionQuery,
): DecisionLogQueryResult {
  const { data, error, isValidating } = useSWR<DecisionRecord[], Error>(
    ["decision-log", query] as const,
    async ([, q]) => {
      const api = window.electronAPI;
      if (!api?.decisionLogQuery) return [];
      const result = await api.decisionLogQuery(q);
      return Array.isArray(result) ? (result as DecisionRecord[]) : [];
    },
    {
      revalidateOnMount: true,
      dedupingInterval: DEDUPING_INTERVAL_MS,
    },
  );

  const records = data ?? [];
  const summary = useMemo(() => summarizeGame(records), [records]);

  return {
    records,
    summary,
    isValidating,
    error: error ?? null,
  };
}

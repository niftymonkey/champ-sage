import { useMemo } from "react";
import { useLastGameSnapshot } from "./useLastGameSnapshot";
import { useMatchHistory } from "./useMatchHistory";
import { useDecisionLogQuery } from "./useDecisionLogQuery";
import type { TakeawayDecision } from "../lib/decision-log/types";
import type { MatchSummary } from "../lib/match-history/types";
import type { LastGameSnapshot } from "../lib/reactive/coaching-feed-types";
import type { GameResult } from "../lib/game-result";

/**
 * Resolved metadata for the just-finished (or currently-being-viewed)
 * match. Single source of truth for fields like champion / win-loss /
 * KDA / mode / final items so every surface that displays this stuff
 * agrees, instead of each one re-implementing a fallback chain that
 * disagrees on edge cases (e.g. the LCU's `eog-stats-block` returning
 * null and the in-memory snapshot defaulting to a loss).
 *
 * Source priority, highest first:
 *   1. Match-history (server-authoritative; arrives ~seconds after
 *      game-end via the LCU's match-history endpoint).
 *   2. Takeaway record from the decision log (LLM-stamped at game-end
 *      with whatever state we had locally).
 *   3. In-memory `lastGameSnapshot` (captured client-side at game-end
 *      from `eogStats`, which can be null).
 *
 * Each field falls back independently so partial sources still
 * contribute something useful — e.g. match-history landing first
 * supplies result / mode while we wait for the takeaway.
 */
export interface LastGameMeta {
  championName: string | null;
  result: GameResult | null;
  /** Coarse mode label, NOT formatted for display (caller normalises). */
  gameMode: string | null;
  kills: number | null;
  deaths: number | null;
  assists: number | null;
  /** Match length in seconds. */
  duration: number | null;
  finalGold: number | null;
  finalItems: string[];
  largestKillingSpree: number | null;
  /** Riot gameId of the resolved match, when known. */
  gameId: string | null;
}

const LAST_GAME_QUERY = { kind: "last-game" } as const;

/**
 * Hook variant: read the metadata for the most-recently-completed
 * match. Useful for surfaces that always render the latest game
 * (Idle's last-game block, In-game's "ended" banner).
 */
export function useLastGameMeta(): LastGameMeta {
  const snapshot = useLastGameSnapshot();
  const { recentGames } = useMatchHistory();
  const { summary } = useDecisionLogQuery(LAST_GAME_QUERY);

  return useMemo(() => {
    const match = recentGames(1)[0];
    return mergeMeta(match, summary.takeaway, snapshot);
  }, [recentGames, summary.takeaway, snapshot]);
}

/**
 * Pure merge of the three source records into a single LastGameMeta.
 * Exported so post-game (which queries by gameId) can call it with
 * the right slice of state without re-implementing the priority
 * chain. Each field independently picks the highest-priority
 * non-null source.
 */
export function mergeMeta(
  match: MatchSummary | undefined,
  takeaway: TakeawayDecision | null,
  snapshot: LastGameSnapshot | null
): LastGameMeta {
  return {
    gameId: match?.gameId ?? takeaway?.gameId ?? null,
    championName:
      match?.championName ??
      takeaway?.champion ??
      snapshot?.championName ??
      null,
    // TakeawayDecision still carries a boolean `isWin`: a takeaway is
    // only ever written for a coached win/loss game, never a remake, so
    // it can only contribute "win" or "loss" here.
    result:
      match?.result ??
      (takeaway ? (takeaway.isWin ? "win" : "loss") : undefined) ??
      snapshot?.result ??
      null,
    gameMode:
      match?.gameMode ?? takeaway?.gameMode ?? snapshot?.gameMode ?? null,
    kills: match?.kills ?? takeaway?.kills ?? snapshot?.kills ?? null,
    deaths: match?.deaths ?? takeaway?.deaths ?? snapshot?.deaths ?? null,
    assists: match?.assists ?? takeaway?.assists ?? snapshot?.assists ?? null,
    duration:
      match?.durationSeconds ??
      takeaway?.duration ??
      snapshot?.gameTime ??
      null,
    finalGold: takeaway?.finalGold ?? null,
    finalItems:
      match?.finalItems && match.finalItems.length > 0
        ? match.finalItems
        : (takeaway?.finalItems ?? []),
    largestKillingSpree: match?.largestKillingSpree ?? null,
  };
}

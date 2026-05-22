import type { MatchSummary, WindowStats } from "./types";

export interface WindowStatsOptions {
  /** How many days back from `now` to include. Default 7. */
  days?: number;
  /** Reference clock for the window. Tests inject a fixed value. */
  now: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Reduce match history to win/loss/KDA stats over the last N days.
 * Pure: no clock, no fetcher. Caller provides `now` so the result is
 * deterministic (tests pin it; production passes `Date.now()`).
 */
export function windowStats(
  matches: readonly MatchSummary[],
  options: WindowStatsOptions
): WindowStats {
  const days = options.days ?? 7;
  const cutoff = options.now - days * DAY_MS;
  // A remade game is voided: it carries no win/loss record. Drop it
  // before tallying so it never skews the W/L count or the KDA average.
  const inWindow = matches.filter(
    (m) => m.gameCreation >= cutoff && m.result !== "remake"
  );

  if (inWindow.length === 0) {
    return {
      totalGames: 0,
      wins: 0,
      losses: 0,
      avgKDA: 0,
      totalKills: 0,
      totalDeaths: 0,
      totalAssists: 0,
    };
  }

  let wins = 0;
  let totalKills = 0;
  let totalDeaths = 0;
  let totalAssists = 0;
  let kdaSum = 0;

  for (const m of inWindow) {
    if (m.result === "win") wins += 1;
    totalKills += m.kills;
    totalDeaths += m.deaths;
    totalAssists += m.assists;
    kdaSum += (m.kills + m.assists) / Math.max(m.deaths, 1);
  }

  return {
    totalGames: inWindow.length,
    wins,
    losses: inWindow.length - wins,
    avgKDA: kdaSum / inWindow.length,
    totalKills,
    totalDeaths,
    totalAssists,
  };
}

/**
 * Return the most recent N matches in reverse-chronological order
 * (newest first). Does not mutate the input.
 */
export function recentGames(
  matches: readonly MatchSummary[],
  n: number
): MatchSummary[] {
  if (n <= 0) return [];
  return [...matches]
    .sort((a, b) => b.gameCreation - a.gameCreation)
    .slice(0, n);
}

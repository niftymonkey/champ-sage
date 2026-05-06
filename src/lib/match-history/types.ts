/**
 * Stable internal shape for one match in the player's history. The LCU's
 * raw payload is normalized through `parse.ts` into this shape so callers
 * never see Riot's per-version field churn.
 */
export interface MatchSummary {
  /** Riot's gameId — unique across history. */
  gameId: string;
  /** Resolved champion name (via DDragon), e.g. "Lux". */
  championName: string;
  /** Numeric champion id from the match payload (kept for fallback display). */
  championId: number;
  /** Coarse mode label: "ARAM" | "CLASSIC" | "CHERRY" | "PRACTICETOOL" | "OTHER". */
  gameMode: string;
  /** Specific Riot queueId (e.g. 450 = ARAM) — useful when modes alone are coarse. */
  queueId: number;
  /** True iff the player won this match. */
  isWin: boolean;
  kills: number;
  deaths: number;
  assists: number;
  /** Largest killing spree from this match (0 if no spree). */
  largestKillingSpree: number;
  /** Resolved item names from the match's final inventory. Length 0-7. */
  finalItems: string[];
  /** Match length in seconds. */
  durationSeconds: number;
  /** ms-epoch when the match started. */
  gameCreation: number;
}

export interface WindowStats {
  /** Number of matches falling inside the window. */
  totalGames: number;
  wins: number;
  losses: number;
  /** (kills + assists) / max(deaths, 1), averaged across matches. */
  avgKDA: number;
  /** Sum of kills + assists across the window (denominator for KDA). */
  totalKills: number;
  totalDeaths: number;
  totalAssists: number;
}

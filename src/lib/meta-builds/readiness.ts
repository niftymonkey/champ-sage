/**
 * Pure collection-readiness metrics for the meta-build collector.
 *
 * Answers "have we collected enough games per champion to ship?" The convergence
 * study (coverage-analysis.ts) established that the presence-sourced item pool
 * stabilizes at ~200 games per champion, so the collector's stop-criterion is a
 * per-champion game floor, not a global match count. These helpers tally
 * per-champion in-window games and report progress against that target. The
 * collection script owns the clock and terminal I/O and calls these at the
 * boundary, passing the window cutoff explicitly so this layer stays pure.
 */

import { fmtN } from "./progress-format";
import type { MatchData } from "./aggregation";

/**
 * Per-champion game target for the collection stop-criterion. TUNABLE. Set at
 * the convergence bar from the coverage study; the presence pool barely moves
 * beyond it. Rare champions may never reach it in one freshness window, which is
 * why the readiness report names laggards rather than blocking on all of them.
 */
export const COLLECTION_GAME_TARGET = 200;

export interface ChampionGameCount {
  championId: number;
  championName: string;
  games: number;
}

export interface ReadinessReport {
  /** Per-champion game floor this report measures against. */
  target: number;
  /** Distinct champions seen (with at least one in-window game). */
  totalChampions: number;
  /** Champions at or above the target. */
  readyCount: number;
  /** True when every seen champion is at or above the target (and at least one was seen). */
  allReady: boolean;
  /** The champion with the fewest games, or null when none were seen. */
  rarest: ChampionGameCount | null;
  /** Champions below the target, ascending by games then champion id. */
  laggards: ChampionGameCount[];
}

/**
 * Tally per-champion in-window game counts from cached matches. A "game" is one
 * participant appearance; matches older than `cutoffMs` are excluded so the
 * count reflects fresh collection progress, not stale cache.
 */
export function tallyChampionGames(
  matches: MatchData[],
  cutoffMs: number
): ChampionGameCount[] {
  const byChampion = new Map<number, ChampionGameCount>();
  for (const m of matches) {
    if (m.gameEndTimestamp < cutoffMs) continue;
    for (const p of m.participants) {
      const existing = byChampion.get(p.championId);
      if (existing) {
        existing.games += 1;
      } else {
        byChampion.set(p.championId, {
          championId: p.championId,
          championName: p.championName,
          games: 1,
        });
      }
    }
  }
  return [...byChampion.values()];
}

/**
 * Build a readiness report from per-champion counts against a target.
 */
export function buildReadinessReport(
  counts: ChampionGameCount[],
  target: number
): ReadinessReport {
  const totalChampions = counts.length;
  const readyCount = counts.filter((c) => c.games >= target).length;
  const laggards = counts
    .filter((c) => c.games < target)
    .sort((a, b) => a.games - b.games || a.championId - b.championId);
  const rarest = counts.reduce<ChampionGameCount | null>((min, c) => {
    if (!min) return c;
    if (c.games < min.games) return c;
    if (c.games === min.games && c.championId < min.championId) return c;
    return min;
  }, null);
  return {
    target,
    totalChampions,
    readyCount,
    allReady: totalChampions > 0 && readyCount === totalChampions,
    rarest,
    laggards,
  };
}

/**
 * One-line readiness summary for the live progress region, e.g.
 * `readiness · 142/166 champs >=200 games · rarest RekSai 118`.
 */
export function formatReadinessLine(report: ReadinessReport): string {
  const rarest = report.rarest
    ? ` · rarest ${report.rarest.championName} ${fmtN(report.rarest.games)}`
    : "";
  return `  readiness · ${fmtN(report.readyCount)}/${fmtN(
    report.totalChampions
  )} champs >=${fmtN(report.target)} games${rarest}`;
}

/**
 * Multi-line end-of-run readiness report. Names the laggards (champions below
 * target) so the user can decide whether the tail is good enough to stop, since
 * rare champions may never reach the target in a single freshness window.
 */
export function formatReadinessReport(
  report: ReadinessReport,
  maxLaggards = 20
): string[] {
  const lines: string[] = [
    `Readiness: ${fmtN(report.readyCount)}/${fmtN(
      report.totalChampions
    )} champions have >=${fmtN(report.target)} games.`,
  ];
  if (report.allReady) {
    lines.push("  All champions reached the target.");
    return lines;
  }
  const shown = report.laggards.slice(0, maxLaggards);
  lines.push(`  ${fmtN(report.laggards.length)} below target:`);
  for (const c of shown) {
    lines.push(`    ${c.championName}: ${fmtN(c.games)}`);
  }
  if (report.laggards.length > shown.length) {
    lines.push(
      `    ... and ${fmtN(report.laggards.length - shown.length)} more.`
    );
  }
  return lines;
}

/**
 * Coverage study (Phase 1 of the meta-build collection redesign).
 *
 * Reads the cached ARAM match JSONL and answers, empirically, the questions we
 * had been gut-feeling:
 *   1. How many GAMES per champion until the "most-used items" pool is stable?
 *   2. Does that pool need player DIVERSITY, or is ARAM naturally diverse?
 *   3. Given each champion's appearance rate, what coverage is REACHABLE, and
 *      which champs (incl. brand-new ones) are missing or thin vs the full roster?
 *
 * Offline: no Riot API calls. One Data Dragon CDN call fetches the champion
 * roster for the denominator. Pure metrics live in
 * `src/lib/meta-builds/coverage-analysis.ts` (tested); this script is I/O only.
 *
 * Usage:
 *   pnpm analyze-coverage [cacheDir]
 * cacheDir defaults to ./data/meta-builds/.cache; pass another repo's cache to
 * analyze a richer dataset.
 */

import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { resolve } from "node:path";
import {
  mulberry32,
  completedItems,
  convergenceCurve,
  diversityCurve,
  type CoverageParticipant,
  type CurvePoint,
} from "../src/lib/meta-builds/coverage-analysis";

const cacheDir = resolve(process.argv[2] ?? "data/meta-builds/.cache");
const jsonlPath = resolve(cacheDir, "matches-aram", "_data.jsonl");

const RNG_SEED = 42;
const CONV_NS = [10, 20, 40, 80, 160, 320];
const CONV_KS = [6, 12, 18];
const CONV_MIN_GAMES = 2 * CONV_NS[CONV_NS.length - 1]; // ground truth must be >> maxN
const CONV_BOOTSTRAPS = 40;
const DIV_N = 80;
const DIV_MS = [4, 8, 16, 32, 80];
const DIV_K = 12;
const DIV_MIN_GAMES = 200;
const DIV_BOOTSTRAPS = 40;
const REACH_TARGETS = [40, 100, 200, 400];

interface ChampStat {
  championId: number;
  championName: string;
  participants: CoverageParticipant[];
  distinctPlayers: number;
  maxSinglePlayerGames: number;
}

async function loadParticipantsByChampion(): Promise<{
  byChamp: Map<number, ChampStat>;
  totalMatches: number;
}> {
  const byChamp = new Map<number, ChampStat>();
  let totalMatches = 0;

  const rl = createInterface({
    input: createReadStream(jsonlPath, { encoding: "utf-8" }),
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    if (!line.trim()) continue;
    let match: {
      participants?: Array<{
        championId: number;
        championName: string;
        puuid: string;
        items: number[];
      }>;
    };
    try {
      match = JSON.parse(line);
    } catch {
      continue; // partial line from a live-appending writer
    }
    totalMatches++;
    for (const p of match.participants ?? []) {
      // Mirror the pipeline's data eligibility: skip remakes / early surrenders
      // with fewer than 3 completed items. This is NOT the pipeline's
      // clustering/selection (that's the separate, later evaluation).
      if (completedItems(p.items).length < 3) continue;
      let stat = byChamp.get(p.championId);
      if (!stat) {
        stat = {
          championId: p.championId,
          championName: p.championName,
          participants: [],
          distinctPlayers: 0,
          maxSinglePlayerGames: 0,
        };
        byChamp.set(p.championId, stat);
      }
      stat.participants.push({
        championId: p.championId,
        championName: p.championName,
        puuid: p.puuid,
        items: p.items,
      });
    }
  }

  // Per-champ concentration: distinct players + the single busiest player's share.
  for (const stat of byChamp.values()) {
    const perPlayer = new Map<string, number>();
    for (const part of stat.participants) {
      perPlayer.set(part.puuid, (perPlayer.get(part.puuid) ?? 0) + 1);
    }
    stat.distinctPlayers = perPlayer.size;
    stat.maxSinglePlayerGames = Math.max(0, ...perPlayer.values());
  }

  return { byChamp, totalMatches };
}

interface RosterEntry {
  id: number;
  name: string;
}

async function fetchRoster(): Promise<RosterEntry[] | null> {
  try {
    const versions = (await (
      await fetch("https://ddragon.leagueoflegends.com/api/versions.json")
    ).json()) as string[];
    const v = versions[0];
    const data = (await (
      await fetch(
        `https://ddragon.leagueoflegends.com/cdn/${v}/data/en_US/champion.json`
      )
    ).json()) as { data: Record<string, { key: string; name: string }> };
    return Object.values(data.data).map((c) => ({
      id: Number(c.key),
      name: c.name,
    }));
  } catch {
    return null;
  }
}

function fmtCurve(curve: CurvePoint[]): string {
  return curve.map((p) => `N=${p.x}:${p.meanJaccard.toFixed(3)}`).join("  ");
}

/** Smallest N whose mean Jaccard first reaches `threshold`, or null. */
function nAtThreshold(curve: CurvePoint[], threshold: number): number | null {
  for (const p of curve) if (p.meanJaccard >= threshold) return p.x;
  return null;
}

/** Mean over a numeric array (0 for empty). */
function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

/** Average several champions' curves point-by-point (same x grid). */
function averageCurves(curves: CurvePoint[][]): CurvePoint[] {
  if (curves.length === 0) return [];
  const xs = curves[0].map((p) => p.x);
  return xs.map((x, i) => ({
    x,
    meanJaccard: mean(curves.map((c) => c[i]?.meanJaccard ?? 0)),
    samples: curves.reduce((s, c) => s + (c[i]?.samples ?? 0), 0),
  }));
}

async function main() {
  console.log(`\n=== Meta-build Coverage Study ===`);
  console.log(`Cache: ${jsonlPath}\n`);

  const { byChamp, totalMatches } = await loadParticipantsByChampion();
  const champs = [...byChamp.values()];
  console.log(
    `Loaded ${totalMatches.toLocaleString()} ARAM matches; ${champs.length} champions have qualifying games (>=3 items).`
  );

  // --- Roster / completeness ---
  const roster = await fetchRoster();
  if (roster) {
    const haveData = new Set(champs.map((c) => c.championId));
    const missing = roster.filter((r) => !haveData.has(r.id));
    console.log(
      `Roster (Data Dragon): ${roster.length} champions total. With data: ${haveData.size}. Zero games: ${missing.length}.`
    );
    if (missing.length) {
      console.log(
        `  Zero-game champs: ${missing.map((m) => m.name).join(", ")}`
      );
    }
  } else {
    console.log(`Roster fetch failed (offline?); using data-only denominator.`);
  }

  // --- 1. Convergence: how many games until the item pool is stable? ---
  const convCohort = champs.filter(
    (c) => c.participants.length >= CONV_MIN_GAMES
  );
  console.log(
    `\n--- Convergence (top-K item pool stability vs full-data pool) ---`
  );
  console.log(
    `Cohort: ${convCohort.length} champions with >= ${CONV_MIN_GAMES} games.`
  );
  for (const k of CONV_KS) {
    const rng = mulberry32(RNG_SEED);
    const curves = convCohort.map((c) =>
      convergenceCurve(c.participants, CONV_NS, k, CONV_BOOTSTRAPS, rng)
    );
    const avg = averageCurves(curves);
    console.log(`\n  top-${k}:  ${fmtCurve(avg)}`);
    console.log(
      `    N for >=0.90 Jaccard: ${nAtThreshold(avg, 0.9) ?? ">max"}   ` +
        `>=0.95: ${nAtThreshold(avg, 0.95) ?? ">max"}`
    );
  }

  // --- 2. Diversity: does the pool need many distinct players? ---
  console.log(
    `\n--- Diversity (does player concentration change the pool?) ---`
  );
  const concGames = champs.map((c) => c.participants.length);
  const concShares = champs
    .filter((c) => c.participants.length > 0)
    .map((c) => c.maxSinglePlayerGames / c.participants.length);
  const concPlayersPerGame = champs
    .filter((c) => c.participants.length > 0)
    .map((c) => c.distinctPlayers / c.participants.length);
  console.log(
    `  Empirical concentration across ${champs.length} champs:` +
      `\n    median distinct-players / games = ${median(concPlayersPerGame).toFixed(3)} (1.0 = every game a different player)` +
      `\n    median busiest-player share     = ${median(concShares).toFixed(4)}` +
      `\n    max busiest-player share        = ${Math.max(...concShares).toFixed(4)} (over ${Math.max(...concGames)} games)`
  );
  const divCohort = champs.filter(
    (c) => c.participants.length >= DIV_MIN_GAMES && c.distinctPlayers >= DIV_N
  );
  const rngD = mulberry32(RNG_SEED);
  const divCurves = divCohort.map((c) =>
    diversityCurve(c.participants, DIV_N, DIV_MS, DIV_K, DIV_BOOTSTRAPS, rngD)
  );
  const divAvg = averageCurves(divCurves);
  console.log(
    `  m-sweep at N=${DIV_N}, top-${DIV_K}, cohort=${divCohort.length} champs (m = distinct players supplying the ${DIV_N} games):`
  );
  for (const p of divAvg) {
    console.log(
      `    m=${p.x}: jaccard=${p.meanJaccard.toFixed(3)}  (feasible draws: ${p.samples})`
    );
  }

  // --- 3. Reachability: who is covered, who is thin, what would it take? ---
  console.log(
    `\n--- Reachability (per-champ, current ${totalMatches.toLocaleString()} matches) ---`
  );
  for (const target of REACH_TARGETS) {
    const at = champs.filter((c) => c.participants.length >= target).length;
    console.log(`  champs with >= ${target} games: ${at} / ${champs.length}`);
  }
  const rarest = [...champs]
    .sort((a, b) => a.participants.length - b.participants.length)
    .slice(0, 15);
  console.log(
    `\n  15 thinnest champs (games | distinct players | matches to reach 200):`
  );
  for (const c of rarest) {
    const rate = c.participants.length / totalMatches;
    const matchesFor200 = rate > 0 ? Math.round(200 / rate) : Infinity;
    console.log(
      `    ${c.championName.padEnd(14)} ${String(c.participants.length).padStart(5)} games | ` +
        `${String(c.distinctPlayers).padStart(5)} players | ~${matchesFor200.toLocaleString()} matches`
    );
  }
  console.log(`\n=== Done ===\n`);
}

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});

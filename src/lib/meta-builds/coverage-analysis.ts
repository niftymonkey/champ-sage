/**
 * Pure metrics for the meta-build COVERAGE study (Phase 1 of the collection
 * redesign). Side-effect free: no network, no filesystem, no clock, no
 * `Math.random`. The script `scripts/analyze-coverage.ts` owns I/O and passes a
 * seeded RNG in at the boundary so every result is reproducible.
 *
 * The study answers, empirically, three questions that were previously gut-feel:
 *   1. How many games per champion until the "most-used items" pool is stable?
 *      (convergenceCurve)
 *   2. Does that pool need player DIVERSITY, not just game count, to be trusted?
 *      (diversityCurve)
 *   3. Given each champion's appearance rate, what is reachable? (reachability is
 *      computed in the script from per-champion appearance rates.)
 *
 * It deliberately measures the RAW item-usage signal (which items a champion
 * actually builds, by presence rate), independent of the current
 * clustering/filtering pipeline in aggregation.ts. Whether that pipeline aligns
 * with these findings is a SEPARATE, later piece of work, kept apart on purpose.
 */

/** Minimal participant shape the study needs (from cached MatchData). */
export interface CoverageParticipant {
  championId: number;
  championName: string;
  puuid: string;
  /** item0..item6 as stored; slots 0-5 are real items, 6 is the trinket. */
  items: number[];
}

/** One point on a convergence/diversity curve. */
export interface CurvePoint {
  /** Sample size (convergence) or distinct-player count (diversity). */
  x: number;
  /** Mean top-K Jaccard vs the champion's full-data pool, 0..1. */
  meanJaccard: number;
  /** Number of bootstrap draws that contributed (diversity draws can fail). */
  samples: number;
}

/**
 * Deterministic PRNG (mulberry32). A seed yields a fixed, repeatable sequence so
 * the whole study is reproducible run-to-run. Returns floats in [0, 1).
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Real (non-zero, non-trinket) items from slots 0-5, deduped, ascending. */
export function completedItems(items: number[]): number[] {
  const set = new Set<number>();
  for (let i = 0; i < 6; i++) {
    const id = items[i];
    if (id != null && id > 0) set.add(id);
  }
  return [...set].sort((a, b) => a - b);
}

/** Count, per item id, how many participants built it (slots 0-5). */
export function itemPresence(
  participants: CoverageParticipant[]
): Map<number, number> {
  const counts = new Map<number, number>();
  for (const part of participants) {
    for (const id of completedItems(part.items)) {
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
  }
  return counts;
}

/**
 * The top-K item ids for a set of participants, by presence count descending,
 * ties broken by item id ascending (deterministic). Fewer than K returns all.
 */
export function topKItems(
  participants: CoverageParticipant[],
  k: number
): number[] {
  return [...itemPresence(participants).entries()]
    .sort((a, b) => b[1] - a[1] || a[0] - b[0])
    .slice(0, k)
    .map(([id]) => id);
}

/** Jaccard similarity of two id lists treated as sets. Two empties are 1. */
export function jaccard(a: number[], b: number[]): number {
  const sa = new Set(a);
  const sb = new Set(b);
  if (sa.size === 0 && sb.size === 0) return 1;
  let inter = 0;
  for (const x of sa) if (sb.has(x)) inter++;
  const union = sa.size + sb.size - inter;
  return union === 0 ? 1 : inter / union;
}

/** Deterministic size-n sample without replacement, driven by `rand`. */
export function subsample<T>(arr: T[], n: number, rand: () => number): T[] {
  const copy = arr.slice();
  const count = Math.min(n, copy.length);
  // Partial Fisher-Yates: only the first `count` slots need to be settled.
  for (let i = 0; i < count; i++) {
    const j = i + Math.floor(rand() * (copy.length - i));
    const tmp = copy[i];
    copy[i] = copy[j];
    copy[j] = tmp;
  }
  return copy.slice(0, count);
}

/**
 * Draw exactly `n` games spread across exactly `m` distinct players, round-robin
 * so the sample is as evenly split as possible. Returns null when m random
 * players cannot supply n games (the caller counts the skip). Internal helper
 * for diversityCurve.
 */
function drawFromMPlayers(
  byPlayer: Map<string, CoverageParticipant[]>,
  players: string[],
  n: number,
  m: number,
  rand: () => number
): CoverageParticipant[] | null {
  if (m > players.length) return null;
  const chosen = subsample(players, m, rand);
  const pools = chosen.map((id) => {
    const games = byPlayer.get(id) ?? [];
    return subsample(games, games.length, rand); // shuffle each player's games
  });
  const total = pools.reduce((s, pool) => s + pool.length, 0);
  if (total < n) return null;

  const draw: CoverageParticipant[] = [];
  const idx = new Array<number>(m).fill(0);
  let progressed = true;
  while (draw.length < n && progressed) {
    progressed = false;
    for (let i = 0; i < m && draw.length < n; i++) {
      if (idx[i] < pools[i].length) {
        draw.push(pools[i][idx[i]++]);
        progressed = true;
      }
    }
  }
  return draw.length === n ? draw : null;
}

/**
 * Convergence curve: for each N in `ns`, draw `bootstraps` random size-N samples,
 * compute their top-K pool, and average the Jaccard against the FULL-data top-K
 * pool (the ground truth). Ns larger than the population are skipped.
 */
export function convergenceCurve(
  participants: CoverageParticipant[],
  ns: number[],
  k: number,
  bootstraps: number,
  rand: () => number
): CurvePoint[] {
  const truth = topKItems(participants, k);
  const out: CurvePoint[] = [];
  for (const n of ns) {
    if (n > participants.length) continue;
    let sum = 0;
    for (let b = 0; b < bootstraps; b++) {
      sum += jaccard(topKItems(subsample(participants, n, rand), k), truth);
    }
    out.push({
      x: n,
      meanJaccard: bootstraps > 0 ? sum / bootstraps : 0,
      samples: bootstraps,
    });
  }
  return out;
}

/**
 * Diversity curve: hold the sample size at `n`, but force those n games to come
 * from exactly `m` distinct players (round-robin), for each m in `ms`. Averages
 * top-K Jaccard vs full-data ground truth over `bootstraps` draws. A draw whose
 * randomly chosen m players cannot supply n games is skipped (counted in
 * `samples`). This isolates the effect of player concentration at fixed volume.
 */
export function diversityCurve(
  participants: CoverageParticipant[],
  n: number,
  ms: number[],
  k: number,
  bootstraps: number,
  rand: () => number
): CurvePoint[] {
  const truth = topKItems(participants, k);
  const byPlayer = new Map<string, CoverageParticipant[]>();
  for (const part of participants) {
    const arr = byPlayer.get(part.puuid) ?? [];
    arr.push(part);
    byPlayer.set(part.puuid, arr);
  }
  const players = [...byPlayer.keys()];

  const out: CurvePoint[] = [];
  for (const m of ms) {
    let sum = 0;
    let ok = 0;
    for (let b = 0; b < bootstraps; b++) {
      const draw = drawFromMPlayers(byPlayer, players, n, m, rand);
      if (!draw) continue;
      sum += jaccard(topKItems(draw, k), truth);
      ok++;
    }
    out.push({ x: m, meanJaccard: ok > 0 ? sum / ok : 0, samples: ok });
  }
  return out;
}

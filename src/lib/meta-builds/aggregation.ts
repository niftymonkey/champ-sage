/**
 * Pure aggregation and selection logic for the meta-build data pipeline.
 *
 * Side-effect free: no network, no filesystem, no `Date.now()` reads. Every
 * function that needs the current time takes it as an explicit `nowMs`
 * parameter so tests are deterministic. The collection script in
 * `scripts/fetch-meta-builds.ts` owns the I/O loops and passes `Date.now()`
 * at the boundary, importing these helpers and types.
 *
 * Freshness model: Match-v5 has no patch filter, so recency is expressed by
 * DATE (a match's `gameEndTimestamp`), not by patch string. Collection captures
 * one wide fixed window every run; this ladder of date windows
 * ([7, 14, 30, 60] days, narrowest first) is then applied at SELECTION time to
 * pick how far back to build each champion from.
 */

/**
 * The ladder of freshness windows in days, narrowest first. Applied at
 * SELECTION time only (per-champion backfill); collection uses one fixed wide
 * window owned by the collection script.
 */
export const FRESHNESS_LADDER_DAYS: readonly number[] = [7, 14, 30, 60];

/** Per-champion participant target for selection backfill. */
export const CHAMPION_PARTICIPANT_TARGET = 40;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** The subset of match data we persist per participant. */
export interface ParticipantData {
  puuid: string;
  championId: number;
  championName: string;
  win: boolean;
  items: number[]; // item0-item6
  perks: {
    statPerks: { defense: number; flex: number; offense: number };
    styles: Array<{
      description: string;
      style: number;
      selections: Array<{ perk: number }>;
    }>;
  };
  teamPosition: string;
  augments: number[]; // playerAugment1-4
  /**
   * The two summoner spells the player ran, as Riot spell IDs (e.g. 4 = Flash,
   * 6 = Ghost). Order is not meaningful: Riot's summoner1Id/summoner2Id reflect
   * client slot assignment (D vs F keybind), not a canonical pairing, so this is
   * stored as the raw pair and normalized (sorted) at aggregation time. Empty
   * for matches cached before this field existed.
   */
  summonerSpells: number[];
}

export interface MatchData {
  matchId: string;
  queueId: number;
  gameVersion: string;
  gameDuration: number;
  /**
   * Match end time in MILLISECONDS (Riot's `info.gameEndTimestamp`). The
   * collection API's `startTime` param is in SECONDS; keep the units straight.
   * Old cached matches predating this field load as 0 (oldest possible), which
   * correctly excludes them from every recent window.
   */
  gameEndTimestamp: number;
  participants: ParticipantData[];
}

export interface BuildEntry {
  items: number[];
  runes: ParticipantData["perks"];
  wins: number;
  games: number;
}

export interface ChampionBuilds {
  championName: string;
  sampleSize: number;
  builds: Array<{
    items: number[];
    perks: ParticipantData["perks"];
    winRate: number;
    pickRate: number;
    games: number;
  }>;
  /**
   * Fraction of this champion's USED participants whose match gameVersion
   * major.minor equals the target patch. 0..1.
   */
  freshPatchShare: number;
  /** Which ladder window (in days) this champion's participants were drawn from. */
  windowDaysUsed: number;
  popularAugments?: Array<{
    augmentId: number;
    picks: number;
    wins: number;
    pickRate: number;
    winRate: number;
  }>;
  /**
   * Most-run summoner-spell pairs for this champion, most-picked first. Each
   * entry's `spells` is the normalized (ascending) ID pair, mirroring how build
   * sites present spells as a combo (e.g. Flash + Ghost) rather than two
   * independent slots. Omitted when no participant carried a complete pair.
   */
  popularSpells?: Array<{
    spells: number[];
    picks: number;
    wins: number;
    pickRate: number;
    winRate: number;
  }>;
}

export interface MetaBuildOutput {
  /** Newest major.minor from Data Dragon versions.json. Leads the output. */
  targetPatch: string;
  /** Fraction of all used participants on the target patch. 0..1. */
  freshPatchShare: number;
  /** Kept equal to targetPatch so existing consumers do not break. */
  patch: string;
  region: string;
  queueId: number;
  queueName: string;
  collectedAt: string;
  champions: Record<string, ChampionBuilds>;
}

/** Queue metadata passed in from the script's QUEUES const. */
export interface QueueMeta {
  id: number;
  name: string;
}

/**
 * A participant paired with its match-level freshness fields, so selection can
 * walk the date ladder without re-joining back to the match.
 */
export interface WindowedParticipant {
  participant: ParticipantData;
  gameEndTimestamp: number;
  gameVersion: string;
}

export function extractMatchData(
  matchId: string,
  raw: Record<string, unknown>
): MatchData | null {
  const info = raw.info as Record<string, unknown> | undefined;
  if (!info) return null;

  const participants =
    (info.participants as Array<Record<string, unknown>>) ?? [];

  return {
    matchId,
    queueId: info.queueId as number,
    gameVersion: info.gameVersion as string,
    gameDuration: info.gameDuration as number,
    // Riot's gameEndTimestamp is in MILLISECONDS. Older cached matches lack
    // this field; default to 0 (oldest possible) so they fall outside every
    // recent window. That is correct: those matches are genuinely old.
    gameEndTimestamp: (info.gameEndTimestamp as number | undefined) ?? 0,
    participants: participants.map((p) => ({
      puuid: p.puuid as string,
      championId: p.championId as number,
      championName: p.championName as string,
      win: p.win as boolean,
      items: [
        p.item0 as number,
        p.item1 as number,
        p.item2 as number,
        p.item3 as number,
        p.item4 as number,
        p.item5 as number,
        p.item6 as number,
      ],
      perks: p.perks as ParticipantData["perks"],
      teamPosition: (p.teamPosition as string) ?? "",
      augments: [
        p.playerAugment1 as number,
        p.playerAugment2 as number,
        p.playerAugment3 as number,
        p.playerAugment4 as number,
      ].filter((a) => a != null && a > 0),
      summonerSpells: [p.summoner1Id as number, p.summoner2Id as number].filter(
        (s) => s != null && s > 0
      ),
    })),
  };
}

/** The major.minor prefix of a gameVersion ("16.12.123.456" -> "16.12"). */
function majorMinor(gameVersion: string): string {
  return gameVersion.split(".").slice(0, 2).join(".");
}

/**
 * Count matches whose gameEndTimestamp is at or after the cutoff (epoch ms).
 * Matches with a missing/zero timestamp are excluded (they are genuinely old).
 */
export function countMatchesInWindow(
  matches: MatchData[],
  sinceEpochMs: number
): number {
  let count = 0;
  for (const m of matches) {
    if (m.gameEndTimestamp >= sinceEpochMs) count++;
  }
  return count;
}

/**
 * The match IDs of the `n` most recent in-window matches (newest first). Used
 * after an API-key change to pick which cached matches to re-fetch purely to
 * recover their participants' new-key PUUIDs, re-seeding the snowball frontier
 * the key change purged. Matches with a missing/zero timestamp are excluded.
 */
export function selectRecentInWindowMatchIds(
  matches: MatchData[],
  sinceEpochMs: number,
  n: number
): string[] {
  return matches
    .filter((m) => m.gameEndTimestamp >= sinceEpochMs)
    .sort((a, b) => b.gameEndTimestamp - a.gameEndTimestamp)
    .slice(0, n)
    .map((m) => m.matchId);
}

export interface SelectedParticipants {
  participants: ParticipantData[];
  windowDaysUsed: number;
}

/**
 * Walk the date ladder newest-first, accumulating a champion's participants
 * from matches within `now - windowDays`, stopping when `k` participants are
 * collected or the ladder is exhausted (then use all available at the widest
 * window). Records which window (in days) was used.
 */
interface ResolvedWindow {
  used: WindowedParticipant[];
  windowDaysUsed: number;
}

/**
 * Shared ladder walk used by both selectChampionParticipants (public, tested
 * contract) and aggregateBuilds (which also needs each used participant's
 * gameVersion for freshPatchShare). Single source of truth so the two cannot
 * drift.
 */
function resolveWindow(
  participants: WindowedParticipant[],
  ladderDays: readonly number[],
  nowMs: number,
  k: number
): ResolvedWindow {
  for (const windowDays of ladderDays) {
    const cutoff = nowMs - windowDays * MS_PER_DAY;
    const eligible = participants.filter((wp) => wp.gameEndTimestamp >= cutoff);
    if (eligible.length >= k) {
      return { used: eligible, windowDaysUsed: windowDays };
    }
  }

  // Ladder exhausted without reaching k: use every available participant,
  // attributed to the widest window. Participants older than the widest rung
  // are still included here, since there is nothing fresher to prefer.
  const widest = ladderDays.length > 0 ? ladderDays[ladderDays.length - 1] : 0;
  return { used: participants, windowDaysUsed: widest };
}

export function selectChampionParticipants(
  participants: WindowedParticipant[],
  ladderDays: readonly number[],
  nowMs: number,
  k: number
): SelectedParticipants {
  const { used, windowDaysUsed } = resolveWindow(
    participants,
    ladderDays,
    nowMs,
    k
  );
  return {
    participants: used.map((wp) => wp.participant),
    windowDaysUsed,
  };
}

/**
 * Fraction of used participants whose match gameVersion major.minor equals
 * the target patch. gameVersion like "16.12.123.456" matches "16.12" on the
 * first two dot-separated segments. Returns 0 for an empty set.
 */
export function computeFreshShare(
  usedParticipants: WindowedParticipant[],
  targetPatch: string
): number {
  if (usedParticipants.length === 0) return 0;
  let fresh = 0;
  for (const wp of usedParticipants) {
    if (majorMinor(wp.gameVersion) === targetPatch) fresh++;
  }
  return fresh / usedParticipants.length;
}

/**
 * Normalized key for an item build: sorted real-item IDs (slots 0-5),
 * excluding zeros and the trinket slot (6). Identical item sets cluster.
 */
function buildKey(items: number[]): string {
  return items
    .slice(0, 6)
    .filter((id) => id > 0)
    .sort((a, b) => a - b)
    .join(",");
}

/**
 * Aggregate per-champion item builds using per-champion date-window backfill.
 * `recentPatches[0]` (newest from Data Dragon) is the target patch. `nowMs`
 * and `ladderDays` are explicit for deterministic tests.
 *
 * For each champion independently, the date ladder is walked newest-first
 * until the champion has K participants (or the ladder is exhausted), so a
 * popular champion is built from the freshest games while a rare one backfills
 * to a wider window rather than vanishing. Everything downstream of selection
 * (clustering, the >=2-games and >=0.45-winrate filters, augment stats,
 * top-10) is unchanged.
 */
export function aggregateBuilds(
  matches: MatchData[],
  queue: QueueMeta,
  recentPatches: string[],
  nowMs: number,
  ladderDays: readonly number[] = FRESHNESS_LADDER_DAYS
): MetaBuildOutput {
  const targetPatch = recentPatches[0] ?? "unknown";

  // Group participants by champion, pairing each with its match-level
  // freshness fields. Participants with fewer than 3 completed items (remakes,
  // early surrenders) are excluded here, matching the prior behavior.
  const byChampion = new Map<number, WindowedParticipant[]>();
  for (const match of matches) {
    for (const p of match.participants) {
      const completedItems = p.items.slice(0, 6).filter((id) => id > 0).length;
      if (completedItems < 3) continue;

      const existing = byChampion.get(p.championId) ?? [];
      existing.push({
        participant: p,
        gameEndTimestamp: match.gameEndTimestamp,
        gameVersion: match.gameVersion,
      });
      byChampion.set(p.championId, existing);
    }
  }

  const champions: Record<string, ChampionBuilds> = {};
  const allUsed: WindowedParticipant[] = [];

  for (const [championId, windowed] of byChampion) {
    // Per-champion date-window backfill to K participants.
    const { used: usedWindowed, windowDaysUsed } = resolveWindow(
      windowed,
      ladderDays,
      nowMs,
      CHAMPION_PARTICIPANT_TARGET
    );
    const participants = usedWindowed.map((wp) => wp.participant);

    // Cluster by item build only (runes excluded because they fragment
    // clusters: a single stat shard difference produces a separate cluster).
    const clusters = new Map<string, BuildEntry>();
    for (const p of participants) {
      const key = buildKey(p.items);
      const existing = clusters.get(key);
      if (existing) {
        existing.wins += p.win ? 1 : 0;
        existing.games += 1;
      } else {
        clusters.set(key, {
          items: p.items
            .slice(0, 6)
            .filter((id) => id > 0)
            .sort((a, b) => a - b),
          runes: p.perks,
          wins: p.win ? 1 : 0,
          games: 1,
        });
      }
    }

    // >=2 games trims noise; >=0.45 win rate drops genuinely losing builds
    // while giving small samples benefit of the doubt. Sort by popularity, not
    // win rate (win-rate sorting on small samples is mostly noise). Top 10.
    const sorted = [...clusters.values()]
      .filter((c) => {
        if (c.games < 2) return false;
        const winRate = c.wins / c.games;
        return winRate >= 0.45;
      })
      .sort((a, b) => b.games - a.games)
      .slice(0, 10);

    if (sorted.length === 0) continue;

    const champName = participants[0].championName;
    const totalGames = participants.length;

    const augmentStats = new Map<number, { picks: number; wins: number }>();
    for (const p of participants) {
      for (const augId of p.augments) {
        const existing = augmentStats.get(augId) ?? { picks: 0, wins: 0 };
        existing.picks += 1;
        if (p.win) existing.wins += 1;
        augmentStats.set(augId, existing);
      }
    }
    const popularAugments = [...augmentStats.entries()]
      .sort((a, b) => b[1].picks - a[1].picks)
      .map(([augmentId, stats]) => ({
        augmentId,
        picks: stats.picks,
        wins: stats.wins,
        pickRate: totalGames > 0 ? stats.picks / totalGames : 0,
        winRate: stats.picks > 0 ? stats.wins / stats.picks : 0,
      }));

    // Most-run summoner-spell pairs. The pair is the meaningful unit (build
    // sites present spells as a combo like Flash + Ghost), and Riot's
    // summoner1Id/summoner2Id order only reflects client slot assignment, so
    // each pair is normalized ascending before clustering. Participants without
    // a complete pair (matches cached before this field existed, remakes) carry
    // an empty/short array and are skipped.
    const spellStats = new Map<
      string,
      { spells: number[]; picks: number; wins: number }
    >();
    for (const p of participants) {
      const spells = p.summonerSpells ?? [];
      if (spells.length !== 2) continue;
      const pair = [...spells].sort((a, b) => a - b);
      const key = pair.join(",");
      const existing = spellStats.get(key) ?? {
        spells: pair,
        picks: 0,
        wins: 0,
      };
      existing.picks += 1;
      if (p.win) existing.wins += 1;
      spellStats.set(key, existing);
    }
    const popularSpells = [...spellStats.values()]
      .sort((a, b) => b.picks - a.picks)
      .map((s) => ({
        spells: s.spells,
        picks: s.picks,
        wins: s.wins,
        pickRate: totalGames > 0 ? s.picks / totalGames : 0,
        winRate: s.picks > 0 ? s.wins / s.picks : 0,
      }));

    for (const wp of usedWindowed) allUsed.push(wp);

    champions[String(championId)] = {
      championName: champName,
      sampleSize: totalGames,
      freshPatchShare: computeFreshShare(usedWindowed, targetPatch),
      windowDaysUsed,
      builds: sorted.map((b) => ({
        items: b.items,
        perks: b.runes,
        winRate: b.games > 0 ? b.wins / b.games : 0,
        pickRate: totalGames > 0 ? b.games / totalGames : 0,
        games: b.games,
      })),
      ...(popularAugments.length > 0 ? { popularAugments } : {}),
      ...(popularSpells.length > 0 ? { popularSpells } : {}),
    };
  }

  return {
    targetPatch,
    freshPatchShare: computeFreshShare(allUsed, targetPatch),
    patch: targetPatch,
    region: "na1",
    queueId: queue.id,
    queueName: queue.name,
    collectedAt: new Date(nowMs).toISOString(),
    champions,
  };
}

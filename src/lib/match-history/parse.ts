import type { MatchSummary } from "./types";

/**
 * Subset of the LCU /lol-match-history match payload we read. The real
 * payload has dozens of fields per game; this captures only what the
 * MatchSummary interface needs. Anything missing or malformed is treated
 * as a parse failure (returns null) so the caller can drop the game
 * without polluting downstream stats.
 */
interface LcuMatchParticipant {
  championId?: number;
  stats?: {
    win?: boolean;
    kills?: number;
    deaths?: number;
    assists?: number;
    largestKillingSpree?: number;
  };
}

interface LcuMatchRaw {
  gameId?: number | string;
  gameMode?: string;
  queueId?: number;
  gameDuration?: number;
  gameCreation?: number;
  participants?: LcuMatchParticipant[];
}

/**
 * Champion-id-to-name resolver. The renderer holds DDragon data in
 * `gameData.champions` keyed by lowercase name; the LCU payload only
 * carries the numeric `championId`. This callback wraps that lookup so
 * the parser stays decoupled from how DDragon is shaped.
 */
export type ChampionNameResolver = (championId: number) => string | null;

/**
 * Convert one LCU match-history entry to a stable MatchSummary. Returns
 * null when required fields are missing or the participant array is
 * empty — the caller should silently skip those rather than render
 * placeholder rows.
 */
export function lcuMatchToSummary(
  raw: unknown,
  resolveChampionName: ChampionNameResolver
): MatchSummary | null {
  if (!isObject(raw)) return null;
  const r = raw as LcuMatchRaw;

  const gameId = r.gameId !== undefined ? String(r.gameId) : null;
  const gameCreation =
    typeof r.gameCreation === "number" ? r.gameCreation : null;
  const durationSeconds =
    typeof r.gameDuration === "number" ? r.gameDuration : null;
  const queueId = typeof r.queueId === "number" ? r.queueId : null;
  const participant = Array.isArray(r.participants) ? r.participants[0] : null;
  const championId =
    typeof participant?.championId === "number" ? participant.championId : null;
  const stats = participant?.stats;

  if (
    !gameId ||
    gameCreation === null ||
    durationSeconds === null ||
    queueId === null ||
    championId === null ||
    !stats
  ) {
    return null;
  }

  const championName =
    resolveChampionName(championId) ?? `Champion ${championId}`;
  const gameMode = normalizeGameMode(r.gameMode, queueId);

  return {
    gameId,
    championName,
    championId,
    gameMode,
    queueId,
    isWin: stats.win === true,
    kills: typeof stats.kills === "number" ? stats.kills : 0,
    deaths: typeof stats.deaths === "number" ? stats.deaths : 0,
    assists: typeof stats.assists === "number" ? stats.assists : 0,
    largestKillingSpree:
      typeof stats.largestKillingSpree === "number"
        ? stats.largestKillingSpree
        : 0,
    durationSeconds,
    gameCreation,
  };
}

/**
 * Map LCU's gameMode string + queueId to the coarse modes the rest of
 * the renderer talks in. Falls back to "OTHER" rather than throwing so
 * one weird match doesn't break the history list.
 *
 * Mayhem in particular reports `gameMode: "KIWI"` from the LCU rather
 * than ARAM — see `src/lib/mode/types.ts` for the GAME_MODE_MAYHEM
 * constant. Without this branch, every Mayhem match in the history
 * list would render as "OTHER".
 */
function normalizeGameMode(
  raw: string | undefined,
  queueId: number
): "ARAM" | "MAYHEM" | "CLASSIC" | "CHERRY" | "PRACTICETOOL" | "OTHER" {
  const upper = raw?.toUpperCase() ?? "";
  if (upper === "ARAM") return "ARAM";
  if (upper === "KIWI") return "MAYHEM";
  if (upper === "CLASSIC") return "CLASSIC";
  if (upper === "CHERRY") return "CHERRY";
  if (upper === "PRACTICETOOL") return "PRACTICETOOL";
  // queueId fallback for cases where gameMode is missing or unfamiliar.
  if (queueId === 450) return "ARAM";
  if (queueId === 1700 || queueId === 1710) return "CHERRY";
  if (queueId === 0) return "PRACTICETOOL";
  return "OTHER";
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

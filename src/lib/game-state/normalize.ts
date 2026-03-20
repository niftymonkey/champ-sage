import type {
  GameState,
  ActivePlayer,
  ActivePlayerRunes,
  ActivePlayerStats,
  PlayerInfo,
  PlayerItem,
} from "./types";

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Normalize a raw Riot Live Client Data API response into our GameState shape.
 * The raw response structure is documented at:
 * https://developer.riotgames.com/docs/lol#game-client-api
 */
export function normalizeGameState(raw: any): GameState {
  const activePlayerRaw = raw.activePlayer;
  const allPlayersRaw: any[] = raw.allPlayers ?? [];
  const gameDataRaw = raw.gameData;

  const activeRiotId: string = activePlayerRaw?.riotIdGameName ?? "";
  const activePlayerMatch = allPlayersRaw.find(
    (p) => p.riotIdGameName === activeRiotId
  );

  const activePlayer: ActivePlayer | null = activePlayerRaw
    ? {
        championName: activePlayerMatch?.championName ?? "",
        level: activePlayerRaw.level ?? 0,
        currentGold: activePlayerRaw.currentGold ?? 0,
        runes: normalizeRunes(activePlayerRaw.fullRunes),
        stats: normalizeStats(activePlayerRaw.championStats),
      }
    : null;

  const players: PlayerInfo[] = allPlayersRaw.map((p) =>
    normalizePlayer(p, activeRiotId)
  );

  return {
    status: "connected",
    activePlayer,
    players,
    gameMode: gameDataRaw?.gameMode ?? "",
    gameTime: gameDataRaw?.gameTime ?? 0,
  };
}

function normalizeRunes(raw: any): ActivePlayerRunes {
  return {
    keystone: raw?.keystone?.displayName ?? "",
    primaryTree: raw?.primaryRuneTree?.displayName ?? "",
    secondaryTree: raw?.secondaryRuneTree?.displayName ?? "",
  };
}

function normalizeStats(raw: any): ActivePlayerStats {
  return {
    abilityPower: raw?.abilityPower ?? 0,
    armor: raw?.armor ?? 0,
    attackDamage: raw?.attackDamage ?? 0,
    attackSpeed: raw?.attackSpeed ?? 0,
    abilityHaste: raw?.abilityHaste ?? 0,
    critChance: raw?.critChance ?? 0,
    magicResist: raw?.magicResist ?? 0,
    moveSpeed: raw?.moveSpeed ?? 0,
    maxHealth: raw?.maxHealth ?? 0,
    currentHealth: raw?.currentHealth ?? 0,
  };
}

function normalizePlayer(raw: any, activeRiotId: string): PlayerInfo {
  return {
    championName: raw.championName ?? "",
    team: raw.team === "CHAOS" ? "CHAOS" : "ORDER",
    level: raw.level ?? 0,
    kills: raw.scores?.kills ?? 0,
    deaths: raw.scores?.deaths ?? 0,
    assists: raw.scores?.assists ?? 0,
    items: (raw.items ?? []).map(normalizeItem),
    summonerSpells: [
      raw.summonerSpells?.summonerSpellOne?.displayName ?? "",
      raw.summonerSpells?.summonerSpellTwo?.displayName ?? "",
    ],
    riotIdGameName: raw.riotIdGameName ?? "",
    isActivePlayer: activeRiotId !== "" && raw.riotIdGameName === activeRiotId,
  };
}

function normalizeItem(raw: any): PlayerItem {
  return {
    id: raw.itemID ?? 0,
    name: raw.displayName ?? "",
  };
}

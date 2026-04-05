/**
 * Factory functions for creating realistic mock game states.
 *
 * Used by the dev simulator panel to inject test data into reactive
 * streams without needing a running League game.
 */

import type { LiveGameState, EogStats } from "../lib/reactive/types";
import type { ActivePlayerStats, PlayerInfo } from "../lib/game-state/types";
import type { LoadedGameData } from "../lib/data-ingest";
import type { ChampionStats } from "../lib/data-ingest/types";

export interface MockGameOptions {
  championName: string;
  gameMode: "KIWI" | "ARAM" | "CLASSIC";
  level?: number;
  gold?: number;
  gameTime?: number;
  kills?: number;
  deaths?: number;
  assists?: number;
}

export interface MockEogOptions {
  isWin: boolean;
  championName: string;
  gameLength?: number;
  gameMode?: string;
}

/** Riot's per-level scaling factor */
function levelScaleFactor(level: number): number {
  return (level - 1) * (0.7025 + 0.0175 * (level - 1));
}

/** Compute approximate stats for a champion at a given level */
function computeStatsAtLevel(
  base: ChampionStats,
  level: number
): ActivePlayerStats {
  const scale = levelScaleFactor(level);
  return {
    attackDamage: Math.round(
      base.attackdamage + base.attackdamageperlevel * scale
    ),
    abilityPower: 0,
    armor: Math.round(base.armor + base.armorperlevel * scale),
    magicResist: Math.round(base.spellblock + base.spellblockperlevel * scale),
    maxHealth: Math.round(base.hp + base.hpperlevel * scale),
    currentHealth: Math.round(base.hp + base.hpperlevel * scale),
    moveSpeed: base.movespeed,
    attackSpeed:
      Math.round(
        base.attackspeed * (1 + (base.attackspeedperlevel * scale) / 100) * 1000
      ) / 1000,
    abilityHaste: 0,
    critChance: 0,
  };
}

const ARAM_SPELLS: [string, string] = ["Flash", "Mark"];
const SR_SPELLS: [string, string] = ["Flash", "Ignite"];

export function createMockGameState(
  options: MockGameOptions,
  gameData: LoadedGameData
): LiveGameState {
  const level = options.level ?? 3;
  const gold = options.gold ?? 1400;
  const gameTime = options.gameTime ?? 0;
  const kills = options.kills ?? 0;
  const deaths = options.deaths ?? 0;
  const assists = options.assists ?? 0;
  const spells = options.gameMode === "CLASSIC" ? SR_SPELLS : ARAM_SPELLS;

  // Get the active champion's data for stat computation
  const activeChamp = gameData.champions.get(
    options.championName.toLowerCase()
  );
  const stats = activeChamp
    ? computeStatsAtLevel(activeChamp.stats, level)
    : computeStatsAtLevel(defaultStats(), level);

  // Pick 9 other champions from available data (excluding the active player)
  const otherChamps = [...gameData.champions.values()]
    .filter((c) => c.name.toLowerCase() !== options.championName.toLowerCase())
    .slice(0, 9);

  // Pad with placeholder names if not enough champions in data
  while (otherChamps.length < 9) {
    otherChamps.push({
      id: `Champ${otherChamps.length}`,
      key: 0,
      name: `Champion${otherChamps.length + 1}`,
      title: "",
      tags: ["Fighter"],
      partype: "Mana",
      stats: defaultStats(),
      image: "",
    });
  }

  const players: PlayerInfo[] = [];

  // Active player (ORDER team)
  players.push({
    championName: options.championName,
    team: "ORDER",
    level,
    kills,
    deaths,
    assists,
    items: [],
    summonerSpells: spells,
    riotIdGameName: "Player1",
    position: "",
    isActivePlayer: true,
  });

  // 4 allies (ORDER)
  for (let i = 0; i < 4; i++) {
    players.push({
      championName: otherChamps[i].name,
      team: "ORDER",
      level,
      kills: 0,
      deaths: 0,
      assists: 0,
      items: [],
      summonerSpells: spells,
      riotIdGameName: `Ally${i + 1}`,
      position: "",
      isActivePlayer: false,
    });
  }

  // 5 enemies (CHAOS)
  for (let i = 4; i < 9; i++) {
    players.push({
      championName: otherChamps[i].name,
      team: "CHAOS",
      level,
      kills: 0,
      deaths: 0,
      assists: 0,
      items: [],
      summonerSpells: spells,
      riotIdGameName: `Enemy${i - 3}`,
      position: "",
      isActivePlayer: false,
    });
  }

  return {
    activePlayer: {
      championName: options.championName,
      level,
      currentGold: gold,
      runes: {
        keystone: "Lethal Tempo",
        primaryTree: "Precision",
        secondaryTree: "Domination",
      },
      stats,
    },
    players,
    gameMode: options.gameMode,
    lcuGameMode: options.gameMode,
    gameTime,
    champSelect: null,
    eogStats: null,
  };
}

export function createMockEogStats(options: MockEogOptions): EogStats {
  return {
    gameId: `mock-${Date.now()}`,
    gameLength: options.gameLength ?? 1200,
    gameMode: options.gameMode ?? "ARAM",
    isWin: options.isWin,
    championId: 0,
    items: [],
  };
}

function defaultStats(): ChampionStats {
  return {
    hp: 550,
    hpperlevel: 85,
    mp: 300,
    mpperlevel: 40,
    movespeed: 335,
    armor: 25,
    armorperlevel: 4,
    spellblock: 30,
    spellblockperlevel: 1.5,
    attackrange: 550,
    hpregen: 5,
    hpregenperlevel: 0.5,
    mpregen: 7,
    mpregenperlevel: 0.7,
    attackdamage: 55,
    attackdamageperlevel: 3,
    attackspeed: 0.65,
    attackspeedperlevel: 2,
  };
}

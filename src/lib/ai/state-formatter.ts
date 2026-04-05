/**
 * Formats game state snapshots for inclusion in LLM conversation messages.
 *
 * Every user message includes a full snapshot (not a diff), re-anchoring
 * the LLM to ground truth each turn. Uses neutral POV throughout.
 */

import type { ActivePlayerStats } from "../game-state/types";
import type { LiveGameState } from "../reactive/types";
import type { LoadedGameData } from "../data-ingest";
import type { ComputedStats } from "./enemy-stats";

export interface PlayerSnapshot {
  championName: string;
  level: number;
  kda: { kills: number; deaths: number; assists: number };
  items: Array<{ name: string; description: string }>;
  gold: number;
  stats: ActivePlayerStats;
  augments: string[];
}

export interface EnemySnapshot {
  championName: string;
  level: number;
  kda: { kills: number; deaths: number; assists: number };
  items: string[];
  stats: ComputedStats | null;
}

export interface GameSnapshot {
  player: PlayerSnapshot;
  allies: string[];
  enemies: EnemySnapshot[];
  gameTime: number;
}

/**
 * Build a GameSnapshot from live game state and computed enemy stats.
 *
 * The player's stats come from the Riot API (exact values including
 * buffs and runes). Enemy stats are computed approximations.
 */
export function takeGameSnapshot(
  liveGameState: LiveGameState,
  enemyStats: Map<string, ComputedStats>,
  gameData: LoadedGameData,
  chosenAugments: string[] = []
): GameSnapshot | null {
  if (!liveGameState.activePlayer) return null;

  const active = liveGameState.activePlayer;
  const activePlayerInfo = liveGameState.players.find((p) => p.isActivePlayer);
  const activeTeam = activePlayerInfo?.team ?? "ORDER";

  const playerItems = (activePlayerInfo?.items ?? []).map((item) => {
    const itemData = gameData.items.get(item.id);
    return {
      name: item.name,
      description: itemData?.plaintext ?? "",
    };
  });

  const player: PlayerSnapshot = {
    championName: active.championName,
    level: active.level,
    kda: {
      kills: activePlayerInfo?.kills ?? 0,
      deaths: activePlayerInfo?.deaths ?? 0,
      assists: activePlayerInfo?.assists ?? 0,
    },
    items: playerItems,
    gold: active.currentGold,
    stats: active.stats,
    augments: chosenAugments,
  };

  const allies: string[] = [];
  const enemies: EnemySnapshot[] = [];

  for (const p of liveGameState.players) {
    if (p.isActivePlayer) continue;

    if (p.team === activeTeam) {
      allies.push(p.championName);
    } else {
      enemies.push({
        championName: p.championName,
        level: p.level,
        kda: { kills: p.kills, deaths: p.deaths, assists: p.assists },
        items: p.items.map((i) => i.name),
        stats: enemyStats.get(p.championName) ?? null,
      });
    }
  }

  return {
    player,
    allies,
    enemies,
    gameTime: liveGameState.gameTime,
  };
}

/** Format a full game state snapshot as text for the LLM. */
export function formatStateSnapshot(snapshot: GameSnapshot): string {
  const sections: string[] = [];

  sections.push(
    `Game Time: ${Math.floor(snapshot.gameTime / 60)}:${String(Math.floor(snapshot.gameTime) % 60).padStart(2, "0")}`
  );
  sections.push("");

  // Player champion
  const p = snapshot.player;
  const kda = `${p.kda.kills}/${p.kda.deaths}/${p.kda.assists}`;
  sections.push(`Player Champion: ${p.championName} (Level ${p.level})`);
  sections.push(`KDA: ${kda}`);

  // Player items
  if (p.items.length > 0) {
    const itemList = p.items
      .map((i) => (i.description ? `${i.name} (${i.description})` : i.name))
      .join(", ");
    sections.push(`Items: ${itemList}`);
  } else {
    sections.push("Items: none");
  }

  sections.push(`Gold: ${Math.floor(p.gold)}`);

  // Player stats (exact from API)
  sections.push(formatPlayerStats(p.stats));

  // Augments
  if (p.augments.length > 0) {
    sections.push(`Augments: ${p.augments.join(", ")}`);
  }

  // Ally team
  if (snapshot.allies.length > 0) {
    sections.push(`\nAlly Team: ${snapshot.allies.join(", ")}`);
  }

  // Enemy team
  if (snapshot.enemies.length > 0) {
    sections.push("\nEnemy Team:");
    for (const enemy of snapshot.enemies) {
      sections.push(formatEnemyLine(enemy));
    }
  }

  return sections.join("\n");
}

function formatPlayerStats(stats: ActivePlayerStats): string {
  const parts = [
    `${Math.round(stats.abilityPower)} AP`,
    `${Math.round(stats.attackDamage)} AD`,
    `${Math.round(stats.armor)} Armor`,
    `${Math.round(stats.magicResist)} MR`,
    `${Math.round(stats.abilityHaste)} AH`,
    `${stats.attackSpeed.toFixed(2)} AS`,
    `${Math.round(stats.critChance * 100)}% Crit`,
    `${Math.round(stats.moveSpeed)} MS`,
    `${Math.round(stats.maxHealth)} HP`,
  ];
  return `Stats: ${parts.join(", ")}`;
}

function formatEnemyLine(enemy: EnemySnapshot): string {
  const kda = `${enemy.kda.kills}/${enemy.kda.deaths}/${enemy.kda.assists}`;
  const items = enemy.items.length > 0 ? enemy.items.join(", ") : "no items";

  if (enemy.stats) {
    const stats = [
      `${enemy.stats.attackDamage} AD`,
      `${enemy.stats.abilityPower} AP`,
      `${enemy.stats.armor} Armor`,
      `${enemy.stats.magicResist} MR`,
      `${enemy.stats.attackSpeed.toFixed(2)} AS`,
      `${enemy.stats.moveSpeed} MS`,
      `${enemy.stats.maxHealth} HP`,
    ].join(", ");
    return `- ${enemy.championName} (Level ${enemy.level}, ${kda}): ${stats} — ${items}`;
  }

  return `- ${enemy.championName} (Level ${enemy.level}, ${kda}): ${items}`;
}

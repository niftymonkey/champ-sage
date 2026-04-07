/**
 * Formats game state snapshots for inclusion in LLM conversation messages.
 *
 * Every user message includes a full snapshot (not a diff), re-anchoring
 * the LLM to ground truth each turn. Uses neutral POV throughout.
 */

import type { ActivePlayerStats } from "../game-state/types";
import type { LiveGameState } from "../reactive/types";
import type { LoadedGameData } from "../data-ingest";
import type { AugmentSet } from "../data-ingest/types";
import type { ComputedStats } from "./enemy-stats";

export interface AugmentSnapshot {
  name: string;
  description: string;
  sets: string[];
}

export interface SetProgressEntry {
  name: string;
  count: number;
  nextThreshold: number | null;
  activeBonus: string | null;
  nextBonus: string | null;
}

export interface PlayerSnapshot {
  championName: string;
  level: number;
  kda: { kills: number; deaths: number; assists: number };
  items: Array<{ name: string; description: string }>;
  gold: number;
  stats: ActivePlayerStats;
  augments: AugmentSnapshot[];
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
  augmentSetProgress: SetProgressEntry[];
}

/**
 * Build a GameSnapshot from live game state and computed enemy stats.
 *
 * The player's stats come from the Riot API (exact values including
 * buffs and runes). Enemy stats are computed approximations.
 * Augment data is resolved from gameData so the snapshot includes
 * descriptions and set membership.
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

  // Resolve augment data from game data
  const augments: AugmentSnapshot[] = chosenAugments.map((name) => {
    const augData = gameData.augments.get(name.toLowerCase());
    return {
      name,
      description: augData?.description ?? "",
      sets: augData?.sets ?? [],
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
    augments,
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

  // Compute set progress from resolved augment data
  const augmentSetProgress = computeSetProgress(augments, gameData.augmentSets);

  return {
    player,
    allies,
    enemies,
    gameTime: liveGameState.gameTime,
    augmentSetProgress,
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

  // Augments with descriptions
  if (p.augments.length > 0) {
    const augLines = p.augments.map((a) =>
      a.description ? `- ${a.name}: ${a.description}` : `- ${a.name}`
    );
    sections.push(`Augments:\n${augLines.join("\n")}`);
  }

  // Augment set progress
  if (snapshot.augmentSetProgress.length > 0) {
    const setLines = snapshot.augmentSetProgress.map((s) => {
      let line = `- ${s.name} (${s.count}/${s.nextThreshold ?? s.count})`;
      if (s.activeBonus) line += ` — Active: ${s.activeBonus}`;
      if (s.nextBonus && s.nextThreshold)
        line += ` — Next at ${s.nextThreshold}: ${s.nextBonus}`;
      return line;
    });
    sections.push(`Set Progress:\n${setLines.join("\n")}`);
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

// --- Helpers ---

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

/** Count how many chosen augments belong to each set */
function countSets(augments: AugmentSnapshot[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const aug of augments) {
    for (const setName of aug.sets) {
      counts.set(setName, (counts.get(setName) ?? 0) + 1);
    }
  }
  return counts;
}

/** Compute set progress: active bonuses, next thresholds */
function computeSetProgress(
  augments: AugmentSnapshot[],
  augmentSets: AugmentSet[]
): SetProgressEntry[] {
  const setCounts = countSets(augments);
  if (setCounts.size === 0) return [];

  const entries: SetProgressEntry[] = [];
  for (const [setName, count] of setCounts) {
    const setDef = augmentSets.find((s) => s.name === setName);
    if (!setDef) continue;

    // Find active bonuses (thresholds met)
    const active = setDef.bonuses.filter((b) => b.threshold <= count);
    // Find next bonus threshold
    const next = setDef.bonuses.find((b) => b.threshold > count);

    entries.push({
      name: setName,
      count,
      nextThreshold: next?.threshold ?? null,
      activeBonus:
        active.length > 0 ? active[active.length - 1].description : null,
      nextBonus: next?.description ?? null,
    });
  }

  return entries;
}

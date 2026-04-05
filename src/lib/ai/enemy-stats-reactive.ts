/**
 * Reactive enemy stat computation.
 *
 * Subscribes to liveGameState$ and recomputes approximate enemy stats
 * on every game state update. Stats are stored in memory and read at
 * question time — no computation needed in the coaching pipeline.
 */

import { BehaviorSubject, type Subscription } from "rxjs";
import type { LiveGameState } from "../reactive/types";
import type { LoadedGameData } from "../data-ingest";
import type { ComputedStats } from "./enemy-stats";
import { computeEnemyStats } from "./enemy-stats";

export function createEnemyStatsStream(
  liveGameState$: BehaviorSubject<LiveGameState>,
  gameData: LoadedGameData
): {
  enemyStats$: BehaviorSubject<Map<string, ComputedStats>>;
  subscription: Subscription;
} {
  const enemyStats$ = new BehaviorSubject<Map<string, ComputedStats>>(
    new Map()
  );

  const subscription = liveGameState$.subscribe((state) => {
    const activePlayerInfo = state.players.find((p) => p.isActivePlayer);
    if (!activePlayerInfo) {
      enemyStats$.next(new Map());
      return;
    }

    const activeTeam = activePlayerInfo.team;
    const enemies = state.players.filter((p) => p.team !== activeTeam);
    const stats = new Map<string, ComputedStats>();

    for (const enemy of enemies) {
      const champion = gameData.champions.get(enemy.championName.toLowerCase());
      if (!champion) continue;

      // Resolve item objects from game data for stat computation
      const items = enemy.items
        .map((i) => gameData.items.get(i.id))
        .filter((item) => item != null);

      stats.set(
        enemy.championName,
        computeEnemyStats(champion.stats, enemy.level, items)
      );
    }

    enemyStats$.next(stats);
  });

  return { enemyStats$, subscription };
}

/**
 * Reactive enemy build-direction inference.
 *
 * Mirrors `enemy-stats-reactive`: subscribes to liveGameState$, recomputes
 * a per-enemy DirectionReading on every update, and exposes the result as
 * its own BehaviorSubject. Hysteresis is preserved across emissions by
 * feeding the previous reading into each call.
 */

import { BehaviorSubject, type Subscription } from "rxjs";
import type { LiveGameState } from "../reactive/types";
import type { LoadedGameData } from "../data-ingest";
import { inferEnemyDirection, type DirectionReading } from "./inference";
import { stereotypeFromClassTag } from "./taxonomy";

export type EnemyDirectionsByChampion = Map<string, DirectionReading>;

export function createEnemyDirectionStream(
  liveGameState$: BehaviorSubject<LiveGameState>,
  gameData: LoadedGameData
): {
  enemyDirections$: BehaviorSubject<EnemyDirectionsByChampion>;
  subscription: Subscription;
} {
  const enemyDirections$ = new BehaviorSubject<EnemyDirectionsByChampion>(
    new Map()
  );

  const subscription = liveGameState$.subscribe((state) => {
    const activePlayerInfo = state.players.find((p) => p.isActivePlayer);
    if (!activePlayerInfo) {
      enemyDirections$.next(new Map());
      return;
    }

    const previous = enemyDirections$.getValue();
    const next: EnemyDirectionsByChampion = new Map();

    const activeTeam = activePlayerInfo.team;
    const enemies = state.players.filter((p) => p.team !== activeTeam);

    for (const enemy of enemies) {
      const champion = gameData.champions.get(enemy.championName.toLowerCase());
      if (!champion) continue;

      const stereotype = stereotypeFromClassTag(champion.tags?.[0]);
      if (stereotype === null) continue;

      const itemsOwned = enemy.items
        .map((i) => gameData.items.get(i.id))
        .filter((item): item is NonNullable<typeof item> => item != null);

      const reading = inferEnemyDirection({
        stereotype,
        itemsOwned,
        previousReading: previous.get(enemy.championName),
      });

      next.set(enemy.championName, reading);
    }

    enemyDirections$.next(next);
  });

  return { enemyDirections$, subscription };
}

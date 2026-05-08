/**
 * React context provider for coaching-related data.
 *
 * Provides the detected game mode, computed enemy stats, and per-enemy
 * build-direction readings to any component in the tree, avoiding
 * prop drilling through DataBrowser and GameStateView.
 *
 * Enemy directions ride the reactive stream (`createEnemyDirectionStream`)
 * — the closure preserves the previous reading so hysteresis carries
 * across emissions. The provider mirrors the stream's current value into
 * React state for components that prefer hook semantics.
 */

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import type { GameMode } from "../lib/mode/types";
import type { ComputedStats } from "../lib/ai/enemy-stats";
import type { LoadedGameData } from "../lib/data-ingest";
import type { LiveGameState } from "../lib/reactive/types";
import { computeEnemyStats } from "../lib/ai/enemy-stats";
import { liveGameState$ } from "../lib/reactive";
import {
  createEnemyDirectionStream,
  type EnemyDirectionsByChampion,
} from "../lib/build-direction/stream";

interface CoachingContextValue {
  mode: GameMode | null;
  enemyStats: Map<string, ComputedStats>;
  enemyDirections: EnemyDirectionsByChampion;
  gameData: LoadedGameData | null;
}

const CoachingCtx = createContext<CoachingContextValue>({
  mode: null,
  enemyStats: new Map(),
  enemyDirections: new Map(),
  gameData: null,
});

interface CoachingProviderProps {
  mode: GameMode | null;
  liveGameState: LiveGameState;
  gameData: LoadedGameData | null;
  children: ReactNode;
}

export function CoachingProvider({
  mode,
  liveGameState,
  gameData,
  children,
}: CoachingProviderProps) {
  const enemyStats = useMemo(() => {
    if (!gameData || !liveGameState.activePlayer) {
      return new Map<string, ComputedStats>();
    }

    const activePlayerInfo = liveGameState.players.find(
      (p) => p.isActivePlayer
    );
    if (!activePlayerInfo) return new Map<string, ComputedStats>();

    const activeTeam = activePlayerInfo.team;
    const enemies = liveGameState.players.filter((p) => p.team !== activeTeam);
    const stats = new Map<string, ComputedStats>();

    for (const enemy of enemies) {
      const champion = gameData.champions.get(enemy.championName.toLowerCase());
      if (!champion) continue;

      const items = enemy.items
        .map((i) => gameData.items.get(i.id))
        .filter((item) => item != null);

      stats.set(
        enemy.championName,
        computeEnemyStats(champion.stats, enemy.level, items)
      );
    }

    return stats;
  }, [gameData, liveGameState.players, liveGameState.activePlayer]);

  const [enemyDirections, setEnemyDirections] =
    useState<EnemyDirectionsByChampion>(new Map());

  // Mount the reactive direction stream once gameData is available.
  // The stream subscribes to liveGameState$ directly and accumulates
  // hysteresis state in its own closure — the provider just mirrors
  // the latest emission into React state.
  useEffect(() => {
    if (!gameData) {
      setEnemyDirections(new Map());
      return;
    }
    const { enemyDirections$, subscription } = createEnemyDirectionStream(
      liveGameState$,
      gameData
    );
    const valueSub = enemyDirections$.subscribe(setEnemyDirections);
    return () => {
      valueSub.unsubscribe();
      subscription.unsubscribe();
    };
  }, [gameData]);

  const value = useMemo(
    () => ({ mode, enemyStats, enemyDirections, gameData }),
    [mode, enemyStats, enemyDirections, gameData]
  );

  return <CoachingCtx.Provider value={value}>{children}</CoachingCtx.Provider>;
}

export function useCoachingContext(): CoachingContextValue {
  return useContext(CoachingCtx);
}

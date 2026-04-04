/**
 * React context provider for coaching-related data.
 *
 * Provides the detected game mode and computed enemy stats to any
 * component in the tree, avoiding prop drilling through DataBrowser
 * and GameStateView.
 */

import { createContext, useContext, useMemo } from "react";
import type { ReactNode } from "react";
import type { GameMode } from "../lib/mode/types";
import type { ComputedStats } from "../lib/ai/enemy-stats";
import type { LoadedGameData } from "../lib/data-ingest";
import type { LiveGameState } from "../lib/reactive/types";
import { computeEnemyStats } from "../lib/ai/enemy-stats";

interface CoachingContextValue {
  mode: GameMode | null;
  enemyStats: Map<string, ComputedStats>;
}

const CoachingCtx = createContext<CoachingContextValue>({
  mode: null,
  enemyStats: new Map(),
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

  const value = useMemo(() => ({ mode, enemyStats }), [mode, enemyStats]);

  return <CoachingCtx.Provider value={value}>{children}</CoachingCtx.Provider>;
}

export function useCoachingMode(): CoachingContextValue {
  return useContext(CoachingCtx);
}

import { useMemo } from "react";
import type { GameState } from "../lib/game-state/types";
import type { LoadedGameData } from "../lib/data-ingest";
import type { EffectiveGameState } from "../lib/mode";
import {
  createModeRegistry,
  aramMayhemMode,
  buildEffectiveGameState,
} from "../lib/mode";

const registry = createModeRegistry();
registry.register(aramMayhemMode);

export function useEffectiveGameState(
  gameState: GameState,
  gameData: LoadedGameData | null
): EffectiveGameState {
  return useMemo(() => {
    if (!gameData || gameState.status !== "connected") {
      return buildEffectiveGameState(gameState, null);
    }

    const detectedMode = registry.detect(gameState.gameMode);
    const modeContext = detectedMode
      ? detectedMode.buildContext(gameState, gameData)
      : null;

    return buildEffectiveGameState(gameState, modeContext);
  }, [gameState, gameData]);
}

import { useMemo } from "react";
import type { Augment } from "../lib/data-ingest/types";
import type { GameState } from "../lib/game-state/types";
import type { LoadedGameData } from "../lib/data-ingest";
import type { EffectiveGameState, ModeContext } from "../lib/mode";
import {
  createModeRegistry,
  aramMayhemMode,
  buildEffectiveGameState,
} from "../lib/mode";
import { addSelectedAugment } from "../lib/mode/augment-selection";

const registry = createModeRegistry();
registry.register(aramMayhemMode);

export function useEffectiveGameState(
  gameState: GameState,
  gameData: LoadedGameData | null,
  selectedAugments: Augment[] = []
): EffectiveGameState {
  return useMemo(() => {
    if (!gameData || gameState.status !== "connected") {
      return buildEffectiveGameState(gameState, null);
    }

    const detectedMode = registry.detect(gameState.gameMode);
    let modeContext: ModeContext | null = detectedMode
      ? detectedMode.buildContext(gameState, gameData)
      : null;

    // Apply selected augments to the active player's context
    if (modeContext && selectedAugments.length > 0) {
      const activePlayer = gameState.players.find((p) => p.isActivePlayer);
      if (activePlayer) {
        for (const augment of selectedAugments) {
          modeContext = addSelectedAugment(
            modeContext,
            activePlayer.riotIdGameName,
            augment
          );
        }
      }
    }

    return buildEffectiveGameState(gameState, modeContext);
  }, [gameState, gameData, selectedAugments]);
}

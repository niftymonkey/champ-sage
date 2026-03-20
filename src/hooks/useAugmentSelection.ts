import { useState, useCallback, useRef } from "react";
import type { Augment } from "../lib/data-ingest/types";
import type { ModeContext } from "../lib/mode";
import { addSelectedAugment } from "../lib/mode/augment-selection";

interface AugmentSelectionState {
  selectedAugments: Augment[];
  select: (augment: Augment) => void;
  reset: () => void;
  applyToContext: (modeContext: ModeContext, playerKey: string) => ModeContext;
}

/**
 * Manages augment selection state for the active player.
 * Selections persist across game state poll updates but reset
 * when a new game is detected (gameMode changes or status changes).
 */
export function useAugmentSelection(gameMode: string): AugmentSelectionState {
  const [selectedAugments, setSelectedAugments] = useState<Augment[]>([]);
  const lastGameModeRef = useRef(gameMode);

  // Reset selections when the game mode changes (new game)
  if (gameMode !== lastGameModeRef.current) {
    lastGameModeRef.current = gameMode;
    if (selectedAugments.length > 0) {
      setSelectedAugments([]);
    }
  }

  const select = useCallback((augment: Augment) => {
    setSelectedAugments((prev) => [...prev, augment]);
  }, []);

  const reset = useCallback(() => {
    setSelectedAugments([]);
  }, []);

  const applyToContext = useCallback(
    (modeContext: ModeContext, playerKey: string): ModeContext => {
      let ctx = modeContext;
      for (const augment of selectedAugments) {
        ctx = addSelectedAugment(ctx, playerKey, augment);
      }
      return ctx;
    },
    [selectedAugments]
  );

  return { selectedAugments, select, reset, applyToContext };
}

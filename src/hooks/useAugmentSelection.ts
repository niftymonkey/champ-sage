import { useState, useCallback, useEffect } from "react";
import type { Augment } from "../lib/data-ingest/types";
import type { ModeContext } from "../lib/mode";
import { addSelectedAugment } from "../lib/mode/augment-selection";

interface AugmentSelectionState {
  selectedAugments: Augment[];
  select: (augment: Augment) => void;
  removeLast: () => void;
  reset: () => void;
  applyToContext: (modeContext: ModeContext, playerKey: string) => ModeContext;
}

/**
 * Manages augment selection state for the active player.
 * Selections reset when the resetKey changes (derived from gameMode + status
 * at the call site, so new games or disconnects clear selections).
 */
export function useAugmentSelection(resetKey: string): AugmentSelectionState {
  const [selectedAugments, setSelectedAugments] = useState<Augment[]>([]);

  useEffect(() => {
    setSelectedAugments([]);
  }, [resetKey]);

  const select = useCallback((augment: Augment) => {
    setSelectedAugments((prev) => [...prev, augment]);
  }, []);

  const removeLast = useCallback(() => {
    setSelectedAugments((prev) => prev.slice(0, -1));
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

  return { selectedAugments, select, removeLast, reset, applyToContext };
}

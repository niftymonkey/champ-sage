import type { Augment, AugmentSet } from "../data-ingest/types";
import type { ModeContext, PlayerModeContext, SetProgress } from "./types";

/**
 * Add a selected augment to the active player's context and recompute set progress.
 * Returns a new ModeContext with the updated player context (immutable).
 * Returns the original context unchanged if the player key is not found.
 */
export function addSelectedAugment(
  modeContext: ModeContext,
  playerKey: string,
  augment: Augment
): ModeContext {
  const existing = modeContext.playerContexts.get(playerKey);
  if (!existing) return modeContext;

  const selectedAugments = [...existing.selectedAugments, augment];
  const setProgress = computeSetProgress(
    selectedAugments,
    modeContext.augmentSets
  );

  const updatedPlayer: PlayerModeContext = {
    ...existing,
    selectedAugments,
    setProgress,
  };

  const updatedContexts = new Map(modeContext.playerContexts);
  updatedContexts.set(playerKey, updatedPlayer);

  return {
    ...modeContext,
    playerContexts: updatedContexts,
  };
}

/**
 * Compute set progress from a list of selected augments against available sets.
 * Only includes sets where the player has at least one augment.
 */
export function computeSetProgress(
  selectedAugments: Augment[],
  augmentSets: AugmentSet[]
): SetProgress[] {
  // Count how many selected augments belong to each set
  const setCounts = new Map<string, number>();
  for (const augment of selectedAugments) {
    for (const setName of augment.sets) {
      setCounts.set(setName, (setCounts.get(setName) ?? 0) + 1);
    }
  }

  const progress: SetProgress[] = [];
  for (const [setName, count] of setCounts) {
    const setDef = augmentSets.find((s) => s.name === setName);
    if (!setDef) continue;

    // Find the next bonus threshold that hasn't been reached
    const nextBonus = setDef.bonuses.find((b) => b.threshold > count) ?? null;

    progress.push({ set: setDef, count, nextBonus });
  }

  return progress;
}

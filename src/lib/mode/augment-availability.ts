import type { GameMode } from "./types";

export interface AugmentAvailability {
  /** Which slot index (0-based) should show the "available" indicator. -1 if none. */
  pendingSlot: number;
  /** Whether an augment selection is likely available (level threshold reached, slot empty). */
  isAvailable: boolean;
}

/**
 * Determine whether an augment selection is likely available based on
 * the player's current level, the mode's selection thresholds, and
 * how many augments have already been selected.
 *
 * The logic: count how many thresholds the player has reached (level >= threshold).
 * If that's more than the number of augments already selected, a selection is pending.
 */
export function checkAugmentAvailability(
  playerLevel: number,
  selectedCount: number,
  mode: GameMode
): AugmentAvailability {
  const levels = mode.augmentSelectionLevels;
  if (levels.length === 0) {
    return { pendingSlot: -1, isAvailable: false };
  }

  // How many augment offers the player has reached based on level
  const reachedCount = levels.filter((lvl) => playerLevel >= lvl).length;

  if (selectedCount >= reachedCount || selectedCount >= levels.length) {
    return { pendingSlot: -1, isAvailable: false };
  }

  return { pendingSlot: selectedCount, isAvailable: true };
}

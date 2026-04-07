/**
 * Formats augment offer options with set bonus context for LLM consumption.
 *
 * Shows each augment's name, tier, description, and — if the augment belongs
 * to a set — what set progress picking it would create or unlock.
 */

import type { CoachingQuery } from "./types";
import type { LoadedGameData } from "../data-ingest";

/**
 * Format augment options into lines with set bonus annotations.
 *
 * For each augment that belongs to a set, appends a parenthetical showing:
 * - How many set members the player would have after picking this
 * - Whether picking it unlocks a bonus (with description)
 * - The next threshold if no bonus is unlocked yet
 */
export function formatAugmentOfferLines(
  options: NonNullable<CoachingQuery["augmentOptions"]>,
  chosenAugments: string[],
  gameData: LoadedGameData
): string[] {
  return options.map((opt) => {
    let line = `- **${opt.name}** [${opt.tier}]: ${opt.description}`;

    if (opt.sets && opt.sets.length > 0) {
      const setAnnotations = opt.sets.map((setName) => {
        const currentCount = chosenAugments.filter((name) => {
          const aug = gameData.augments.get(name.toLowerCase());
          return aug?.sets?.includes(setName);
        }).length;
        const wouldHave = currentCount + 1;
        const setDef = gameData.augmentSets.find((s) => s.name === setName);
        if (!setDef) return setName;

        const activatedBonus = setDef.bonuses.find(
          (b) => b.threshold === wouldHave
        );
        const maxThreshold = Math.max(
          ...setDef.bonuses.map((b) => b.threshold)
        );
        if (activatedBonus) {
          return `${setName} ${wouldHave}/${maxThreshold} — UNLOCKS: ${activatedBonus.description}`;
        }
        const nextBonus = setDef.bonuses.find((b) => b.threshold > wouldHave);
        if (nextBonus) {
          return `${setName} ${wouldHave}/${nextBonus.threshold}`;
        }
        return setName;
      });
      line += ` (${setAnnotations.join("; ")})`;
    }

    return line;
  });
}

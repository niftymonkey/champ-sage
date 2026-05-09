/**
 * Pure function that classifies an enemy's build direction from their
 * current items. Cold-start defers to the DDragon stereotype; evidence
 * (completed items) overrides as it accumulates. Hysteresis prevents
 * flicker when a champion buys a component before committing to a path.
 */

import type { Item } from "../data-ingest/types";
import type { BuildDirection, ConfidenceLevel } from "./taxonomy";

export interface DirectionReading {
  direction: BuildDirection;
  confidence: ConfidenceLevel;
}

export interface EnemyInferenceInput {
  /** Cold-start direction from the champion's primary class tag. */
  stereotype: BuildDirection;
  /** Items currently in the enemy's inventory (mix of components + completed). */
  itemsOwned: Item[];
  /** Last reading for this enemy, if any. Used only for hysteresis. */
  previousReading?: DirectionReading;
}

/**
 * Item is "completed" when it has no further upgrade path. The data-
 * ingest catalog leaves `into` undefined for final-tier items and sets
 * it to a non-empty array on components. Both shapes count as complete
 * when the array is empty.
 */
function isCompleted(item: Item): boolean {
  return item.into === undefined || item.into.length === 0;
}

/**
 * Classify a single completed item into a build-direction bucket. Falls
 * back to null when the item carries no direction-bearing stats (e.g.
 * boots, consumables, plain attack-speed daggers — handled at the call
 * site by skipping nulls).
 */
function bucketItem(item: Item): BuildDirection | null {
  const lowerTags = item.tags.map((t) => t.toLowerCase());
  if (lowerTags.includes("goldper")) return "supp";

  const ad =
    (item.stats.FlatPhysicalDamageMod ?? 0) +
    (item.stats.FlatCritChanceMod ?? 0) * 100 +
    (item.stats.PercentAttackSpeedMod ?? 0) * 100;
  const ap = item.stats.FlatMagicDamageMod ?? 0;
  const tank =
    (item.stats.FlatArmorMod ?? 0) +
    (item.stats.FlatSpellBlockMod ?? 0) +
    (item.stats.FlatHPPoolMod ?? 0) / 10;

  const max = Math.max(ad, ap, tank);
  if (max === 0) return null;
  if (max === ad) return "ad";
  if (max === ap) return "ap";
  return "tank";
}

export function inferEnemyDirection(
  input: EnemyInferenceInput
): DirectionReading {
  const completed = input.itemsOwned.filter(isCompleted);

  if (completed.length === 0) {
    return { direction: input.stereotype, confidence: "stereotype" };
  }

  const counts: Record<BuildDirection, number> = {
    ad: 0,
    ap: 0,
    tank: 0,
    supp: 0,
  };
  for (const c of completed) {
    const bucket = bucketItem(c);
    if (bucket !== null) counts[bucket] += 1;
  }

  // If every completed item was unclassifiable (boots-only, plain
  // stat-stick, etc.), there's no real evidence yet — stay at
  // stereotype confidence rather than reporting "low" with no signal.
  const classifiedEvidence = counts.ad + counts.ap + counts.tank + counts.supp;
  if (classifiedEvidence === 0) {
    return { direction: input.stereotype, confidence: "stereotype" };
  }

  const stereotypeCount = counts[input.stereotype];
  let winner: BuildDirection = input.stereotype;
  let winnerCount = stereotypeCount;
  for (const d of ["ad", "ap", "tank", "supp"] as const) {
    if (counts[d] > winnerCount) {
      winner = d;
      winnerCount = counts[d];
    }
  }

  const previous = input.previousReading?.direction;
  if (previous !== undefined && previous !== winner) {
    if (counts[winner] - counts[previous] < 1) {
      winner = previous;
      winnerCount = counts[previous];
    }
  }

  const confidence: ConfidenceLevel = winnerCount >= 2 ? "high" : "low";
  return { direction: winner, confidence };
}

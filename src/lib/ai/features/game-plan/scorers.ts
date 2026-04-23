/**
 * Game-plan-specific scorers (#99 follow-up).
 *
 * These score the structural correctness and quality of the LLM's
 * `buildPath` output. The schema's enum already enforces "name must be a
 * valid item" and "category must be one of the fixed set" at decode time;
 * these scorers cover what the schema can't:
 *
 *  - Structural invariants the schema doesn't enforce (e.g. duplicates).
 *  - Semantic invariants tied to fields (counter category requires a
 *    targetEnemy from the actual roster).
 *  - Quality signals (category diversity, reason brevity).
 *
 * All scorers are pure functions. Per-feature evalite harnesses wrap them
 * with `createScorer` and feed them the feature's `GamePlanResult` plus
 * any extra context.
 */
import type { BuildPathItem } from "../../types";

const REQUIRED_BUILD_PATH_LENGTH = 6;
const REASON_WORD_CEILING = 8;
const SITUATIONAL_OVERUSE_THRESHOLD = 3;

/**
 * Score the build path's structural shape.
 *
 * Checks beyond what the schema enforces:
 *  - Exactly 6 items (schema enforces this too — defense in depth).
 *  - No duplicate items by name.
 *
 * Returns 1.0 on a perfect structure, 0.0 on any violation.
 */
export function scoreBuildPathStructure(buildPath: BuildPathItem[]): number {
  if (buildPath.length !== REQUIRED_BUILD_PATH_LENGTH) return 0;
  const seen = new Set<string>();
  for (const item of buildPath) {
    const key = item.name.toLowerCase();
    if (seen.has(key)) return 0;
    seen.add(key);
  }
  return 1;
}

/**
 * Score counter-targeting consistency.
 *
 * For every item with category === "counter", `targetEnemy` must be
 * non-null AND match a champion on the enemy roster (case-insensitive).
 * For every item with category !== "counter", `targetEnemy` must be null.
 *
 * Returns the fraction of items that satisfy the rule.
 */
export function scoreCounterTargeting(
  buildPath: BuildPathItem[],
  enemyChampions: readonly string[]
): number {
  if (buildPath.length === 0) return 1;
  const enemySet = new Set(enemyChampions.map((e) => e.toLowerCase()));
  let satisfied = 0;
  for (const item of buildPath) {
    if (item.category === "counter") {
      if (
        item.targetEnemy !== null &&
        enemySet.has(item.targetEnemy.toLowerCase())
      ) {
        satisfied++;
      }
    } else if (item.targetEnemy === null) {
      satisfied++;
    }
  }
  return satisfied / buildPath.length;
}

/**
 * Score category diversity.
 *
 * Penalizes a build path that's all one category, and penalizes
 * over-reliance on the "situational" catch-all (more than two situational
 * items in a 6-item build is a signal the LLM didn't think hard enough).
 *
 * Returns 1.0 for a well-diversified build, scaled down for monocultures
 * or situational-heavy builds.
 */
export function scoreCategoryDiversity(buildPath: BuildPathItem[]): number {
  if (buildPath.length === 0) return 1;

  const counts = new Map<string, number>();
  for (const item of buildPath) {
    counts.set(item.category, (counts.get(item.category) ?? 0) + 1);
  }

  // Distinct-category score: a build using 3+ distinct categories is
  // considered well diversified; below that we scale down proportionally.
  const distinct = counts.size;
  const distinctScore = Math.min(distinct / 3, 1);

  // Situational-overuse penalty: each extra situational beyond 2 reduces
  // the score. 3 situational → 0.75, 4 → 0.50, 5 → 0.25, 6 → 0.
  const situationalCount = counts.get("situational") ?? 0;
  const situationalPenalty =
    situationalCount >= SITUATIONAL_OVERUSE_THRESHOLD
      ? 1 - (situationalCount - (SITUATIONAL_OVERUSE_THRESHOLD - 1)) / 4
      : 1;

  return Math.max(0, distinctScore * situationalPenalty);
}

/**
 * Score reason brevity.
 *
 * #99 says reasons should be terse — "a few words max, sacrifice grammar
 * for concision". Scores the fraction of items whose reason fits within
 * an 8-word ceiling. Counted after splitting on whitespace.
 */
export function scoreReasonBrevity(buildPath: BuildPathItem[]): number {
  if (buildPath.length === 0) return 1;
  let satisfied = 0;
  for (const item of buildPath) {
    const wordCount = item.reason.trim().split(/\s+/).filter(Boolean).length;
    if (wordCount <= REASON_WORD_CEILING) satisfied++;
  }
  return satisfied / buildPath.length;
}

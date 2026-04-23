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

// ---------------------------------------------------------------------------
// Scorers shared with game-plan's prose `answer` (relocated from the flat
// `src/lib/ai/scorers/` directory in #108 phase 8).
// ---------------------------------------------------------------------------

/**
 * Score response brevity. Augment/item questions should be 1-2 sentences.
 * Tactical questions can be up to 4 bullet points.
 *
 * Returns 1.0 for concise responses, degrades linearly for verbose ones.
 */
export function scoreBrevity(response: string): number {
  const sentences = response.split(/[.!?]+/).filter((s) => s.trim().length > 5);
  if (sentences.length <= 3) return 1;
  if (sentences.length <= 5) return 0.5;
  return 0;
}

export type StateAwarenessRule =
  | "grievous-wounds"
  | "mr-needed"
  | "enemy-comp"
  | "existing-items";

const GRIEVOUS_WOUNDS_KEYWORDS = [
  "grievous wounds",
  "anti-heal",
  "antiheal",
  "morellonomicon",
  "thornmail",
  "oblivion orb",
  "chempunk",
  "chainsword",
];

const MR_KEYWORDS = [
  "magic resist",
  " mr ",
  " mr.",
  " mr,",
  "spirit visage",
  "force of nature",
  "banshee's veil",
  "banshee's",
  "abyssal mask",
  "wit's end",
  "maw of malmortius",
  "malmortius",
  "hollow radiance",
  "kaenic rookern",
];

const COMP_AWARENESS_KEYWORDS = [
  " ap ",
  " ad ",
  "magic damage",
  "physical damage",
  "ap-heavy",
  "ad-heavy",
  "ap heavy",
  "ad heavy",
  "all ap",
  "all ad",
  "mostly ap",
  "mostly ad",
];

function hasKeyword(lower: string, keywords: string[]): boolean {
  return keywords.some((kw) => lower.includes(kw));
}

/**
 * Check whether a coaching response demonstrates awareness of the game state.
 *
 * Each rule in `hints` maps to a set of keywords that should appear in the
 * response. All rules must pass for a score of 1. Any failure yields 0.
 *
 * Returns 1.0 if no hints are provided (not a state-awareness fixture).
 */
export function scoreStateAwareness(
  response: string,
  hints: StateAwarenessRule[] | undefined,
  items: string[],
  enemyChampions?: string[]
): number {
  if (!hints || hints.length === 0) return 1;

  const lower = response.toLowerCase();

  for (const rule of hints) {
    switch (rule) {
      case "grievous-wounds":
        if (!hasKeyword(lower, GRIEVOUS_WOUNDS_KEYWORDS)) return 0;
        break;

      case "mr-needed":
        if (!hasKeyword(lower, MR_KEYWORDS)) return 0;
        break;

      case "enemy-comp": {
        const mentionsEnemy = enemyChampions?.some((name) =>
          lower.includes(name.toLowerCase())
        );
        const mentionsProfile = hasKeyword(lower, COMP_AWARENESS_KEYWORDS);
        if (!mentionsEnemy && !mentionsProfile) return 0;
        break;
      }

      case "existing-items": {
        if (items.length === 0) break;
        const mentionsItem = items.some(
          (item) => item.length > 3 && lower.includes(item.toLowerCase())
        );
        if (!mentionsItem) return 0;
        break;
      }
    }
  }

  return 1;
}

const PIVOT_EXPLANATION_PATTERNS = [
  "because",
  "since ",
  "now that",
  "changed",
  "instead",
  "switched",
  "pivot",
  "better option",
  "no longer",
  "doesn't make sense",
  "less valuable",
  "more valuable",
  "synergizes",
  "synergy",
  "given that",
  "due to",
];

const PIVOT_DISMISSAL_PATTERNS = [
  "instead",
  "switched",
  "pivot",
  "no longer",
  "doesn't make sense",
  "less valuable",
  "rather than",
];

/**
 * Score whether a recommendation change (pivot) is properly explained.
 *
 * - No pivot expected or detected → 1.0 (not applicable)
 * - Pivot detected + explanation present → 1.0
 * - Pivot detected + no explanation → 0.0
 * - Pivot expected but not detected (still recommends same) → 0.5
 */
export function scorePivotExplanation(
  response: string,
  pivotExpected: boolean | undefined,
  priorRecommendation: string | undefined,
  _history: Array<{ question: string; answer: string }>
): number {
  if (pivotExpected === undefined) return 1;
  if (!priorRecommendation) return 1;

  const lower = response.toLowerCase();
  const priorLower = priorRecommendation.toLowerCase();

  const mentionsPrior = lower.includes(priorLower);
  const dismissesIt = PIVOT_DISMISSAL_PATTERNS.some((p) => lower.includes(p));
  const stillRecommendsSame = mentionsPrior && !dismissesIt;

  if (pivotExpected && stillRecommendsSame) return 0.5;
  if (!pivotExpected) return 1;

  const hasExplanation = PIVOT_EXPLANATION_PATTERNS.some((p) =>
    lower.includes(p)
  );
  return hasExplanation ? 1 : 0;
}

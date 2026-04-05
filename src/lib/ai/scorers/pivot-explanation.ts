/**
 * Pivot Explanation scorer for the coaching eval pipeline.
 *
 * Ranking scorer: when the LLM changes its recommendation from a prior
 * turn, checks whether it explains why. Validates that multi-turn
 * conversations reduce the "whiplash" problem.
 */

// Causal language patterns that indicate the LLM is explaining a change
const CAUSAL_PATTERNS = [
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
  // Not a pivot fixture
  if (pivotExpected === undefined) return 1;

  // No prior recommendation to compare against
  if (!priorRecommendation) return 1;

  const lower = response.toLowerCase();
  const priorLower = priorRecommendation.toLowerCase();

  // Check if the response still recommends the same item.
  // Mentioning the prior item in a dismissive context ("less valuable",
  // "no longer", "instead of") doesn't count as still recommending it.
  const mentionsPrior = lower.includes(priorLower);
  const dismissesIt = CAUSAL_PATTERNS.some((p) => lower.includes(p));
  const stillRecommendsSame = mentionsPrior && !dismissesIt;

  if (pivotExpected && stillRecommendsSame) {
    // Expected a pivot but the LLM didn't change its recommendation
    return 0.5;
  }

  if (!pivotExpected) {
    // No pivot expected — consistent recommendation is good
    return 1;
  }

  // Pivot detected (pivotExpected=true and response doesn't mention prior item)
  // Check for causal explanation
  const hasExplanation = CAUSAL_PATTERNS.some((p) => lower.includes(p));
  return hasExplanation ? 1 : 0;
}

/**
 * Pivot Explanation scorer for the coaching eval pipeline.
 *
 * Ranking scorer: when the LLM changes its recommendation from a prior
 * turn, checks whether it explains why. Validates that multi-turn
 * conversations reduce the "whiplash" problem.
 */

// Patterns that indicate the LLM is explaining a change in recommendation
const EXPLANATION_PATTERNS = [
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

// Subset of explanation patterns that indicate the prior item is being
// dismissed rather than reaffirmed. "Keep Thornmail because it's great"
// should NOT count as a dismissal, but "Thornmail is no longer useful"
// should.
const DISMISSAL_PATTERNS = [
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
  // Not a pivot fixture
  if (pivotExpected === undefined) return 1;

  // No prior recommendation to compare against
  if (!priorRecommendation) return 1;

  const lower = response.toLowerCase();
  const priorLower = priorRecommendation.toLowerCase();

  // Check if the response still recommends the same item.
  // Mentioning the prior item alongside dismissal language ("no longer",
  // "instead", "less valuable") counts as pivoting away, not reaffirming.
  // But "keep Thornmail because..." is reaffirming despite causal language.
  const mentionsPrior = lower.includes(priorLower);
  const dismissesIt = DISMISSAL_PATTERNS.some((p) => lower.includes(p));
  const stillRecommendsSame = mentionsPrior && !dismissesIt;

  if (pivotExpected && stillRecommendsSame) {
    // Expected a pivot but the LLM didn't change its recommendation
    return 0.5;
  }

  if (!pivotExpected) {
    // No pivot expected — consistent recommendation is good
    return 1;
  }

  // Pivot detected (pivotExpected=true and response doesn't mention prior item,
  // or mentions it in a dismissive context)
  // Check for causal explanation
  const hasExplanation = EXPLANATION_PATTERNS.some((p) => lower.includes(p));
  return hasExplanation ? 1 : 0;
}

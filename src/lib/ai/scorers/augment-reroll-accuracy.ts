/**
 * Augment Re-Roll Accuracy scorer for the coaching eval pipeline.
 *
 * Gate scorer: checks that the model follows the actual re-roll mechanics
 * when advising on augment selections. Returns 0 if it suggests impossible
 * re-rolls, 1 if it follows the rules correctly, 1 if not an augment question.
 */

/**
 * Check whether a coaching response suggests re-rolling a card that
 * has already been re-rolled.
 *
 * This scorer examines the conversation history to determine the current
 * re-roll state and checks the response against what's actually possible.
 *
 * Returns 1.0 if the response follows re-roll rules or is not about augments.
 * Returns 0.0 if it suggests an impossible re-roll.
 */
export function scoreAugmentRerollAccuracy(
  response: string,
  question: string,
  history: Array<{ question: string; answer: string }>
): number {
  // Only score augment-related exchanges
  if (!isAugmentQuestion(question)) return 1;

  const lower = response.toLowerCase();

  // Check for suggesting re-rolls of cards that can't exist
  // "re-roll all three" is never valid after round 1
  if (isFollowUpRound(history) && suggestsRerollingAll(lower)) {
    return 0;
  }

  return 1;
}

function isAugmentQuestion(question: string): boolean {
  // Augment questions typically list 2-3 options separated by commas, "or", or "and"
  const parts = question
    .split(/,|(?:\s+(?:or|and)\s+)/i)
    .filter((s) => s.trim());
  return parts.length >= 2 && parts.length <= 4;
}

function isFollowUpRound(
  history: Array<{ question: string; answer: string }>
): boolean {
  // If there's a recent augment exchange in history, this might be a follow-up round
  if (history.length === 0) return false;

  const lastExchange = history[history.length - 1];
  const lastWasAugment = isAugmentQuestion(lastExchange.question);
  const lastAnswerRecommendedReroll =
    lastExchange.answer.toLowerCase().includes("re-roll") ||
    lastExchange.answer.toLowerCase().includes("reroll");

  return lastWasAugment && lastAnswerRecommendedReroll;
}

function suggestsRerollingAll(response: string): boolean {
  return (
    response.includes("re-roll all three") ||
    response.includes("reroll all three") ||
    response.includes("re-roll all 3") ||
    response.includes("reroll all 3")
  );
}

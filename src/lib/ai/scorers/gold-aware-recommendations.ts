/**
 * Gold-Aware Recommendations scorer for the coaching eval pipeline.
 *
 * Gate scorer: checks that item recommendations follow the
 * destination + component format. The response should name
 * a completed (destination) item AND a buildable component.
 */

// Same item-question gate used by the gold-awareness scorer
const ITEM_QUESTION_PATTERN = /item|buy|build|next|shop|gold/i;

// Patterns indicating the response names a destination (completed) item
const DESTINATION_PATTERNS = [/build toward\s/i, /build towards\s/i];

// Patterns indicating the response names a component to buy
const COMPONENT_PATTERNS = [
  /you can get (?:a |an )?\w/i,
  /pick up (?:a |an )?\w/i,
  /grab (?:a |an )?\w/i,
  /\bbuy (?:a |an )?\w/i,
];

/**
 * Check whether an item recommendation follows the destination + component format.
 *
 * Returns 1.0 if:
 * - Not an item-related question (scorer doesn't apply)
 * - Gold is 0 (nothing to buy)
 * - Response names both a destination item and a component
 *
 * Returns 0.0 if:
 * - Response only names a component without a destination
 * - Response only names a destination without a component
 */
export function scoreGoldAwareRecommendations(
  response: string,
  gold: number,
  question: string
): number {
  // Only score item-related questions
  if (!ITEM_QUESTION_PATTERN.test(question)) return 1;
  if (gold === 0) return 1;

  const hasDestination = DESTINATION_PATTERNS.some((p) => p.test(response));
  const hasComponent = COMPONENT_PATTERNS.some((p) => p.test(response));

  // Both must be present for an item recommendation to pass
  if (hasDestination && hasComponent) return 1;

  // If neither is present, the response might not be an item recommendation
  // (e.g., a tactical answer to a question containing "next")
  if (!hasDestination && !hasComponent) return 1;

  // One without the other is a format violation
  return 0;
}

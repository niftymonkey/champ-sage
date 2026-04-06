/**
 * Gold-Aware Recommendations scorer for the coaching eval pipeline.
 *
 * Gate scorer: checks that item recommendations follow the
 * destination + component format. Gates primarily on the response
 * content (purchase verbs), with a narrow question-level exclusion
 * for augment confirmations.
 */

// Questions where item format doesn't apply:
// - Augment confirmations ("I chose X")
// - Augment offers (listing options: "X, Y, or Z")
const AUGMENT_CONFIRMATION_PATTERN =
  /^i (?:chose|picked|took|selected|went with|choose)\b/i;
const AUGMENT_OFFER_PATTERN = /\w+,\s+\w+.+(?:,\s+or\s+|,\s+)\w+/i;

// Patterns indicating the response contains an item purchase recommendation
const PURCHASE_VERB_PATTERN =
  /\b(buy|build toward|build towards|pick up|grab|rush|get a|get an)\b/i;

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
 * Gates on response content: if the response contains a purchase verb
 * (buy, build toward, etc.), it's an item recommendation and must follow
 * the format. Augment confirmations ("I chose X") are excluded since the
 * model may mention items in follow-up advice without it being a purchase
 * recommendation.
 *
 * Returns 1.0 if:
 * - Gold is 0 (nothing to buy)
 * - Question is an augment confirmation
 * - Response has no purchase verbs (not an item recommendation)
 * - Response names both a destination item and a component
 *
 * Returns 0.0 if:
 * - Response has a purchase verb but only names a component without a destination
 * - Response has a purchase verb but only names a destination without a component
 */
export function scoreGoldAwareRecommendations(
  response: string,
  gold: number,
  question: string
): number {
  if (gold === 0) return 1;

  // Skip augment interactions — incidental item mentions shouldn't trigger
  if (AUGMENT_CONFIRMATION_PATTERN.test(question)) return 1;
  if (AUGMENT_OFFER_PATTERN.test(question)) return 1;

  // Gate on response content — does it contain a purchase recommendation?
  if (!PURCHASE_VERB_PATTERN.test(response)) return 1;

  const hasDestination = DESTINATION_PATTERNS.some((p) => p.test(response));
  const hasComponent = COMPONENT_PATTERNS.some((p) => p.test(response));

  // Both must be present for an item recommendation to pass
  if (hasDestination && hasComponent) return 1;

  // One without the other is a format violation
  return 0;
}

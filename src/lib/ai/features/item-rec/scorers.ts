/**
 * Item-rec scorers.
 *
 * The item-rec feature returns short prose plus a list of recommended
 * items. These scorers measure correctness against the player's current
 * inventory (don't recommend owned items, don't warn about not re-buying
 * unprompted) and format compliance for purchase recommendations
 * (destination + component).
 *
 * Relocated from the flat `src/lib/ai/scorers/` directory in #108 phase 8.
 */

/**
 * Check whether a coaching response recommends any item the player already owns.
 *
 * Returns 1.0 if the response avoids recommending owned items.
 * Returns 0.0 if the response recommends one or more owned items.
 * Returns 1.0 if no item-like recommendations are detected (not an item question).
 */
export function scoreItemAwareness(
  response: string,
  ownedItems: string[]
): number {
  if (ownedItems.length === 0) return 1;

  const lower = response.toLowerCase();

  for (const item of ownedItems) {
    const itemLower = item.toLowerCase();
    if (isRecommendingPurchase(lower, itemLower)) {
      return 0;
    }
  }

  return 1;
}

/**
 * Detect whether the response is recommending the player BUY a specific item.
 *
 * Intentionally avoids false positives from mentions like:
 * - "You already have Titanic Hydra" (acknowledging, not recommending)
 * - "Since you have Bami's Cinder, build into Sunfire" (referencing, not recommending purchase)
 * - "Your Titanic Hydra gives you enough damage" (discussing existing item)
 */
function isRecommendingPurchase(response: string, item: string): boolean {
  if (item.length <= 3) return false;

  const purchasePatterns = [
    `buy ${item}`,
    `buy **${item}**`,
    `build ${item}`,
    `build **${item}**`,
    `get ${item}`,
    `get **${item}**`,
    `finish ${item}`,
    `finish **${item}**`,
    `rush ${item}`,
    `rush **${item}**`,
    `grab ${item}`,
    `grab **${item}**`,
    `pick up ${item}`,
    `pick up **${item}**`,
    `take ${item}`,
    `take **${item}**`,
  ];

  return purchasePatterns.some((p) => response.includes(p));
}

const UNNECESSARY_WARNING_PATTERNS = [
  "don't buy .+ again",
  "don't purchase .+ again",
  "don't get .+ again",
  "do not buy .+ again",
  "no need to buy .+ again",
  "you already have .+, so don't",
  "don't rebuy",
  "don't re-buy",
];

/**
 * Check whether a coaching response includes unnecessary warnings about
 * not re-buying owned items when the player didn't ask about it.
 *
 * Returns 1.0 if the response doesn't contain unnecessary warnings.
 * Returns 0.0 if it warns about not re-buying items unprompted.
 */
export function scoreUnnecessaryWarnings(
  response: string,
  question: string
): number {
  if (/again|rebuy|re-buy|duplicate/i.test(question)) return 1;

  const lower = response.toLowerCase();
  const hasWarning = UNNECESSARY_WARNING_PATTERNS.some((p) =>
    new RegExp(p).test(lower)
  );
  return hasWarning ? 0 : 1;
}

const AUGMENT_CONFIRMATION_PATTERN =
  /^i (?:chose|picked|took|selected|went with|choose)\b/i;
const AUGMENT_OFFER_PATTERN = /\w+,\s+\w+.+(?:,\s+or\s+|,\s+)\w+/i;

const PURCHASE_VERB_PATTERN =
  /\b(buy|build toward|build towards|pick up|grab|rush|get a|get an)\b/i;

const DESTINATION_PATTERNS = [/build toward\s/i, /build towards\s/i];

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

  if (AUGMENT_CONFIRMATION_PATTERN.test(question)) return 1;
  if (AUGMENT_OFFER_PATTERN.test(question)) return 1;

  if (!PURCHASE_VERB_PATTERN.test(response)) return 1;

  const hasDestination = DESTINATION_PATTERNS.some((p) => p.test(response));
  const hasComponent = COMPONENT_PATTERNS.some((p) => p.test(response));

  if (hasDestination && hasComponent) return 1;

  return 0;
}

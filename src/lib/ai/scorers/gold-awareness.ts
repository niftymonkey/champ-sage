/**
 * Gold Awareness scorer for the coaching eval pipeline.
 *
 * Ranking scorer: checks that the model uses the player's gold amount
 * to make concrete buy recommendations rather than hedging with
 * "if you can afford it" type language.
 */

const HEDGE_PATTERNS = [
  "if you can buy",
  "if you can afford",
  "if you have enough",
  "if you can purchase",
  "when you have enough",
  "when you can afford",
  "save up for",
  "save gold for",
];

/**
 * Check whether a coaching response hedges about gold when the player's
 * gold amount is known.
 *
 * Returns 1.0 if the response doesn't hedge about gold.
 * Returns 0.0 if it hedges despite having exact gold info.
 * Returns 1.0 if gold is 0 (nothing to buy anyway) or not an item question.
 */
export function scoreGoldAwareness(
  response: string,
  gold: number,
  question: string
): number {
  // Only score item-related questions where gold matters
  if (!/item|buy|build|next|shop|gold/i.test(question)) return 1;
  if (gold === 0) return 1;

  const lower = response.toLowerCase();
  const hedges = HEDGE_PATTERNS.some((p) => lower.includes(p));
  return hedges ? 0 : 1;
}

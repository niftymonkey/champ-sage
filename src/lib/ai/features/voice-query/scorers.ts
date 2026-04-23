/**
 * Voice-query scorers.
 *
 * Voice queries are open-ended conversational coaching responses. The
 * scorers here measure prose quality of the `answer` field: continuity
 * with prior turns, decisiveness vs hedging, and gold-aware framing
 * when the question implies an item purchase.
 *
 * Relocated from the flat `src/lib/ai/scorers/` directory in #108 phase 8.
 */

/**
 * Check whether a coaching response references an expected topic
 * from earlier in the conversation.
 *
 * Returns 1.0 if the response references the expected topic.
 * Returns 0.0 if the response seems unaware of the referenced context.
 * Returns 1.0 if no expected reference is defined (not a continuity test).
 */
export function scoreConversationalContinuity(
  response: string,
  expectedReferences: string[] | undefined
): number {
  if (!expectedReferences || expectedReferences.length === 0) return 1;

  const lower = response.toLowerCase();
  const found = expectedReferences.some((ref) =>
    lower.includes(ref.toLowerCase())
  );

  return found ? 1 : 0;
}

/**
 * Score response decisiveness. The response should give clear fit assessments,
 * not deflect the decision entirely.
 *
 * Phrases like "both are viable" are legitimate when augments genuinely tie on
 * fit rating. Only penalize true non-answers that avoid evaluating the options.
 *
 * Returns 1.0 for decisive responses, 0.0 for hedgy ones.
 */
export function scoreDecisiveness(response: string): number {
  const lower = response.toLowerCase();

  const hedges = [
    "it depends",
    "it's up to you",
    "you could go either way",
    "it really depends on",
  ];

  const hedgeCount = hedges.filter((h) => lower.includes(h)).length;
  if (hedgeCount >= 2) return 0;
  if (hedgeCount === 1) return 0.5;
  return 1;
}

const GOLD_HEDGE_PATTERNS = [
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
  if (!/item|buy|build|next|shop|gold/i.test(question)) return 1;
  if (gold === 0) return 1;

  const lower = response.toLowerCase();
  const hedges = GOLD_HEDGE_PATTERNS.some((p) => lower.includes(p));
  return hedges ? 0 : 1;
}

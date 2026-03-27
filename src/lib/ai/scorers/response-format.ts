/**
 * Response Format scorer for the coaching eval pipeline.
 *
 * Gate scorer: checks that responses are concise and decisive.
 */

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

/**
 * Score response decisiveness. The response should give a clear recommendation,
 * not a menu of hedged options.
 *
 * Returns 1.0 for decisive responses, 0.0 for hedgy ones.
 */
export function scoreDecisiveness(response: string): number {
  const lower = response.toLowerCase();

  // Hedging patterns
  const hedges = [
    "it depends",
    "it's up to you",
    "you could go either way",
    "both are viable",
    "any of these would work",
    "there's no wrong choice",
    "it really depends on",
    "you can't go wrong with",
  ];

  const hedgeCount = hedges.filter((h) => lower.includes(h)).length;
  if (hedgeCount >= 2) return 0;
  if (hedgeCount === 1) return 0.5;
  return 1;
}

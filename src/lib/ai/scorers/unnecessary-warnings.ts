/**
 * Unnecessary Warnings scorer for the coaching eval pipeline.
 *
 * Ranking scorer: checks that the model doesn't add unprompted warnings
 * about not buying items the player already owns. The player didn't ask
 * about re-buying items, so "don't buy X again" is noise.
 */

const WARNING_PATTERNS = [
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
  // If the player explicitly mentions buying something again, warnings are warranted
  if (/again|rebuy|re-buy|duplicate/i.test(question)) return 1;

  const lower = response.toLowerCase();
  const hasWarning = WARNING_PATTERNS.some((p) => new RegExp(p).test(lower));
  return hasWarning ? 0 : 1;
}

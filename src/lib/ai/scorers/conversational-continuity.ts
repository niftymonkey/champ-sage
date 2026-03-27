/**
 * Conversational Continuity scorer for the coaching eval pipeline.
 *
 * Ranking scorer: checks whether the model can resolve references
 * to earlier conversation when context is available.
 *
 * Returns 1.0 if the response references the expected topic.
 * Returns 0.0 if the response seems unaware of the referenced context.
 * Returns 1.0 if no expected reference is defined (not a continuity test).
 */

/**
 * Check whether a coaching response references an expected topic
 * from earlier in the conversation.
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

/**
 * Personality layer for coaching responses (#24 prerequisite).
 *
 * A personality is a voice/tone modifier applied to every system prompt
 * the session emits. Decoupled from feature task prompts so a single
 * personality choice tints every answer (game plan, augment fit, voice
 * query, etc.) without each feature reasoning about it.
 *
 * Position: the personality's `suffix()` lands after the feature task
 * prompt and right before the conversation messages. LLMs follow recent
 * instructions more reliably than buried ones — putting voice rules at
 * the tail keeps them effective regardless of how long the base context
 * grows.
 */
export interface PersonalityLayer {
  readonly id: string;
  /**
   * Prompt fragment appended after the feature task prompt. Empty string
   * means "no voice instruction" (see `noopPersonality`).
   */
  suffix(): string;
}

/**
 * Structural fallback that adds nothing to the prompt. Used by the eval
 * harness and any caller that wants the base context + task prompt
 * untouched. NOT a tone — it's the absence of one.
 */
export const noopPersonality: PersonalityLayer = {
  id: "no-op",
  suffix: () => "",
};

/**
 * The default personality. Reinforces brevity, lead-with-recommendation,
 * and audience-awareness rules that previously lived in `buildBaseContext`.
 * Moving them into a personality means future personalities (#24) replace
 * the voice layer cleanly instead of fighting embedded brevity instructions.
 */
export const briefPersonality: PersonalityLayer = {
  id: "brief",
  suffix: () =>
    [
      "RESPONSE RULES:",
      "- Respond in 1-3 sentences maximum. Shorter is always better — the player is mid-game. Sacrifice grammar for brevity.",
      "- Lead with your top recommendation. Mention alternatives only when the situation genuinely supports different playstyles.",
      "- Never explain what the player already knows.",
    ].join("\n"),
};

/**
 * First non-default personality. The voice signal needs to be loud enough
 * to cut through ~5500 chars of base context + task prompt — subtle tone
 * shifts read as noise next to the monolithic system prompt. Pirate was
 * picked for its unique vocabulary (arr, ye, matey, yer, be) which is
 * immediately audible in the response. Pirate speech is also naturally
 * clipped, so it plays well with the brevity budget rather than fighting
 * it like Shakespearean or Victorian voices would.
 */
export const piratePersonality: PersonalityLayer = {
  id: "pirate",
  suffix: () =>
    [
      "RESPONSE RULES:",
      "- Respond as a pirate. Use pirate vocabulary liberally: arr, ye, matey, aye, yer, be (for is/are), 'ain, plunder, booty, scurvy, landlubber, hearty.",
      "- Keep pirate grammar: 'ye be needin'', 'that there', 'this here', drop the 'g' on -ing verbs ('buildin'', 'rushin'').",
      "- 1-3 short sentences maximum. Shorter is always better — pirate speech is naturally clipped. Sacrifice grammar for brevity.",
      "- Lead with your top recommendation.",
      "- Never explain what the player already knows.",
      "- Example: 'Arr, grab Thornmail, matey. Yi be healin' too hard.'",
    ].join("\n"),
};

/**
 * Task prompt for the post-game-takeaway feature.
 *
 * Generates the narrative paragraph that anchors the post-game surface.
 * The surface itself renders the structured numbers (KDA, build, decisions
 * timeline); the LLM only writes the prose reflection.
 */
export const POST_GAME_TAKEAWAY_TASK_PROMPT = [
  "POST-GAME TAKEAWAY: Reflect on the just-ended match in 2-4 sentences.",
  "- Past tense, narrative voice. Speak about what happened, not what should have happened.",
  "- No advice, no should-haves, no recommendations for next time. The player is done; this is a calm reflection, not a coaching lecture.",
  "- Italic emphasis via single-asterisk markdown on key items, augments, or pivots (e.g. *Kraken Slayer*, *Magic Missile*). Use sparingly — at most three emphasized terms total.",
  "- Anchor the reflection in concrete events from the [Game Summary] block: the plan, the pivots, what the player asked, what they bought.",
  "- If the build matched the recommended plan well, say so plainly. If it diverged, name the divergence without judgment.",
  "- No salutations, no sign-offs, no headings, no bullets. Just the paragraph.",
].join("\n");

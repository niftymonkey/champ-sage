import { MISSING_DESCRIPTION_PLACEHOLDER } from "../../../data-ingest/sources/community-dragon";

/**
 * Task prompt for augment-fit feature.
 *
 * Rates each offered augment on the 4-tier fit scale and flags creative
 * synergy builds enabled by augment / item / ability / stat anvil
 * combinations. This block is appended to the base context on every
 * augment-offer LLM call; base context carries the champion, roster, and
 * item catalog, and the user message carries the per-offer augment
 * descriptions and tiers.
 */
export const AUGMENT_FIT_TASK_PROMPT = [
  "AUGMENT FIT RATING:",
  "- Augments are NOT items. They are permanent passive bonuses.",
  "- Rate each offered augment independently using the `fit` field: exceptional, strong, situational, or weak. Ties are expected — two augments can both be strong, or all three can be weak.",
  "- ALWAYS return all offered augments in the recommendations array, each with its own fit rating and reasoning. The UI renders a badge on every card.",
  "- Fit tiers (default to strong or situational — most augments are one of these):",
  "  - exceptional: RARE. Only for augments that unlock a multiplicative synergy the player's existing build is already set up to exploit — e.g. Dual Wield when they already have 3+ on-hit items, or a percent-HP augment on a champion stacking health items. If the augment is simply 'good for this champion', that is strong, not exceptional. Expect fewer than 1 in 10 offers to contain an exceptional augment.",
  "  - strong: Good fit for the current champion, build, and game state. This is the correct rating for augments that align well with the champion's kit or build direction.",
  "  - situational: Conditional value — could pay off depending on how the game develops, decent but not ideal, or has a prerequisite that isn't fully met yet.",
  "  - weak: Poor fit for the current state. Explain briefly why.",
  "- Reasoning describes what the augment does and why it fits (or doesn't) the current state. No imperative language — do not say 'pick this', 'take this', or 'reroll that'.",
  "- If an augment upgrades a specific item, only rate it strong/exceptional if the player already owns that item.",
  "- Mayhem augments are standalone. The 26.12 rework removed set and trait bonuses, so there is no set progression to chase: rate each augment purely on its own value for this champion, build, and game state. The newer Ability Augments reshape a single ability (e.g., Multishot, Chain Reaction), so weigh how central that ability is to the champion's pattern.",
  "- Use the augment descriptions provided, not your general knowledge.",
  `- An augment whose description reads "${MISSING_DESCRIPTION_PLACEHOLDER}" is new this patch and not yet documented. Rate it conservatively (situational by default) from its name and tier alone, state in the reasoning that its exact effect is not yet confirmed, and suggest the player check the in-game tooltip. Do NOT invent specific numbers or mechanics for it.`,
  "",
  "SYNERGY COACHING:",
  "- Look for synergies the offer opens up: augment-item combos, augment-ability combos, and stat anvil pairings. An AD champion with a tank augment like Goliath might pivot into a Heartsteel build. A mage with attack speed augments might go on-hit.",
  "- When an augment changes what items are optimal, recommend the synergy build and explain WHY it works: the player needs to understand the reasoning, not just the pick.",
  "- Don't default to cookie-cutter builds. ARAM Mayhem rewards creative synergies that wouldn't work in standard modes.",
].join("\n");

/**
 * Task prompt for augment-fit feature.
 *
 * Rates each offered augment on the 4-tier fit scale and flags creative
 * synergy builds enabled by augment / set bonus / item / stat anvil
 * combinations. This block is appended to the base context on every
 * augment-offer LLM call; base context carries the champion, roster, and
 * item catalog, and the user message carries the per-offer set annotations
 * (e.g., `Wired 2/4 — UNLOCKS: +10% attack speed`).
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
  "- Consider augment set progression when rating. Each offered augment's annotation (e.g., `Wired 2/4 — UNLOCKS: +10% attack speed`) tells you whether picking it would advance or complete a set bonus. A bonus the player would actually unlock adds to the augment's value — mention it in the reasoning and let it nudge the rating upward when the bonus is impactful. Standalone value still matters most; set math amplifies a good fit, it doesn't rescue a fundamental mismatch (an AP-scaling augment on a pure-AD champion stays situational or weak regardless of set progress).",
  "- Use the augment descriptions and set annotations provided, not your general knowledge.",
  "",
  "SYNERGY COACHING:",
  "- Look for synergies the offer opens up — augment-item combos, augment-ability combos, set-bonus completions, and stat anvil pairings. An AD champion with a tank augment like Goliath might pivot into a Heartsteel build. A mage with attack speed augments might go on-hit. A near-complete augment set can justify a different build direction than the standalone augment alone would suggest.",
  "- When an augment or set bonus changes what items are optimal, recommend the synergy build and explain WHY it works — the player needs to understand the reasoning, not just the pick.",
  "- Don't default to cookie-cutter builds. ARAM Mayhem rewards creative synergies that wouldn't work in standard modes.",
].join("\n");

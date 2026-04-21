import type { GameMode } from "../mode/types";

/**
 * Feature-specific rule blocks, composed after the base context.
 *
 * This file is a temporary home for Phase 2 of the #108 refactor. Phase 3
 * dismantles it by moving each block into its owning feature's task prompt:
 *   - ITEM RECOMMENDATIONS / PROACTIVE AWARENESS / ITEM POOL USAGE
 *     → `features/item-rec/prompt.ts`
 *   - AUGMENT FIT RATING / SYNERGY COACHING
 *     → `features/augment-fit/prompt.ts`
 */
export function buildFeatureRules(mode: GameMode): string {
  const sections: string[] = [];

  sections.push(
    "ITEM RECOMMENDATIONS: When recommending an item purchase, always name the destination (completed) item AND a buildable component. If the player can afford a component: 'Build toward Rabadon's Deathcap. You can get a Needlessly Large Rod now.' If not: 'Build toward Rabadon's Deathcap. You can get a Needlessly Large Rod at 1250g.' Name the most expensive component the player can currently afford. If no component is affordable, name the cheapest and its gold threshold. Never recommend unrelated filler items just to spend gold. For non-purchase responses (strategy, positioning, augments), just name items naturally without this format."
  );
  sections.push("");
  sections.push(
    "PROACTIVE AWARENESS: Before answering any item question, check the enemy team composition. If the enemy has heavy healing (Soraka, Aatrox, Yuumi, Warwick, Dr. Mundo), mention grievous wounds. If 3+ enemies deal magic damage, mention magic resist. If you notice other build gaps (missing resistances, unusually high unspent gold), flag them briefly."
  );
  sections.push("");
  sections.push(
    "ITEM POOL USAGE: When an item pool is provided for the player's champion, treat it as a curated set of viable items — NOT as a build order or a list to regurgitate. Choose items from the pool that specifically counter the enemy team composition and address the player's current game state. Different matchups should produce different recommendations from the same pool. If the enemy comp or game state calls for something outside the pool (grievous wounds, specific defensive items, matchup counters), recommend from the broader available items instead — do not restrict yourself to the pool."
  );

  if (mode.decisionTypes.includes("augment-selection")) {
    sections.push("");
    sections.push("AUGMENT FIT RATING:");
    sections.push(
      "- Augments are NOT items. They are permanent passive bonuses."
    );
    sections.push(
      "- Rate each offered augment independently using the `fit` field: exceptional, strong, situational, or weak. Ties are expected — two augments can both be strong, or all three can be weak."
    );
    sections.push(
      "- ALWAYS return all offered augments in the recommendations array, each with its own fit rating and reasoning. The UI renders a badge on every card."
    );
    sections.push(
      "- Fit tiers (default to strong or situational — most augments are one of these):"
    );
    sections.push(
      "  - exceptional: RARE. Only for augments that unlock a multiplicative synergy the player's existing build is already set up to exploit — e.g. Dual Wield when they already have 3+ on-hit items, or a percent-HP augment on a champion stacking health items. If the augment is simply 'good for this champion', that is strong, not exceptional. Expect fewer than 1 in 10 offers to contain an exceptional augment."
    );
    sections.push(
      "  - strong: Good fit for the current champion, build, and game state. This is the correct rating for augments that align well with the champion's kit or build direction."
    );
    sections.push(
      "  - situational: Conditional value — could pay off depending on how the game develops, decent but not ideal, or has a prerequisite that isn't fully met yet."
    );
    sections.push(
      "  - weak: Poor fit for the current state. Explain briefly why."
    );
    sections.push(
      "- Reasoning describes what the augment does and why it fits (or doesn't) the current state. No imperative language — do not say 'pick this', 'take this', or 'reroll that'."
    );
    sections.push(
      "- If an augment upgrades a specific item, only rate it strong/exceptional if the player already owns that item."
    );
    sections.push(
      "- Use the augment descriptions provided in the prompt, not your general knowledge."
    );
    sections.push("");
    sections.push("SYNERGY COACHING:");
    sections.push(
      "- Look for unconventional build paths enabled by augment, set bonus, item, and stat anvil synergies. An AD champion with a tank augment like Goliath might pivot into a Heartsteel build. A mage with attack speed augments might go on-hit."
    );
    sections.push(
      "- When an augment or set bonus changes what items are optimal, recommend the synergy build and explain WHY it works — the player needs to understand the reasoning, not just the pick."
    );
    sections.push(
      "- Don't default to cookie-cutter builds. ARAM Mayhem rewards creative synergies that wouldn't work in standard modes."
    );
  }

  return sections.join("\n");
}

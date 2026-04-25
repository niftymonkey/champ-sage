/**
 * Task prompt for item-rec feature.
 *
 * Frames recommendations as multi-option comparisons (not single prescriptive
 * picks), enforces the destination + component item-purchase format on every
 * option, adds proactive awareness for grievous-wounds / MR / resistance
 * gaps, and treats the item pool as a curated viable set (not a build
 * order). This block is appended to the base context on every item-rec
 * LLM call. The routing layer (`isItemRecQuestion`) only sends item-purchase
 * questions here, so the universal format rule is safe — non-item queries
 * don't reach this feature.
 */
export const ITEM_REC_TASK_PROMPT = [
  "ITEM RECOMMENDATIONS — OPTIONS, NOT IMPERATIVES: Present 2–3 viable items in the recommendations list, each with its own fit rating and reasoning. The answer field should acknowledge the comparison ('X and Y both work for different reasons' or 'Consider X for damage or Y for survivability'), not declare a single winner. Players want reasoning to compare; they don't want to be told what to do.",
  "",
  "DESTINATION + COMPONENT FORMAT: For each recommended option, name a destination (completed) item AND a buildable component the player can act on. Use this format inside the answer field: 'X and Y are both strong. For Rabadon's, you can get a Needlessly Large Rod now; for Zhonya's, a Seeker's Armguard.' If a component isn't yet affordable, include the gold threshold: '...a Needlessly Large Rod at 1250g.' For each option, name the most expensive component the player can currently afford; if none is affordable, name the cheapest with its gold threshold. Never recommend unrelated filler items just to spend gold.",
  "",
  "PROACTIVE AWARENESS: Before answering any item question, check the enemy team composition. If the enemy has heavy healing (Soraka, Aatrox, Yuumi, Warwick, Dr. Mundo), surface grievous wounds as one of the options. If 3+ enemies deal magic damage, surface magic resist. If you notice other build gaps (missing resistances, unusually high unspent gold), flag them briefly.",
  "",
  "ITEM POOL USAGE: When an item pool is provided for the player's champion, treat it as a curated set of viable items — NOT as a build order or a list to regurgitate. Choose items from the pool that specifically counter the enemy team composition and address the player's current game state. Different matchups should produce different recommendations from the same pool. If the enemy comp or game state calls for something outside the pool (grievous wounds, specific defensive items, matchup counters), recommend from the broader available items instead — do not restrict yourself to the pool.",
].join("\n");

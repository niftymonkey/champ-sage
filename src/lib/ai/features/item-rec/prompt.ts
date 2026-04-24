/**
 * Task prompt for item-rec feature.
 *
 * Enforces the destination + component item-purchase format on EVERY
 * response, adds proactive awareness for grievous-wounds / MR / resistance
 * gaps, and treats the item pool as a curated viable set (not a build
 * order). This block is appended to the base context on every item-rec
 * LLM call. The routing layer (`isItemRecQuestion`) only sends item-purchase
 * questions here, so the universal format rule is safe — non-item queries
 * don't reach this feature.
 */
export const ITEM_REC_TASK_PROMPT = [
  "ITEM RECOMMENDATIONS: Every response must name a destination (completed) item AND a buildable component — no exceptions. This applies equally to fresh recommendations, yes/no confirmations ('keep building tank'), clarifications, follow-ups, corrections, and replies to player pushback or frustration. If the player asks for more specificity or challenges a prior answer, respond with an updated destination+component, not a conversational explanation. Format: 'Build toward Rabadon's Deathcap. You can get a Needlessly Large Rod now.' If not affordable: 'Build toward Rabadon's Deathcap. You can get a Needlessly Large Rod at 1250g.' Name the most expensive component the player can currently afford; if none is affordable, name the cheapest and its gold threshold. Never recommend unrelated filler items just to spend gold.",
  "",
  "PROACTIVE AWARENESS: Before answering any item question, check the enemy team composition. If the enemy has heavy healing (Soraka, Aatrox, Yuumi, Warwick, Dr. Mundo), mention grievous wounds. If 3+ enemies deal magic damage, mention magic resist. If you notice other build gaps (missing resistances, unusually high unspent gold), flag them briefly.",
  "",
  "ITEM POOL USAGE: When an item pool is provided for the player's champion, treat it as a curated set of viable items — NOT as a build order or a list to regurgitate. Choose items from the pool that specifically counter the enemy team composition and address the player's current game state. Different matchups should produce different recommendations from the same pool. If the enemy comp or game state calls for something outside the pool (grievous wounds, specific defensive items, matchup counters), recommend from the broader available items instead — do not restrict yourself to the pool.",
].join("\n");

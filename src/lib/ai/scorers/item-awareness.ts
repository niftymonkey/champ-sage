/**
 * Item Awareness scorer for the coaching eval pipeline.
 *
 * Gate scorer: checks that the model does not recommend items
 * the player already owns. Returns 0 if it does, 1 if it doesn't.
 */

/**
 * Check whether a coaching response recommends any item the player already owns.
 *
 * Returns 1.0 if the response avoids recommending owned items.
 * Returns 0.0 if the response recommends one or more owned items.
 * Returns 1.0 if no item-like recommendations are detected (not an item question).
 */
export function scoreItemAwareness(
  response: string,
  ownedItems: string[]
): number {
  if (ownedItems.length === 0) return 1;

  const lower = response.toLowerCase();

  for (const item of ownedItems) {
    const itemLower = item.toLowerCase();
    // Look for patterns like "Buy **Item**" or "Build **Item**" or "get **Item**"
    // that indicate a recommendation to acquire an item the player already has
    if (isRecommendingPurchase(lower, itemLower)) {
      return 0;
    }
  }

  return 1;
}

/**
 * Detect whether the response is recommending the player BUY a specific item.
 *
 * This intentionally avoids false positives from mentions like:
 * - "You already have Titanic Hydra" (acknowledging, not recommending)
 * - "Since you have Bami's Cinder, build into Sunfire" (referencing, not recommending purchase)
 * - "Your Titanic Hydra gives you enough damage" (discussing existing item)
 */
function isRecommendingPurchase(response: string, item: string): boolean {
  // Skip very short/generic item names that would cause false positives
  if (item.length <= 3) return false;

  // Patterns that indicate "go buy this item"
  const purchasePatterns = [
    `buy ${item}`,
    `buy **${item}**`,
    `build ${item}`,
    `build **${item}**`,
    `get ${item}`,
    `get **${item}**`,
    `finish ${item}`,
    `finish **${item}**`,
    `rush ${item}`,
    `rush **${item}**`,
    `grab ${item}`,
    `grab **${item}**`,
    `pick up ${item}`,
    `pick up **${item}**`,
    `take ${item}`,
    `take **${item}**`,
  ];

  return purchasePatterns.some((p) => response.includes(p));
}

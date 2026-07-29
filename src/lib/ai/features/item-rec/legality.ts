/**
 * Deterministic post-hoc enforcement of item-recommendation legality
 * (issue #117), the item-rec counterpart of the game-plan build-path sweep.
 *
 * The two surfaces enforce DIFFERENT rules because they mean different things.
 * A build path is an END-STATE 6-slot inventory: every entry must be able to
 * co-exist with every other, and an owned item legitimately echoes once in the
 * slot it already fills. A recommendation list is a set of ALTERNATIVES the
 * player picks ONE of. That inverts two rules:
 *
 * - **Options never eliminate each other.** Two Last Whisper items, or two
 *   pairs of boots, side by side are a legitimate comparison, not an illegal
 *   inventory. Only a slot the player's INVENTORY already holds eliminates an
 *   option. (Exact duplicate names are still dropped: listing one item twice
 *   is not a comparison.)
 * - **An owned item is never a legal option.** There is no echo rule here.
 *   Buying it again buys nothing, so an owned name, and the purchasable base
 *   of an owned evolved item (owning Muramana makes Manamune a no-op),
 *   is dropped outright.
 *
 * Mode availability is identical to the build path: an option is mode-legal
 * when SOME same-named catalog variant is `isBuildPathEligible` for the
 * current mode. Names the catalog does not know are never dropped: nothing
 * about them is proven.
 */

import type { Recommendation } from "../../types";
import type { Item } from "../../../data-ingest/types";
import type { GameMode } from "../../../mode/types";
import {
  buildItemNameIndex,
  resolveInventorySlots,
  type InventorySlots,
  type ItemNameIndex,
} from "../../item-legality";

/** An option removed because the player already owns it. `ownedName` is the
 *  owned item's display name, which differs from the option's name when the
 *  option is the purchasable base of an owned evolved item. */
export interface AlreadyOwnedDrop {
  kind: "already-owned";
  recommendation: Recommendation;
  ownedName: string;
}

/** An option removed because an owned item holds its restriction group, so
 *  the shop refuses the purchase. */
export interface OwnedGroupCollisionDrop {
  kind: "owned-group-collision";
  recommendation: Recommendation;
  /** The restriction group both items share (e.g. "Fatality"). */
  group: string;
  ownedName: string;
}

/** An option removed because the player already owns a finished pair of
 *  boots and the game allows only one. */
export interface OwnedBootsCollisionDrop {
  kind: "owned-boots-collision";
  recommendation: Recommendation;
  ownedName: string;
}

/** An option removed because an earlier surfaced option carries the same
 *  name. Two identical options are not a comparison. */
export interface DuplicateOptionDrop {
  kind: "duplicate-option";
  recommendation: Recommendation;
}

/** An option removed because no same-named catalog variant is purchasable in
 *  the current game mode. */
export interface OptionModeUnavailableDrop {
  kind: "mode-unavailable";
  recommendation: Recommendation;
  /** Display name of the mode the item is unavailable in, for logs. */
  modeName: string;
}

export type RecommendationDrop =
  | AlreadyOwnedDrop
  | OwnedGroupCollisionDrop
  | OwnedBootsCollisionDrop
  | DuplicateOptionDrop
  | OptionModeUnavailableDrop;

export interface RecommendationLegalityResult {
  /** The options with every illegal one removed. */
  recommendations: Recommendation[];
  /** Options dropped, in the order they were offered. Empty when every
   *  option was legal. */
  dropped: RecommendationDrop[];
}

/**
 * Filter a model's item options down to the ones the player can actually buy
 * right now. See the module docblock for how the rules differ from the
 * build-path sweep.
 *
 * Each option is checked in this order: duplicate of an earlier option,
 * already owned, unavailable in this mode, blocked by owned boots, blocked by
 * an owned item's restriction group.
 */
export function enforceRecommendationLegality(
  recommendations: readonly Recommendation[],
  items: ReadonlyMap<number, Item>,
  mode: GameMode,
  ownedItemNames: readonly string[] = []
): RecommendationLegalityResult {
  const index = buildItemNameIndex(items, mode);
  const inventory = resolveInventorySlots(index, items, ownedItemNames);

  const kept: Recommendation[] = [];
  const dropped: RecommendationDrop[] = [];
  const keptNames = new Set<string>();

  for (const recommendation of recommendations) {
    const name = recommendation.name;

    if (keptNames.has(name)) {
      dropped.push({ kind: "duplicate-option", recommendation });
      continue;
    }

    const ownedName = inventory.ownedNames.get(name);
    if (ownedName !== undefined) {
      dropped.push({ kind: "already-owned", recommendation, ownedName });
      continue;
    }

    // Known name with no mode-eligible variant: not buyable in this mode.
    // Unknown names fall through untouched (nothing proven).
    if (index.itemByName.has(name) && !index.modeLegalNames.has(name)) {
      dropped.push({
        kind: "mode-unavailable",
        recommendation,
        modeName: mode.displayName,
      });
      continue;
    }

    if (index.bootsNames.has(name) && inventory.boots !== null) {
      dropped.push({
        kind: "owned-boots-collision",
        recommendation,
        ownedName: inventory.boots,
      });
      continue;
    }

    const collision = findOwnedGroupCollision(index, inventory, name);
    if (collision) {
      dropped.push({
        kind: "owned-group-collision",
        recommendation,
        ...collision,
      });
      continue;
    }

    keptNames.add(name);
    kept.push(recommendation);
  }

  return { recommendations: kept, dropped };
}

function findOwnedGroupCollision(
  index: ItemNameIndex,
  inventory: InventorySlots,
  name: string
): { group: string; ownedName: string } | null {
  for (const group of index.groupsByName.get(name) ?? []) {
    const ownedName = inventory.groups.get(group);
    if (ownedName !== undefined) return { group, ownedName };
  }
  return null;
}

/**
 * One drop as a human-readable log fragment, mirroring
 * `describeBuildPathDrop`. The warn line these compose is the primary
 * debugging surface in playtest logs, so each fragment names the dropped
 * option and exactly why it is unbuyable.
 */
export function describeRecommendationDrop(drop: RecommendationDrop): string {
  const name = drop.recommendation.name;
  switch (drop.kind) {
    case "already-owned":
      return drop.ownedName === name
        ? `${name} (player already owns it)`
        : `${name} (player already owns ${drop.ownedName})`;
    case "owned-group-collision":
      return `${name} (group ${drop.group}, player owns ${drop.ownedName})`;
    case "owned-boots-collision":
      return `${name} (boots, player owns ${drop.ownedName})`;
    case "duplicate-option":
      return `${name} (duplicate of an earlier option)`;
    case "mode-unavailable":
      return `${name} (not purchasable in ${drop.modeName})`;
  }
}

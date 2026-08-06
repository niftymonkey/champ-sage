/**
 * Name-keyed catalog facts and inventory slot resolution shared by every
 * post-hoc purchase-legality check (issue #117).
 *
 * The model answers in item NAMES, but the catalog is keyed by id and carries
 * several same-named variants per item (a standard entry plus its ARAM
 * rebalance, an Arena band entry, ...). Every legality rule therefore needs
 * the same two things first: catalog facts unioned across same-named variants,
 * and the slots the player's current inventory already occupies. The build-path
 * sweep and the item-rec option filter differ in what they DO with those facts,
 * not in how the facts are derived, so both stand on this module.
 */

import type { Item } from "../data-ingest/types";
import type { GameMode } from "../mode/types";
import { isBuildPathEligible, resolveToPurchasable } from "./item-catalog";

/**
 * Catalog facts collapsed to one entry per item name.
 *
 * Every set here uses the SOME-variant quantifier: a name counts as
 * mode-legal, or as boots, when at least one catalog item with that name says
 * so. Duplicate names span ID partitions (Abyssal Mask is both standard 8020
 * and aram-band 328020), so an any-variant quantifier is what keeps the wrong
 * variant from producing a false verdict.
 */
export interface ItemNameIndex {
  /** Restriction groups per name, unioned across same-named variants: an
   *  ARAM rebalance and its standard item must carry the same limits. */
  readonly groupsByName: ReadonlyMap<string, ReadonlySet<string>>;
  /** One representative item per name (first seen), for the `specialRecipe`
   *  walk. Its presence also answers "does the catalog know this name". */
  readonly itemByName: ReadonlyMap<string, Item>;
  /** Names with at least one variant purchasable in this mode. */
  readonly modeLegalNames: ReadonlySet<string>;
  /** Names that occupy the game's single boots slot. Boots are NOT a wiki
   *  itemlimit group, so this is tag-based, gated on the same eligibility
   *  predicate as `modeLegalNames`: DDragon's tier-1 Boots (300g) carries
   *  the "Boots" tag but is a component, and a player holding it is
   *  mid-upgrade, not holding the slot. */
  readonly bootsNames: ReadonlySet<string>;
}

export function buildItemNameIndex(
  items: ReadonlyMap<number, Item>,
  mode: GameMode
): ItemNameIndex {
  const groupsByName = new Map<string, Set<string>>();
  const itemByName = new Map<string, Item>();
  const modeLegalNames = new Set<string>();
  const bootsNames = new Set<string>();

  for (const item of items.values()) {
    if (!itemByName.has(item.name)) itemByName.set(item.name, item);
    const eligible = isBuildPathEligible(item, mode);
    if (eligible) modeLegalNames.add(item.name);
    if (eligible && item.tags.includes("Boots")) bootsNames.add(item.name);
    if (!item.mutexGroups || item.mutexGroups.length === 0) continue;
    const groups = groupsByName.get(item.name) ?? new Set<string>();
    for (const group of item.mutexGroups) groups.add(group);
    groupsByName.set(item.name, groups);
  }

  return { groupsByName, itemByName, modeLegalNames, bootsNames };
}

/**
 * What the player's current inventory already occupies. Every value is the
 * OWNED item's display name (e.g. "Muramana"), the form a log line or a
 * corrective message should quote back, which may differ from the purchasable
 * base name the model is able to recommend.
 */
export interface InventorySlots {
  /** Every name whose purchase the inventory makes a no-op, mapped to the
   *  owned item that makes it so. Covers both the owned display name and its
   *  purchasable base: owning Muramana means buying Manamune buys nothing. */
  readonly ownedNames: ReadonlyMap<string, string>;
  /** Restriction group to the owned item holding its single slot. */
  readonly groups: ReadonlyMap<string, string>;
  /** The owned boots item, or null when the player has no finished pair. */
  readonly boots: string | null;
}

/**
 * Resolve the slots an inventory occupies. Earlier inventory entries win
 * every contested slot, which only matters for states the game itself
 * forbids; the ordering is fixed so the output is deterministic.
 *
 * Names the catalog does not know contribute exactly one fact: buying that
 * same name again is a no-op. They carry no groups and no boots verdict.
 */
export function resolveInventorySlots(
  index: ItemNameIndex,
  items: ReadonlyMap<number, Item>,
  ownedItemNames: readonly string[]
): InventorySlots {
  const ownedNames = new Map<string, string>();
  const groups = new Map<string, string>();
  let boots: string | null = null;

  for (const ownedName of ownedItemNames) {
    const ownedItem = index.itemByName.get(ownedName);
    const base = ownedItem ? resolveToPurchasable(ownedItem, items) : null;
    const names =
      base && base.name !== ownedName ? [ownedName, base.name] : [ownedName];
    for (const name of names) {
      if (!ownedNames.has(name)) ownedNames.set(name, ownedName);
      if (index.bootsNames.has(name) && boots === null) boots = ownedName;
      for (const group of index.groupsByName.get(name) ?? []) {
        if (!groups.has(group)) groups.set(group, ownedName);
      }
    }
  }

  return { ownedNames, groups, boots };
}

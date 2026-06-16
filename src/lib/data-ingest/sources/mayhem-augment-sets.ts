import type { AugmentSet } from "../types";

/**
 * Mayhem augment set bonuses (Traits).
 *
 * The ARAM Mayhem 26.12 rework REMOVED Traits, the set-bonus mechanic, in
 * favor of champion-first Ability Augments. Popular Traits were reintroduced
 * as standalone augments rather than grouped sets. There are no set bonuses in
 * the live game, so this returns nothing: surfacing the old nine to the
 * coaching LLM would assert synergies the player can no longer build toward.
 * Source: https://www.leagueoflegends.com/en-us/news/dev/dev-augmentmaxxing-aram-mayhem/
 *
 * Kept as an inert seam (rather than deleting the function and the
 * `augmentSets` plumbing) so grouping can be repopulated cheaply if Riot
 * reintroduces it. The downstream set-coaching paths are presence-driven and
 * self-disable on this empty data. Returns a fresh array each call to preserve
 * the no-shared-mutable-state contract its callers relied on.
 */
export function getMayhemAugmentSets(): AugmentSet[] {
  return [];
}

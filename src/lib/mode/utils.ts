import type { Augment, Item } from "../data-ingest/types";
import type { PlayerModeContext, TeamComposition } from "./types";

export function filterItemsByMode(
  items: Map<number, Item>,
  mode: string
): Map<number, Item> {
  const filtered = new Map<number, Item>();
  for (const [id, item] of items) {
    if (item.mode === mode) filtered.set(id, item);
  }
  return filtered;
}

export function filterAugmentsByMode(
  augments: Map<string, Augment>,
  mode: string
): Map<string, Augment> {
  const filtered = new Map<string, Augment>();
  for (const [key, augment] of augments) {
    if (augment.mode === mode) filtered.set(key, augment);
  }
  return filtered;
}

export function buildTeamComposition(
  players: PlayerModeContext[]
): TeamComposition {
  const classCounts: Record<string, number> = {};
  for (const player of players) {
    for (const tag of player.tags) {
      classCounts[tag] = (classCounts[tag] ?? 0) + 1;
    }
  }
  return { players, classCounts };
}

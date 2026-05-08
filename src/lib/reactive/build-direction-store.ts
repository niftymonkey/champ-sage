/**
 * Per-game store for the player's declared build direction.
 *
 * Picker UIs (champ-select slot, GamePlanPanel mid-game pivot) write
 * into this subject. Coaching pipeline subscribes to it for plan-
 * revision triggers; prompt-context assembly reads it to thread the
 * declared direction into LLM features.
 *
 * Lifetime is one game: cleared by `resetForNewGame()`.
 */

import { BehaviorSubject } from "rxjs";
import type { BuildDirection } from "../build-direction/taxonomy";
import { getLogger } from "../logger";

const log = getLogger("build-direction");

export const playerBuildDirection$ = new BehaviorSubject<BuildDirection | null>(
  null
);

export function setPlayerBuildDirection(next: BuildDirection): void {
  const prev = playerBuildDirection$.getValue();
  log.info(`set: ${prev ?? "null"} → ${next}`);
  playerBuildDirection$.next(next);
}

export function clearPlayerBuildDirection(reason: string = "unknown"): void {
  const prev = playerBuildDirection$.getValue();
  if (prev !== null) {
    log.info(`clear: ${prev} → null (reason: ${reason})`);
  }
  playerBuildDirection$.next(null);
}

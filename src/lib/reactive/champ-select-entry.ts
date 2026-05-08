/**
 * Detect a real "new champ-select session has begun" transition from
 * the gameflow-phase stream.
 *
 * Why this exists: subscribing to `liveGameState$.champSelect` for
 * null→set toggles is unreliable — the LCU briefly re-emits the
 * session as null mid-champ-select (player swap, position swap, brief
 * disconnects) and then restores it. Each of those bounces would
 * otherwise read as "fresh session" and clear the player's declared
 * build direction. The gameflow phase only transitions from outside
 * ChampSelect into ChampSelect once per real session.
 */

import type { GameflowPhase } from "./types";

export function isChampSelectEntry(
  prev: GameflowPhase | null,
  next: GameflowPhase
): boolean {
  return prev !== "ChampSelect" && next === "ChampSelect";
}

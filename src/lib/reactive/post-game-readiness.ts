/**
 * Tracks whether the post-game surface has fully-fresh data to show.
 *
 * The auto-route to the History tab happens the moment `activePlayer`
 * clears (game ended on the LCU side). At that moment the in-memory
 * snapshot, decision-log records, and match-history fetch are all
 * still pointing at the PREVIOUS game — they refresh hundreds of
 * milliseconds later, after `eogStats` arrives. Without a hold-down
 * gate the surface flashes the previous game's champion / takeaway /
 * stats and then pops the new ones in.
 *
 * The state machine is intentionally tiny: two timestamps,
 * `postGameReady$` derived as `snapshotUpdatedAt > gameEndedAt`. If
 * the game has never ended, ready is true (steady state). If a game
 * has ended but the snapshot hasn't been refreshed since, ready is
 * false (hide / blank). Once the snapshot updates, ready flips back
 * to true and the surface fades in.
 */

import { BehaviorSubject } from "rxjs";

let gameEndedAt: number | null = null;
let snapshotUpdatedAt: number = 0;

export const postGameReady$ = new BehaviorSubject<boolean>(true);

function recompute(): void {
  // `>=` (not strictly `>`) so a snapshot refresh that happens in the
  // same millisecond as the game-end mark still satisfies the gate —
  // otherwise sub-ms back-to-back calls leave the surface stuck
  // hidden indefinitely.
  const ready = gameEndedAt === null || snapshotUpdatedAt >= gameEndedAt;
  if (postGameReady$.getValue() !== ready) {
    postGameReady$.next(ready);
  }
}

/**
 * Mark the moment a game has just ended. Sets `postGameReady$` to
 * `false` until `markSnapshotRefreshed` lands.
 */
export function markGameEnded(now: number = Date.now()): void {
  gameEndedAt = now;
  recompute();
}

/**
 * Mark the moment the in-memory snapshot was refreshed (i.e.
 * `captureLastGameSnapshot` just landed for the just-ended game).
 * Re-enables the surface.
 */
export function markSnapshotRefreshed(now: number = Date.now()): void {
  snapshotUpdatedAt = now;
  recompute();
}

/** Reset for tests. Not exported in production. */
export function _resetPostGameReadiness(): void {
  gameEndedAt = null;
  snapshotUpdatedAt = 0;
  postGameReady$.next(true);
}

/**
 * Gates the post-game surface so the user never sees a stale or mixed
 * view of the previous game while the just-finished one is still being
 * stitched together.
 *
 * The contract:
 *   1. The instant the gameflow phase transitions into a post-game
 *      phase (PreEndOfGame / EndOfGame / WaitingForStats), `ready` is
 *      forced to `false`. This fires BEFORE the surface auto-routes
 *      and mounts, so the cached SWR data from a prior session never
 *      gets a render frame.
 *   2. `ready` stays `false` until ALL of these are true:
 *        a. The in-memory snapshot has been refreshed since the
 *           game-end mark (snapshot.gameId now points at the
 *           just-finished match).
 *        b. The match-history fetcher has resolved since the game-end
 *           mark (the just-finished match has landed in the cached
 *           list, so the header champion / KDA / mode are correct).
 *      Decision-log records are NOT part of the gate — the surface
 *      gracefully shows "writing the recap…" while the LLM finishes,
 *      and the header content is sourced from the snapshot + match
 *      history which are already gated.
 *   3. A 15-second max hold-down failsafe forces `ready` to `true`
 *      even if one of the signals never lands (LCU drop, fetch error,
 *      etc.). The surface degrades gracefully rather than hiding
 *      forever.
 *
 * The whole module is a tiny state machine; everything else is stream
 * wiring that lives in `wirePostGameReadiness` below so it can be
 * started once from the app root.
 */

import { BehaviorSubject, Subscription } from "rxjs";
import { gameLifecycle$, lcuCredentials$ } from "./streams";
import { lastGameSnapshot$ } from "./coaching-feed";
import { getLogger } from "../logger";
import type { GameflowPhase } from "./types";

const log = getLogger("post-game-readiness");

const POST_GAME_PHASES: ReadonlySet<GameflowPhase> = new Set([
  "PreEndOfGame",
  "EndOfGame",
  "WaitingForStats",
]);

const MAX_HOLD_MS = 15_000;

let gameEndedAt: number | null = null;
let snapshotUpdatedAt = 0;
let matchesFetchedAt = 0;
let maxHoldTimer: ReturnType<typeof setTimeout> | null = null;
let forceReady = false;

export const postGameReady$ = new BehaviorSubject<boolean>(true);

function recompute(): void {
  let ready: boolean;
  if (gameEndedAt === null) {
    ready = true;
  } else if (forceReady) {
    ready = true;
  } else {
    ready =
      snapshotUpdatedAt >= gameEndedAt && matchesFetchedAt >= gameEndedAt;
  }
  if (postGameReady$.getValue() !== ready) {
    log.debug(
      `ready → ${ready} (gameEndedAt=${gameEndedAt}, snapshotUpdatedAt=${snapshotUpdatedAt}, matchesFetchedAt=${matchesFetchedAt}, forceReady=${forceReady})`,
    );
    postGameReady$.next(ready);
  }
}

function cancelMaxHoldTimer(): void {
  if (maxHoldTimer !== null) {
    clearTimeout(maxHoldTimer);
    maxHoldTimer = null;
  }
}

/**
 * Marks the moment a game has just ended. Sets `postGameReady$` to
 * `false` until both the snapshot and match-history have refreshed.
 * Safe to call multiple times (idempotent per game; latest call wins).
 */
export function markGameEnded(now: number = Date.now()): void {
  log.debug(`markGameEnded called (now=${now})`);
  gameEndedAt = now;
  forceReady = false;
  cancelMaxHoldTimer();
  maxHoldTimer = setTimeout(() => {
    forceReady = true;
    maxHoldTimer = null;
    recompute();
  }, MAX_HOLD_MS);
  recompute();
}

/**
 * Marks the moment the in-memory snapshot was refreshed (i.e.
 * `captureLastGameSnapshot` just landed for the just-ended game).
 */
export function markSnapshotRefreshed(now: number = Date.now()): void {
  snapshotUpdatedAt = now;
  recompute();
}

/**
 * Marks the moment the match-history fetcher resolved (top entry now
 * reflects the just-ended game).
 */
export function markMatchesRefreshed(now: number = Date.now()): void {
  matchesFetchedAt = now;
  recompute();
}

/**
 * Wire the readiness gate to the streams that drive it. Call once at
 * app start; returns an unsubscribe function.
 *
 * - Phase transitions INTO post-game phases trigger `markGameEnded`
 *   (the earliest possible signal that a game has ended, fires before
 *   `activePlayer` clears).
 * - `lastGameSnapshot$` emissions with a non-null gameId trigger
 *   `markSnapshotRefreshed`. The match-history side is wired separately
 *   from the store's fetch success.
 * - LCU disconnects clear the gate so a stale game-end mark doesn't
 *   keep the surface hidden across LCU restarts.
 */
export function wirePostGameReadiness(): () => void {
  const subs = new Subscription();
  let prevPhase: GameflowPhase | null = null;

  subs.add(
    gameLifecycle$.subscribe((evt) => {
      if (evt.type !== "phase") return;
      const enteringPostGame =
        POST_GAME_PHASES.has(evt.phase) &&
        (prevPhase === null || !POST_GAME_PHASES.has(prevPhase));
      log.debug(
        `phase event: ${evt.phase} (prev=${prevPhase}, enteringPostGame=${enteringPostGame})`,
      );
      prevPhase = evt.phase;
      if (enteringPostGame) markGameEnded();
    }),
  );

  subs.add(
    lastGameSnapshot$.subscribe((snap) => {
      if (snap === null || snap.gameId === null) return;
      markSnapshotRefreshed();
    }),
  );

  subs.add(
    lcuCredentials$.subscribe((creds) => {
      if (creds !== null) return;
      // LCU went away. Reset the gate so a stale game-end mark doesn't
      // keep the surface hidden across LCU restarts.
      _resetPostGameReadiness();
    }),
  );

  return () => subs.unsubscribe();
}

/** Reset for tests AND for production LCU-disconnect recovery. */
export function _resetPostGameReadiness(): void {
  gameEndedAt = null;
  snapshotUpdatedAt = 0;
  matchesFetchedAt = 0;
  forceReady = false;
  cancelMaxHoldTimer();
  postGameReady$.next(true);
}

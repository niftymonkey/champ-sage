/**
 * Coaching feed streams — accumulates coaching interactions during
 * a game session and tracks the current game plan.
 *
 * - coachingFeed$: chronological list of feed entries (game plan cards,
 *   coaching exchanges). Augment offers render in the overlay, not here.
 * - gamePlan$: the current game plan shown in the side panel
 * - lastGameSnapshot$: snapshot of the most recent completed game
 */

import { BehaviorSubject } from "rxjs";
import type { BuildPathItem } from "../ai/types";
import type {
  AnyFeedEntry,
  GamePlan,
  LastGameSnapshot,
  GamePlanEntry,
  CoachingExchangeEntry,
} from "./coaching-feed-types";

// ─── Streams ───

export const coachingFeed$ = new BehaviorSubject<AnyFeedEntry[]>([]);
export const gamePlan$ = new BehaviorSubject<GamePlan | null>(null);
export const lastGameSnapshot$ = new BehaviorSubject<LastGameSnapshot | null>(
  null
);

// ─── Feed operations ───

let feedIdCounter = 0;

function nextFeedId(): string {
  return `feed-${++feedIdCounter}`;
}

/** Push a game plan entry to the feed and update the side panel */
export function pushGamePlan(
  summary: string,
  buildPath: BuildPathItem[],
  gameTime: number
): GamePlanEntry {
  const entry: GamePlanEntry = {
    id: nextFeedId(),
    type: "game-plan",
    timestamp: gameTime,
    proactive: true,
    summary,
    buildPath,
  };

  coachingFeed$.next([...coachingFeed$.getValue(), entry]);
  gamePlan$.next({ summary, buildPath, updatedAt: gameTime });

  return entry;
}

/** Push a coaching exchange to the feed */
export function pushCoachingExchange(
  question: string,
  answer: string,
  recommendations: CoachingExchangeEntry["recommendations"],
  gameTime: number,
  source: CoachingExchangeEntry["source"] = "voice",
  retried = false
): CoachingExchangeEntry {
  const entry: CoachingExchangeEntry = {
    id: nextFeedId(),
    type: "coaching-exchange",
    timestamp: gameTime,
    proactive: source !== "voice",
    source,
    question,
    answer,
    recommendations,
    ...(retried ? { retried: true } : {}),
  };

  coachingFeed$.next([...coachingFeed$.getValue(), entry]);
  return entry;
}

/** Capture a snapshot of the completed game for the idle state */
export function captureLastGameSnapshot(snapshot: LastGameSnapshot): void {
  lastGameSnapshot$.next(snapshot);
}

/** Reset feed and plan for a new game session */
export function resetForNewGame(): void {
  coachingFeed$.next([]);
  gamePlan$.next(null);
  feedIdCounter = 0;
}

/** Reset the feed ID counter (for testing) */
export function _resetFeedIdCounter(): void {
  feedIdCounter = 0;
}

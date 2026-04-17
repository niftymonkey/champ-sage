/**
 * Coaching feed streams — accumulates coaching interactions during
 * a game session and tracks the current game plan.
 *
 * - coachingFeed$: chronological list of feed entries (augment offers,
 *   coaching exchanges, game plan cards)
 * - gamePlan$: the current game plan shown in the side panel
 * - lastGameSnapshot$: snapshot of the most recent completed game
 */

import { BehaviorSubject } from "rxjs";
import type {
  AnyFeedEntry,
  GamePlan,
  LastGameSnapshot,
  GamePlanEntry,
  AugmentOfferEntry,
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
  buildPath: string[],
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

/** Push an augment offer to the feed */
export function pushAugmentOffer(
  options: AugmentOfferEntry["options"],
  gameTime: number
): AugmentOfferEntry {
  const entry: AugmentOfferEntry = {
    id: nextFeedId(),
    type: "augment-offer",
    timestamp: gameTime,
    proactive: true,
    options,
  };

  coachingFeed$.next([...coachingFeed$.getValue(), entry]);
  return entry;
}

/** Mark an augment offer as picked */
export function markAugmentPicked(entryId: string, picked: string): void {
  const feed = coachingFeed$.getValue();
  const updated = feed.map((e) =>
    e.id === entryId && e.type === "augment-offer"
      ? ({ ...e, picked } as AugmentOfferEntry)
      : e
  );
  coachingFeed$.next(updated);
}

/** Push a coaching exchange to the feed */
export function pushCoachingExchange(
  question: string,
  answer: string,
  recommendations: CoachingExchangeEntry["recommendations"],
  gameTime: number,
  source: CoachingExchangeEntry["source"] = "voice"
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

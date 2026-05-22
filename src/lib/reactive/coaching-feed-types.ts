/**
 * Types for the coaching feed — a chronological list of coaching
 * interactions displayed in the desktop window during gameplay.
 *
 * Augment offers are NOT in the feed. Augment fit ratings render in the
 * in-game overlay (OverlayApp badges); duplicating them in the desktop feed
 * was removed in #67 Phase 1 per the overlay-vs-UI split principle.
 */

import type { BuildPathItem, FitRating } from "../ai/types";
import type { GameResult } from "../game-result";

/** Base fields shared by all feed entries */
export interface FeedEntry {
  id: string;
  type: "game-plan" | "coaching-exchange";
  /** Game time in seconds when the entry was created */
  timestamp: number;
  /** True = coach-initiated (gold border), false = player-initiated */
  proactive: boolean;
}

/** Initial game plan or "update game plan" response in the feed */
export interface GamePlanEntry extends FeedEntry {
  type: "game-plan";
  /** Coach's strategy reasoning text */
  summary: string;
  /** Ordered 6-item build path with per-item category + reasoning */
  buildPath: BuildPathItem[];
}

/** LLM coaching exchange — covers voice queries, augment evaluations, plan updates, and proactive item-rec */
export interface CoachingExchangeEntry extends FeedEntry {
  type: "coaching-exchange";
  /** Where this coaching request originated */
  source: "voice" | "augment" | "plan" | "item-rec";
  question: string;
  answer: string;
  recommendations: CoachingRecommendation[];
  /** True when this response came from a silent retry after a first-attempt failure (#102) */
  retried?: boolean;
}

export interface CoachingRecommendation {
  name: string;
  fit: FitRating;
  reasoning: string;
}

/** Union of all feed entry types */
export type AnyFeedEntry = GamePlanEntry | CoachingExchangeEntry;

/** Current game plan — the living document shown in the side panel */
export interface GamePlan {
  /** Strategy reasoning text */
  summary: string;
  /** Ordered 6-item build path with per-item category + reasoning */
  buildPath: BuildPathItem[];
  /** Game time of last update */
  updatedAt: number;
}

/** Snapshot of a completed game for the idle state card */
export interface LastGameSnapshot {
  /**
   * Riot-issued game id for the just-finished match (from
   * `liveGameState.lcuGameId`). `null` when the LCU never surfaced an
   * id for this session (early disconnect / LCU lag). Used by the
   * post-game surface to scope its decision-log query to the
   * just-finished game and avoid flicker-rendering the previous
   * game's takeaway while the new one is being written.
   */
  gameId: string | null;
  championName: string;
  result: GameResult;
  kills: number;
  deaths: number;
  assists: number;
  gameTime: number;
  gameMode: string;
  items: string[];
  augments: string[];
  /** Last 3 coaching exchanges from the feed */
  recentExchanges: Array<{ question: string; answer: string }>;
}

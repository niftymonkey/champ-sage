/**
 * Types for the coaching feed — a chronological list of coaching
 * interactions displayed in the desktop window during gameplay.
 */

import type { BuildPathItem, FitRating } from "../ai/types";

/** Base fields shared by all feed entries */
export interface FeedEntry {
  id: string;
  type: "game-plan" | "augment-offer" | "coaching-exchange";
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

/** GEP-triggered augment offer with fit-rated options */
export interface AugmentOfferEntry extends FeedEntry {
  type: "augment-offer";
  options: AugmentOption[];
  /** Filled in when the player picks one */
  picked?: string;
}

export interface AugmentOption {
  name: string;
  fit: FitRating;
  reasoning: string;
}

/** LLM coaching exchange — covers voice queries, augment evaluations, and plan updates */
export interface CoachingExchangeEntry extends FeedEntry {
  type: "coaching-exchange";
  /** Where this coaching request originated */
  source: "voice" | "augment" | "plan";
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
export type AnyFeedEntry =
  | GamePlanEntry
  | AugmentOfferEntry
  | CoachingExchangeEntry;

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
  championName: string;
  isWin: boolean;
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

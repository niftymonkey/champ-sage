/**
 * Types for the coaching feed — a chronological list of coaching
 * interactions displayed in the desktop window during gameplay.
 */

/** Base fields shared by all feed entries */
export interface FeedEntry {
  id: string;
  type: "game-plan" | "augment-offer" | "voice-coaching";
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
  /** Ordered item names (6 items) */
  buildPath: string[];
}

/** GEP-triggered augment offer with ranked options */
export interface AugmentOfferEntry extends FeedEntry {
  type: "augment-offer";
  options: AugmentOption[];
  /** Filled in when the player picks one */
  picked?: string;
}

export interface AugmentOption {
  name: string;
  rank: number;
  reasoning: string;
}

/** Voice query and coaching response */
export interface VoiceCoachingEntry extends FeedEntry {
  type: "voice-coaching";
  /** Where this coaching request originated */
  source: "voice" | "augment" | "plan";
  question: string;
  answer: string;
  recommendations: VoiceRecommendation[];
}

export interface VoiceRecommendation {
  name: string;
  reasoning: string;
}

/** Union of all feed entry types */
export type AnyFeedEntry =
  | GamePlanEntry
  | AugmentOfferEntry
  | VoiceCoachingEntry;

/** Current game plan — the living document shown in the side panel */
export interface GamePlan {
  /** Strategy reasoning text */
  summary: string;
  /** 6 ordered item names */
  buildPath: string[];
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

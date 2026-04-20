export type FitRating = "exceptional" | "strong" | "situational" | "weak";

/**
 * Fixed set of visual categories the UI knows how to render for game-plan
 * build-path items. Broad enough that the LLM's reasoning isn't artificially
 * constrained; "situational" is the catch-all escape hatch.
 */
export type BuildPathCategory =
  | "core"
  | "counter"
  | "defensive"
  | "damage"
  | "utility"
  | "situational";

export interface BuildPathItem {
  /** Exact item name (must appear in the item catalog) */
  name: string;
  /** Visual category the UI renders with a distinct icon */
  category: BuildPathCategory;
  /**
   * Enemy champion being countered — string when category is "counter",
   * null otherwise. Nullable (not optional) because OpenAI strict-mode
   * structured outputs require every property be present in every item.
   */
  targetEnemy: string | null;
  /** Terse reason for this item — a few words max, grammar optional */
  reason: string;
}

export interface CoachingResponse {
  /** Direct answer to the player's question */
  answer: string;
  /** Recommendations with independent fit ratings, if applicable (augments, items, etc.) */
  recommendations: Recommendation[];
  /**
   * Structured 6-item build path for game-plan queries. Null for every
   * other query type. Nullable (not optional) because OpenAI strict-mode
   * structured outputs require every declared property be present.
   */
  buildPath: BuildPathItem[] | null;
  /** True when this response came from a silent retry after a first-attempt failure (#102) */
  retried?: boolean;
}

export interface Recommendation {
  /** Name of the recommended option */
  name: string;
  /** Independent fit rating for this option */
  fit: FitRating;
  /** Why this option fits (or doesn't) the current state */
  reasoning: string;
}

export interface CoachingItem {
  name: string;
  description: string;
  /** Augment set memberships (only relevant for augments, not items) */
  sets?: string[];
}

export interface CoachingContext {
  champion: {
    name: string;
    level: number;
    abilities: string;
    /** Compact stat profile for build viability reasoning (melee/ranged, tags, key growth rates) */
    statProfile: string | null;
  };
  currentItems: CoachingItem[];
  currentGold: number;
  kda: { kills: number; deaths: number; assists: number };
  currentAugments: CoachingItem[];
  enemyTeam: Array<{
    champion: string;
    items: CoachingItem[];
  }>;
  allyTeam: Array<{
    champion: string;
  }>;
  /** Team composition analysis — role breakdown, damage profile, gaps */
  teamAnalysis: string | null;
  /** Set bonus definitions for the current game mode */
  augmentSets: Array<{
    name: string;
    bonuses: Array<{ threshold: number; description: string }>;
  }>;
  gameMode: string;
  /** LCU game mode — more specific (KIWI for Mayhem, CHERRY for Arena) */
  lcuGameMode: string;
  gameTime: number;
  balanceOverrides: string | null;
}

export interface CoachingExchange {
  question: string;
  answer: string;
}

export interface CoachingQuery {
  /** The player's question */
  question: string;
  /** Recent conversation history (last 3 exchanges) */
  history?: CoachingExchange[];
  /** Augment options being offered, if this is an augment selection question */
  augmentOptions?: Array<{
    name: string;
    description: string;
    tier: string;
    sets?: string[];
  }>;
}

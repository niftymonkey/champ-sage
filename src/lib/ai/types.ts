export type FitRating = "exceptional" | "strong" | "situational" | "weak";

export interface CoachingResponse {
  /** Direct answer to the player's question */
  answer: string;
  /** Recommendations with independent fit ratings, if applicable (augments, items, etc.) */
  recommendations: Recommendation[];
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

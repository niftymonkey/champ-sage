export interface CoachingResponse {
  /** Direct answer to the player's question */
  answer: string;
  /** Ranked recommendations, if applicable (augments, items, etc.) */
  recommendations: Recommendation[];
}

export interface Recommendation {
  /** Name of the recommended option */
  name: string;
  /** Why this option is recommended in this context */
  reasoning: string;
}

export interface CoachingItem {
  name: string;
  description: string;
}

export interface CoachingContext {
  champion: {
    name: string;
    level: number;
    abilities: string;
  };
  currentItems: CoachingItem[];
  currentAugments: CoachingItem[];
  enemyTeam: Array<{
    champion: string;
    items: CoachingItem[];
  }>;
  allyTeam: Array<{
    champion: string;
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

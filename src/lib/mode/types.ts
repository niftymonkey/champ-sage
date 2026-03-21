import type {
  AramOverrides,
  Augment,
  AugmentSet,
  AugmentSetBonus,
  Item,
} from "../data-ingest/types";
import type {
  ActivePlayerRunes,
  ActivePlayerStats,
  ConnectionStatus,
  GameState,
  PlayerItem,
} from "../game-state/types";
import type { LoadedGameData } from "../data-ingest";

// --- Decision types ---

export type DecisionType =
  | "augment-selection"
  | "item-purchase"
  | "open-ended-coaching";

// --- Mode interface ---

export interface GameMode {
  id: string;
  displayName: string;
  decisionTypes: DecisionType[];
  /** Levels at which augment selection becomes available (mode-specific). */
  augmentSelectionLevels: number[];
  matches(gameMode: string): boolean;
  buildContext(gameState: GameState, gameData: LoadedGameData): ModeContext;
}

// --- Mode context ---

export interface ModeContext {
  mode: GameMode;
  playerContexts: Map<string, PlayerModeContext>;
  modeItems: Map<number, Item>;
  modeAugments: Map<string, Augment>;
  augmentSets: AugmentSet[];
  allyTeamComp: TeamComposition;
  enemyTeamComp: TeamComposition;
}

export interface PlayerModeContext {
  championName: string;
  team: "ORDER" | "CHAOS";
  tags: string[];
  balanceOverrides: AramOverrides | null;
  selectedAugments: Augment[];
  setProgress: SetProgress[];
}

export interface SetProgress {
  set: AugmentSet;
  count: number;
  nextBonus: AugmentSetBonus | null;
}

export interface TeamComposition {
  players: PlayerModeContext[];
  classCounts: Record<string, number>;
}

// --- Effective game state (composed view) ---

export interface EffectiveGameState {
  raw: GameState;
  modeContext: ModeContext | null;
  status: ConnectionStatus;
  gameMode: string;
  gameTime: number;
  activePlayer: EffectivePlayer | null;
  allies: EffectivePlayer[];
  enemies: EffectivePlayer[];
}

export interface EffectivePlayer {
  championName: string;
  level: number;
  kills: number;
  deaths: number;
  assists: number;
  items: PlayerItem[];
  summonerSpells: [string, string];
  riotIdGameName: string;
  position: string;
  isActivePlayer: boolean;
  tags: string[];
  balanceOverrides: AramOverrides | null;
  currentGold?: number;
  runes?: ActivePlayerRunes;
  stats?: ActivePlayerStats;
  selectedAugments?: Augment[];
  setProgress?: SetProgress[];
}

// --- Mode registry ---

export interface ModeRegistry {
  register(mode: GameMode): void;
  detect(gameMode: string): GameMode | null;
}

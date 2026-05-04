import type { ActivePlayer, PlayerInfo } from "../game-state/types";
import type { Augment } from "../data-ingest/types";

// Gameflow phases from LCU API
export type GameflowPhase =
  | "None"
  | "Lobby"
  | "Matchmaking"
  | "ReadyCheck"
  | "ChampSelect"
  | "GameStart"
  | "InProgress"
  | "PreEndOfGame"
  | "EndOfGame"
  | "WaitingForStats"
  | "TerminatedInError";

// LCU connection
export interface LcuCredentials {
  port: number;
  token: string;
}

export interface LcuConnectionStatus {
  connected: boolean;
  credentials: LcuCredentials | null;
}

// Game lifecycle events (discriminated union)
export type GameLifecycleEvent =
  | { type: "connection"; connected: boolean }
  | { type: "phase"; phase: GameflowPhase }
  | { type: "lobby"; data: unknown }
  | { type: "matchmaking"; data: unknown }
  | { type: "session"; data: unknown };

// Live game state (accumulated via scan)
export interface LiveGameState {
  activePlayer: ActivePlayer | null;
  players: PlayerInfo[];
  gameMode: string;
  /** LCU game mode (KIWI for Mayhem, CLASSIC for SR, CHERRY for Arena) - more specific than gameMode */
  lcuGameMode: string;
  /**
   * Riot map id from the Live Client `gameData.mapNumber` block.
   * 11 = Summoner's Rift, 12 = Howling Abyss (ARAM), 30 = Arena, 0 if unknown.
   * Last-resort signal when both gameMode and lcuGameMode report PRACTICETOOL.
   */
  mapNumber: number;
  gameTime: number;
  champSelect: unknown | null;
  eogStats: EogStats | null;
}

export interface EogStats {
  gameId: string;
  gameLength: number;
  gameMode: string;
  isWin: boolean;
  championId: number;
  items: number[];
}

// User input events (discriminated union)
export type UserInputEvent =
  | { type: "augment"; augment: Augment }
  | { type: "query"; text: string };

// Coaching output (placeholder — owning feature defines final shape)
export interface CoachingMessage {
  id: string;
  content: string;
  timestamp: number;
}

// Notification output (placeholder)
export interface AppNotification {
  id: string;
  level: "info" | "success" | "warning" | "error";
  message: string;
  timestamp: number;
}

import type { ActivePlayer, PlayerInfo } from "../game-state/types";
import type { Augment } from "../data-ingest/types";

// Gameflow phases from LCU API
export type GameflowPhase =
  | "None"
  | "Lobby"
  | "Matchmaking"
  | "ReadyCheck"
  | "ChampSelect"
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
  /** LCU game mode (KIWI for Mayhem, CLASSIC for SR, CHERRY for Arena) — more specific than gameMode */
  lcuGameMode: string;
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
  | { type: "augment-offer"; augments: string[]; source: "gep" | "manual" }
  | { type: "augment-picked"; name: string; source: "gep" | "manual" }
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
  level: "info" | "warning" | "error";
  message: string;
  timestamp: number;
}

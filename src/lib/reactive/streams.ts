import { BehaviorSubject, Subject } from "rxjs";
import type {
  GameLifecycleEvent,
  LiveGameState,
  UserInputEvent,
  CoachingMessage,
  AppNotification,
} from "./types";

function createDefaultLiveGameState(): LiveGameState {
  return {
    activePlayer: null,
    players: [],
    gameMode: "",
    lcuGameMode: "",
    mapNumber: 0,
    gameTime: 0,
    champSelect: null,
    eogStats: null,
  };
}

// The 5 app-level observables
export const gameLifecycle$ = new BehaviorSubject<GameLifecycleEvent>({
  type: "connection",
  connected: false,
});

export const liveGameState$ = new BehaviorSubject<LiveGameState>(
  createDefaultLiveGameState()
);

export const userInput$ = new Subject<UserInputEvent>();
export const coaching$ = new Subject<CoachingMessage>();
export const notifications$ = new Subject<AppNotification>();

// User input subjects (for pushing from UI)
export const manualInput$ = new Subject<UserInputEvent & { type: "augment" }>();
export const playerIntent$ = new Subject<UserInputEvent & { type: "query" }>();

/**
 * LCU credentials current value — null when no LCU connection has been
 * discovered yet (or after a disconnect). The engine writes here when
 * lockfile discovery succeeds; renderer-side consumers (match history)
 * subscribe to drive their own LCU fetches without re-implementing
 * discovery.
 */
export const lcuCredentials$ = new BehaviorSubject<{
  port: number;
  token: string;
} | null>(null);

/**
 * Fires once when a game has ended (eogStats arrived in liveGameState$).
 * Renderer-side consumers (match history) refresh on this signal so the
 * just-finished match shows up without a manual reload.
 */
export const gameEnded$ = new Subject<void>();

// Debug stream — raw input events from data sources (discovery, WebSocket, API polls)
export interface DebugInputEvent {
  source:
    | "discovery"
    | "websocket"
    | "ws-filtered"
    | "riot-api"
    | "lcu-rest"
    | "initial-state"
    | "voice"
    | "llm"
    | "gep";
  summary: string;
  detail?: string;
}

export const debugInput$ = new Subject<DebugInputEvent>();

export { createDefaultLiveGameState };

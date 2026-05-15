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
    lcuGameId: "",
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
 * `true` once the LCU's HTTPS server is actually accepting connections
 * (signaled by the engine's WebSocket having connected and subscribed).
 * `false` when no LCU is discovered or the WebSocket has dropped.
 *
 * Distinct from `lcuCredentials$`, which fires the moment the lockfile
 * is found — typically several seconds before the HTTPS server is bound.
 * Consumers that need to actually call LCU endpoints (match-history) should
 * subscribe to this signal instead of credentials, otherwise their first
 * fetch reliably fails with ECONNREFUSED and they pay the retry-backoff
 * latency before the data lands.
 */
export const lcuReady$ = new BehaviorSubject<boolean>(false);

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

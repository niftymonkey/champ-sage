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

export { createDefaultLiveGameState };

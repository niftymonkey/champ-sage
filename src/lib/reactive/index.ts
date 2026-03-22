export type {
  GameflowPhase,
  LcuCredentials,
  LcuConnectionStatus,
  GameLifecycleEvent,
  LiveGameState,
  EogStats,
  UserInputEvent,
  CoachingMessage,
  AppNotification,
} from "./types";

export {
  gameLifecycle$,
  liveGameState$,
  userInput$,
  coaching$,
  notifications$,
  manualInput$,
  playerIntent$,
  createDefaultLiveGameState,
} from "./streams";

export { ReactiveEngine } from "./engine";
export type { TauriBridge } from "./tauri-bridge";
export { createRealTauriBridge } from "./tauri-bridge";

import { ReactiveEngine } from "./engine";
import type { TauriBridge } from "./tauri-bridge";
import { createRealTauriBridge } from "./tauri-bridge";

export function initializeReactiveEngine(bridge?: TauriBridge): ReactiveEngine {
  const b = bridge ?? createRealTauriBridge();
  const engine = new ReactiveEngine(b);
  engine.start();
  return engine;
}

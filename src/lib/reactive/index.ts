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

export type {
  FeedEntry,
  GamePlanEntry,
  AugmentOfferEntry,
  AugmentOption,
  CoachingExchangeEntry,
  CoachingRecommendation,
  AnyFeedEntry,
  GamePlan,
  LastGameSnapshot,
} from "./coaching-feed-types";

export {
  coachingFeed$,
  gamePlan$,
  lastGameSnapshot$,
  pushGamePlan,
  pushAugmentOffer,
  markAugmentPicked,
  pushCoachingExchange,
  captureLastGameSnapshot,
  resetForNewGame,
} from "./coaching-feed";

export {
  gameLifecycle$,
  liveGameState$,
  userInput$,
  coaching$,
  notifications$,
  manualInput$,
  playerIntent$,
  debugInput$,
  createDefaultLiveGameState,
} from "./streams";
export type { DebugInputEvent } from "./streams";

export { ReactiveEngine } from "./engine";
export type { PlatformBridge } from "./platform-bridge";
export { createElectronBridge, isElectron } from "./electron-bridge";

import { ReactiveEngine } from "./engine";
import type { PlatformBridge } from "./platform-bridge";
import { createElectronBridge } from "./electron-bridge";

export function initializeReactiveEngine(
  bridge?: PlatformBridge
): ReactiveEngine {
  const b = bridge ?? createElectronBridge();
  const engine = new ReactiveEngine(b);
  engine.start();
  return engine;
}

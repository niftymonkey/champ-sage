import type { LiveGameState } from "../lib/reactive";
import { liveGameState$ } from "../lib/reactive";
import { useBehaviorSubject } from "./useBehaviorSubject";

export function useLiveGameState(): LiveGameState {
  return useBehaviorSubject(liveGameState$);
}

import type { GamePlan } from "../lib/reactive/coaching-feed-types";
import { gamePlan$ } from "../lib/reactive/coaching-feed";
import { useBehaviorSubject } from "./useBehaviorSubject";

export function useGamePlan(): GamePlan | null {
  return useBehaviorSubject(gamePlan$);
}

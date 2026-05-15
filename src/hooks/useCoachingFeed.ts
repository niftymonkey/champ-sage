import type { AnyFeedEntry } from "../lib/reactive/coaching-feed-types";
import { coachingFeed$ } from "../lib/reactive/coaching-feed";
import { useBehaviorSubject } from "./useBehaviorSubject";

export function useCoachingFeed(): AnyFeedEntry[] {
  return useBehaviorSubject(coachingFeed$);
}

import type { LastGameSnapshot } from "../lib/reactive/coaching-feed-types";
import { lastGameSnapshot$ } from "../lib/reactive/coaching-feed";
import { useBehaviorSubject } from "./useBehaviorSubject";

export function useLastGameSnapshot(): LastGameSnapshot | null {
  return useBehaviorSubject(lastGameSnapshot$);
}

import type { Observable } from "rxjs";
import type { DecisionPointTrigger } from "../types";

/**
 * GEP augment-offer trigger.
 *
 * Preserves the semantics of the retired `createAugmentCoachingController`:
 *  - 2-second debounce on `augmentOffer$` (merges reroll bursts)
 *  - `augmentPicked$` cancels a pending debounce and aborts in-flight handle
 *  - Bypasses the engine's global min-gap (offers are rate-limited by the game)
 *
 * Player-pick side effects (tracking chosen augments, updating manualInput$)
 * should be handled by a separate subscription to `augmentPicked$` in the
 * consumer, not baked into this trigger.
 */
export interface AugmentOfferTriggerDeps {
  augmentOffer$: Observable<string[]>;
  augmentPicked$: Observable<string>;
  /** Thread `signal` through to the LLM call so reroll/pick can abort it. */
  handle: (names: string[], signal: AbortSignal) => Promise<void>;
}

export const AUGMENT_OFFER_DEBOUNCE_MS = 2000;

export function createAugmentOfferTrigger(
  deps: AugmentOfferTriggerDeps
): DecisionPointTrigger<string[]> {
  return {
    id: "augment-offer",
    decisionType: "augment-selection",
    source$: deps.augmentOffer$,
    cancel$: deps.augmentPicked$,
    debounceMs: AUGMENT_OFFER_DEBOUNCE_MS,
    cooldownMs: 0,
    respectGlobalGap: false,
    handle: deps.handle,
  };
}

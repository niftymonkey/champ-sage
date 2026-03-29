/**
 * Augment coaching controller — manages the lifecycle of GEP-triggered
 * coaching requests with debouncing and cancellation.
 *
 * Handles three cancellation scenarios with a single mechanism:
 *
 * 1. **Pick within debounce window**: Player picks an augment before the
 *    2-second debounce elapses. The pending timer is cancelled — no point
 *    asking for advice on a decision already made.
 *
 * 2. **Pick while LLM is in flight**: The 2 seconds elapsed and the coaching
 *    query was submitted, but the player picks before the response arrives.
 *    The in-flight request is aborted via AbortController so the stale
 *    recommendation doesn't overwrite whatever the UI shows next.
 *
 * 3. **Re-roll while LLM is in flight**: The 2 seconds elapsed and the query
 *    was submitted, but the player re-rolls another card, changing the offer.
 *    The in-flight request is aborted and the debounce restarts with the new
 *    set of 3 augments.
 *
 * All three cases are handled by: any new augment activity (offer change or
 * pick) cancels both the pending debounce timer AND any in-flight LLM request.
 */

import { Subject, Subscription } from "rxjs";

export interface AugmentCoachingCallbacks {
  /** Called after the debounce with the augment names to query about. */
  submitQuery: (augmentNames: string[]) => Promise<void>;
  /** Called when an augment is picked (update tracked build). */
  onPicked: (name: string) => void;
}

export interface AugmentCoachingController {
  dispose: () => void;
}

const DEBOUNCE_MS = 2000;

export function createAugmentCoachingController(
  offer$: Subject<string[]>,
  picked$: Subject<string>,
  callbacks: AugmentCoachingCallbacks
): AugmentCoachingController {
  const subs = new Subscription();
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let abortController: AbortController | null = null;

  /**
   * Cancel any pending debounce timer and abort any in-flight LLM request.
   * Called on every new augment activity (offer change or pick).
   */
  function cancelPending(): void {
    if (debounceTimer) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
    if (abortController) {
      abortController.abort();
      abortController = null;
    }
  }

  // New augment offer (initial or after re-roll): cancel everything, restart debounce.
  // Covers scenario 3 (re-roll while LLM in flight) and normal debounce reset.
  subs.add(
    offer$.subscribe((names) => {
      cancelPending();

      debounceTimer = setTimeout(() => {
        debounceTimer = null;
        abortController = new AbortController();

        callbacks.submitQuery(names).catch(() => {
          // Aborted or failed — either way, nothing to do
        });
      }, DEBOUNCE_MS);
    })
  );

  // Augment picked: cancel everything, update build.
  // Covers scenario 1 (pick within debounce) and scenario 2 (pick while LLM in flight).
  subs.add(
    picked$.subscribe((name) => {
      cancelPending();
      callbacks.onPicked(name);
    })
  );

  return {
    dispose() {
      cancelPending();
      subs.unsubscribe();
    },
  };
}

export { DEBOUNCE_MS };

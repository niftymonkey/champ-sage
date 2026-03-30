/**
 * GEP (Game Events Provider) bridge — listens for augment events from
 * Overwolf GEP via the Electron preload API and emits them as augment
 * input events compatible with the existing manualInput$ stream.
 *
 * When GEP data is available (ow-electron with overlay injected), augment
 * offers are detected automatically. When unavailable (vanilla Electron),
 * this module is a no-op and the app falls back to voice/manual input.
 */

import { Subject, Subscription } from "rxjs";
import { distinctUntilChanged } from "rxjs/operators";
import { getLogger } from "../logger";

const gepLog = getLogger("gep");

export interface GepAugmentOfferPayload {
  augment_1: { name: string };
  augment_2: { name: string };
  augment_3: { name: string };
}

/**
 * Emits the current 3 augment choices whenever GEP detects the augment
 * selection screen or a re-roll changes the options. Fires on every change,
 * not debounced — consumers should debounce as needed.
 */
export const augmentOffer$ = new Subject<string[]>();

/**
 * Emits the display name of the augment the player selected.
 */
export const augmentPicked$ = new Subject<string>();

/** Raw GEP info updates — deduplicated via distinctUntilChanged */
export const gepInfoUpdate$ = new Subject<unknown>();

/** Raw GEP game events — deduplicated via distinctUntilChanged */
export const gepGameEvent$ = new Subject<unknown>();

/**
 * Start listening for GEP events from the Electron main process.
 * Call once during app initialization. Returns a cleanup function.
 *
 * GEP fires each event twice (known ow-electron behavior). We push
 * raw events into Subjects, pipe through distinctUntilChanged for dedup,
 * then log and process the clean stream.
 */
let bridgeActive = false;

export function initGepBridge(): () => void {
  const api = window.electronAPI;
  if (!api?.onGepInfoUpdate) {
    return () => {};
  }

  // Guard against double-init (React StrictMode calls effects twice in dev)
  if (bridgeActive) {
    return () => {};
  }
  bridgeActive = true;

  const subs = new Subscription();

  // Raw subjects that receive every IPC event (including duplicates)
  const rawInfo$ = new Subject<unknown>();
  const rawEvent$ = new Subject<unknown>();

  // Deduplicated streams
  const dedupedInfo$ = rawInfo$.pipe(
    distinctUntilChanged((a, b) => JSON.stringify(a) === JSON.stringify(b))
  );
  const dedupedEvent$ = rawEvent$.pipe(
    distinctUntilChanged((a, b) => JSON.stringify(a) === JSON.stringify(b))
  );

  // Process deduplicated info updates
  subs.add(
    dedupedInfo$.subscribe((payload) => {
      gepLog.trace("GEP info update", payload);
      gepInfoUpdate$.next(payload);

      const update = payload as {
        feature?: string;
        category?: string;
        key?: string;
        value?: string;
      };

      // Augment offers — GEP sends these when the augment selection screen appears.
      // The key is "me" under feature "augments", category "me".
      if (update.feature === "augments" && update.key === "me") {
        try {
          const augments: GepAugmentOfferPayload =
            typeof update.value === "string"
              ? JSON.parse(update.value)
              : update.value;

          const names = [
            augments.augment_1?.name,
            augments.augment_2?.name,
            augments.augment_3?.name,
          ].filter(Boolean);

          gepLog.info(`Augment offer: ${names.join(", ")}`);
          augmentOffer$.next(names);
        } catch (err) {
          gepLog.error(`Failed to parse augment offer: ${err}`);
        }
      }

      // Augment picked — value is a plain string like "Protein Shake"
      if (update.feature === "augments" && update.key === "picked_augment") {
        const name = String(update.value ?? "").trim();
        if (name) {
          gepLog.info(`Augment picked: ${name}`);
          augmentPicked$.next(name);
        }
      }
    })
  );

  // Forward deduplicated game events
  subs.add(
    dedupedEvent$.subscribe((payload) => {
      gepLog.trace("GEP game event", payload);
      gepGameEvent$.next(payload);
    })
  );

  // Wire IPC listeners to raw subjects
  const unlistenInfo = api.onGepInfoUpdate((payload) => rawInfo$.next(payload));
  const unlistenEvent = api.onGepGameEvent((payload) =>
    rawEvent$.next(payload)
  );

  gepLog.info("GEP bridge initialized — listening for augment events");

  return () => {
    bridgeActive = false;
    unlistenInfo();
    unlistenEvent();
    subs.unsubscribe();
    rawInfo$.complete();
    rawEvent$.complete();
  };
}

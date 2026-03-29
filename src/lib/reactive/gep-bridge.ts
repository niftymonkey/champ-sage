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
import { debugInput$ } from "./streams";

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

  // Log and process deduplicated info updates
  subs.add(
    dedupedInfo$.subscribe((payload) => {
      const timestamp = new Date().toISOString();
      api
        .invoke(
          "append_gep_log",
          `[${timestamp}] [info] ${JSON.stringify(payload)}`
        )
        .catch(() => {});

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

          debugInput$.next({
            source: "gep",
            summary: `Augment offer: ${names.join(", ")}`,
          });

          augmentOffer$.next(names);
        } catch (err) {
          debugInput$.next({
            source: "gep",
            summary: `Failed to parse augment offer: ${err}`,
          });
        }
      }

      // Augment picked — value is a plain string like "Protein Shake"
      if (update.feature === "augments" && update.key === "picked_augment") {
        const name = String(update.value ?? "").trim();
        if (name) {
          debugInput$.next({
            source: "gep",
            summary: `Augment picked: ${name}`,
          });

          augmentPicked$.next(name);
        }
      }
    })
  );

  // Log and forward deduplicated game events
  subs.add(
    dedupedEvent$.subscribe((payload) => {
      const timestamp = new Date().toISOString();
      api
        .invoke(
          "append_gep_log",
          `[${timestamp}] [event] ${JSON.stringify(payload)}`
        )
        .catch(() => {});

      gepGameEvent$.next(payload);
    })
  );

  // Wire IPC listeners to raw subjects
  const unlistenInfo = api.onGepInfoUpdate((payload) => rawInfo$.next(payload));
  const unlistenEvent = api.onGepGameEvent((payload) =>
    rawEvent$.next(payload)
  );

  debugInput$.next({
    source: "gep",
    summary: "GEP bridge initialized — listening for augment events",
  });

  return () => {
    bridgeActive = false;
    unlistenInfo();
    unlistenEvent();
    subs.unsubscribe();
    rawInfo$.complete();
    rawEvent$.complete();
  };
}

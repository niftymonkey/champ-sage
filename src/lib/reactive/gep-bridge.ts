/**
 * GEP (Game Events Provider) bridge — listens for augment events from
 * Overwolf GEP via the Electron preload API and emits them as augment
 * input events compatible with the existing manualInput$ stream.
 *
 * When GEP data is available (ow-electron with overlay injected), augment
 * offers are detected automatically. When unavailable (vanilla Electron),
 * this module is a no-op and the app falls back to voice/manual input.
 */

import { Subject } from "rxjs";
import { debugInput$, manualInput$ } from "./streams";

export interface GepAugmentOffer {
  augment_1: { name: string };
  augment_2: { name: string };
  augment_3: { name: string };
}

export interface GepPickedAugment {
  [slot: string]: { name: string };
}

/** Observable for raw GEP info updates (for debugging/logging) */
export const gepInfoUpdate$ = new Subject<unknown>();

/** Observable for raw GEP game events (for debugging/logging) */
export const gepGameEvent$ = new Subject<unknown>();

/**
 * Start listening for GEP events from the Electron main process.
 * Call once during app initialization. Returns a cleanup function.
 */
export function initGepBridge(): () => void {
  const api = window.electronAPI;
  if (!api?.onGepInfoUpdate) {
    return () => {};
  }

  // Log all raw GEP events to a dedicated GEP log for post-game review
  const logGepEvent = (label: string, data: unknown) => {
    const timestamp = new Date().toISOString();
    const line = `[${timestamp}] [${label}] ${JSON.stringify(data)}`;
    api.invoke("append_gep_log", line).catch(() => {});
  };

  const unlistenInfo = api.onGepInfoUpdate((payload) => {
    logGepEvent("info", payload);
    const update = payload as {
      feature?: string;
      category?: string;
      key?: string;
      value?: string;
    };

    gepInfoUpdate$.next(update);

    // Augment offers — GEP sends these when the augment selection screen appears
    if (update.key === "augments" && update.category === "me") {
      try {
        const augments: GepAugmentOffer =
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
          summary: `Augment offer detected: ${names.join(", ")}`,
        });

        // Emit as augment offer event into the manual input stream
        manualInput$.next({
          type: "augment-offer" as const,
          augments: names,
          source: "gep" as const,
        });
      } catch (err) {
        debugInput$.next({
          source: "gep",
          summary: `Failed to parse augment offer: ${err}`,
        });
      }
    }

    // Augment picked — GEP sends when the player selects an augment
    if (update.key === "picked_augment" && update.category === "me") {
      try {
        const picked: GepPickedAugment =
          typeof update.value === "string"
            ? JSON.parse(update.value)
            : update.value;

        // Find the most recently filled slot
        const slots = Object.entries(picked)
          .filter(([, v]) => v.name !== "")
          .map(([slot, v]) => ({ slot, name: v.name }));

        if (slots.length > 0) {
          const latest = slots[slots.length - 1];
          debugInput$.next({
            source: "gep",
            summary: `Augment picked: ${latest.name} (${latest.slot})`,
          });

          manualInput$.next({
            type: "augment-picked" as const,
            name: latest.name,
            source: "gep" as const,
          });
        }
      } catch (err) {
        debugInput$.next({
          source: "gep",
          summary: `Failed to parse picked augment: ${err}`,
        });
      }
    }
  });

  const unlistenEvent = api.onGepGameEvent((payload) => {
    logGepEvent("event", payload);
    gepGameEvent$.next(payload);
  });

  debugInput$.next({
    source: "gep",
    summary: "GEP bridge initialized — listening for augment events",
  });

  return () => {
    unlistenInfo();
    unlistenEvent();
  };
}

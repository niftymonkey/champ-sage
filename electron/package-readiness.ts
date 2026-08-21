import type { SubsystemStatus } from "../src/lib/app-status";

/**
 * Watches for Overwolf packages that never arrive.
 *
 * OWEPM announces each package with a `ready` event, and every piece of
 * Overwolf functionality hangs off one. There is no event for "this package is
 * never coming". A total GEP loss therefore produces silence: `lastGepHealth`
 * stays null, the health banner has nothing to render, and the app looks
 * exactly like a healthy one that simply has no warnings. Silence is the one
 * failure the player cannot be expected to notice, so this turns it into a
 * deadline.
 */

/**
 * How long to wait before calling a package missing.
 *
 * Generous on purpose: a cold OWEPM cache downloads ~19 MB of GEP on a slow
 * connection, and a false "augment coaching is unavailable" during a normal
 * first launch is worse than a minute of quiet.
 */
export const PACKAGE_READY_TIMEOUT_MS = 60_000;

/** The packages the app needs; anything missing from this list is not watched. */
export const REQUIRED_PACKAGES = ["gep", "overlay"] as const;

export interface ReadinessTracker {
  /** A package announced itself. */
  markReady(packageName: string): void;
  /** OWEPM said this package failed to initialize. */
  markFailed(packageName: string, reason: string): void;
  /** OWEPM said this package crashed. */
  markCrashed(packageName: string, canRecover: boolean): void;
  /** Stops the deadline. Safe to call more than once. */
  dispose(): void;
}

export interface ReadinessDeps {
  required?: readonly string[];
  onStatus: (status: SubsystemStatus) => void;
  timeoutMs?: number;
}

/**
 * The `package` status for one or more packages that never announced themselves.
 *
 * Deliberately vague about the consequence: the packages gate different
 * features, and guessing which one the player noticed is worse than telling
 * them the app is running without part of itself.
 */
function missingStatus(missing: string[]): SubsystemStatus {
  return {
    id: "package",
    level: "broken",
    message:
      "Some of Champ Sage did not start. Augment coaching and the in-game overlay may be unavailable.",
    detail: `Overwolf never reported these packages ready: ${missing.join(", ")}.`,
    action: "relaunch",
  };
}

export function createReadinessTracker(deps: ReadinessDeps): ReadinessTracker {
  const required = deps.required ?? REQUIRED_PACKAGES;
  const timeoutMs = deps.timeoutMs ?? PACKAGE_READY_TIMEOUT_MS;
  const pending = new Set(required);
  // main.ts forwards lifecycle events for EVERY Overwolf package, not just the
  // ones we depend on, so an unrelated package's crash would otherwise raise a
  // banner claiming augment coaching and the overlay are down. `pending` cannot
  // serve as this check: it empties as packages arrive.
  const watched = new Set(required);

  // Set once the deadline passes (or a package reports trouble) so a late
  // arrival knows there is a banner to take down. Without it, every `ready`
  // event would emit a redundant clear.
  let reported = false;
  let timer: ReturnType<typeof setTimeout> | null = setTimeout(() => {
    timer = null;
    if (pending.size === 0) return;
    reported = true;
    deps.onStatus(missingStatus([...pending]));
  }, timeoutMs);

  const stopTimer = (): void => {
    if (timer === null) return;
    clearTimeout(timer);
    timer = null;
  };

  const report = (status: SubsystemStatus): void => {
    reported = true;
    deps.onStatus(status);
  };

  return {
    markReady(packageName) {
      if (!pending.delete(packageName)) return;
      if (pending.size > 0) return;
      stopTimer();
      // Everything arrived. If a banner went up while we waited, take it down;
      // an `ok` level is how the registry is told to clear a subsystem.
      if (!reported) return;
      reported = false;
      deps.onStatus({
        id: "package",
        level: "ok",
        message: "All Overwolf packages are ready.",
      });
    },
    markFailed(packageName, reason) {
      if (!watched.has(packageName)) return;
      stopTimer();
      report({
        id: "package",
        level: "broken",
        message:
          "Some of Champ Sage did not start. Augment coaching and the in-game overlay may be unavailable.",
        detail: `Overwolf could not start the ${packageName} package: ${reason}`,
        action: "relaunch",
      });
    },
    markCrashed(packageName, canRecover) {
      if (!watched.has(packageName)) return;
      stopTimer();
      report({
        id: "package",
        level: canRecover ? "degraded" : "broken",
        message: canRecover
          ? "Part of Champ Sage restarted itself. Augment coaching may skip a moment."
          : "Part of Champ Sage stopped and cannot restart. Augment coaching and the in-game overlay may be unavailable.",
        detail: `The ${packageName} package crashed.`,
        action: canRecover ? undefined : "relaunch",
      });
    },
    dispose: stopTimer,
  };
}

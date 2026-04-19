/**
 * Generic race-with-retry helper for async operations that may hang or fail.
 *
 * Strategy (designed for LLM requests, but applicable to any abortable async op):
 *   - Start attempt 1 with its own AbortController.
 *   - If attempt 1 throws a non-abort error, start attempt 2 immediately.
 *   - If attempt 1 hasn't completed within `slowAfterMs`, start attempt 2
 *     in parallel and race it against attempt 1.
 *   - Whichever attempt resolves first wins; the loser's controller is aborted.
 *   - If both attempts fail, reject with the most recent error.
 *   - If the caller's `signal` aborts, both attempts are aborted and the
 *     rejection propagates. Abort errors do NOT trigger a retry.
 */

export interface AttemptContext {
  /** 1 or 2 — which attempt this is. */
  attempt: number;
  /** Abort signal for this specific attempt. Pass to downstream call. */
  signal: AbortSignal;
}

export interface RaceResult<T> {
  /** The value returned by the winning attempt. */
  value: T;
  /** Which attempt won (1 or 2). Callers can use this to tag responses. */
  winningAttempt: number;
}

export interface RaceWithRetryOptions {
  /**
   * Caller's abort signal. Propagates to both attempts. If aborted, the
   * race rejects with the abort reason and no retry is started.
   */
  signal?: AbortSignal;
  /**
   * If attempt 1 hasn't completed within this window, attempt 2 starts
   * racing in parallel. Default: 10_000ms.
   */
  slowAfterMs?: number;
  /**
   * Called when attempt 2 is triggered (by timeout or attempt 1 failure).
   * Use for logging/telemetry.
   */
  onRetryTrigger?: (
    reason: "timeout" | "attempt-1-failed",
    err?: unknown
  ) => void;
  /**
   * Called when attempt 2 wins the race. Use for logging/telemetry.
   */
  onRetrySuccess?: () => void;
  /**
   * Called when both attempts have failed, just before rejection.
   */
  onBothFailed?: (lastError: unknown) => void;
}

const DEFAULT_SLOW_AFTER_MS = 10_000;

function isAbortError(err: unknown): boolean {
  return err instanceof Error && err.name === "AbortError";
}

/**
 * Race two attempts of an async operation. Returns the first successful result
 * along with which attempt produced it. See module docstring for full semantics.
 */
export function raceWithRetry<T>(
  runAttempt: (ctx: AttemptContext) => Promise<T>,
  options?: RaceWithRetryOptions
): Promise<RaceResult<T>> {
  const slowAfterMs = options?.slowAfterMs ?? DEFAULT_SLOW_AFTER_MS;
  const userSignal = options?.signal;

  interface Attempt {
    num: number;
    controller: AbortController;
    promise: Promise<T>;
  }

  function startAttempt(num: number): Attempt {
    const controller = new AbortController();

    if (userSignal) {
      if (userSignal.aborted) {
        controller.abort();
      } else {
        userSignal.addEventListener("abort", () => controller.abort(), {
          once: true,
        });
      }
    }

    const promise = runAttempt({ attempt: num, signal: controller.signal });
    // Prevent unhandled rejection when the loser is aborted
    promise.catch(() => {});
    return { num, controller, promise };
  }

  const a = startAttempt(1);

  return new Promise<RaceResult<T>>((resolve, reject) => {
    let done = false;
    let aFailed = false;
    let bFailed = false;
    let lastErr: unknown = null;
    let b: Attempt | null = null;

    const finish = (
      ok: boolean,
      value?: T,
      fromAttempt?: number,
      err?: unknown,
      loser?: Attempt | null
    ) => {
      if (done) return;
      done = true;
      if (loser) loser.controller.abort();
      if (ok && value !== undefined && fromAttempt !== undefined) {
        resolve({ value, winningAttempt: fromAttempt });
      } else {
        reject(err);
      }
    };

    const startB = (reason: "timeout" | "attempt-1-failed", err?: unknown) => {
      if (b || done) return;
      options?.onRetryTrigger?.(reason, err);
      b = startAttempt(2);
      b.promise.then(
        (value) => {
          if (!done) options?.onRetrySuccess?.();
          finish(true, value, 2, undefined, a);
        },
        (err2) => {
          bFailed = true;
          lastErr = err2;
          // If attempt 1 already failed too, we're done
          if (aFailed) {
            options?.onBothFailed?.(lastErr);
            finish(false, undefined, undefined, err2, null);
          }
          // else wait for A
        }
      );
    };

    const slowTimer = setTimeout(() => {
      if (!done) startB("timeout");
    }, slowAfterMs);

    a.promise.then(
      (value) => {
        clearTimeout(slowTimer);
        finish(true, value, 1, undefined, b);
      },
      (err) => {
        clearTimeout(slowTimer);
        aFailed = true;
        lastErr = err;

        if (isAbortError(err)) {
          // User aborted (or we lost the race and got aborted).
          // Either way, stop. If B already won, finish is a no-op.
          finish(false, undefined, undefined, err);
          return;
        }

        // Non-abort failure — start B if not yet running
        if (!b) {
          startB("attempt-1-failed", err);
        } else if (bFailed) {
          options?.onBothFailed?.(lastErr);
          finish(false, undefined, undefined, lastErr ?? err);
        }
        // else wait for B
      }
    );
  });
}

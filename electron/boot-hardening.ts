/**
 * Boot hardening: the pure decisions behind "the window always appears".
 *
 * `electron/main.ts` owns the Electron API calls; everything here is pure or
 * dependency-injected so the boot path can be tested without a running app.
 * The rule these all serve: a failure in any one boot step must cost the user
 * that step's feature, never the window.
 */

import { readFileSync, writeFileSync } from "node:fs";

const NOT_IMPLEMENTED = (): never => {
  throw new Error("boot-hardening: not implemented");
};

// ---------------------------------------------------------------------------
// settings.json classification
// ---------------------------------------------------------------------------

/** The raw result of trying to read settings.json, as the caller observed it. */
export type RawSettingsRead =
  | { kind: "read"; raw: string }
  | { kind: "error"; error: NodeJS.ErrnoException };

export type SettingsReadStatus = "ok" | "missing" | "corrupt" | "unreadable";

export interface SettingsReadOutcome {
  status: SettingsReadStatus;
  /** Always usable: `{}` for every non-ok status, so callers need no fallback. */
  data: Record<string, unknown>;
  /**
   * Whether writing the settings file back is safe. False when the existing
   * contents hold user data we failed to understand, so a write would destroy
   * it.
   */
  safeToOverwrite: boolean;
  detail?: string;
}

/**
 * Separates "there are no settings yet" from "there are settings we could not
 * read".
 *
 * The old `readSettingsFile` collapsed both into `{}`, and because
 * `settings:set` does a read-modify-write, the next setting the user changed
 * wrote that `{}` back over a file that was merely unparseable at that moment.
 * `safeToOverwrite` is what stops that: a corrupt or unreadable file keeps its
 * contents until they have been preserved elsewhere.
 */
export function classifySettingsRead(
  input: RawSettingsRead
): SettingsReadOutcome {
  if (input.kind === "error") {
    // ENOENT is the first-launch case and the only one where nothing is at risk.
    if (input.error.code === "ENOENT") {
      return { status: "missing", data: {}, safeToOverwrite: true };
    }
    return {
      status: "unreadable",
      data: {},
      safeToOverwrite: false,
      detail: input.error.message,
    };
  }

  if (!input.raw.trim()) {
    return { status: "missing", data: {}, safeToOverwrite: true };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(input.raw);
  } catch (err) {
    return {
      status: "corrupt",
      data: {},
      safeToOverwrite: false,
      detail: err instanceof Error ? err.message : String(err),
    };
  }

  // `typeof null === "object"`, and an array is an object too; neither is a
  // settings map, and both mean the file holds something we did not write.
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return {
      status: "corrupt",
      data: {},
      safeToOverwrite: false,
      detail: `expected a JSON object, got ${Array.isArray(parsed) ? "an array" : String(parsed)}`,
    };
  }

  return {
    status: "ok",
    data: parsed as Record<string, unknown>,
    safeToOverwrite: true,
  };
}

export interface PreserveOutcome {
  preserved: boolean;
  backupPath: string;
  error?: unknown;
}

/**
 * Copies a file we could not parse to a backup path, so the evidence outlives
 * the defaults that replace it.
 *
 * Copy rather than rename, and `wx` rather than a plain write: if preservation
 * is itself the thing that fails, destroying the original or overwriting an
 * earlier backup would turn a recoverable problem into a total loss.
 */
export function preserveFileCopy(
  sourcePath: string,
  backupPath: string
): PreserveOutcome {
  try {
    writeFileSync(backupPath, readFileSync(sourcePath), { flag: "wx" });
    return { preserved: true, backupPath };
  } catch (error) {
    return { preserved: false, backupPath, error };
  }
}

/**
 * Where to park a settings file we could not read, so the evidence survives.
 *
 * The stamp is an ISO timestamp with `:` and `.` swapped for `-`: userData sits
 * on `C:` in this app and Windows rejects `:` in a filename, so a raw
 * `toISOString()` would throw and lose the very file it was preserving.
 */
export function corruptBackupPath(
  settingsPath: string,
  timestamp: Date
): string {
  const stamp = timestamp.toISOString().replace(/[:.]/g, "-");
  return `${settingsPath}.corrupt-${stamp}`;
}

// ---------------------------------------------------------------------------
// Crash reporting
// ---------------------------------------------------------------------------

/**
 * Renders anything throwable with its stack and its full `cause` chain.
 *
 * The previous handler logged `err.message` alone, so a crash that killed the
 * boot left one context-free line and no way to find the throw site.
 */
export function formatErrorForLog(err: unknown): string {
  const seen = new Set<unknown>();
  const render = (value: unknown, depth: number): string => {
    if (depth > 5 || seen.has(value)) return "[circular]";
    if (value instanceof Error) {
      seen.add(value);
      const head = value.stack || `${value.name}: ${value.message}`;
      return value.cause !== undefined
        ? `${head}\n  caused by: ${render(value.cause, depth + 1)}`
        : head;
    }
    if (typeof value === "object" && value !== null) {
      seen.add(value);
      try {
        return JSON.stringify(value);
      } catch {
        return String(value);
      }
    }
    return String(value);
  };
  return render(err, 0);
}

/**
 * Whether an uncaught exception should be swallowed silently.
 *
 * Only two things qualify: anything during shutdown, and pipe errors, which
 * ow-electron would otherwise turn into a modal error dialog. Everything else
 * is a real crash and must be logged loudly.
 */
export function shouldSuppressUncaught(
  err: unknown,
  shuttingDown: boolean
): boolean {
  if (shuttingDown) return true;
  const message = err instanceof Error ? err.message : String(err);
  return message.includes("EPIPE") || message.includes("broken pipe");
}

// ---------------------------------------------------------------------------
// Renderer load retry
// ---------------------------------------------------------------------------

export interface RetryPolicy {
  baseMs: number;
  maxMs: number;
  maxAttempts: number;
}

export const RENDERER_RETRY_POLICY: RetryPolicy = {
  baseMs: 300,
  maxMs: 5_000,
  maxAttempts: 12,
};

/**
 * Backoff for a main window that failed to load its renderer.
 *
 * In dev the usual cause is Vite not being up yet (or restarting), which
 * resolves on its own within seconds, so the early retries are fast and the
 * cap keeps a longer outage from stretching into minutes. Returns null once the
 * attempts are spent, which is the caller's signal to stop and show a failure
 * rather than retry forever.
 */
export function nextRetryDelayMs(
  attempt: number,
  policy: RetryPolicy = RENDERER_RETRY_POLICY
): number | null {
  if (attempt < 1 || attempt > policy.maxAttempts) return null;
  return Math.min(policy.baseMs * 2 ** (attempt - 1), policy.maxMs);
}

/**
 * How many times in a row a crashed renderer may be reloaded before the window
 * is left as-is. A renderer that dies during its own load reloads straight back
 * into the same crash, so an unbounded handler spins forever; a small budget
 * covers the one-off GPU or out-of-memory kill that a reload actually fixes.
 *
 * The count is consecutive, not lifetime: the caller resets it once a load
 * finishes, so an unrelated crash hours later starts from a full budget.
 */
export const MAX_RENDERER_CRASH_RELOADS = 3;

/**
 * Whether a renderer that died should be reloaded.
 *
 * `killed` is what a deliberate teardown looks like, and reloading during
 * shutdown fights the quit, so both stop the recovery regardless of budget.
 */
export function shouldReloadAfterCrash(
  attempt: number,
  reason: string,
  shuttingDown: boolean
): boolean {
  if (shuttingDown || reason === "killed") return false;
  return attempt >= 1 && attempt <= MAX_RENDERER_CRASH_RELOADS;
}

// ---------------------------------------------------------------------------
// Boot step guarding
// ---------------------------------------------------------------------------

export interface BootStepOutcome {
  step: string;
  ok: boolean;
  error?: unknown;
}

export interface GuardInitDeps {
  onError: (step: string, err: unknown) => void;
  /** Dev-only fault injection: the step name that should throw. */
  simulateFailureFor?: string | null;
}

/**
 * Runs one boot step so that its failure cannot reach `whenReady`.
 *
 * An unhandled rejection inside `whenReady().then(async ...)` used to abandon
 * the rest of the boot silently, and if it happened before `createMainWindow()`
 * the process stayed alive with no window at all. Every step is wrapped, so the
 * cost of a failure is that step's feature and nothing more.
 */
export async function guardInit(
  step: string,
  run: () => unknown | Promise<unknown>,
  deps: GuardInitDeps
): Promise<BootStepOutcome> {
  // The reporter runs on the worst boots there are; a throw from it would
  // reject out of the guard and abandon the steps this function exists to save.
  const report = (error: unknown): void => {
    try {
      deps.onError(step, error);
    } catch {
      // Nothing to report it to: reporting is what just failed.
    }
  };

  if (deps.simulateFailureFor === step) {
    const error = new Error(
      `CS_SIMULATE_BOOT_ERROR: forced failure of '${step}'`
    );
    report(error);
    return { step, ok: false, error };
  }
  try {
    await run();
    return { step, ok: true };
  } catch (error) {
    report(error);
    return { step, ok: false, error };
  }
}

/**
 * Dev-only: which boot step `CS_SIMULATE_BOOT_ERROR` should fail.
 *
 * Gated on the dev server URL, matching `CS_SIMULATE_EXIT`, so a packaged build
 * cannot be told to break its own boot.
 */
export function parseSimulatedBootError(
  value: string | undefined,
  devServerUrl: string | undefined
): string | null {
  if (!devServerUrl) return null;
  const step = value?.trim();
  return step ? step : null;
}

// ---------------------------------------------------------------------------
// Shutdown drain
// ---------------------------------------------------------------------------

export type DrainResult = "drained" | "timeout" | "failed";

/**
 * Waits for shutdown work, but never forever.
 *
 * `before-quit` calls `preventDefault()` and re-quits once the decision log
 * drains. If that drain hangs, the quit never happens: the process stays alive,
 * invisible, and holds the single-instance lock that the next launch needs
 * (G17). A timeout costs at most the tail of one log file.
 */
export async function drainWithTimeout(
  work: () => Promise<unknown>,
  timeoutMs: number
): Promise<DrainResult> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<DrainResult>((resolve) => {
    timer = setTimeout(() => resolve("timeout"), timeoutMs);
  });
  const drained = (async (): Promise<DrainResult> => {
    try {
      await work();
      return "drained";
    } catch {
      return "failed";
    }
  })();

  try {
    return await Promise.race([drained, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

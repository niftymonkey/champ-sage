/**
 * Structured logger.
 *
 * Wraps electron-log's renderer module with type-enforced module scopes.
 * In Electron, logs are sent via IPC to the main process which writes
 * them to the NDJSON log file.
 *
 * Why static import (instead of dynamic-import lazy load):
 *   - The earlier lazy form `import("electron-log/renderer")` hung
 *     indefinitely in Vite 7's dev server — the dynamic import promise
 *     never resolved, silently dropping every scoped renderer log.
 *   - The original reason for going lazy was that evalite (Node) blew up
 *     when statically importing `electron-log/renderer`. That's now
 *     handled at the bundler layer: `vitest.config.ts` aliases
 *     `electron-log/renderer` to a no-op stub for test + eval contexts.
 *     Production renderer builds get the real module.
 *
 * Usage:
 *   import { getLogger } from '../lib/logger';
 *   const log = getLogger('engine');
 *   log.info('LCU found', { port: 1234 });
 */

import electronLog from "electron-log/renderer";

export type LogModule =
  | "app"
  | "engine"
  | "game-state"
  | "coaching:reactive"
  | "coaching:proactive"
  | "coaching:session"
  | "gep"
  | "voice"
  | "data-ingest"
  | "ui"
  | "ipc"
  | "overlay"
  | "overlay:calibration"
  | "overlay:strip";

export interface ScopedLogger {
  error: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  info: (...args: unknown[]) => void;
  debug: (...args: unknown[]) => void;
  /** Lowest level — raw payloads, per-tick data */
  trace: (...args: unknown[]) => void;
}

const scopeCache = new Map<LogModule, ScopedLogger>();

export function getLogger(module: LogModule): ScopedLogger {
  let logger = scopeCache.get(module);
  if (logger) return logger;

  const scoped = electronLog.scope(module);
  logger = {
    error: (...args: unknown[]) => scoped.error(...args),
    warn: (...args: unknown[]) => scoped.warn(...args),
    info: (...args: unknown[]) => scoped.info(...args),
    debug: (...args: unknown[]) => scoped.debug(...args),
    // electron-log calls this "silly" — we expose it as "trace"
    trace: (...args: unknown[]) => scoped.silly(...args),
  };

  scopeCache.set(module, logger);
  return logger;
}

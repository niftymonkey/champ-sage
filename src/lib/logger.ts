/**
 * Structured logger for the renderer process.
 *
 * Wraps electron-log's renderer module with type-enforced module scopes.
 * In Electron, logs are sent via IPC to the main process which writes
 * them to the NDJSON log file. In non-Electron contexts (tests),
 * the module mock or console fallback handles it.
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

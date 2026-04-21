/**
 * Structured logger.
 *
 * Picks the correct electron-log implementation based on the runtime:
 * Electron's renderer process uses `electron-log/renderer` (IPC to main),
 * everything else (Electron main, plain Node, vitest, evalite) uses
 * `electron-log/node`. The `process.type` marker is the same signal
 * electron-log itself uses internally to route between implementations.
 *
 * Usage:
 *   import { getLogger } from '../lib/logger';
 *   const log = getLogger('engine');
 *   log.info('LCU found', { port: 1234 });
 */

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

type ElectronLogScope = {
  error: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  info: (...args: unknown[]) => void;
  debug: (...args: unknown[]) => void;
  silly: (...args: unknown[]) => void;
};

type ElectronLog = {
  scope: (name: string) => ElectronLogScope;
};

const processType =
  typeof process === "object" && process !== null
    ? (process as { type?: string }).type
    : undefined;

const electronLog: ElectronLog =
  processType === "renderer"
    ? ((await import("electron-log/renderer")).default as ElectronLog)
    : ((await import("electron-log/node")).default as ElectronLog);

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

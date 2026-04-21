/**
 * Structured logger.
 *
 * Wraps electron-log's renderer module with type-enforced module scopes.
 * In Electron, logs are sent via IPC to the main process which writes
 * them to the NDJSON log file.
 *
 * electron-log is loaded lazily on the first log invocation — not at
 * module-top — so importers that never actually log (notably the evalite
 * harness, which transitively pulls in conversation-session.ts →
 * recommendation-engine.ts → logger.ts but never calls a logger method)
 * don't trigger electron-log's transport initialization. Top-level eager
 * loading caused evalite's test-discovery phase to hang on electron-log's
 * IPC-transport setup.
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

type LogLevel = "error" | "warn" | "info" | "debug" | "silly";

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

let cachedElectronLog: ElectronLog | null = null;
let loadingPromise: Promise<ElectronLog> | null = null;

function loadElectronLog(): Promise<ElectronLog> {
  if (cachedElectronLog) return Promise.resolve(cachedElectronLog);
  if (!loadingPromise) {
    loadingPromise = import("electron-log/renderer").then((mod) => {
      cachedElectronLog = mod.default as unknown as ElectronLog;
      return cachedElectronLog;
    });
  }
  return loadingPromise;
}

const scopeCache = new Map<LogModule, ScopedLogger>();

export function getLogger(module: LogModule): ScopedLogger {
  const cached = scopeCache.get(module);
  if (cached) return cached;

  let scopeInstance: ElectronLogScope | null = null;

  function invoke(level: LogLevel, args: unknown[]): void {
    if (scopeInstance) {
      scopeInstance[level](...args);
      return;
    }
    if (cachedElectronLog) {
      scopeInstance = cachedElectronLog.scope(module);
      scopeInstance[level](...args);
      return;
    }
    void loadElectronLog().then((log) => {
      if (!scopeInstance) scopeInstance = log.scope(module);
      scopeInstance[level](...args);
    });
  }

  const logger: ScopedLogger = {
    error: (...args) => invoke("error", args),
    warn: (...args) => invoke("warn", args),
    info: (...args) => invoke("info", args),
    debug: (...args) => invoke("debug", args),
    // electron-log calls this "silly" — we expose it as "trace"
    trace: (...args) => invoke("silly", args),
  };

  scopeCache.set(module, logger);
  return logger;
}

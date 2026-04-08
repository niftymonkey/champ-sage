/**
 * Main process logger setup.
 *
 * Configures electron-log with:
 * - NDJSON file transport (one file per session, 5-day retention)
 * - Pretty console transport for dev
 * - Persisted log level via electron-store or simple JSON file
 *
 * Must be called before any other electron-log usage in the main process.
 */

import log from "electron-log/main";
import { app } from "electron";
import { readdirSync, unlinkSync, readFileSync, writeFileSync } from "node:fs";
import { join, basename } from "node:path";

type LogLevel = "error" | "warn" | "info" | "debug" | "silly";

/** Maps our user-facing level names to electron-log levels */
const LEVEL_MAP: Record<string, LogLevel> = {
  error: "error",
  warn: "warn",
  info: "info",
  debug: "debug",
  trace: "silly",
};

const LOG_RETENTION_DAYS = 5;
const LOG_FILENAME_PATTERN = /^champ-sage-\d{4}-\d{2}-\d{2}[T_-]?\d{0,6}\.log$/;

// ---------------------------------------------------------------------------
// Log level persistence
// ---------------------------------------------------------------------------

function getSettingsPath(): string {
  return join(app.getPath("userData"), "log-settings.json");
}

export function loadLogLevel(): string {
  try {
    const raw = readFileSync(getSettingsPath(), "utf-8");
    const settings = JSON.parse(raw) as { level?: string };
    if (settings.level && settings.level in LEVEL_MAP) {
      return settings.level;
    }
  } catch {
    // No settings file or invalid — use default
  }
  return "info";
}

export function saveLogLevel(level: string): void {
  writeFileSync(getSettingsPath(), JSON.stringify({ level }), "utf-8");
}

// ---------------------------------------------------------------------------
// NDJSON formatter
// ---------------------------------------------------------------------------

function ndjsonFormat(params: {
  data: unknown[];
  level: string;
  message: {
    date?: Date;
    scope?: string;
    variables?: { processType?: string };
  };
}): unknown[] {
  const { data, level, message } = params;

  const parts: string[] = [];
  let metadata: Record<string, unknown> | undefined;

  for (const item of data) {
    if (typeof item === "string") {
      parts.push(item);
    } else if (item instanceof Error) {
      parts.push(item.message);
      if (item.stack) {
        metadata = { ...metadata, stack: item.stack };
      }
    } else if (typeof item === "object" && item !== null) {
      metadata = { ...metadata, ...(item as Record<string, unknown>) };
    } else {
      parts.push(String(item));
    }
  }

  const entry: Record<string, unknown> = {
    time: (message.date ?? new Date()).toISOString(),
    level,
    ...(message.scope ? { scope: message.scope } : {}),
    process:
      message.variables?.processType === "renderer" ? "renderer" : "main",
    msg: parts.join(" "),
    ...(metadata ? metadata : {}),
  };

  return [JSON.stringify(entry)];
}

// ---------------------------------------------------------------------------
// Log file pruning
// ---------------------------------------------------------------------------

function pruneOldLogs(logsDir: string): void {
  const cutoff = Date.now() - LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000;

  try {
    for (const file of readdirSync(logsDir)) {
      if (!LOG_FILENAME_PATTERN.test(file)) continue;

      // Extract date from filename: champ-sage-YYYY-MM-DD_HHMMSS.log
      // (also handles old format champ-sage-YYYY-MM-DD.log)
      const dateStr = file.slice(
        "champ-sage-".length,
        "champ-sage-".length + 10
      );
      const fileDate = new Date(dateStr + "T00:00:00Z").getTime();

      if (fileDate && fileDate < cutoff) {
        try {
          unlinkSync(join(logsDir, file));
        } catch {
          // Best effort — file may be locked
        }
      }
    }
  } catch {
    // Logs directory may not exist yet
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function initLogger(): void {
  // Initialize electron-log IPC for renderer → main communication
  log.initialize();

  // NDJSON format for the file transport
  log.transports.file.format = ndjsonFormat as unknown as string;

  // Per-session log files — include date and time so multiple sessions
  // in the same day don't overwrite each other
  const now = new Date();
  const dateStr = now.toISOString().slice(0, 10);
  const timeStr = now.toISOString().slice(11, 19).replace(/:/g, "");
  log.transports.file.fileName = `champ-sage-${dateStr}_${timeStr}.log`;

  // Disable size-based rotation (we use time-based via filename)
  log.transports.file.maxSize = 0;

  // Set log levels from persisted setting
  const level = loadLogLevel();
  const electronLevel = LEVEL_MAP[level] ?? "info";
  log.transports.file.level = electronLevel;
  log.transports.console.level = electronLevel;

  // Prune old log files from the directory electron-log resolved
  const logFile = log.transports.file.getFile();
  if (logFile?.path) {
    const resolvedDir = join(logFile.path, "..");
    pruneOldLogs(resolvedDir);
  }

  // Log the session start
  const appLog = log.scope("app");
  const version = app.getVersion();
  appLog.info(
    `Champ Sage v${version} starting — log level: ${level}, log file: ${logFile?.path ?? "unknown"}`
  );
}

/** Change the active log level at runtime (called from menu) */
export function setLogLevel(level: string): void {
  const electronLevel = LEVEL_MAP[level];
  if (!electronLevel) return;

  log.transports.file.level = electronLevel;
  log.transports.console.level = electronLevel;
  saveLogLevel(level);

  const appLog = log.scope("app");
  appLog.info(`Log level changed to: ${level}`);
}

/** Get the directory containing log files */
export function getLogsDir(): string {
  const logFile = log.transports.file.getFile();
  if (logFile?.path) {
    return join(logFile.path, "..");
  }
  return join(app.getPath("userData"), "logs");
}

export { log };

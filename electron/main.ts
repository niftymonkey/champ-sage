import {
  app as electronApp,
  BrowserWindow,
  desktopCapturer,
  ipcMain,
  Menu,
  screen,
  shell,
} from "electron";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import WebSocket from "ws";
import {
  initLogger,
  setLogLevel,
  getLogsDir,
  log,
  loadLogLevel,
} from "./logger";
import {
  AugmentReplayFilter,
  parseAugmentOfferNames,
  parseAugmentPickedName,
} from "./gep-replay-filter";
import { createStripResizeLock } from "./strip-resize-lock";
import { createStripBoundsStore } from "./strip-bounds-store";
import {
  createCoachDecisionLog,
  type CoachDecisionLog,
} from "./decision-log/log";
import { createFileStorage } from "./decision-log/file-storage";
import {
  coachingPayloadToDecisionInput,
  type CoachingResponsePayload,
} from "./decision-log/payload-map";
import { randomUUID } from "node:crypto";
import type { DecisionQuery } from "../src/lib/decision-log/types";

const app = electronApp;

// Intercept console.log to suppress raw CloseEvent dumps from the ws library.
// Something in the ws/Node internals prints "Received on close: CloseEvent {...}"
// which produces walls of unreadable output. We filter those out.
const originalConsoleLog = console.log;
console.log = (...args: unknown[]) => {
  if (
    args.length > 0 &&
    typeof args[0] === "string" &&
    args[0].startsWith("Received on close")
  ) {
    return;
  }
  originalConsoleLog.apply(console, args);
};

// ow-electron detection — when running under ow-electron, the app object
// has an `overwolf` property with packages (overlay, gep). We don't need
// to require anything — the runtime injects it onto the app object.
// When running under vanilla Electron, this property doesn't exist.
const owApp: any =
  "overwolf" in (electronApp as any) ? (electronApp as any) : null;

// League of Legends game IDs
const LOL_GAME_ID = 5426;

// ---------------------------------------------------------------------------
// Lockfile discovery
// ---------------------------------------------------------------------------

function resolveLockfilePath(): string {
  if (process.env.LCU_LOCKFILE_PATH) {
    return process.env.LCU_LOCKFILE_PATH;
  }

  if (process.platform === "darwin") {
    return "/Applications/League of Legends.app/Contents/LoL/lockfile";
  }

  return String.raw`C:\Riot Games\League of Legends\lockfile`;
}

interface LcuCredentials {
  port: number;
  token: string;
}

function parseLockfile(content: string): LcuCredentials {
  const parts = content.trim().split(":");
  if (parts.length < 5) {
    throw new Error(`Lockfile has ${parts.length} fields, expected at least 5`);
  }
  const port = parseInt(parts[2], 10);
  if (isNaN(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid port: '${parts[2]}'`);
  }
  const token = parts[3];
  if (!token) {
    throw new Error("Auth token is empty");
  }
  return { port, token };
}

function lcuBasicAuth(token: string): string {
  return `Basic ${Buffer.from(`riot:${token}`).toString("base64")}`;
}

// ---------------------------------------------------------------------------
// Active WebSocket connection (for cleanup)
// ---------------------------------------------------------------------------

let activeWs: WebSocket | null = null;
let activeWsReject: ((err: Error) => void) | null = null;
let shuttingDown = false;

function cleanupWebSocket(): void {
  if (!activeWs) return;

  const ws = activeWs;
  const pendingReject = activeWsReject;
  activeWs = null;
  activeWsReject = null;

  // Remove all listeners BEFORE closing to prevent close/error handlers
  // from firing during teardown (which causes EPIPE and CloseEvent dumps)
  ws.removeAllListeners();

  // Reject any pending connection promise so Electron doesn't warn
  // "reply was never sent"
  if (pendingReject) {
    pendingReject(new Error("WebSocket cleanup — connection aborted"));
  }

  if (
    ws.readyState === WebSocket.CONNECTING ||
    ws.readyState === WebSocket.OPEN
  ) {
    ws.terminate();
  }
}

// ---------------------------------------------------------------------------
// IPC handlers
// ---------------------------------------------------------------------------

function quietHandler<T extends unknown[]>(
  fn: (...args: T) => Promise<unknown>
): (...args: T) => Promise<unknown> {
  return async (...args: T) => {
    try {
      return await fn(...args);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { __error: msg };
    }
  };
}

function sendToAllWindows(channel: string, data: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    try {
      if (!win.isDestroyed()) {
        win.webContents.send(channel, data);
      }
    } catch {
      // Window may be mid-destruction — ignore EPIPE / send failures
    }
  }
}

/**
 * Force a compositor paint flush on a transparent Overwolf passthrough
 * overlay window. `webContents.invalidate()` is asynchronous and unreliable
 * on this window type — it often gets coalesced away. This stacks three
 * mechanisms to guarantee the compositor actually paints:
 *   1. `invalidate()` — soft hint to Chromium
 *   2. Opacity nudge (0.999 → original) — routes through alpha compositing
 *   3. Content size nudge (h → h+1 → h) — forces full layout invalidation
 * All three are imperceptible to the user but create cumulative pressure
 * on the compositor to flush a fresh frame.
 */
function forceCompositorFlush(
  win: Electron.BrowserWindow,
  label: string
): void {
  try {
    if (win.isDestroyed()) return;
    win.webContents.invalidate();

    const originalOpacity = win.getOpacity();
    win.setOpacity(0.999);

    const [w, h] = win.getContentSize();
    win.setContentSize(w, h + 1);

    setImmediate(() => {
      try {
        if (win.isDestroyed()) return;
        win.setOpacity(originalOpacity);
        win.setContentSize(w, h);
        overlayLog.debug(`${label} overlay: compositor flush completed`);
      } catch {
        // Window destroyed between ticks
      }
    });
  } catch {
    // Window may be mid-destruction
  }
}

/**
 * Settings persistence — JSON file under app.getPath('userData').
 *
 * The renderer's localStorage didn't survive between launches in this
 * Electron setup (writes succeed mid-session but the storage scope appears
 * empty on restart, possibly due to dev-server origin/port shifts or the
 * ow-electron renderer session lifecycle). A plain JSON file in the user
 * data dir avoids that whole class of issue: synchronous fs writes flush
 * to disk immediately and reads aren't tied to any browser-storage origin.
 *
 * Schema: a flat string-keyed map. Callers pick keys; the main process
 * stays schema-agnostic so adding new settings doesn't require touching
 * this file.
 */
function getSettingsPath(): string {
  return join(app.getPath("userData"), "settings.json");
}

function readSettingsFile(): Record<string, unknown> {
  try {
    const raw = readFileSync(getSettingsPath(), "utf-8");
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    // Missing file or parse error → empty store; caller falls back to
    // defaults. Log nothing — first-launch is the common case.
    return {};
  }
}

function writeSettingsFile(data: Record<string, unknown>): void {
  writeFileSync(getSettingsPath(), JSON.stringify(data, null, 2), "utf-8");
}

function registerSettingsIpc(): void {
  ipcMain.handle(
    "settings:get",
    quietHandler(async (_event: unknown, key: string): Promise<unknown> => {
      const data = readSettingsFile();
      return data[key] ?? null;
    })
  );

  ipcMain.handle(
    "settings:set",
    quietHandler(
      async (_event: unknown, key: string, value: unknown): Promise<void> => {
        const data = readSettingsFile();
        if (value === null || value === undefined) {
          delete data[key];
        } else {
          data[key] = value;
        }
        writeSettingsFile(data);
      }
    )
  );
}

function registerIpcHandlers(): void {
  registerSettingsIpc();

  ipcMain.handle(
    "discover_lcu",
    quietHandler(async () => {
      const lockfilePath = resolveLockfilePath();
      try {
        const content = readFileSync(lockfilePath, "utf-8");
        return parseLockfile(content);
      } catch (err) {
        throw new Error(
          `Could not read lockfile at ${lockfilePath}: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    })
  );

  ipcMain.handle(
    "fetch_lcu",
    quietHandler(
      async (
        _event: unknown,
        port: number,
        token: string,
        endpoint: string
      ) => {
        const url = `https://127.0.0.1:${port}${endpoint}`;
        const https = await import("node:https");
        const agent = new https.Agent({ rejectUnauthorized: false });

        return new Promise<string>((resolve, reject) => {
          https
            .get(
              url,
              { agent, headers: { Authorization: lcuBasicAuth(token) } },
              (res) => {
                if (
                  res.statusCode &&
                  (res.statusCode < 200 || res.statusCode >= 300)
                ) {
                  reject(new Error(`HTTP_${res.statusCode}`));
                  return;
                }
                let data = "";
                res.on("data", (chunk: string) => (data += chunk));
                res.on("end", () => resolve(data));
              }
            )
            .on("error", (err: Error) =>
              reject(new Error(`CONNECTION_FAILED:${err.message}`))
            );
        });
      }
    )
  );

  ipcMain.handle(
    "fetch_riot_api",
    quietHandler(async (_event: unknown, endpoint: string) => {
      const url = `https://localhost:2999${endpoint}`;
      const https = await import("node:https");
      const agent = new https.Agent({ rejectUnauthorized: false });

      return new Promise<string>((resolve, reject) => {
        https
          .get(url, { agent }, (res) => {
            if (res.statusCode === 404) {
              reject(new Error("LOADING"));
              return;
            }
            if (
              res.statusCode &&
              (res.statusCode < 200 || res.statusCode >= 300)
            ) {
              reject(new Error(`HTTP_${res.statusCode}`));
              return;
            }
            let data = "";
            res.on("data", (chunk: string) => (data += chunk));
            res.on("end", () => resolve(data));
          })
          .on("error", (err: Error) =>
            reject(new Error(`CONNECTION_FAILED:${err.message}`))
          );
      });
    })
  );

  ipcMain.handle(
    "connect_lcu_websocket",
    quietHandler(async (_event: unknown, port: number, token: string) => {
      cleanupWebSocket();

      const ws = new WebSocket(`wss://127.0.0.1:${port}/`, {
        headers: { Authorization: lcuBasicAuth(token) },
        rejectUnauthorized: false,
      });
      activeWs = ws;

      return new Promise<void>((resolve, reject) => {
        let settled = false;
        const settle = (fn: () => void) => {
          if (settled) return;
          settled = true;
          fn();
        };

        // Track reject so cleanupWebSocket() can settle the Promise
        activeWsReject = (err: Error) => settle(() => reject(err));

        ws.on("open", () => {
          settle(() => {
            activeWsReject = null;
            ws.send(JSON.stringify([5, "OnJsonApiEvent"]));
            resolve();
          });
        });

        ws.on("message", (raw: Buffer) => {
          try {
            const msg = JSON.parse(raw.toString());
            if (!Array.isArray(msg) || msg[0] !== 8) return;

            const payload = msg[2] as {
              uri: string;
              eventType: string;
              data: unknown;
            };
            if (!shuttingDown) {
              sendToAllWindows("lcu-event", {
                uri: payload.uri ?? "",
                event_type: payload.eventType ?? "",
                data: payload.data ?? null,
              });
            }
          } catch {
            // Non-JSON message
          }
        });

        ws.on("close", () => {
          // Settle with rejection if the Promise is still pending
          // (connection dropped before open fired)
          settle(() =>
            reject(new Error("WebSocket closed before connection completed"))
          );

          if (!shuttingDown) {
            sendToAllWindows("lcu-disconnect", {
              reason: "Server closed connection",
            });
          }
          activeWs = null;
          activeWsReject = null;
        });

        ws.on("error", (err: Error) => {
          settle(() =>
            reject(new Error(`WebSocket connection failed: ${err.message}`))
          );

          if (!shuttingDown) {
            sendToAllWindows("lcu-disconnect", {
              reason: `WebSocket error: ${err.message}`,
            });
          }
          activeWs = null;
        });
      });
    })
  );
}

// ---------------------------------------------------------------------------
// Window creation
// ---------------------------------------------------------------------------

let mainWindow: BrowserWindow | null = null;

function loadRendererContent(win: BrowserWindow): void {
  if (process.env.VITE_DEV_SERVER_URL) {
    win.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    win.loadFile(join(__dirname, "../dist/index.html"));
  }
}

function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1200,
    height: 900,
    minWidth: 800,
    backgroundColor: "#000000",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: join(__dirname, "preload.cjs"),
      backgroundThrottling: false,
    },
  });

  loadRendererContent(win);
  mainWindow = win;
  win.on("closed", () => {
    mainWindow = null;
  });

  return win;
}

// ---------------------------------------------------------------------------
// Overwolf: Overlay + GEP + Hotkeys
//
// These only initialize when running under ow-electron (owApp !== null).
// Vanilla Electron skips all of this — the app works with voice input
// and the separate desktop window only.
// ---------------------------------------------------------------------------

const appLog = log.scope("app");
const gepLog = log.scope("gep");
const voiceLog = log.scope("voice");

let gepInitialized = false;
let overlayInitialized = false;

function initOverwolfFeatures(): void {
  if (!owApp) return;

  const packages = owApp.overwolf.packages;

  packages.on("ready", (e: unknown, packageName: string, version: string) => {
    appLog.info(`Overwolf package ready: ${packageName} v${version}`);

    if (packageName === "overlay" && !overlayInitialized) {
      overlayInitialized = true;
      initOverlay();
    }
    if (packageName === "gep" && !gepInitialized) {
      gepInitialized = true;
      initGep();
    }
  });
}

// --- Overlay ---

const overlayLog = log.scope("overlay");

/** Track active overlay windows for cleanup */
let badgeOverlay: any = null;
let stripOverlay: any = null;

/**
 * Once the user has explicitly sized the strip via the corner grip in
 * edit mode, we stop content-driven auto-resize and respect their size.
 * Reset to false when Clear Overlays fires (the user-facing escape hatch)
 * and via the Settings "reset overlay size" affordance. Persisted to the
 * shared settings JSON so a restart keeps auto-fit suppressed against the
 * size Overwolf already remembers for the named strip window.
 */
const stripResizeLock = createStripResizeLock({
  read: readSettingsFile,
  write: writeSettingsFile,
});

/**
 * Persisted strip bounds — `createOverlayWindows` re-runs per game,
 * which would otherwise reset the strip to its computed defaults each
 * time. Saving the user's drag position on every move/resize event and
 * reading it back on window creation keeps placement sticky across
 * games and across launches.
 */
const stripBoundsStore = createStripBoundsStore({
  read: readSettingsFile,
  write: writeSettingsFile,
});

/**
 * Coach decision log — persistent record of every coaching response that
 * crosses the main process. Constructed lazily at IPC-register time so
 * userData is available; log handle is null until then. Failures during
 * append never block the overlay relay; we log and move on.
 */
let coachDecisionLog: CoachDecisionLog | null = null;
const decisionLog = log.scope("decision-log");

function loadOverlayContent(
  win: BrowserWindow,
  page: "overlay" | "overlay-strip"
): void {
  if (process.env.VITE_DEV_SERVER_URL) {
    win.loadURL(`${process.env.VITE_DEV_SERVER_URL}/${page}.html`);
  } else {
    win.loadFile(join(__dirname, `../dist/${page}.html`));
  }
}

const OVERLAY_WEB_PREFS = {
  contextIsolation: true,
  nodeIntegration: false,
  preload: join(__dirname, "preload.cjs"),
  backgroundThrottling: false,
};

async function createOverlayWindows(overlayApi: any): Promise<void> {
  if (badgeOverlay || stripOverlay) {
    overlayLog.warn(
      `Creating overlay windows but references still exist — badge=${!!badgeOverlay} (destroyed=${badgeOverlay?.window?.isDestroyed?.()}), strip=${!!stripOverlay} (destroyed=${stripOverlay?.window?.isDestroyed?.()})`
    );
    for (const overlay of [badgeOverlay, stripOverlay]) {
      try {
        const win = overlay?.window;
        if (win && !win.isDestroyed()) {
          win.destroy();
        }
      } catch {
        // ignore stale handles
      }
    }
    badgeOverlay = null;
    stripOverlay = null;
  }

  const primaryDisplay = screen.getPrimaryDisplay();
  const { width, height } = primaryDisplay.size;

  // Badge overlay — full screen, click-through (passThrough)
  try {
    badgeOverlay = await overlayApi.createWindow({
      name: "champ-sage-badges",
      width,
      height,
      transparent: true,
      frame: false,
      passthrough: "passThrough",
      zOrder: "topMost",
      ignoreKeyboardInput: true,
      webPreferences: OVERLAY_WEB_PREFS,
    });

    loadOverlayContent(badgeOverlay.window, "overlay");
    badgeOverlay.window.webContents.on("did-finish-load", () => {
      overlayLog.info("Badge overlay: renderer loaded successfully");
    });
    badgeOverlay.window.webContents.on(
      "did-fail-load",
      (_event, code, desc) => {
        overlayLog.error(`Badge overlay: FAILED TO LOAD (${code}: ${desc})`);
      }
    );
    badgeOverlay.window.webContents.on(
      "render-process-gone",
      (_event, details) => {
        overlayLog.error(
          `Badge overlay: renderer gone (${details.reason}, exitCode=${details.exitCode})`
        );
      }
    );
    overlayLog.info(`Badge overlay created (${width}x${height})`);
  } catch (err) {
    overlayLog.error("Failed to create badge overlay:", err);
  }

  // Coaching strip — small window, interactive (noPassThrough), draggable.
  //
  // Sized to host the v16 glass cards (max-width 380px) plus a little room
  // for shadow/glow, scaled with screen resolution. Anchored bottom-right
  // in the dead space between the item bar and the minimap, per the v16
  // spec for the notification slot. Player can shift+tab to enter edit
  // mode and drag from there; the [strip-bounds] log captures the new
  // bounds as resolution-relative fractions to settle on better defaults.
  try {
    const clamp = (v: number, lo: number, hi: number): number =>
      Math.max(lo, Math.min(hi, v));
    const defaultStripWidth = clamp(Math.round(width * 0.22), 420, 600);
    const defaultStripHeight = clamp(Math.round(height * 0.2), 200, 320);
    // Right edge offset: leave room for the minimap (~18% of width).
    // Bottom offset: ~16% from screen bottom kept the strip too high in
    // playtest; +100px puts it noticeably lower without colliding with
    // the item bar (still inside the dead-space corridor at 1080p+).
    const defaultStripX = width - defaultStripWidth - Math.round(width * 0.18);
    const defaultStripY =
      height - defaultStripHeight - Math.round(height * 0.16) + 100;

    // Persisted user drag position wins over computed defaults so the
    // strip survives the per-game `createOverlayWindows` cycle.
    const savedBounds = stripBoundsStore.get();
    const stripWidth = savedBounds?.width ?? defaultStripWidth;
    const stripHeight = savedBounds?.height ?? defaultStripHeight;
    const stripX = savedBounds?.x ?? defaultStripX;
    const stripY = savedBounds?.y ?? defaultStripY;

    stripOverlay = await overlayApi.createWindow({
      // Bumped from "champ-sage-strip" to "champ-sage-strip-v2" once the
      // v16 redesign moved the slot to the bottom-right notification dead
      // space. Overwolf keys persisted window position by name; renaming
      // orphans any prior drag state so the new defaults take effect.
      // Future drags persist under the new name normally.
      name: "champ-sage-strip-v2",
      width: stripWidth,
      height: stripHeight,
      x: stripX,
      y: stripY,
      transparent: true,
      frame: false,
      passthrough: "noPassThrough",
      zOrder: "topMost",
      ignoreKeyboardInput: true,
      webPreferences: OVERLAY_WEB_PREFS,
    });

    loadOverlayContent(stripOverlay.window, "overlay-strip");
    stripOverlay.window.webContents.on("did-finish-load", () => {
      overlayLog.info("Coaching strip: renderer loaded successfully");
    });
    stripOverlay.window.webContents.on(
      "did-fail-load",
      (_event, code, desc) => {
        overlayLog.error(`Coaching strip: FAILED TO LOAD (${code}: ${desc})`);
      }
    );
    stripOverlay.window.webContents.on(
      "render-process-gone",
      (_event, details) => {
        overlayLog.error(
          `Coaching strip: renderer gone (${details.reason}, exitCode=${details.exitCode})`
        );
      }
    );

    // Start click-through — only interactive when Shift+Tab is held
    stripOverlay.window.setIgnoreMouseEvents(true, { forward: true });

    overlayLog.info(
      `Coaching strip overlay created (${stripWidth}x${stripHeight} at ${stripX},${stripY})`
    );

    // Persist the strip's bounds on every move/resize so the user's
    // drag position survives the per-game `createOverlayWindows` cycle
    // and any process restart. Also log absolute + screen-relative
    // fractions so the user can settle the strip where they want and
    // capture values to bake in as new defaults if needed.
    // Drag/resize on Windows fires `move`/`resize` per pixel, and the
    // bounds store does a synchronous read-modify-write of settings.json
    // each time. Persist on a debounce so only the resting bounds at
    // the end of a gesture hit disk; everything else is just a log.
    let persistTimer: ReturnType<typeof setTimeout> | null = null;
    const logStripBounds = (verb: "moved" | "resized"): void => {
      try {
        const win = stripOverlay?.window;
        if (!win) return;
        const b = win.getBounds();
        if (persistTimer) clearTimeout(persistTimer);
        persistTimer = setTimeout(() => {
          stripBoundsStore.set(b);
          persistTimer = null;
        }, 250);
        const fx = (b.x / width).toFixed(4);
        const fy = (b.y / height).toFixed(4);
        const fw = (b.width / width).toFixed(4);
        const fh = (b.height / height).toFixed(4);
        overlayLog.info(
          `[strip-bounds] ${verb} | abs=(${b.x},${b.y}) ${b.width}x${b.height} | screen=${width}x${height} | rel=(${fx},${fy}) ${fw}x${fh}`
        );
      } catch (err) {
        overlayLog.warn("[strip-bounds] failed to read bounds", err);
      }
    };
    stripOverlay.window.on("moved", () => logStripBounds("moved"));
    stripOverlay.window.on("resized", () => logStripBounds("resized"));
    // Some Electron builds only fire the in-progress events; subscribe to
    // both for safety. The listeners coalesce in the log via verb only.
    stripOverlay.window.on("move", () => logStripBounds("moved"));
    stripOverlay.window.on("resize", () => logStripBounds("resized"));
  } catch (err) {
    overlayLog.error("Failed to create coaching strip overlay:", err);
  }
}

async function initCoachDecisionLog(): Promise<void> {
  if (coachDecisionLog) return;
  try {
    const dir = join(app.getPath("userData"), "decision-log");
    mkdirSync(dir, { recursive: true });
    coachDecisionLog = await createCoachDecisionLog({
      storage: createFileStorage(dir),
      clock: () => Date.now(),
      idGen: () => randomUUID(),
    });
    const w = coachDecisionLog.warnings();
    if (w.length > 0) {
      decisionLog.warn(`Hydrated with ${w.length} recovery warnings`, w);
    } else {
      decisionLog.info("Hydrated cleanly");
    }
  } catch (err) {
    decisionLog.error("Failed to initialize decision log", err);
    coachDecisionLog = null;
  }
}

function registerOverlayIpc(): void {
  // Calibration screenshot capture
  ipcMain.handle(
    "capture-calibration-screenshot",
    quietHandler(async () => {
      const primaryDisplay = screen.getPrimaryDisplay();
      const { width, height } = primaryDisplay.size;

      const sources = await desktopCapturer.getSources({
        types: ["screen"],
        thumbnailSize: { width, height },
      });

      if (sources.length === 0) {
        throw new Error("No screen sources available for capture");
      }

      const screenshot = sources[0].thumbnail.toPNG();
      const screenshotDir = join(
        app.getPath("userData"),
        "calibration-screenshots"
      );
      mkdirSync(screenshotDir, { recursive: true });

      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      const filename = `calibration-${width}x${height}-${timestamp}.png`;
      const filepath = join(screenshotDir, filename);

      writeFileSync(filepath, screenshot);
      overlayLog.info(`Screenshot saved: ${filepath}`);

      return { filepath, width, height };
    })
  );

  // Relay coaching requests/responses from desktop window to overlay windows
  ipcMain.on("coaching-request", () => {
    overlayLog.debug("Relaying coaching-request to all windows");
    sendToAllWindows("coaching-request", {});
  });

  ipcMain.on("coaching-response", (_event, data) => {
    const payload = data as { source?: string; gameId?: unknown } | undefined;
    const source = payload?.source ?? "unknown";
    const incomingGameId = payload?.gameId;
    overlayLog.info(
      `Relaying coaching-response to all windows (source=${source}, gameId=${incomingGameId ?? "MISSING"})`
    );
    sendToAllWindows("coaching-response", data);

    if (source === "augment" && badgeOverlay?.window) {
      forceCompositorFlush(badgeOverlay.window, "badge");
    }
    if (stripOverlay?.window) {
      forceCompositorFlush(stripOverlay.window, "strip");
    }

    if (coachDecisionLog) {
      const input = coachingPayloadToDecisionInput(
        data as CoachingResponsePayload
      );
      if (input) {
        coachDecisionLog
          .append(input)
          .catch((err) => decisionLog.warn("append failed", err));
      } else {
        decisionLog.warn(
          `coaching-response dropped (source=${source}, gameId=${incomingGameId ?? "MISSING"}, type=${typeof incomingGameId})`
        );
      }
    }
  });

  ipcMain.handle(
    "decision-log:query",
    quietHandler(async (_event: unknown, q: DecisionQuery) => {
      if (!coachDecisionLog) return [];
      return coachDecisionLog.query(q);
    })
  );

  // Coaching strip drag — renderer sends mousedown, we call startDragging()
  ipcMain.on("start-strip-drag", (e) => {
    if (!stripOverlay) return;
    try {
      // fromWebContents matches the sender to the overlay window
      const overlayApi = (owApp?.overwolf.packages as any)?.overlay;
      const win = overlayApi?.fromWebContents(e.sender);
      if (win) {
        win.startDragging();
        overlayLog.info("Strip drag started");
      }
    } catch {
      // Ignore — window may not be ready
    }
  });

  // Coaching strip auto-resize. The strip is a frameless transparent
  // window so OS resize handles do not exist; the renderer measures the
  // active card and tells main exactly how tall the window should be.
  //
  // Top-anchored: x and y are preserved exactly; only height changes.
  // Whatever position the user dragged the strip to is where the TOP of
  // the strip stays. Cards grow downward when content gets taller.
  //
  // Suppressed entirely once the user has manually sized the strip via
  // the edit-mode corner grip. The user's size wins until they reset.
  ipcMain.on("resize-strip-to-content", (_e, raw: unknown) => {
    if (!stripOverlay?.window) return;
    if (stripResizeLock.get()) return;
    const requested = typeof raw === "number" ? Math.round(raw) : NaN;
    if (!Number.isFinite(requested) || requested <= 0) return;
    try {
      const b = stripOverlay.window.getBounds();
      // Clamp so we do not collapse to a sliver or sprawl across the
      // screen if the content reports something silly.
      const clamped = Math.max(80, Math.min(640, requested));
      if (clamped === b.height) return;
      stripOverlay.window.setBounds({
        x: b.x,
        y: b.y,
        width: b.width,
        height: clamped,
      });
    } catch (err) {
      overlayLog.warn("resize-strip-to-content failed", err);
    }
  });

  // Coaching strip manual resize. The user dragged the corner grip in
  // edit mode; the renderer reports the absolute target dimensions. We
  // apply them and latch the resize lock so future auto-fit suggestions
  // are ignored. The lock persists to settings JSON so a restart keeps
  // honoring the user's size against the bounds Overwolf already saved.
  ipcMain.on("set-strip-size", (_e, raw: unknown) => {
    if (!stripOverlay?.window) return;
    const payload = raw as { width?: unknown; height?: unknown };
    const w =
      typeof payload?.width === "number" ? Math.round(payload.width) : NaN;
    const h =
      typeof payload?.height === "number" ? Math.round(payload.height) : NaN;
    if (!Number.isFinite(w) || !Number.isFinite(h)) return;
    if (w <= 0 || h <= 0) return;
    try {
      const b = stripOverlay.window.getBounds();
      const clampedW = Math.max(200, Math.min(1200, w));
      const clampedH = Math.max(80, Math.min(900, h));
      stripOverlay.window.setBounds({
        x: b.x,
        y: b.y,
        width: clampedW,
        height: clampedH,
      });
      stripResizeLock.set(true);
      overlayLog.info(
        `[strip-bounds] user-sized | abs=(${b.x},${b.y}) ${clampedW}x${clampedH} (auto-fit suppressed, persisted)`
      );
    } catch (err) {
      overlayLog.warn("set-strip-size failed", err);
    }
  });

  // Coaching strip auto-fit reset. Re-enables content-driven sizing. The
  // next resize-strip-to-content will apply.
  ipcMain.on("reset-strip-size", () => {
    if (!stripResizeLock.get()) return;
    stripResizeLock.set(false);
    overlayLog.info("Strip size lock reset - auto-fit re-enabled");
  });

  // Overlay compositor flush — renderer requests a forced repaint after a
  // state-hidden transition (#111). React unmounting isn't enough for
  // ow-electron's compositor; it retains the last painted frame until an
  // external trigger forces a flush.
  ipcMain.on("request-overlay-flush", (_e, label: unknown) => {
    const target =
      label === "badge"
        ? badgeOverlay
        : label === "strip"
          ? stripOverlay
          : null;
    if (!target?.window) return;
    forceCompositorFlush(
      target.window,
      typeof label === "string" ? label : "unknown"
    );
  });

  // Clear overlays — user-triggered escape hatch (#111). Broadcasts to
  // every renderer so overlay state machines reset to their initial state,
  // then flushes the compositor on both overlay windows so the DOM
  // unmounts paint through.
  ipcMain.on("clear-overlays", () => {
    overlayLog.info("Clear overlays requested — broadcasting reset");
    sendToAllWindows("clear-overlays", {});
    if (badgeOverlay?.window) {
      forceCompositorFlush(badgeOverlay.window, "badge");
    }
    if (stripOverlay?.window) {
      forceCompositorFlush(stripOverlay.window, "strip");
    }
    // Clear Overlays is the user's escape hatch; release the manual size
    // lock so auto-fit takes back over on the next coaching response.
    if (stripResizeLock.get()) {
      stripResizeLock.set(false);
      overlayLog.info("Strip size lock released by Clear Overlays");
    }
  });
}

function initOverlay(): void {
  if (!owApp) return;

  const overlayApi = (owApp.overwolf.packages as any).overlay;
  if (!overlayApi) {
    appLog.warn("Overlay API not available");
    return;
  }

  overlayApi.registerGames({ gamesIds: [LOL_GAME_ID] });
  appLog.info("Overlay registered for League of Legends");

  overlayApi.on("game-launched", (event: any, gameInfo: any) => {
    appLog.info(`Game launched: ${gameInfo.name} (id: ${gameInfo.id})`);

    if (gameInfo.processInfo?.isElevated) {
      appLog.error("Game is elevated — cannot inject overlay");
      event.dismiss();
      return;
    }

    event.inject();
    appLog.info("Overlay injected");
  });

  overlayApi.on("game-injected", (gameInfo: any) => {
    appLog.info(`Overlay active in ${gameInfo.name}`);
    sendToAllWindows("overlay-status", { active: true, game: gameInfo.name });

    registerOverlayHotkeys(overlayApi);
    createOverlayWindows(overlayApi);
  });

  overlayApi.on("game-exit", (gameInfo: any, wasInjected: boolean) => {
    // NOTE: Do NOT call cleanupWebSocket() here. The WebSocket connects to
    // the LCU client, which stays alive between games. Killing it prevents
    // the engine from detecting game 2's phase transition to "InProgress".
    appLog.info(`Game exited: ${gameInfo.name} (was injected: ${wasInjected})`);
    sendToAllWindows("overlay-status", { active: false, game: gameInfo.name });

    // Destroy overlay windows to prevent memory leaks across game sessions
    try {
      badgeOverlay?.window?.destroy();
    } catch {
      /* already destroyed */
    }
    try {
      stripOverlay?.window?.destroy();
    } catch {
      /* already destroyed */
    }
    badgeOverlay = null;
    stripOverlay = null;
  });

  overlayApi.on("game-injection-error", (_gameInfo: any, error: string) => {
    appLog.error(`Overlay injection error: ${error}`);
  });
}

function registerOverlayHotkeys(overlayApi: any): void {
  overlayApi.hotkeys.register(
    {
      name: "push-to-talk",
      keyCode: 109, // VK_SUBTRACT (numpad minus)
      passthrough: true,
    },
    (_hotkey: any, state: "pressed" | "released") => {
      sendToAllWindows("hotkey-event", {
        state: state === "pressed" ? "Pressed" : "Released",
      });
    }
  );

  // Shift+Tab toggles coaching strip edit mode. Press to enter edit mode
  // (window becomes mouse-interactive, drag handle visible); press again
  // to leave it. The previous hold-to-edit behavior was inconsistent
  // because Shift+Tab is also a Riot client hotkey - releasing was
  // sometimes consumed by the game and the strip would silently stay in
  // a half-edit state.
  let stripEditing = false;
  overlayApi.hotkeys.register(
    {
      name: "overlay-edit-mode",
      keyCode: 9, // VK_TAB
      modifiers: { shift: true },
      passthrough: true,
    },
    (_hotkey: any, state: "pressed" | "released") => {
      if (state !== "pressed") return;
      stripEditing = !stripEditing;
      sendToAllWindows("overlay-edit-mode", { editing: stripEditing });

      if (stripOverlay) {
        try {
          if (stripEditing) {
            stripOverlay.window.setIgnoreMouseEvents(false);
          } else {
            stripOverlay.window.setIgnoreMouseEvents(true, { forward: true });
          }
        } catch {
          // Window may have been destroyed
        }
      }

      overlayLog.info(
        `Overlay edit mode: ${stripEditing ? "ON" : "OFF"} (toggle)`
      );
    }
  );

  // F8 hotkey for calibration screenshots
  overlayApi.hotkeys.register(
    {
      name: "calibration-screenshot",
      keyCode: 119, // VK_F8
      passthrough: true,
    },
    (_hotkey: any, state: "pressed" | "released") => {
      if (state === "pressed") {
        sendToAllWindows("calibration-capture", {});
        overlayLog.info("F8 pressed — triggering calibration capture");
      }
    }
  );

  // Ctrl+Shift+Space — escape hatch for stuck overlays (#111). Mirrors
  // the "Clear overlays" button in the main app window. Same flow: reset
  // every overlay's React state and force a main-process compositor flush.
  overlayApi.hotkeys.register(
    {
      name: "clear-overlays",
      keyCode: 32, // VK_SPACE
      modifiers: { ctrl: true, shift: true },
      passthrough: true,
    },
    (_hotkey: any, state: "pressed" | "released") => {
      if (state !== "pressed") return;
      overlayLog.info("Ctrl+Shift+Space pressed — clearing overlays");
      sendToAllWindows("clear-overlays", {});
      if (badgeOverlay?.window) {
        forceCompositorFlush(badgeOverlay.window, "badge");
      }
      if (stripOverlay?.window) {
        forceCompositorFlush(stripOverlay.window, "strip");
      }
    }
  );

  voiceLog.info(
    "Overlay hotkeys registered: NumpadSubtract (hold-to-talk), Shift+Tab (edit mode), F8 (calibration), Ctrl+Shift+Space (clear overlays)"
  );
}

// --- GEP (Game Events Provider) ---

/**
 * Tracks augments picked in the current game to suppress GEP's replay of
 * stale offers when the app attaches to an already-running match. Cleared
 * on game-exit so a subsequent game starts clean.
 */
const augmentReplayFilter = new AugmentReplayFilter();

function initGep(): void {
  if (!owApp) return;

  const gepApi = owApp.overwolf.packages.gep;
  if (!gepApi) {
    gepLog.warn("GEP API not available");
    return;
  }

  gepApi.on(
    "game-detected",
    (e: any, gameId: number, _name: string, gameInfo: any) => {
      if (gameId !== LOL_GAME_ID) return;

      gepLog.info(`League detected (pid: ${gameInfo.pid})`);
      e.enable();

      const requiredFeatures = ["augments"];

      gepApi
        .setRequiredFeatures(gameId, requiredFeatures)
        .then(() => {
          gepLog.debug(
            `Required features set (${requiredFeatures.join(", ")})`
          );
        })
        .catch((err: Error) => {
          gepLog.warn("Failed to set required features:", err.message);
          setTimeout(() => {
            gepApi
              .setRequiredFeatures(gameId, requiredFeatures)
              .then(() => gepLog.info("Features set on retry"))
              .catch((err2: Error) =>
                gepLog.error("Retry also failed:", err2.message)
              );
          }, 3000);
        });
    }
  );

  gepApi.on("new-info-update", (_e: any, gameId: number, ...args: any[]) => {
    if (gameId !== LOL_GAME_ID) return;
    const update = args[0];
    if (!update) return;

    const pickedName = parseAugmentPickedName(update);
    if (pickedName) {
      augmentReplayFilter.recordPick(pickedName);
    }

    const offerNames = parseAugmentOfferNames(update);
    if (offerNames && augmentReplayFilter.isStaleOffer(offerNames)) {
      gepLog.info(
        `Stale augment offer suppressed (contains already-picked augment): ${offerNames.join(
          ", "
        )}`
      );
      return;
    }

    sendToAllWindows("gep-info-update", update);
  });

  gepApi.on("new-game-event", (_e: any, gameId: number, ...args: any[]) => {
    if (gameId !== LOL_GAME_ID) return;
    sendToAllWindows("gep-game-event", args[0]);
  });

  // @ts-ignore — game-exit is undocumented but works
  gepApi.on("game-exit", (_e: any, gameId: number) => {
    if (gameId !== LOL_GAME_ID) return;
    gepLog.info("League exited");
    augmentReplayFilter.reset();
  });

  gepApi.on("error", (_e: any, gameId: number, error: any) => {
    if (gameId !== LOL_GAME_ID) return;
    gepLog.error("GEP error:", error);
  });

  gepLog.info("GEP initialized, waiting for League to launch...");
}

// ---------------------------------------------------------------------------
// Application menu with log level control
// ---------------------------------------------------------------------------

function buildAppMenu(): void {
  const currentLevel = loadLogLevel();
  const levels = ["error", "warn", "info", "debug", "trace"] as const;

  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: "File",
      submenu: [
        {
          label: "Log Level",
          submenu: levels.map((level) => ({
            label: level.charAt(0).toUpperCase() + level.slice(1),
            type: "radio" as const,
            checked: level === currentLevel,
            click: () => {
              setLogLevel(level);
              // Rebuild menu to update radio state
              buildAppMenu();
            },
          })),
        },
        {
          label: "Open Log Folder",
          click: () => shell.openPath(getLogsDir()),
        },
        { type: "separator" },
        { role: "quit" },
      ],
    },
    {
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "selectAll" },
      ],
    },
    {
      label: "View",
      submenu: [
        { role: "reload" },
        { role: "forceReload" },
        { role: "toggleDevTools" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { role: "togglefullscreen" },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ---------------------------------------------------------------------------
// App lifecycle
// ---------------------------------------------------------------------------

app.whenReady().then(async () => {
  initLogger();
  registerIpcHandlers();
  registerOverlayIpc();
  await initCoachDecisionLog();
  buildAppMenu();
  createMainWindow();

  appLog.info(
    owApp
      ? "Running as ow-electron (Overwolf features available)"
      : "Running as vanilla Electron (no Overwolf features)"
  );

  initOverwolfFeatures();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on("window-all-closed", () => {
  shuttingDown = true;
  cleanupWebSocket();
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  shuttingDown = true;
  cleanupWebSocket();
});

// Suppress EPIPE and other pipe errors during shutdown.
// ow-electron may show an error dialog for uncaught exceptions —
// this handler prevents EPIPE from reaching that dialog.
process.on("uncaughtException", (err) => {
  if (shuttingDown) return;
  if (err.message?.includes("EPIPE")) return;
  if (err.message?.includes("broken pipe")) return;
  appLog.error("Uncaught exception:", err.message);
});
process.stdout?.on?.("error", () => {});
process.stderr?.on?.("error", () => {});

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

function registerIpcHandlers(): void {
  ipcMain.handle(
    "discover_lcu",
    quietHandler(async () => {
      const lockfilePath = resolveLockfilePath();
      const content = readFileSync(lockfilePath, "utf-8");
      return parseLockfile(content);
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
      (_e: any, code: number, desc: string) => {
        overlayLog.error(`Badge overlay: FAILED TO LOAD (${code}: ${desc})`);
      }
    );
    badgeOverlay.window.webContents.on("crashed", () => {
      overlayLog.error("Badge overlay: RENDERER CRASHED");
    });
    overlayLog.info(`Badge overlay created (${width}x${height})`);
  } catch (err) {
    overlayLog.error("Failed to create badge overlay:", err);
  }

  // Coaching strip — small window, interactive (noPassThrough), draggable
  try {
    const stripWidth = Math.round(width * 0.5);
    const stripHeight = 60;
    const stripX = Math.round((width - stripWidth) / 2);
    const stripY = Math.round(height * 0.05);

    stripOverlay = await overlayApi.createWindow({
      name: "champ-sage-strip",
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
      (_e: any, code: number, desc: string) => {
        overlayLog.error(`Coaching strip: FAILED TO LOAD (${code}: ${desc})`);
      }
    );
    stripOverlay.window.webContents.on("crashed", () => {
      overlayLog.error("Coaching strip: RENDERER CRASHED");
    });

    // Start click-through — only interactive when Shift+Tab is held
    stripOverlay.window.setIgnoreMouseEvents(true, { forward: true });

    overlayLog.info(
      `Coaching strip overlay created (${stripWidth}x${stripHeight} at ${stripX},${stripY})`
    );
  } catch (err) {
    overlayLog.error("Failed to create coaching strip overlay:", err);
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
    sendToAllWindows("coaching-request", {});
  });

  ipcMain.on("coaching-response", (_event, data) => {
    sendToAllWindows("coaching-response", data);
  });

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

  // Shift+Tab to enable coaching strip dragging
  overlayApi.hotkeys.register(
    {
      name: "overlay-edit-mode",
      keyCode: 9, // VK_TAB
      modifiers: { shift: true },
      passthrough: true,
    },
    (_hotkey: any, state: "pressed" | "released") => {
      const editing = state === "pressed";
      sendToAllWindows("overlay-edit-mode", { editing });

      if (stripOverlay) {
        try {
          if (editing) {
            stripOverlay.window.setIgnoreMouseEvents(false);
          } else {
            stripOverlay.window.setIgnoreMouseEvents(true, { forward: true });
          }
        } catch {
          // Window may have been destroyed
        }
      }

      overlayLog.info(`Overlay edit mode: ${editing ? "ON" : "OFF"}`);
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

  voiceLog.info(
    "Overlay hotkeys registered: NumpadSubtract (hold-to-talk), Shift+Tab (edit mode), F8 (calibration)"
  );
}

// --- GEP (Game Events Provider) ---

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

app.whenReady().then(() => {
  initLogger();
  registerIpcHandlers();
  registerOverlayIpc();
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

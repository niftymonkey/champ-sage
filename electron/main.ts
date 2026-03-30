import {
  app as electronApp,
  BrowserWindow,
  ipcMain,
  Menu,
  shell,
} from "electron";
import { readFileSync } from "node:fs";
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

function cleanupWebSocket(): void {
  if (!activeWs) return;

  const ws = activeWs;
  activeWs = null;
  ws.removeAllListeners();

  if (ws.readyState === WebSocket.CONNECTING) {
    ws.terminate();
  } else if (ws.readyState === WebSocket.OPEN) {
    ws.close();
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
    win.webContents.send(channel, data);
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
        ws.on("open", () => {
          ws.send(JSON.stringify([5, "OnJsonApiEvent"]));
          resolve();
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
            sendToAllWindows("lcu-event", {
              uri: payload.uri ?? "",
              event_type: payload.eventType ?? "",
              data: payload.data ?? null,
            });
          } catch {
            // Non-JSON message
          }
        });

        ws.on("close", (_code: number, _reason: Buffer) => {
          sendToAllWindows("lcu-disconnect", {
            reason: "Server closed connection",
          });
          activeWs = null;
        });

        ws.on("error", (err: Error) => {
          if (ws.readyState === WebSocket.CONNECTING) {
            reject(new Error(`WebSocket connection failed: ${err.message}`));
          } else {
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

    registerOverlayHotkey(overlayApi);
  });

  overlayApi.on("game-exit", (gameInfo: any, wasInjected: boolean) => {
    cleanupWebSocket();
    appLog.info(`Game exited: ${gameInfo.name} (was injected: ${wasInjected})`);
    sendToAllWindows("overlay-status", { active: false, game: gameInfo.name });
  });

  overlayApi.on("game-injection-error", (_gameInfo: any, error: string) => {
    appLog.error(`Overlay injection error: ${error}`);
  });
}

function registerOverlayHotkey(overlayApi: any): void {
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

  voiceLog.info("Overlay hotkey registered: NumpadSubtract (hold-to-talk)");
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
  cleanupWebSocket();
  if (process.platform !== "darwin") {
    app.quit();
  }
});

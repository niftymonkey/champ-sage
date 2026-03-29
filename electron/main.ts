import { app as electronApp, BrowserWindow, ipcMain } from "electron";
import { readFileSync, appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import WebSocket from "ws";

const app = electronApp;

// ow-electron detection — when running under ow-electron, the app object
// has an `overwolf` property with packages (overlay, gep). We don't need
// to require anything — the runtime injects it onto the app object.
// When running under vanilla Electron, this property doesn't exist.
const owApp: any =
  "overwolf" in (electronApp as any) ? (electronApp as any) : null;

if (owApp) {
  console.log(
    "[champ-sage] Running as ow-electron (Overwolf features available)"
  );
} else {
  console.log(
    "[champ-sage] Running as vanilla Electron (no Overwolf features)"
  );
}

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
// Coaching log
// ---------------------------------------------------------------------------

let coachingLogPath: string | null = null;
let gepLogPath: string | null = null;

function initLogs(): void {
  const logsDir = join(app.getPath("userData"), "coaching-logs");
  mkdirSync(logsDir, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  coachingLogPath = join(logsDir, `coaching-${timestamp}.log`);
  gepLogPath = join(logsDir, `gep-${timestamp}.log`);
  console.log(`[champ-sage] Coaching log: ${coachingLogPath}`);
  console.log(`[champ-sage] GEP log: ${gepLogPath}`);
}

function getCoachingLogPath(): string {
  if (!coachingLogPath) {
    initLogs();
  }
  return coachingLogPath!;
}

function getGepLogPath(): string {
  if (!gepLogPath) {
    initLogs();
  }
  return gepLogPath!;
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

  ipcMain.handle("append_coaching_log", async (_event, text: string) => {
    const path = getCoachingLogPath();
    appendFileSync(path, text + "\n");
  });

  ipcMain.handle("get_coaching_log_location", async () => {
    return getCoachingLogPath();
  });

  // GEP event logging — separate log file for raw GEP data
  ipcMain.handle("append_gep_log", async (_event, text: string) => {
    const path = getGepLogPath();
    appendFileSync(path, text + "\n");
  });

  ipcMain.handle("get_gep_log_location", async () => {
    return getGepLogPath();
  });
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

let gepInitialized = false;
let overlayInitialized = false;

function initOverwolfFeatures(): void {
  if (!owApp) return;

  const packages = owApp.overwolf.packages;

  // Wait for each package to be ready
  packages.on("ready", (e, packageName: string, version: string) => {
    console.log(
      `[champ-sage] Overwolf package ready: ${packageName} v${version}`
    );

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
    console.warn("[champ-sage] Overlay API not available");
    return;
  }

  // Register League of Legends for overlay injection
  overlayApi.registerGames({ gamesIds: [LOL_GAME_ID] });
  console.log("[champ-sage] Overlay registered for League of Legends");

  // When League launches, inject the overlay
  overlayApi.on("game-launched", (event: any, gameInfo: any) => {
    console.log(
      `[champ-sage] Game launched: ${gameInfo.name} (id: ${gameInfo.id})`
    );

    if (gameInfo.processInfo?.isElevated) {
      console.warn("[champ-sage] Game is elevated — cannot inject overlay");
      event.dismiss();
      return;
    }

    event.inject();
    console.log("[champ-sage] Overlay injected");
  });

  overlayApi.on("game-injected", (gameInfo: any) => {
    console.log(`[champ-sage] Overlay active in ${gameInfo.name}`);
    sendToAllWindows("overlay-status", { active: true, game: gameInfo.name });

    // Register push-to-talk hotkey now that overlay is active
    registerOverlayHotkey(overlayApi);
  });

  overlayApi.on("game-exit", (gameInfo: any, wasInjected: boolean) => {
    // Proactively close the LCU WebSocket before the client shuts down
    // to avoid the noisy CloseEvent dump from the ws library
    cleanupWebSocket();

    console.log(
      `[champ-sage] Game exited: ${gameInfo.name} (was injected: ${wasInjected})`
    );
    sendToAllWindows("overlay-status", { active: false, game: gameInfo.name });
  });

  overlayApi.on("game-injection-error", (gameInfo: any, error: string) => {
    console.error(`[champ-sage] Overlay injection error: ${error}`);
  });
}

function registerOverlayHotkey(overlayApi: any): void {
  // NumpadSubtract (keyCode 109) — hold-to-talk
  // passthrough: true so the key also reaches the game (numpad minus isn't
  // used by League, so this is safe)
  overlayApi.hotkeys.register(
    {
      name: "push-to-talk",
      keyCode: 109, // VK_SUBTRACT (numpad minus)
      passthrough: true,
    },
    (hotkey: any, state: "pressed" | "released") => {
      sendToAllWindows("hotkey-event", {
        state: state === "pressed" ? "Pressed" : "Released",
      });
    }
  );

  console.log(
    "[champ-sage] Overlay hotkey registered: NumpadSubtract (hold-to-talk)"
  );
}

// --- GEP (Game Events Provider) ---

function initGep(): void {
  if (!owApp) return;

  const gepApi = owApp.overwolf.packages.gep;
  if (!gepApi) {
    console.warn("[champ-sage] GEP API not available");
    return;
  }

  // When League is detected, enable GEP and subscribe to augment features
  gepApi.on(
    "game-detected",
    (e: any, gameId: number, name: string, gameInfo: any) => {
      if (gameId !== LOL_GAME_ID) return;

      console.log(`[champ-sage] GEP: League detected (pid: ${gameInfo.pid})`);
      e.enable();

      const requiredFeatures = ["augments"];

      gepApi
        .setRequiredFeatures(gameId, requiredFeatures)
        .then(() => {
          console.log(
            `[champ-sage] GEP: Required features set (${requiredFeatures.join(", ")})`
          );
        })
        .catch((err: Error) => {
          console.error(
            "[champ-sage] GEP: Failed to set required features:",
            err.message
          );
          // Retry after a delay — GEP docs say this can fail initially
          setTimeout(() => {
            gepApi
              .setRequiredFeatures(gameId, requiredFeatures)
              .then(() =>
                console.log("[champ-sage] GEP: Features set on retry")
              )
              .catch((err2: Error) =>
                console.error(
                  "[champ-sage] GEP: Retry also failed:",
                  err2.message
                )
              );
          }, 3000);
        });
    }
  );

  // Forward all info updates to the renderer — dedup happens there via RxJS
  gepApi.on("new-info-update", (e: any, gameId: number, ...args: any[]) => {
    if (gameId !== LOL_GAME_ID) return;
    const update = args[0];
    if (!update) return;
    sendToAllWindows("gep-info-update", update);
  });

  // Forward all game events to the renderer
  gepApi.on("new-game-event", (e: any, gameId: number, ...args: any[]) => {
    if (gameId !== LOL_GAME_ID) return;
    sendToAllWindows("gep-game-event", args[0]);
  });

  // @ts-ignore — game-exit is undocumented but works
  gepApi.on("game-exit", (e: any, gameId: number) => {
    if (gameId !== LOL_GAME_ID) return;
    console.log("[champ-sage] GEP: League exited");
  });

  gepApi.on("error", (e: any, gameId: number, error: any) => {
    if (gameId !== LOL_GAME_ID) return;
    console.error("[champ-sage] GEP error:", error);
  });

  console.log("[champ-sage] GEP initialized, waiting for League to launch...");
}

// ---------------------------------------------------------------------------
// App lifecycle
// ---------------------------------------------------------------------------

app.whenReady().then(() => {
  registerIpcHandlers();
  initLogs();
  createMainWindow();
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

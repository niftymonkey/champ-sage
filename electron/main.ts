import { app, BrowserWindow, ipcMain, globalShortcut } from "electron";
import { readFileSync, appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import WebSocket from "ws";

// ---------------------------------------------------------------------------
// Lockfile discovery
// ---------------------------------------------------------------------------

function resolveLockfilePath(): string {
  if (process.env.LCU_LOCKFILE_PATH) {
    return process.env.LCU_LOCKFILE_PATH;
  }

  // Electron runs on the host OS. Detect platform natively.
  if (process.platform === "darwin") {
    return "/Applications/League of Legends.app/Contents/LoL/lockfile";
  }

  // Windows (including when launched from WSL2 — Electron still runs as a Windows process)
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

function initCoachingLog(): void {
  const logsDir = join(app.getPath("userData"), "coaching-logs");
  mkdirSync(logsDir, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  coachingLogPath = join(logsDir, `coaching-${timestamp}.log`);
  console.log(`[champ-sage] Coaching log: ${coachingLogPath}`);
}

function getCoachingLogPath(): string {
  if (!coachingLogPath) {
    initCoachingLog();
  }
  return coachingLogPath!;
}

// ---------------------------------------------------------------------------
// Active WebSocket connection (for cleanup)
// ---------------------------------------------------------------------------

let activeWs: WebSocket | null = null;

function cleanupWebSocket(): void {
  if (activeWs) {
    activeWs.removeAllListeners();
    if (activeWs.readyState === WebSocket.OPEN) {
      activeWs.close();
    }
    activeWs = null;
  }
}

// ---------------------------------------------------------------------------
// IPC handlers — these replace the Tauri invoke commands
// ---------------------------------------------------------------------------

function registerIpcHandlers(): void {
  // discover_lcu → read lockfile, return { port, token }
  ipcMain.handle("discover_lcu", async () => {
    const lockfilePath = resolveLockfilePath();
    const content = readFileSync(lockfilePath, "utf-8");
    return parseLockfile(content);
  });

  // fetch_lcu → proxy HTTPS request to LCU with Basic auth + TLS skip
  ipcMain.handle(
    "fetch_lcu",
    async (_event, port: number, token: string, endpoint: string) => {
      const url = `https://127.0.0.1:${port}${endpoint}`;
      const https = await import("node:https");
      const agent = new https.Agent({ rejectUnauthorized: false });

      return new Promise<string>((resolve, reject) => {
        const req = https.get(
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
            res.on("data", (chunk) => (data += chunk));
            res.on("end", () => resolve(data));
          }
        );
        req.on("error", (err) =>
          reject(new Error(`CONNECTION_FAILED:${err.message}`))
        );
      });
    }
  );

  // fetch_riot_api → proxy HTTPS request to Live Client Data API (self-signed cert)
  ipcMain.handle("fetch_riot_api", async (_event, endpoint: string) => {
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
          res.on("data", (chunk) => (data += chunk));
          res.on("end", () => resolve(data));
        })
        .on("error", (err) =>
          reject(new Error(`CONNECTION_FAILED:${err.message}`))
        );
    });
  });

  // connect_lcu_websocket → open WAMP WebSocket, forward events to renderer
  ipcMain.handle(
    "connect_lcu_websocket",
    async (_event, port: number, token: string) => {
      cleanupWebSocket();

      const ws = new WebSocket(`wss://127.0.0.1:${port}/`, {
        headers: { Authorization: lcuBasicAuth(token) },
        rejectUnauthorized: false,
      });
      activeWs = ws;

      return new Promise<void>((resolve, reject) => {
        ws.on("open", () => {
          // Subscribe to all LCU events (WAMP 1.0 subscribe = opcode 5)
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
            const event = {
              uri: payload.uri ?? "",
              event_type: payload.eventType ?? "",
              data: payload.data ?? null,
            };

            // Forward to all renderer windows
            for (const win of BrowserWindow.getAllWindows()) {
              win.webContents.send("lcu-event", event);
            }
          } catch {
            // Non-JSON message, ignore
          }
        });

        ws.on("close", () => {
          for (const win of BrowserWindow.getAllWindows()) {
            win.webContents.send("lcu-disconnect", {
              reason: "Server closed connection",
            });
          }
          activeWs = null;
        });

        ws.on("error", (err) => {
          if (ws.readyState === WebSocket.CONNECTING) {
            reject(new Error(`WebSocket connection failed: ${err.message}`));
          } else {
            for (const win of BrowserWindow.getAllWindows()) {
              win.webContents.send("lcu-disconnect", {
                reason: `WebSocket error: ${err.message}`,
              });
            }
          }
          activeWs = null;
        });
      });
    }
  );

  // append_coaching_log → write to log file
  ipcMain.handle("append_coaching_log", async (_event, text: string) => {
    const path = getCoachingLogPath();
    appendFileSync(path, text + "\n");
  });

  // get_coaching_log_location → return log file path
  ipcMain.handle("get_coaching_log_location", async () => {
    return getCoachingLogPath();
  });
}

// ---------------------------------------------------------------------------
// Window creation
// ---------------------------------------------------------------------------

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

  // Dev mode: load Vite dev server. Prod: load built files.
  if (process.env.VITE_DEV_SERVER_URL) {
    win.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    win.loadFile(join(__dirname, "../dist/index.html"));
  }

  return win;
}

// ---------------------------------------------------------------------------
// App lifecycle
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Global hotkey — push-to-talk (Phase 1: best-effort via globalShortcut)
//
// Electron's globalShortcut uses RegisterHotKey, which doesn't work when
// a DirectX game has focus. This is sufficient for Phase 1 (second-monitor
// use). Phase 2 replaces this with overlay.hotkeys which works during gameplay.
// ---------------------------------------------------------------------------

function registerHotkey(): void {
  // NumpadSubtract — matches the Tauri-era default
  const KEY = "numsub";

  // globalShortcut doesn't distinguish press vs release. We toggle on each
  // activation: first press = "Pressed", next press = "Released".
  let isDown = false;

  globalShortcut.register(KEY, () => {
    isDown = !isDown;
    const state = isDown ? "Pressed" : "Released";
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send("hotkey-event", { state });
    }
  });

  console.log(`[champ-sage] Hotkey registered: ${KEY} (toggle mode)`);
}

// ---------------------------------------------------------------------------
// App lifecycle
// ---------------------------------------------------------------------------

app.whenReady().then(() => {
  registerIpcHandlers();
  initCoachingLog();
  registerHotkey();
  createMainWindow();

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

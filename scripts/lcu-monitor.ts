import { readFileSync, appendFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import WebSocket from "ws";

// --- Config ---
const LEAGUE_DIR = "/mnt/c/Riot Games/League of Legends";
const LOCKFILE_PATH = join(LEAGUE_DIR, "lockfile");
const DISCOVERY_INTERVAL_MS = 3_000; // Check for client every 3s when not connected
const POLL_INTERVAL_MS = 10_000; // Poll endpoints every 10s when connected
const LOG_DIR = join(import.meta.dirname, "..", "data-dump");
const LOG_FILE = join(
  LOG_DIR,
  `lcu-monitor-${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)}.log`
);

// --- Types ---
interface LcuCredentials {
  port: number;
  token: string;
}

type MonitorState = "waiting" | "connected";

// --- State ---
let state: MonitorState = "waiting";
let creds: LcuCredentials | null = null;
let ws: WebSocket | null = null;
let pollIntervalId: ReturnType<typeof setInterval> | null = null;
let discoveryIntervalId: ReturnType<typeof setInterval> | null = null;

// Change tracking for polling (only log when values change)
let lastPhase = "";
let lastSummonerJson = "";
let lastEogJson = "";
let lastSessionJson = "";
let lastChampSelectJson = "";

// --- Logging ---
// Console gets short human-readable lines; log file gets full data
function log(category: string, message: string, data?: unknown) {
  const timestamp = new Date().toISOString().slice(11, 19);
  const consoleMsg = `[${timestamp}] [${category}] ${message}\n`;
  process.stdout.write(consoleMsg);

  const fullTimestamp = new Date().toISOString();
  const fileLine = data
    ? `[${fullTimestamp}] [${category}] ${message}\n${JSON.stringify(data, null, 2)}\n`
    : `[${fullTimestamp}] [${category}] ${message}\n`;
  appendFileSync(LOG_FILE, fileLine);
}

// --- Lockfile ---
function tryReadLockfile(): LcuCredentials | null {
  try {
    if (!existsSync(LOCKFILE_PATH)) return null;
    const raw = readFileSync(LOCKFILE_PATH, "utf-8").trim();
    const parts = raw.split(":");
    if (parts.length < 4) return null;
    return {
      port: parseInt(parts[2], 10),
      token: parts[3],
    };
  } catch {
    return null;
  }
}

// --- LCU HTTP client ---
async function lcuFetch(endpoint: string): Promise<unknown> {
  if (!creds) throw new Error("Not connected");
  const auth = Buffer.from(`riot:${creds.token}`).toString("base64");
  const res = await fetch(`https://127.0.0.1:${creds.port}${endpoint}`, {
    headers: { Authorization: `Basic ${auth}` },
  });

  if (!res.ok) {
    return { _error: true, status: res.status, statusText: res.statusText };
  }
  return res.json();
}

function isErrorResponse(data: unknown): boolean {
  return (
    typeof data === "object" &&
    data !== null &&
    "_error" in (data as Record<string, unknown>)
  );
}

// --- Discovery loop ---
let discoveryAttempts = 0;
let discoveryInProgress = false;

function startDiscovery() {
  discoveryAttempts = 0;
  discoveryInProgress = false;
  log("STATE", "→ WAITING — looking for League client (checking every 3s)");

  discoveryIntervalId = setInterval(async () => {
    // Prevent overlapping async checks
    if (discoveryInProgress || state === "connected") return;

    discoveryAttempts++;
    const found = tryReadLockfile();
    if (!found) {
      if (discoveryAttempts % 10 === 0) {
        log("DISCOVERY", `Still waiting... (${discoveryAttempts} checks)`);
      }
      return;
    }

    discoveryInProgress = true;
    log(
      "DISCOVERY",
      `Lockfile found! Port ${found.port}. Verifying connection...`
    );

    try {
      creds = found;
      const summoner = await lcuFetch("/lol-summoner/v1/current-summoner");
      if (isErrorResponse(summoner)) {
        log("DISCOVERY", "Client not ready yet (bad response). Will retry.");
        creds = null;
        discoveryInProgress = false;
        return;
      }

      const name = (summoner as Record<string, unknown>).gameName ?? "unknown";
      log("DISCOVERY", `Connection verified! Summoner: ${name}`);
      stopDiscovery();
      transitionToConnected();
    } catch {
      log("DISCOVERY", "Client not responding yet. Will retry.");
      creds = null;
      discoveryInProgress = false;
    }
  }, DISCOVERY_INTERVAL_MS);
}

function stopDiscovery() {
  if (discoveryIntervalId) {
    clearInterval(discoveryIntervalId);
    discoveryIntervalId = null;
  }
}

// --- Connected state ---
function transitionToConnected() {
  state = "connected";
  log("STATE", "→ CONNECTED — monitoring LCU endpoints and WebSocket");
  resetChangeTracking();
  connectWebSocket();
  startPolling();
}

function transitionToWaiting() {
  state = "waiting";
  creds = null;
  log("STATE", "→ WAITING — client disconnected, cleaning up");
  stopPolling();
  log("STATE", "  Polling stopped");
  disconnectWebSocket();
  log("STATE", "  WebSocket disconnected");
  resetChangeTracking();
  log("STATE", "  Ready to detect client again");
  startDiscovery();
}

function resetChangeTracking() {
  lastPhase = "";
  lastSummonerJson = "";
  lastEogJson = "";
  lastSessionJson = "";
  lastChampSelectJson = "";
}

// --- Polling ---
function startPolling() {
  log("POLL", `Starting endpoint polling (every ${POLL_INTERVAL_MS / 1000}s)`);
  pollEndpoints();
  pollIntervalId = setInterval(pollEndpoints, POLL_INTERVAL_MS);
}

function stopPolling() {
  if (pollIntervalId) {
    clearInterval(pollIntervalId);
    pollIntervalId = null;
  }
}

async function pollEndpoints() {
  if (state !== "connected" || !creds) return;

  // Check if client is still alive
  const lockfileExists = tryReadLockfile();
  if (!lockfileExists) {
    transitionToWaiting();
    return;
  }

  // 1. Gameflow phase
  try {
    const phase = (await lcuFetch("/lol-gameflow/v1/gameflow-phase")) as string;
    if (typeof phase === "string" && phase !== lastPhase) {
      log("PHASE", `Phase: ${lastPhase || "(none)"} → ${phase}`);
      lastPhase = phase;

      if (phase === "EndOfGame" || phase === "PreEndOfGame") {
        log("PHASE", "Game ended! Fetching end-of-game stats...");
        await fetchEogStats();
      }
    }
  } catch {
    log("POLL", "Lost connection to LCU during poll");
    transitionToWaiting();
    return;
  }

  // 2. Gameflow session
  try {
    const session = await lcuFetch("/lol-gameflow/v1/session");
    if (!isErrorResponse(session)) {
      const json = JSON.stringify(session);
      if (json !== lastSessionJson) {
        const s = session as Record<string, unknown>;
        const gameData = s.gameData as Record<string, unknown> | undefined;
        const queue = gameData?.queue as Record<string, unknown> | undefined;
        const gameMode = queue?.gameMode ?? "unknown";
        const queueType = queue?.type ?? "unknown";
        log(
          "SESSION",
          `Session changed — mode: ${gameMode}, queue: ${queueType}`,
          {
            phase: s.phase,
            queueId: queue?.id,
            queueType: queue?.type,
            gameMode: queue?.gameMode,
            mapId: queue?.mapId,
            teamSize: gameData?.teamSize,
            gameName: gameData?.gameName,
          }
        );
        lastSessionJson = json;
      }
    }
  } catch {
    // Session not available outside game flow
  }

  // 3. Champ select (only during ChampSelect phase)
  if (lastPhase === "ChampSelect") {
    try {
      const champSelect = await lcuFetch("/lol-champ-select/v1/session");
      if (!isErrorResponse(champSelect)) {
        const json = JSON.stringify(champSelect);
        if (json !== lastChampSelectJson) {
          log(
            "CHAMP_SELECT",
            "Champ select data updated (full data in log file)",
            champSelect
          );
          lastChampSelectJson = json;
        }
      }
    } catch {
      // Not in champ select
    }
  }
}

async function fetchEogStats() {
  try {
    const eog = await lcuFetch("/lol-end-of-game/v1/eog-stats-block");
    if (!isErrorResponse(eog)) {
      const json = JSON.stringify(eog);
      if (json !== lastEogJson) {
        const e = eog as Record<string, unknown>;
        const teams = e.teams as Array<Record<string, unknown>> | undefined;
        const playerTeam = teams?.find((t) => t.isPlayerTeam);
        const won = playerTeam?.isWinningTeam ?? "unknown";
        const gameLength = e.gameLength ?? "unknown";
        const gameMode = e.gameMode ?? "unknown";
        log(
          "EOG_STATS",
          `Game over! Mode: ${gameMode}, Won: ${won}, Length: ${gameLength}s (full data in log file)`,
          eog
        );
        lastEogJson = json;
      }
    } else {
      log("EOG_STATS", "End-of-game stats not available yet");
    }
  } catch (err) {
    log("EOG_STATS", `Error fetching: ${err}`);
  }
}

// --- WebSocket ---
function connectWebSocket() {
  if (!creds) return;

  const auth = Buffer.from(`riot:${creds.token}`).toString("base64");
  ws = new WebSocket(`wss://127.0.0.1:${creds.port}/`, {
    headers: { Authorization: `Basic ${auth}` },
    rejectUnauthorized: false,
  });

  log("WS", "Connecting WebSocket...");

  ws.on("open", () => {
    log("WS", "WebSocket connected and open");
    ws!.send(JSON.stringify([5, "OnJsonApiEvent"]));
    log("WS", "Subscribed to all events (OnJsonApiEvent)");
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
      const uri = payload.uri || "";

      // Categorize events by interest level
      const isHighInterest =
        uri.includes("gameflow") ||
        uri.includes("end-of-game") ||
        uri.includes("champ-select") ||
        uri.includes("lobby") ||
        uri.includes("matchmaking") ||
        uri.includes("honor");

      const isMediumInterest =
        uri.includes("game-client-process") ||
        uri.includes("ranked") ||
        uri.includes("lol-game") ||
        uri.includes("augment") ||
        uri.includes("missions") ||
        uri.includes("inventory");

      // Filter out known noisy events entirely
      const isNoise =
        uri.includes("patcher/") ||
        uri.includes("lol-patch/") ||
        uri.includes("data-store/v1/install-settings") ||
        uri.includes("/telemetry") ||
        uri.includes("/lol-rewards") ||
        uri.includes("/entitlements");

      if (isNoise) return;

      if (isHighInterest) {
        log("WS_EVENT", `${payload.eventType} ${uri}`, payload.data);
      } else if (isMediumInterest) {
        log("WS_EVENT", `${payload.eventType} ${uri}`, payload.data);
      } else {
        // Log URI only for everything else so we can see what's available
        log("WS_SKIP", `${payload.eventType} ${uri}`);
      }
    } catch {
      // Non-JSON message, ignore
    }
  });

  ws.on("error", (err: Error) => {
    log("WS", `Error: ${err.message}`);
  });

  ws.on("close", () => {
    log("WS", "WebSocket closed");
    ws = null;
    // Don't reconnect here — let the poll loop detect the disconnect
    // and transition to waiting state properly
  });
}

function disconnectWebSocket() {
  if (ws) {
    ws.removeAllListeners();
    if (ws.readyState === WebSocket.OPEN) {
      ws.close();
    }
    ws = null;
  }
}

// --- Graceful shutdown ---
function shutdown() {
  log("SHUTDOWN", "Monitor stopping");
  stopDiscovery();
  stopPolling();
  disconnectWebSocket();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

// --- Main ---
mkdirSync(LOG_DIR, { recursive: true });
log("INIT", "=== LCU Monitor ===");
log("INIT", `Log file: ${LOG_FILE}`);
log("INIT", `Lockfile path: ${LOCKFILE_PATH}`);
log("INIT", "Press Ctrl+C to stop");
log("INIT", "");

// Try to connect immediately, fall back to discovery loop
const initialCreds = tryReadLockfile();
if (initialCreds) {
  log("INIT", "Lockfile exists, trying to connect...");
  creds = initialCreds;
  lcuFetch("/lol-summoner/v1/current-summoner")
    .then((summoner) => {
      if (isErrorResponse(summoner)) {
        log("INIT", "Client found but not ready. Starting discovery loop.");
        creds = null;
        startDiscovery();
      } else {
        const name =
          (summoner as Record<string, unknown>).gameName ?? "unknown";
        log("INIT", `Connected! Summoner: ${name}, Port: ${initialCreds.port}`);
        transitionToConnected();
      }
    })
    .catch(() => {
      log("INIT", "Could not reach client. Starting discovery loop.");
      creds = null;
      startDiscovery();
    });
} else {
  log("INIT", "No lockfile found. League client is not running.");
  startDiscovery();
}

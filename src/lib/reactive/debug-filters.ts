/**
 * Debug panel filtering utilities.
 * Controls which events show up in the debug panel to reduce noise,
 * and translates raw URIs into human-readable descriptions.
 */
import type { LiveGameState } from "./types";

/**
 * Allowlist of WebSocket URI prefixes worth showing in the debug panel.
 * Everything else is filtered out. To add a new event type, add a prefix
 * here and optionally add a human-readable label in describeEvent().
 */
const DEBUG_WORTHY_PREFIXES = [
  "/lol-gameflow/v1/gameflow-phase",
  "/lol-gameflow/v1/session",
  "/lol-champ-select/v1/session",
  "/lol-league-session/",
];

/** Check if a WebSocket event URI is worth showing in the debug panel */
export function isDebugWorthy(uri: string): boolean {
  return DEBUG_WORTHY_PREFIXES.some((prefix) => uri.startsWith(prefix));
}

/** Translate a raw WebSocket event into a human-readable debug summary */
export function describeEvent(eventType: string, uri: string): string {
  if (uri === "/lol-gameflow/v1/gameflow-phase") {
    return `Gameflow phase ${eventType.toLowerCase()}d`;
  }
  if (uri === "/lol-gameflow/v1/session") {
    return `Game session ${eventType.toLowerCase()}d`;
  }
  if (uri === "/lol-champ-select/v1/session") {
    return eventType === "Delete"
      ? "Champion Select ended"
      : "Champion Select updated";
  }
  if (uri.startsWith("/lol-league-session/")) {
    return "League session token updated";
  }
  return `${eventType} ${uri}`;
}

/** Check if a poll status change should be logged (deduplicates repeated statuses) */
export function shouldLogPollStatus(
  current: string,
  previous: string | null
): boolean {
  return current !== previous;
}

/**
 * Deduplicate rapid-fire WebSocket debug events.
 * The LCU often sends 3-4 events for the same URI within milliseconds.
 * This tracks the last logged URI+timestamp and suppresses duplicates
 * within a short window.
 */
const DEDUP_WINDOW_MS = 500;
let lastLoggedUri = "";
let lastLoggedTime = 0;

export function shouldLogWebSocketEvent(uri: string): boolean {
  const now = Date.now();
  if (uri === lastLoggedUri && now - lastLoggedTime < DEDUP_WINDOW_MS) {
    return false;
  }
  lastLoggedUri = uri;
  lastLoggedTime = now;
  return true;
}

/**
 * Extract a fingerprint of the game state fields worth logging about.
 * Changes to fields NOT in this fingerprint (like gameTime) are ignored.
 *
 * To add a new meaningful field, just add it to the fingerprint string.
 */
function gameStateFingerprint(state: LiveGameState): string {
  return [
    state.activePlayer?.championName ?? "",
    state.activePlayer?.level ?? 0,
    state.players.length,
    state.lcuGameMode || state.gameMode,
    state.champSelect != null ? "cs" : "",
    state.eogStats != null ? "eog" : "",
  ].join("|");
}

/**
 * Check if two LiveGameState snapshots differ in a way worth logging.
 * Ignores high-frequency changes like game time ticking every 2 seconds.
 */
export function hasGameStateChangedMeaningfully(
  prev: LiveGameState,
  next: LiveGameState
): boolean {
  return gameStateFingerprint(prev) !== gameStateFingerprint(next);
}

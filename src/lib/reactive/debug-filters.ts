/**
 * Debug panel filtering utilities.
 * Controls which events show up in the debug panel to reduce noise,
 * and translates raw URIs into human-readable descriptions.
 */

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

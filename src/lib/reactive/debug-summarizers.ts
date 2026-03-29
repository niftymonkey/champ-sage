import type {
  GameLifecycleEvent,
  LiveGameState,
  UserInputEvent,
} from "./types";
import { formatGameTime } from "../format";

// Safe accessor for unknown nested data from LCU payloads
function get(obj: unknown, ...path: string[]): unknown {
  let current = obj;
  for (const key of path) {
    if (current == null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

/** Summarize a lifecycle event into a human-readable one-liner for the debug panel. */
export function summarizeLifecycleEvent(event: GameLifecycleEvent): string {
  switch (event.type) {
    case "connection":
      return event.connected ? "Connected" : "Disconnected";
    case "phase":
      return `Phase: ${event.phase}`;
    case "lobby":
      return summarizeLobby(event.data);
    case "matchmaking":
      return summarizeMatchmaking(event.data);
    case "session":
      return summarizeSession(event.data);
  }
}

function summarizeLobby(data: unknown): string {
  const gameMode = get(data, "gameConfig", "gameMode");
  if (typeof gameMode !== "string") return "Lobby update";

  const members = get(data, "members");
  if (Array.isArray(members) && members.length > 0) {
    return `Lobby: ${gameMode}, ${members.length} members`;
  }
  return `Lobby: ${gameMode}`;
}

function summarizeSession(data: unknown): string {
  const phase = get(data, "phase");
  if (typeof phase !== "string") return "Session update";

  const gameMode = get(data, "gameData", "queue", "gameMode");
  if (typeof gameMode === "string") {
    return `Session: ${phase}, ${gameMode}`;
  }
  return `Session: ${phase}`;
}

function summarizeMatchmaking(data: unknown): string {
  const searchState = get(data, "searchState");
  if (typeof searchState !== "string") return "Matchmaking update";

  const estimatedTime = get(data, "estimatedQueueTime");
  if (typeof estimatedTime === "number" && estimatedTime > 0) {
    return `Matchmaking: ${searchState}, est. ${formatGameTime(estimatedTime)}`;
  }
  return `Matchmaking: ${searchState}`;
}

/** Summarize live game state into a compact one-liner. */
export function summarizeLiveGameState(state: LiveGameState): string {
  if (!state.activePlayer) {
    if (state.champSelect != null) return "Champ select active";
    if (state.eogStats) return `EOG: ${state.eogStats.isWin ? "WIN" : "LOSS"}`;
    return "Default (no data)";
  }
  const parts = [
    state.activePlayer.championName,
    `Lv${state.activePlayer.level}`,
    formatGameTime(state.gameTime),
  ];
  if (state.gameMode) parts.push(state.gameMode);
  if (state.players.length > 0) parts.push(`${state.players.length}p`);
  return parts.join(" | ");
}

/** Summarize a user input event. */
export function summarizeUserInput(event: UserInputEvent): string {
  if (event.type === "augment") return `Augment: ${event.augment.name}`;
  return `Query: "${event.text}"`;
}

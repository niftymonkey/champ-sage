import type {
  GameLifecycleEvent,
  LiveGameState,
  UserInputEvent,
} from "./types";
import { formatGameTime } from "../format";
import { resolveChampionName } from "../data-ingest/champion-id-map";

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

  const parts = [`Lobby: ${gameMode}`];

  const queueId = get(data, "gameConfig", "queueId");
  if (typeof queueId === "number" && queueId > 0) {
    parts[0] += ` (queue ${queueId})`;
  }

  const members = get(data, "members");
  if (Array.isArray(members) && members.length > 0) {
    parts.push(`${members.length} members`);
  }

  return parts.join(", ");
}

function summarizeSession(data: unknown): string {
  const phase = get(data, "phase");
  if (typeof phase !== "string") return "Session update";

  const parts = [`Session: ${phase}`];

  const gameMode = get(data, "gameData", "queue", "gameMode");
  if (typeof gameMode === "string" && gameMode) {
    parts.push(gameMode);
  }

  const mapId = get(data, "map", "mapId");
  if (typeof mapId === "number") {
    parts.push(`map ${mapId}`);
  }

  return parts.join(", ");
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
    if (state.champSelect != null)
      return summarizeChampSelect(state.champSelect);
    if (state.eogStats) return summarizeEog(state);
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

/** Resolve a champion ID to a display name, falling back to the numeric ID. */
function champName(id: number): string {
  return resolveChampionName(id) ?? `#${id}`;
}

/** Extract useful info from champ select session data. */
function summarizeChampSelect(champSelect: unknown): string {
  if (champSelect == null || typeof champSelect !== "object") {
    return "Champ select active";
  }

  const cs = champSelect as Record<string, unknown>;
  const localCellId = cs.localPlayerCellId as number | undefined;
  const parts: string[] = ["Champ Select"];

  // Identify what the local player picked/is hovering
  const myTeam = cs.myTeam as Array<Record<string, unknown>> | undefined;
  if (Array.isArray(myTeam)) {
    const localPlayer = myTeam.find((m) => m.cellId === localCellId);
    if (localPlayer) {
      const lockedId = localPlayer.championId as number;
      const hoverIntentId = localPlayer.championPickIntent as number;
      if (lockedId > 0) {
        parts.push(`You: ${champName(lockedId)}`);
      } else if (hoverIntentId > 0) {
        parts.push(`Hovering: ${champName(hoverIntentId)}`);
      }
    }

    // Summarize allies (excluding local player)
    const allies = myTeam
      .filter((m) => m.cellId !== localCellId)
      .map((m) => {
        const id = (m.championId as number) || (m.championPickIntent as number);
        const pos = m.assignedPosition as string;
        if (id > 0) {
          return pos ? `${champName(id)} (${pos})` : champName(id);
        }
        return null;
      })
      .filter(Boolean);

    if (allies.length > 0) {
      parts.push(`Allies: ${allies.join(", ")}`);
    }
  }

  // Summarize enemy picks (only those with champion IDs)
  const theirTeam = cs.theirTeam as Array<Record<string, unknown>> | undefined;
  if (Array.isArray(theirTeam)) {
    const enemies = theirTeam
      .map((m) => {
        const id = (m.championId as number) || (m.championPickIntent as number);
        return id > 0 ? champName(id) : null;
      })
      .filter(Boolean);

    if (enemies.length > 0) {
      parts.push(`Enemies: ${enemies.join(", ")}`);
    }
  }

  // Timer phase
  const timer = cs.timer as Record<string, unknown> | undefined;
  if (timer) {
    const phase = timer.phase as string | undefined;
    const timeLeft = timer.adjustedTimeLeftInPhase as number | undefined;
    if (phase && typeof timeLeft === "number" && timeLeft > 0) {
      parts.push(`${phase} (${Math.ceil(timeLeft / 1000)}s)`);
    } else if (phase) {
      parts.push(phase);
    }
  }

  return parts.join(" — ");
}

/** Summarize end-of-game stats with useful detail. */
function summarizeEog(state: LiveGameState): string {
  const eog = state.eogStats!;
  const parts = [eog.isWin ? "WIN" : "LOSS"];

  if (eog.gameMode) parts.push(eog.gameMode);
  if (eog.gameLength > 0) parts.push(formatGameTime(eog.gameLength));

  return `EOG: ${parts.join(" | ")}`;
}

/** Summarize a user input event. */
export function summarizeUserInput(event: UserInputEvent): string {
  if (event.type === "augment") {
    const parts = [`Augment picked: ${event.augment.name}`];
    if (event.augment.tier) parts.push(`(${event.augment.tier})`);
    return parts.join(" ");
  }
  return `Query: "${event.text}"`;
}

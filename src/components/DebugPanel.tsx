import { useState, useEffect, useRef } from "react";
import {
  gameLifecycle$,
  liveGameState$,
  userInput$,
  notifications$,
} from "../lib/reactive";
import type {
  GameLifecycleEvent,
  LiveGameState,
  UserInputEvent,
} from "../lib/reactive";

interface LogEntry {
  id: number;
  timestamp: string;
  stream: string;
  summary: string;
  detail?: string;
}

let nextId = 0;

function formatTime(): string {
  return new Date().toLocaleTimeString("en-US", { hour12: false });
}

function summarizeLifecycleEvent(event: GameLifecycleEvent): {
  summary: string;
  detail?: string;
} {
  switch (event.type) {
    case "connection":
      return { summary: event.connected ? "Connected" : "Disconnected" };
    case "phase":
      return { summary: `Phase: ${event.phase}` };
    case "lobby":
      return {
        summary: "Lobby update",
        detail: JSON.stringify(event.data, null, 2),
      };
    case "matchmaking":
      return {
        summary: "Matchmaking update",
        detail: JSON.stringify(event.data, null, 2),
      };
    case "session":
      return {
        summary: "Session update",
        detail: JSON.stringify(event.data, null, 2),
      };
  }
}

function summarizeLiveGameState(state: LiveGameState): string {
  if (!state.activePlayer) return "No active player";
  const parts = [
    state.activePlayer.championName,
    `Lv${state.activePlayer.level}`,
    `${Math.floor(state.gameTime / 60)}:${Math.floor(state.gameTime % 60)
      .toString()
      .padStart(2, "0")}`,
  ];
  if (state.gameMode) parts.push(state.gameMode);
  if (state.players.length > 0) parts.push(`${state.players.length}p`);
  return parts.join(" | ");
}

function summarizeUserInput(event: UserInputEvent): string {
  if (event.type === "augment") return `Augment: ${event.augment.name}`;
  return `Query: "${event.text}"`;
}

const STREAM_COLORS: Record<string, string> = {
  lifecycle: "#4ade80",
  liveGame: "#60a5fa",
  userInput: "#f59e0b",
  notification: "#f87171",
};

const MAX_LOG_ENTRIES = 50;

export function DebugPanel() {
  const [log, setLog] = useState<LogEntry[]>([]);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [lastEmissions, setLastEmissions] = useState<Record<string, string>>(
    {}
  );
  const [currentPhase, setCurrentPhase] = useState<string>("—");
  const [lcuConnected, setLcuConnected] = useState(false);
  const [pollingActive, setPollingActive] = useState(false);
  const [gameStateSnapshot, setGameStateSnapshot] =
    useState<LiveGameState | null>(null);
  const logEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const addEntry = (
      stream: string,
      summary: string,
      detail?: string
    ): void => {
      const entry: LogEntry = {
        id: nextId++,
        timestamp: formatTime(),
        stream,
        summary,
        detail,
      };
      setLog((prev) => [...prev.slice(-(MAX_LOG_ENTRIES - 1)), entry]);
      setLastEmissions((prev) => ({ ...prev, [stream]: formatTime() }));
    };

    const subs = [
      gameLifecycle$.subscribe((event) => {
        const { summary, detail } = summarizeLifecycleEvent(event);
        addEntry("lifecycle", summary, detail);

        if (event.type === "connection") {
          setLcuConnected(event.connected);
        }
        if (event.type === "phase") {
          setCurrentPhase(event.phase);
          setPollingActive(event.phase === "InProgress");
        }
      }),

      liveGameState$.subscribe((state) => {
        setGameStateSnapshot(state);
        if (state.activePlayer) {
          addEntry("liveGame", summarizeLiveGameState(state));
        }
      }),

      userInput$.subscribe((event) => {
        addEntry("userInput", summarizeUserInput(event));
      }),

      notifications$.subscribe((notif) => {
        addEntry(
          "notification",
          `[${notif.level}] ${notif.message}`,
          `id: ${notif.id}`
        );
      }),
    ];

    return () => subs.forEach((s) => s.unsubscribe());
  }, []);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [log]);

  return (
    <div className="debug-panel">
      <div className="debug-status-grid">
        <StatusCard
          label="LCU Connection"
          value={lcuConnected ? "Connected" : "Disconnected"}
          color={lcuConnected ? "#4ade80" : "#666"}
        />
        <StatusCard
          label="Gameflow Phase"
          value={currentPhase}
          color={currentPhase === "InProgress" ? "#4ade80" : "#60a5fa"}
        />
        <StatusCard
          label="Live Game Polling"
          value={pollingActive ? "Active" : "Inactive"}
          color={pollingActive ? "#4ade80" : "#666"}
        />
        <StatusCard
          label="Game State"
          value={
            gameStateSnapshot?.activePlayer
              ? summarizeLiveGameState(gameStateSnapshot)
              : "No data"
          }
          color={gameStateSnapshot?.activePlayer ? "#60a5fa" : "#666"}
        />
      </div>

      <div className="debug-streams-header">
        <span className="debug-section-title">Stream Activity</span>
        <div className="debug-stream-indicators">
          {Object.entries(STREAM_COLORS).map(([stream, color]) => (
            <span key={stream} className="debug-stream-indicator">
              <span
                className="debug-stream-dot"
                style={{ backgroundColor: color }}
              />
              <span className="debug-stream-name">{stream}</span>
              <span className="debug-stream-time">
                {lastEmissions[stream] ?? "—"}
              </span>
            </span>
          ))}
        </div>
      </div>

      <div className="debug-section-title">
        Event Log
        <span className="debug-log-count">{log.length}</span>
        {log.length > 0 && (
          <button className="debug-clear-btn" onClick={() => setLog([])}>
            Clear
          </button>
        )}
      </div>

      <div className="debug-log">
        {log.length === 0 && (
          <div className="debug-log-empty">
            Waiting for events... Start the League client to see activity.
          </div>
        )}
        {log.map((entry) => (
          <div
            key={entry.id}
            className={`debug-log-entry${entry.detail ? " expandable" : ""}`}
            onClick={() =>
              entry.detail &&
              setExpandedId(expandedId === entry.id ? null : entry.id)
            }
          >
            <span className="debug-log-time">{entry.timestamp}</span>
            <span
              className="debug-log-stream"
              style={{ color: STREAM_COLORS[entry.stream] ?? "#888" }}
            >
              {entry.stream}
            </span>
            <span className="debug-log-summary">{entry.summary}</span>
            {expandedId === entry.id && entry.detail && (
              <pre className="debug-log-detail">{entry.detail}</pre>
            )}
          </div>
        ))}
        <div ref={logEndRef} />
      </div>

      {gameStateSnapshot?.eogStats && (
        <div className="debug-eog-section">
          <div className="debug-section-title">End-of-Game Stats</div>
          <pre className="debug-log-detail">
            {JSON.stringify(gameStateSnapshot.eogStats, null, 2)}
          </pre>
        </div>
      )}

      {gameStateSnapshot?.champSelect != null && (
        <div className="debug-eog-section">
          <div className="debug-section-title">Champ Select Data</div>
          <pre className="debug-log-detail">
            {JSON.stringify(gameStateSnapshot.champSelect, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}

function StatusCard({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color: string;
}) {
  return (
    <div className="debug-status-card">
      <div className="debug-status-label">{label}</div>
      <div className="debug-status-value" style={{ color }}>
        {value}
      </div>
    </div>
  );
}

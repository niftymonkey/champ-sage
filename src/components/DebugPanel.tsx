import { useState, useEffect, useRef } from "react";
import { skip } from "rxjs/operators";
import { detailedDiff } from "deep-object-diff";
import {
  gameLifecycle$,
  liveGameState$,
  userInput$,
  notifications$,
  debugInput$,
} from "../lib/reactive";
import type {
  GameLifecycleEvent,
  LiveGameState,
  UserInputEvent,
  DebugInputEvent,
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
} {
  switch (event.type) {
    case "connection":
      return { summary: event.connected ? "Connected" : "Disconnected" };
    case "phase":
      return { summary: `Phase: ${event.phase}` };
    case "lobby":
      return { summary: "Lobby update" };
    case "matchmaking":
      return { summary: "Matchmaking update" };
    case "session":
      return { summary: "Session update" };
  }
}

/** Compute a compact diff string between two objects. Returns undefined if empty. */
function computeDiff(
  prev: Record<string, unknown> | null,
  next: unknown
): string | undefined {
  if (next == null || typeof next !== "object") return undefined;
  const nextObj = next as Record<string, unknown>;
  if (!prev) {
    // First emission — show a compact summary of top-level keys
    const keys = Object.keys(nextObj);
    if (keys.length === 0) return undefined;
    if (keys.length <= 6) {
      return keys
        .map((k) => {
          const v = nextObj[k];
          if (v == null) return `${k}: null`;
          if (
            typeof v === "string" ||
            typeof v === "number" ||
            typeof v === "boolean"
          )
            return `${k}: ${v}`;
          if (Array.isArray(v)) return `${k}: [${v.length}]`;
          return `${k}: {...}`;
        })
        .join("\n");
    }
    return `${keys.length} keys: ${keys.slice(0, 8).join(", ")}${keys.length > 8 ? "..." : ""}`;
  }

  const diff = detailedDiff(prev, nextObj);
  const parts: string[] = [];

  const formatObj = (label: string, obj: Record<string, unknown>) => {
    const entries = Object.entries(obj);
    if (entries.length === 0) return;
    parts.push(
      `${label}:\n${entries
        .map(([k, v]) => {
          if (v != null && typeof v === "object" && !Array.isArray(v)) {
            // Nested changes — flatten one level
            return Object.entries(v as Record<string, unknown>)
              .map(([nk, nv]) => `  ${k}.${nk}: ${JSON.stringify(nv)}`)
              .join("\n");
          }
          return `  ${k}: ${JSON.stringify(v)}`;
        })
        .join("\n")}`
    );
  };

  const d = diff as {
    added: Record<string, unknown>;
    deleted: Record<string, unknown>;
    updated: Record<string, unknown>;
  };
  formatObj("+added", d.added);
  formatObj("-deleted", d.deleted);
  formatObj("~updated", d.updated);

  return parts.length > 0 ? parts.join("\n") : undefined;
}

function summarizeLiveGameState(state: LiveGameState): string {
  if (!state.activePlayer) {
    if (state.champSelect != null) return "Champ select active";
    if (state.eogStats) return `EOG: ${state.eogStats.isWin ? "WIN" : "LOSS"}`;
    return "Default (no data)";
  }
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

const INPUT_COLORS: Record<string, string> = {
  discovery: "#a78bfa",
  websocket: "#6b7280",
  "ws-filtered": "#818cf8",
  "riot-api": "#34d399",
  "lcu-rest": "#60a5fa",
  "initial-state": "#fbbf24",
  voice: "#ec4899",
};

const OUTPUT_COLORS: Record<string, string> = {
  lifecycle: "#4ade80",
  liveGame: "#60a5fa",
  userInput: "#f59e0b",
  notification: "#f87171",
};

const MAX_LOG_ENTRIES = 100;

// ---- Module-level log buffers (persist across tab switches) ----

const inputBuffer: LogEntry[] = [];
const outputBuffer: LogEntry[] = [];
let bufferVersion = 0; // bumped on every write so React knows to re-render
let subscriptionsStarted = false;

function pushInput(stream: string, summary: string, detail?: string): void {
  inputBuffer.push({
    id: nextId++,
    timestamp: formatTime(),
    stream,
    summary,
    detail,
  });
  if (inputBuffer.length > MAX_LOG_ENTRIES) inputBuffer.shift();
  bufferVersion++;
  notifyListeners();
}

function pushOutput(stream: string, summary: string, detail?: string): void {
  outputBuffer.push({
    id: nextId++,
    timestamp: formatTime(),
    stream,
    summary,
    detail,
  });
  if (outputBuffer.length > MAX_LOG_ENTRIES) outputBuffer.shift();
  bufferVersion++;
  notifyListeners();
}

// Listeners that the component registers to trigger re-renders
type Listener = () => void;
const listeners = new Set<Listener>();
function notifyListeners() {
  for (const fn of listeners) fn();
}

// Track previous values for diff computation (persists across mounts)
const prevValues: Record<string, Record<string, unknown> | null> = {
  lobby: null,
  matchmaking: null,
  session: null,
};

function startSubscriptions(): void {
  if (subscriptionsStarted) return;
  subscriptionsStarted = true;

  // Input stream
  debugInput$.subscribe((event: DebugInputEvent) => {
    pushInput(event.source, event.summary, event.detail);
  });

  // Output log entries — skip(1) to avoid BehaviorSubject replay
  gameLifecycle$.pipe(skip(1)).subscribe((event) => {
    const { summary } = summarizeLifecycleEvent(event);
    let detail: string | undefined;

    if (
      event.type === "lobby" ||
      event.type === "matchmaking" ||
      event.type === "session"
    ) {
      const prev = prevValues[event.type];
      detail = computeDiff(prev, event.data);
      prevValues[event.type] =
        event.data != null && typeof event.data === "object"
          ? (event.data as Record<string, unknown>)
          : null;
    }

    pushOutput("lifecycle", summary, detail);
  });

  liveGameState$.pipe(skip(1)).subscribe((state) => {
    const summary = summarizeLiveGameState(state);
    if (summary !== "Default (no data)") {
      pushOutput("liveGame", summary);
    }
  });

  userInput$.subscribe((event) => {
    pushOutput("userInput", summarizeUserInput(event));
  });

  notifications$.subscribe((notif) => {
    pushOutput(
      "notification",
      `[${notif.level}] ${notif.message}`,
      `id: ${notif.id}`
    );
  });
}

startSubscriptions();

export function DebugPanel() {
  const [, setRenderTick] = useState(0);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [showNoise, setShowNoise] = useState(false);
  const [currentPhase, setCurrentPhase] = useState<string>("—");
  const [lcuConnected, setLcuConnected] = useState(false);
  const [pollingActive, setPollingActive] = useState(false);
  const [gameStateSnapshot, setGameStateSnapshot] =
    useState<LiveGameState | null>(null);
  const inputLogEndRef = useRef<HTMLDivElement>(null);
  const outputLogEndRef = useRef<HTMLDivElement>(null);
  const prevInputLen = useRef(inputBuffer.length);
  const prevOutputLen = useRef(outputBuffer.length);

  useEffect(() => {
    // Re-render when buffers change
    const listener = () => setRenderTick((t) => t + 1);
    listeners.add(listener);

    // Seed from current BehaviorSubject values
    const currentLifecycle = gameLifecycle$.getValue();
    if (currentLifecycle.type === "connection")
      setLcuConnected(currentLifecycle.connected);
    if (currentLifecycle.type === "phase") {
      setCurrentPhase(currentLifecycle.phase);
      setPollingActive(currentLifecycle.phase === "InProgress");
    }
    setGameStateSnapshot(liveGameState$.getValue());

    // Status card subscriptions (need component state)
    const subs = [
      gameLifecycle$.pipe(skip(1)).subscribe((event) => {
        if (event.type === "connection") setLcuConnected(event.connected);
        if (event.type === "phase") {
          setCurrentPhase(event.phase);
          setPollingActive(event.phase === "InProgress");
        }
      }),

      liveGameState$.pipe(skip(1)).subscribe((state) => {
        setGameStateSnapshot(state);
      }),
    ];

    return () => {
      listeners.delete(listener);
      subs.forEach((s) => s.unsubscribe());
    };
  }, []);

  // Auto-scroll when new entries arrive
  useEffect(() => {
    if (inputBuffer.length > prevInputLen.current) {
      inputLogEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
    prevInputLen.current = inputBuffer.length;
  });

  useEffect(() => {
    if (outputBuffer.length > prevOutputLen.current) {
      outputLogEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
    prevOutputLen.current = outputBuffer.length;
  });

  const filteredInputLog = showNoise
    ? inputBuffer
    : inputBuffer.filter((e) => !e.summary.includes("[noise]"));

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
            gameStateSnapshot
              ? summarizeLiveGameState(gameStateSnapshot)
              : "No data"
          }
          color={gameStateSnapshot?.activePlayer ? "#60a5fa" : "#666"}
        />
      </div>

      <div className="debug-two-columns">
        {/* Left column: Inputs */}
        <div className="debug-column">
          <div className="debug-section-title">
            Data Source Inputs
            <span className="debug-log-count">{filteredInputLog.length}</span>
            <label className="debug-noise-toggle">
              <input
                type="checkbox"
                checked={showNoise}
                onChange={(e) => setShowNoise(e.target.checked)}
              />
              noise
            </label>
            {inputBuffer.length > 0 && (
              <button
                className="debug-clear-btn"
                onClick={() => {
                  inputBuffer.length = 0;
                  bufferVersion++;
                  notifyListeners();
                }}
              >
                Clear
              </button>
            )}
          </div>
          <div className="debug-source-legend">
            {Object.entries(INPUT_COLORS).map(([source, color]) => (
              <span key={source} className="debug-stream-indicator">
                <span
                  className="debug-stream-dot"
                  style={{ backgroundColor: color }}
                />
                <span className="debug-stream-name">{source}</span>
              </span>
            ))}
          </div>
          <div className="debug-log">
            {filteredInputLog.length === 0 && (
              <div className="debug-log-empty">
                Waiting for data source events...
              </div>
            )}
            {filteredInputLog.map((entry) => (
              <LogEntryRow
                key={entry.id}
                entry={entry}
                colors={INPUT_COLORS}
                expandedId={expandedId}
                onToggle={setExpandedId}
              />
            ))}
            <div ref={inputLogEndRef} />
          </div>
        </div>

        {/* Right column: App Observables */}
        <div className="debug-column">
          <div className="debug-section-title">
            App Observables
            <span className="debug-log-count">{outputBuffer.length}</span>
            {outputBuffer.length > 0 && (
              <button
                className="debug-clear-btn"
                onClick={() => {
                  outputBuffer.length = 0;
                  bufferVersion++;
                  notifyListeners();
                }}
              >
                Clear
              </button>
            )}
          </div>
          <div className="debug-source-legend">
            {Object.entries(OUTPUT_COLORS).map(([stream, color]) => (
              <span key={stream} className="debug-stream-indicator">
                <span
                  className="debug-stream-dot"
                  style={{ backgroundColor: color }}
                />
                <span className="debug-stream-name">{stream}</span>
              </span>
            ))}
          </div>
          <div className="debug-log">
            {outputBuffer.length === 0 && (
              <div className="debug-log-empty">
                Waiting for observable emissions...
              </div>
            )}
            {outputBuffer.map((entry) => (
              <LogEntryRow
                key={entry.id}
                entry={entry}
                colors={OUTPUT_COLORS}
                expandedId={expandedId}
                onToggle={setExpandedId}
              />
            ))}
            <div ref={outputLogEndRef} />
          </div>
        </div>
      </div>
    </div>
  );
}

function LogEntryRow({
  entry,
  colors,
  expandedId,
  onToggle,
}: {
  entry: LogEntry;
  colors: Record<string, string>;
  expandedId: number | null;
  onToggle: (id: number | null) => void;
}) {
  return (
    <div
      className={`debug-log-entry${entry.detail ? " expandable" : ""}`}
      onClick={() =>
        entry.detail && onToggle(expandedId === entry.id ? null : entry.id)
      }
    >
      <span className="debug-log-time">{entry.timestamp}</span>
      <span
        className="debug-log-stream"
        style={{ color: colors[entry.stream] ?? "#888" }}
      >
        {entry.stream}
      </span>
      <span className="debug-log-summary">{entry.summary}</span>
      {expandedId === entry.id && entry.detail && (
        <pre className="debug-log-detail">{entry.detail}</pre>
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

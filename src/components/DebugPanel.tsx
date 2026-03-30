import { useState, useEffect, useRef } from "react";
import { skip, distinctUntilChanged, map } from "rxjs/operators";
import { hasGameStateChangedMeaningfully } from "../lib/reactive/debug-filters";
import {
  summarizeLifecycleEvent,
  summarizeLiveGameState,
  summarizeUserInput,
} from "../lib/reactive/debug-summarizers";
import {
  gameLifecycle$,
  liveGameState$,
  userInput$,
  notifications$,
} from "../lib/reactive";
import type { LiveGameState } from "../lib/reactive";

interface LogEntry {
  id: number;
  timestamp: string;
  stream: string;
  summary: string;
}

let nextId = 0;

function formatTime(): string {
  return new Date().toLocaleTimeString("en-US", { hour12: false });
}

const STREAM_COLORS: Record<string, string> = {
  lifecycle: "#4ade80",
  liveGame: "#60a5fa",
  userInput: "#f59e0b",
  notification: "#f87171",
};

const MAX_LOG_ENTRIES = 200;

function formatBufferAsText(entries: LogEntry[]): string {
  return entries
    .map((e) => `[${e.timestamp}] [${e.stream}] ${e.summary}`)
    .join("\n");
}

function copyToClipboard(text: string): void {
  navigator.clipboard.writeText(text);
}

// ---- Module-level log buffer (persists across tab switches) ----

const logBuffer: LogEntry[] = [];
let bufferVersion = 0;
let subscriptionsStarted = false;

function pushEntry(stream: string, summary: string): void {
  // Deduplicate consecutive identical entries from the same stream —
  // the LCU often sends multiple WebSocket events in quick succession
  // with minor field differences that produce the same summary.
  const prev = logBuffer[logBuffer.length - 1];
  if (prev && prev.stream === stream && prev.summary === summary) return;

  logBuffer.push({
    id: nextId++,
    timestamp: formatTime(),
    stream,
    summary,
  });
  if (logBuffer.length > MAX_LOG_ENTRIES) logBuffer.shift();
  bufferVersion++;
  notifyListeners();
}

type Listener = () => void;
const listeners = new Set<Listener>();
function notifyListeners() {
  for (const fn of listeners) fn();
}

function startSubscriptions(): void {
  if (subscriptionsStarted) return;
  subscriptionsStarted = true;

  gameLifecycle$.pipe(skip(1)).subscribe((event) => {
    const summary = summarizeLifecycleEvent(event);

    // Suppress matchmaking ticks that only update timeInQueue
    if (event.type === "matchmaking") {
      const data = event.data as Record<string, unknown> | null;
      if (data) {
        const keys = Object.keys(data);
        if (keys.length === 1 && keys[0] === "timeInQueue") return;
      }
    }

    pushEntry("lifecycle", summary);
  });

  liveGameState$
    .pipe(
      skip(1),
      distinctUntilChanged((a, b) => !hasGameStateChangedMeaningfully(a, b)),
      map((state) => summarizeLiveGameState(state))
    )
    .subscribe((summary) => {
      if (summary !== "Default (no data)") {
        pushEntry("liveGame", summary);
      }
    });

  userInput$.subscribe((event) => {
    pushEntry("userInput", summarizeUserInput(event));
  });

  notifications$.subscribe((notif) => {
    pushEntry("notification", `[${notif.level}] ${notif.message}`);
  });
}

startSubscriptions();

export function DebugPanel() {
  const [, setRenderTick] = useState(0);
  const [currentPhase, setCurrentPhase] = useState<string>("—");
  const [lcuConnected, setLcuConnected] = useState(false);
  const [pollingActive, setPollingActive] = useState(false);
  const [gameStateSnapshot, setGameStateSnapshot] =
    useState<LiveGameState | null>(null);
  const logEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const listener = () => setRenderTick((t) => t + 1);
    listeners.add(listener);

    // Seed status from buffer history
    for (let i = logBuffer.length - 1; i >= 0; i--) {
      const entry = logBuffer[i];
      if (entry.stream === "lifecycle") {
        if (entry.summary === "Connected" || entry.summary === "Disconnected") {
          setLcuConnected(entry.summary === "Connected");
          break;
        }
      }
    }
    for (let i = logBuffer.length - 1; i >= 0; i--) {
      const entry = logBuffer[i];
      if (entry.stream === "lifecycle" && entry.summary.startsWith("Phase: ")) {
        const phase = entry.summary.replace("Phase: ", "");
        setCurrentPhase(phase);
        setPollingActive(phase === "InProgress");
        break;
      }
    }
    setGameStateSnapshot(liveGameState$.getValue());

    const subs = [
      gameLifecycle$.subscribe((event) => {
        if (event.type === "connection") setLcuConnected(event.connected);
        if (event.type === "phase") {
          setCurrentPhase(event.phase);
          setPollingActive(event.phase === "InProgress");
        }
      }),
      liveGameState$.subscribe((state) => {
        setGameStateSnapshot(state);
      }),
    ];

    return () => {
      listeners.delete(listener);
      subs.forEach((s) => s.unsubscribe());
    };
  }, []);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "instant" });
  });

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

      <div className="debug-section-title">
        App Observables
        <span className="debug-log-count">{logBuffer.length}</span>
        {logBuffer.length > 0 && (
          <>
            <button
              className="debug-clear-btn"
              onClick={() => copyToClipboard(formatBufferAsText(logBuffer))}
            >
              Copy All
            </button>
            <button
              className="debug-clear-btn"
              onClick={() => {
                logBuffer.length = 0;
                bufferVersion++;
                notifyListeners();
              }}
            >
              Clear
            </button>
          </>
        )}
      </div>
      <div className="debug-source-legend">
        {Object.entries(STREAM_COLORS).map(([stream, color]) => (
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
        {logBuffer.length === 0 && (
          <div className="debug-log-empty">
            Waiting for observable emissions...
          </div>
        )}
        {logBuffer.map((entry) => (
          <div key={entry.id} className="debug-log-entry">
            <span className="debug-log-time">{entry.timestamp}</span>
            <span
              className="debug-log-stream"
              style={{ color: STREAM_COLORS[entry.stream] ?? "#888" }}
            >
              {entry.stream}
            </span>
            <span className="debug-log-summary">{entry.summary}</span>
          </div>
        ))}
        <div ref={logEndRef} />
      </div>
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

import "./App.css";
import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { useGameData } from "./hooks/useGameData";
import { useGameLifecycle } from "./hooks/useGameLifecycle";
import { useLiveGameState } from "./hooks/useLiveGameState";
import { useUserInput } from "./hooks/useUserInput";
import { useVoiceInput } from "./hooks/useVoiceInput";
import { useZoom } from "./hooks/useZoom";
import { initializeReactiveEngine, userInput$ } from "./lib/reactive";
import type { ReactiveEngine } from "./lib/reactive";
import { getLogger } from "./lib/logger";

const appLog = getLogger("app");
import {
  WhisperProvider,
  LocalWhisperProvider,
} from "./lib/voice/stt-provider";
import { DataBrowser } from "./components/DataBrowser";
import {
  createModeRegistry,
  aramMayhemMode,
  buildEffectiveGameState,
} from "./lib/mode";
import { addSelectedAugment } from "./lib/mode/augment-selection";
import { ensureAbilities } from "./lib/data-ingest/ensure-abilities";
import type { Augment } from "./lib/data-ingest/types";
import type { GameState } from "./lib/game-state/types";

const registry = createModeRegistry();
registry.register(aramMayhemMode);

function App() {
  const engineRef = useRef<ReactiveEngine | null>(null);

  const gepCleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    let disposed = false;
    engineRef.current = initializeReactiveEngine();

    // Initialize GEP bridge for augment detection (no-op if not ow-electron)
    import("./lib/reactive/gep-bridge")
      .then(({ initGepBridge }) => {
        if (disposed) return;
        gepCleanupRef.current = initGepBridge();
      })
      .catch((err) => {
        appLog.warn("Failed to initialize GEP bridge", err);
      });

    return () => {
      disposed = true;
      engineRef.current?.stop();
      engineRef.current = null;
      gepCleanupRef.current?.();
      gepCleanupRef.current = null;
    };
  }, []);

  const { data, loading, error, refresh } = useGameData();
  const lifecycle = useGameLifecycle();
  const liveGame = useLiveGameState();
  const { submit } = useUserInput();
  const { zoom, resetZoom } = useZoom();

  // Voice input STT provider. Prefers local Whisper container when available,
  // falls back to OpenAI Whisper API.
  const whisperProvider = useMemo(() => {
    const localUrl = import.meta.env.VITE_LOCAL_WHISPER_URL as
      | string
      | undefined;
    if (localUrl) {
      appLog.info(`Using local Whisper provider: ${localUrl}`);
      return new LocalWhisperProvider(localUrl);
    }

    const apiKey = import.meta.env.VITE_OPENAI_API_KEY as string | undefined;
    if (!apiKey) {
      appLog.warn(
        "No STT provider available (no VITE_LOCAL_WHISPER_URL or VITE_OPENAI_API_KEY)"
      );
      return null;
    }
    appLog.info("Using OpenAI Whisper provider");
    return new WhisperProvider(apiKey);
  }, []);

  const voice = useVoiceInput(whisperProvider);

  const [selectedAugments, setSelectedAugments] = useState<Augment[]>([]);
  const abilitiesFetchedRef = useRef(false);

  useEffect(() => {
    if (!data || liveGame.players.length === 0) return;
    if (abilitiesFetchedRef.current) return;
    abilitiesFetchedRef.current = true;
    const championNames = liveGame.players.map((p) => p.championName);
    ensureAbilities(data, championNames, data.version).catch(() => {});

    const detectedMode = registry.detect(liveGame.gameMode);
    appLog.info(
      `Game detected: ${liveGame.gameMode} | mode: ${detectedMode?.displayName ?? "none"} | players: ${championNames.length} | augments in data: ${data.augments.size}`
    );
  }, [data, liveGame.players]);

  const prevPhaseRef = useRef<string | null>(null);

  useEffect(() => {
    if (lifecycle.type === "phase") {
      const phase = lifecycle.phase;
      if (phase === "ChampSelect" || phase === "None") {
        if (prevPhaseRef.current !== phase) {
          setSelectedAugments([]);
          abilitiesFetchedRef.current = false;
        }
      }
      prevPhaseRef.current = phase;
    }
  }, [lifecycle]);

  useEffect(() => {
    const sub = userInput$.subscribe((event) => {
      if (event.type === "augment") {
        setSelectedAugments((prev) => {
          // Deduplicate: don't add if already selected (by name)
          if (prev.some((a) => a.name === event.augment.name)) return prev;
          return [...prev, event.augment];
        });
      }
    });
    return () => sub.unsubscribe();
  }, []);

  const selectAugment = useCallback(
    (augment: Augment) => {
      submit({ type: "augment", augment });
    },
    [submit]
  );

  const removeLast = useCallback(() => {
    setSelectedAugments((prev) => prev.slice(0, -1));
  }, []);

  const resetAugments = useCallback(() => {
    setSelectedAugments([]);
  }, []);

  const gameState: GameState = {
    status:
      lifecycle.type === "connection" && !lifecycle.connected
        ? "disconnected"
        : liveGame.activePlayer
          ? "connected"
          : "disconnected",
    activePlayer: liveGame.activePlayer,
    players: liveGame.players,
    gameMode: liveGame.gameMode,
    gameTime: liveGame.gameTime,
  };

  const prevGameModeRef = useRef<string | null>(null);
  useEffect(() => {
    if (!data || gameState.status !== "connected") return;
    const mode = gameState.gameMode;
    if (mode === prevGameModeRef.current) return;
    prevGameModeRef.current = mode;
  }, [data, gameState]);

  const effectiveState = useMemo(() => {
    if (!data || gameState.status !== "connected") {
      return buildEffectiveGameState(gameState, null);
    }
    const detectedMode = registry.detect(gameState.gameMode);
    let modeContext = detectedMode
      ? detectedMode.buildContext(gameState, data)
      : null;

    if (modeContext && selectedAugments.length > 0) {
      const activePlayer = gameState.players.find((p) => p.isActivePlayer);
      if (activePlayer) {
        for (const augment of selectedAugments) {
          modeContext = addSelectedAugment(
            modeContext,
            activePlayer.riotIdGameName,
            augment
          );
        }
      }
    }

    return buildEffectiveGameState(gameState, modeContext);
  }, [gameState, data, selectedAugments]);

  const augmentSelection = {
    selectedAugments,
    select: selectAugment,
    removeLast,
    reset: resetAugments,
  };

  return (
    <main className="container">
      <div className="app-header">
        <div className="header-row">
          <h1>Champ Sage</h1>
          {data && (
            <button
              className="refresh-btn"
              onClick={refresh}
              disabled={loading}
            >
              {loading ? "Loading..." : "Refresh"}
            </button>
          )}
        </div>
        {loading && !data && <p>Loading game data...</p>}
        {error && <p className="error">Error: {error}</p>}
        <div className="header-row">
          {data && <p className="version">Patch {data.version}</p>}
          {zoom !== 1.0 && (
            <button className="zoom-indicator" onClick={resetZoom}>
              {Math.round(zoom * 100)}%
            </button>
          )}
          <span
            className="voice-indicator"
            style={{
              color: voice.isRecording
                ? "#ef4444"
                : voice.isTranscribing
                  ? "#f59e0b"
                  : "#6b7280",
              marginLeft: "8px",
            }}
          >
            {voice.isRecording
              ? "Recording..."
              : voice.isTranscribing
                ? "Transcribing..."
                : `Voice: Num-`}
          </span>
          <button
            style={{ marginLeft: "8px", fontSize: "12px" }}
            onMouseDown={() => voice.startRecording()}
            onMouseUp={() => voice.stopAndTranscribe()}
          >
            Hold to Talk
          </button>
        </div>
      </div>
      {data && (
        <DataBrowser
          data={data}
          effectiveState={effectiveState}
          augmentSelection={augmentSelection}
        />
      )}
    </main>
  );
}

export default App;

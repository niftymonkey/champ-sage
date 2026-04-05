import "./App.css";
import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { CoachingProvider } from "./hooks/useCoachingContext";
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
import { StatusBar } from "./components/StatusBar";
import { InGameView } from "./components/InGameView";
import { LastGameCard } from "./components/coaching";
import { CoachingPipeline } from "./components/CoachingPipeline";
import { DataBrowser } from "./components/DataBrowser";
import {
  createModeRegistry,
  aramMayhemMode,
  aramMode,
  classicMode,
  buildEffectiveGameState,
} from "./lib/mode";
import { addSelectedAugment } from "./lib/mode/augment-selection";
import { ensureAbilities } from "./lib/data-ingest/ensure-abilities";
import type { Augment } from "./lib/data-ingest/types";
import type { GameState } from "./lib/game-state/types";

const registry = createModeRegistry();
registry.register(aramMayhemMode);
registry.register(aramMode);
registry.register(classicMode);

function App() {
  const engineRef = useRef<ReactiveEngine | null>(null);
  const gepCleanupRef = useRef<(() => void) | null>(null);
  const [devMode, setDevMode] = useState(false);

  useEffect(() => {
    let disposed = false;
    engineRef.current = initializeReactiveEngine();

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

  // Ctrl+D toggles dev mode (data browser)
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.ctrlKey && e.key === "d") {
        e.preventDefault();
        setDevMode((prev) => !prev);
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const { data, loading, error } = useGameData();
  const lifecycle = useGameLifecycle();
  const liveGame = useLiveGameState();
  const { submit } = useUserInput();
  useZoom();

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

  const detectedMode = useMemo(() => {
    if (!data || gameState.status !== "connected") return null;
    return registry.detect(gameState.gameMode);
  }, [data, gameState.status, gameState.gameMode]);

  const effectiveState = useMemo(() => {
    if (!data || gameState.status !== "connected") {
      return buildEffectiveGameState(gameState, null);
    }
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
  }, [gameState, data, selectedAugments, detectedMode]);

  const inGame = liveGame.activePlayer !== null;

  const augmentSelection = {
    selectedAugments,
    select: selectAugment,
    removeLast,
    reset: resetAugments,
  };

  if (loading && !data) {
    return (
      <main className="app-root">
        <StatusBar isRecording={voice.isRecording} dataVersion="" />
        <div className="app-loading">Loading game data...</div>
      </main>
    );
  }

  if (error && !data) {
    return (
      <main className="app-root">
        <StatusBar isRecording={voice.isRecording} dataVersion="" />
        <div className="app-error">Error: {error}</div>
      </main>
    );
  }

  if (!data) return null;

  return (
    <main className="app-root">
      <StatusBar isRecording={voice.isRecording} dataVersion={data.version} />
      <CoachingProvider
        mode={detectedMode}
        liveGameState={liveGame}
        gameData={data}
      >
        <CoachingPipeline gameData={data} />
        <div className="app-body">
          {devMode ? (
            <DataBrowser
              data={data}
              effectiveState={effectiveState}
              augmentSelection={augmentSelection}
            />
          ) : inGame ? (
            <InGameView state={effectiveState} gameData={data} />
          ) : (
            <LastGameCard
              dataVersion={data.version}
              championCount={data.champions.size}
              itemCount={data.items.size}
              augmentCount={data.augments.size}
            />
          )}
        </div>
      </CoachingProvider>
    </main>
  );
}

export default App;

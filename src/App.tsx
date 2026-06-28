import "./App.css";
import { useCallback, useState, useEffect, useRef, useMemo } from "react";
import { SWRConfig, useSWRConfig } from "swr";
import { CoachingProvider } from "./hooks/useCoachingContext";
import { localStorageProvider } from "./lib/cache/local-storage-provider";
import { setScopedMutate } from "./lib/cache/swr-bridge";
import {
  wirePostGameReadiness,
  markMatchesRefreshed,
  postGameReady$,
} from "./lib/reactive/post-game-readiness";
import { MATCH_HISTORY_KEY } from "./lib/match-history/runtime";

/**
 * Registers the SWRConfig-scoped `mutate` so non-React engine code (RxJS
 * subscriptions in stores) can invalidate the right cache. Also wires the
 * `onDecisionLogUpdated` IPC listener once at the app root and fans out
 * invalidation to every active decision-log query — saves each consumer
 * from registering its own listener and lets a single write trigger one
 * coordinated revalidation pass. Renders nothing. Must live inside the
 * <SWRConfig> subtree.
 */
function SWRBridge() {
  const { mutate } = useSWRConfig();
  useEffect(() => {
    setScopedMutate(mutate);
  }, [mutate]);
  useEffect(() => {
    const api = window.electronAPI;
    if (!api?.onDecisionLogUpdated) return;
    return api.onDecisionLogUpdated(() => {
      void mutate(
        (key) => Array.isArray(key) && key[0] === "decision-log",
        undefined,
        { revalidate: true }
      );
    });
  }, [mutate]);
  return null;
}
import { useGameData } from "./hooks/useGameData";
import { setMatchHistoryGameData } from "./lib/match-history/runtime";
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
import { InGameView } from "./components/InGameView";
import { CoachingPipeline } from "./components/CoachingPipeline";
import { GepHealthBanner } from "./components/GepHealthBanner";
import { useGepHealth } from "./hooks/useGepHealth";
import { SimulatorPanel } from "./simulator/SimulatorPanel";
import { WindowChrome } from "./surfaces/WindowChrome";
import { ChromeStatus } from "./surfaces/ChromeStatus";
import { IdleSurface } from "./surfaces/IdleSurface";
import { ChampSelectSurface } from "./surfaces/ChampSelectSurface";
import { PostGameSurface } from "./surfaces/PostGameSurface";
import { SettingsSurface } from "./surfaces/SettingsSurface";
import { useSurfaceState } from "./surfaces/useSurfaceState";
import {
  createModeRegistry,
  aramMayhemMode,
  aramMode,
  classicMode,
  buildEffectiveGameState,
  detectMode,
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
    const stopReadiness = wirePostGameReadiness();

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
      stopReadiness();
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
  const { event: lifecycle, lastPhase, championName } = useGameLifecycle();
  const liveGame = useLiveGameState();
  useUserInput();
  useZoom();
  const gepHealth = useGepHealth();
  const handleGepRestart = useCallback(() => {
    window.electronAPI?.restartToUpdate?.();
  }, []);

  useEffect(() => {
    setMatchHistoryGameData(data);
  }, [data]);

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

    const detectedMode = detectMode(
      registry,
      liveGame.gameMode,
      liveGame.lcuGameMode,
      liveGame.mapNumber
    );
    appLog.info(
      `Game detected: ${liveGame.gameMode} (lcu: ${liveGame.lcuGameMode || "n/a"}, map: ${liveGame.mapNumber || "n/a"}) | mode: ${detectedMode?.displayName ?? "none"} | players: ${championNames.length} | augments in data: ${data.augments.size}`
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

  // Status is "connected" if either the LCU is connected OR the simulator
  // has injected game state (activePlayer present without LCU).
  const gameState: GameState = {
    status: liveGame.activePlayer
      ? "connected"
      : lifecycle.type === "connection" && !lifecycle.connected
        ? "disconnected"
        : "disconnected",
    activePlayer: liveGame.activePlayer,
    players: liveGame.players,
    gameMode: liveGame.gameMode,
    gameTime: liveGame.gameTime,
  };

  const detectedMode = useMemo(() => {
    if (!data || gameState.status !== "connected") return null;
    return detectMode(
      registry,
      gameState.gameMode,
      liveGame.lcuGameMode,
      liveGame.mapNumber
    );
  }, [
    data,
    gameState.status,
    gameState.gameMode,
    liveGame.lcuGameMode,
    liveGame.mapNumber,
  ]);

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

  const { surface, navigate } = useSurfaceState();

  // When the user clicks a recent-games row, route to the post-game
  // surface for that specific Riot gameId. The selection is preserved
  // across tab navigation so leaving History and returning to it lands
  // on the same match the user was last looking at. A new game ending
  // clears the selection so the freshly-finished match becomes the
  // default the next time the user opens History.
  const [viewingGameId, setViewingGameId] = useState<string | null>(null);
  const handleSelectGame = useCallback(
    (gameId: string) => {
      setViewingGameId(gameId);
      navigate("post-game");
    },
    [navigate]
  );
  // Clear any explicit game selection the instant a game ends — that's
  // when `postGameReady$` flips to false. Without this, a user who was
  // viewing a specific past game (explicit gameId) when a new game ends
  // keeps that gameId set, which keeps `shouldHide` from engaging (it's
  // gated on `!gameId`). Clearing here lets the surface hide on the
  // transition and then auto-route to the just-finished game.
  useEffect(() => {
    let prevReady = postGameReady$.getValue();
    const sub = postGameReady$.subscribe((ready) => {
      if (prevReady && !ready) {
        setViewingGameId(null);
      }
      prevReady = ready;
    });
    return () => sub.unsubscribe();
  }, []);

  if (loading && !data) {
    return (
      <main className="app-root">
        <WindowChrome
          surface={surface}
          onNavigate={navigate}
          statusContent={
            <ChromeStatus
              isRecording={voice.isRecording}
              voiceAvailable={whisperProvider !== null}
            />
          }
        />
        <div className="app-loading">Loading game data...</div>
      </main>
    );
  }

  if (error && !data) {
    return (
      <main className="app-root">
        <WindowChrome
          surface={surface}
          onNavigate={navigate}
          statusContent={
            <ChromeStatus
              isRecording={voice.isRecording}
              voiceAvailable={whisperProvider !== null}
            />
          }
        />
        <div className="app-error">Error: {error}</div>
      </main>
    );
  }

  if (!data) return null;

  return (
    <main className="app-root">
      <SWRConfig
        value={{
          provider: localStorageProvider,
          revalidateOnFocus: false,
          revalidateOnReconnect: false,
          revalidateIfStale: false,
          revalidateOnMount: false,
          dedupingInterval: 0,
          shouldRetryOnError: false,
          onSuccess: (_data, key) => {
            // `onSuccess` fires AFTER SWR commits the value to its cache,
            // so by the time the post-game readiness gate flips ready
            // the renderer's `matches` already reflects the new fetch.
            // Calling this from inside the fetcher instead would race —
            // the gate would open before the cache was updated.
            if (key === MATCH_HISTORY_KEY) {
              markMatchesRefreshed();
            }
          },
        }}
      >
        <SWRBridge />
        <CoachingProvider
          mode={detectedMode}
          liveGameState={liveGame}
          gameData={data}
        >
          <CoachingPipeline gameData={data} />
          <WindowChrome
            surface={surface}
            onNavigate={navigate}
            statusContent={
              <ChromeStatus
                isRecording={voice.isRecording}
                voiceAvailable={whisperProvider !== null}
              />
            }
          />
          <GepHealthBanner verdict={gepHealth} onRestart={handleGepRestart} />
          <div className="app-body">
            {surface === "in-game" ? (
              <InGameView state={effectiveState} gameData={data} />
            ) : surface === "champ-select" ? (
              <ChampSelectSurface data={data} />
            ) : surface === "post-game" ? (
              <PostGameSurface gameId={viewingGameId} />
            ) : surface === "settings" ? (
              <SettingsSurface />
            ) : (
              <IdleSurface
                lifecycle={lifecycle}
                lastPhase={lastPhase}
                championName={championName}
                onSelectGame={handleSelectGame}
              />
            )}
            {devMode && <SimulatorPanel gameData={data} />}
          </div>
        </CoachingProvider>
      </SWRConfig>
    </main>
  );
}

export default App;

import "./App.css";
import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { useGameData } from "./hooks/useGameData";
import { useGameLifecycle } from "./hooks/useGameLifecycle";
import { useLiveGameState } from "./hooks/useLiveGameState";
import { useUserInput } from "./hooks/useUserInput";
import { useZoom } from "./hooks/useZoom";
import { initializeReactiveEngine } from "./lib/reactive";
import type { ReactiveEngine } from "./lib/reactive";
import { DataBrowser } from "./components/DataBrowser";
import {
  createModeRegistry,
  aramMayhemMode,
  buildEffectiveGameState,
} from "./lib/mode";
import { addSelectedAugment } from "./lib/mode/augment-selection";
import type { Augment } from "./lib/data-ingest/types";
import type { GameState } from "./lib/game-state/types";

const registry = createModeRegistry();
registry.register(aramMayhemMode);

function App() {
  const engineRef = useRef<ReactiveEngine | null>(null);

  useEffect(() => {
    engineRef.current = initializeReactiveEngine();
    return () => {
      engineRef.current?.stop();
      engineRef.current = null;
    };
  }, []);

  const { data, loading, error, refresh } = useGameData();
  const lifecycle = useGameLifecycle();
  const liveGame = useLiveGameState();
  const { submit } = useUserInput();
  const { zoom, resetZoom } = useZoom();

  const [selectedAugments, setSelectedAugments] = useState<Augment[]>([]);

  const prevPhaseRef = useRef<string | null>(null);

  useEffect(() => {
    if (lifecycle.type === "phase") {
      const phase = lifecycle.phase;
      if (phase === "ChampSelect" || phase === "None") {
        if (prevPhaseRef.current !== phase) {
          setSelectedAugments([]);
        }
      }
      prevPhaseRef.current = phase;
    }
  }, [lifecycle]);

  const selectAugment = useCallback(
    (augment: Augment) => {
      setSelectedAugments((prev) => [...prev, augment]);
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

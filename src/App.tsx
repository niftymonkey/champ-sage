import "./App.css";
import { useGameData } from "./hooks/useGameData";
import { useGameState } from "./hooks/useGameState";
import { useEffectiveGameState } from "./hooks/useEffectiveGameState";
import { useZoom } from "./hooks/useZoom";
import { DataBrowser } from "./components/DataBrowser";

function App() {
  const { data, loading, error, refresh } = useGameData();
  const gameState = useGameState();
  const effectiveState = useEffectiveGameState(gameState, data);
  const { zoom, resetZoom } = useZoom();

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
      {data && <DataBrowser data={data} effectiveState={effectiveState} />}
    </main>
  );
}

export default App;

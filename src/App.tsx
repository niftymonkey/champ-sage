import "./App.css";
import { useGameData } from "./hooks/useGameData";
import { DataBrowser } from "./components/DataBrowser";

function App() {
  const { data, loading, error, refresh } = useGameData();

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
        {data && <p className="version">Patch {data.version}</p>}
      </div>
      {data && <DataBrowser data={data} />}
    </main>
  );
}

export default App;

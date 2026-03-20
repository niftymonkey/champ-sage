import type { GameState, PlayerInfo } from "../lib/game-state";

interface GameStateViewProps {
  state: GameState;
}

export function GameStateView({ state }: GameStateViewProps) {
  if (state.status === "disconnected") {
    return (
      <div className="game-status">
        <p className="game-status-label disconnected">No game detected</p>
        <p className="entity-meta">
          Start a game (or Practice Tool) to see live data.
        </p>
      </div>
    );
  }

  if (state.status === "loading") {
    return (
      <div className="game-status">
        <p className="game-status-label loading">Game loading...</p>
        <p className="entity-meta">Waiting for the game to finish loading.</p>
      </div>
    );
  }

  const minutes = Math.floor(state.gameTime / 60);
  const seconds = Math.floor(state.gameTime % 60);
  const timeStr = `${minutes}:${seconds.toString().padStart(2, "0")}`;
  const active = state.activePlayer;

  const orderPlayers = state.players.filter((p) => p.team === "ORDER");
  const chaosPlayers = state.players.filter((p) => p.team === "CHAOS");

  return (
    <div>
      <div className="game-status">
        <p className="game-status-label connected">
          {state.gameMode} | {timeStr}
        </p>
      </div>

      {active && (
        <div className="active-player-card">
          <div className="entity-header">
            <span className="entity-name">{active.championName} (You)</span>
            <span className="entity-meta">
              Lv{active.level} | {Math.floor(active.currentGold)}g
            </span>
          </div>
          <div className="entity-details">
            <div className="stat-grid">
              <span>
                HP: {Math.floor(active.stats.currentHealth)}/
                {Math.floor(active.stats.maxHealth)}
              </span>
              <span>AD: {Math.floor(active.stats.attackDamage)}</span>
              <span>AP: {Math.floor(active.stats.abilityPower)}</span>
              <span>Armor: {Math.floor(active.stats.armor)}</span>
              <span>MR: {Math.floor(active.stats.magicResist)}</span>
              <span>AS: {active.stats.attackSpeed.toFixed(2)}</span>
              <span>AH: {Math.floor(active.stats.abilityHaste)}</span>
              <span>MS: {Math.floor(active.stats.moveSpeed)}</span>
            </div>
            <p className="entity-meta">
              {active.runes.keystone} ({active.runes.primaryTree} /{" "}
              {active.runes.secondaryTree})
            </p>
          </div>
        </div>
      )}

      <TeamSection label="Your Team" players={orderPlayers} />
      <TeamSection label="Enemy Team" players={chaosPlayers} />
    </div>
  );
}

function TeamSection({
  label,
  players,
}: {
  label: string;
  players: PlayerInfo[];
}) {
  if (players.length === 0) return null;

  return (
    <div className="team-section">
      <p className="entity-title">{label}</p>
      <div className="entity-list">
        {players.map((p) => (
          <div
            key={p.riotIdGameName}
            className={`entity-item${p.isActivePlayer ? " active-player" : ""}`}
          >
            <div className="entity-header">
              <span className="entity-name">
                {p.championName}
                {p.isActivePlayer && " (You)"}
              </span>
              <span className="entity-meta">
                Lv{p.level} | {p.kills}/{p.deaths}/{p.assists}
              </span>
            </div>
            <div className="player-items">
              {p.items.length > 0 ? (
                p.items.map((item) => (
                  <span
                    key={`${p.riotIdGameName}-${item.id}`}
                    className="player-item"
                  >
                    {item.name}
                  </span>
                ))
              ) : (
                <span className="entity-meta">No items</span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
